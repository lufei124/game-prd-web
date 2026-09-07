import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../server/db.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { Domain } from "../server/domain.ts";
import {
  Extensions,
  githubLocation,
  githubArchiveFiles,
  encoded,
} from "../server/extensions.ts";
import { Tasks } from "../server/tasks.ts";
import { Knowledge } from "../server/knowledge.ts";
import {
  resolveAssistant,
  assistantDefaults,
} from "../server/assistant-settings.ts";
import {
  CodexExecutor,
  RuntimeRouter,
  submitCodexOutput,
} from "../server/codex.ts";
import { MockRuntime } from "./fixtures.ts";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-changes-"));
  const s = new Store(root);
  await bootstrap(s);
  return {
    root,
    s,
    d: new Domain(s),
    close: async () => {
      s.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("Codex is default, settings precedence and immutable retry snapshots", async () => {
  const f = await fixture();
  try {
    const p = f.d.project("模型测试"),
      r = f.d.requirement(p.id, "需求");
    const runtime = new MockRuntime();
    runtime.fail = true;
    const tasks = new Tasks(
      f.s,
      f.d,
      new Extensions(f.s),
      new Knowledge(f.s),
      runtime,
    );
    assert.deepEqual(
      resolveAssistant(f.s.get("settings", "system")),
      assistantDefaults,
    );
    f.s.put("project", {
      ...p,
      defaults: {
        executor: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      },
    });
    const t = tasks.create(r.id, {
      kind: "requirement",
      prompt: "整理",
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
    });
    assert.equal(t.snapshot.executor, "codex");
    assert.equal(t.snapshot.model, "gpt-6-astra");
    assert.equal(t.snapshot.reasoningEffort, "xhigh");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(f.s.get("task", t.id).status, "failed");
    f.s.put("settings", {
      ...f.s.get("settings", "system"),
      model: "gpt-5.5",
      reasoningEffort: "low",
    });
    const retry = tasks.retry(t.id);
    assert.equal(retry.snapshot.model, "gpt-6-astra");
    await new Promise((r) => setTimeout(r, 40));
    assert.throws(() =>
      resolveAssistant(
        { executor: "codex", model: "gpt-5.6-terra" },
        {},
        { reasoningEffort: "bogus" },
      ),
    );
    assert.equal(
      resolveAssistant(
        { executor: "codex", model: "gpt-5.6-terra" },
        {},
        { executor: "claude" },
      ).model,
      "claude-sonnet-4-6",
    );
  } finally {
    await f.close();
  }
});
test("bootstrap preserves existing assistant choices and Chinese display without rewriting releases", async () => {
  const f = await fixture();
  try {
    const before = f.s.all("release");
    const old = f.s.get("settings", "system");
    f.s.put("settings", {
      ...old,
      assistantMigration: undefined,
      executor: undefined,
      model: "claude-sonnet-4-6",
    });
    await bootstrap(f.s);
    assert.equal(f.s.get("settings", "system").model, "claude-sonnet-4-6");
    assert.deepEqual(f.s.all("release"), before);
    const skills = new Extensions(f.s)
      .list()
      .filter((e) => e.type !== "template");
    assert.equal(skills.length, 7);
    assert.ok(
      skills.every(
        (e) =>
          /[\u4e00-\u9fff]/.test(e.name) &&
          /[\u4e00-\u9fff]/.test(e.description),
      ),
    );
    f.s.put("settings", {
      ...f.s.get("settings", "system"),
      executor: "claude",
      model: "claude-custom",
    });
    await bootstrap(f.s);
    assert.equal(f.s.get("settings", "system").model, "claude-custom");
  } finally {
    await f.close();
  }
});
test("project delete is confirmed, reversible, scoped and refuses running work", async () => {
  const f = await fixture();
  try {
    const p = f.d.project("待删除"),
      r = f.d.requirement(p.id, "需求"),
      other = f.d.project("保留");
    const v = f.d.save(r.id, "requirement", "需求正文", null);
    const k = await new Knowledge(f.s).import(
      p.id,
      null,
      "资料.md",
      Buffer.from("资料"),
      "upload",
      "模块",
      "pending",
    );
    assert.throws(() => f.d.deleteProject(p.id, p.name, "agent"), /用户/);
    assert.throws(() => f.d.deleteProject(p.id, "错误"), /名称/);
    f.s.put("task", {
      id: "busy",
      projectId: p.id,
      requirementId: r.id,
      status: "running",
    });
    assert.throws(() => f.d.deleteProject(p.id, p.name), /任务/);
    f.s.put("task", {
      id: "busy",
      projectId: p.id,
      requirementId: r.id,
      status: "cancelled",
    });
    f.s.put("publication", {
      id: "pub",
      requirementId: r.id,
      status: "writing",
    });
    assert.throws(() => f.d.deleteProject(p.id, p.name), /发布/);
    f.s.remove("publication", "pub");
    f.d.deleteProject(p.id, p.name);
    assert.equal(f.s.maybe("version", v.id), undefined);
    assert.equal(f.s.maybe("knowledge", k.id), undefined);
    assert.ok(f.s.get("project", other.id));
    f.d.restoreProject(p.id);
    assert.equal(f.s.get("version", v.id).content, "需求正文");
    assert.equal((await new Knowledge(f.s).file(k.id)).toString(), "资料");
    assert.equal(f.s.all("projectTrash").length, 0);
  } finally {
    await f.close();
  }
});
test("GitHub import accepts repo, tree and SKILL file, detects ambiguous repos and malicious links", () => {
  assert.deepEqual(githubLocation("https://github.com/owner/repo"), {
    owner: "owner",
    repo: "repo",
    ref: undefined,
    sub: [],
  });
  assert.deepEqual(
    githubLocation(
      "https://github.com/owner/repo/blob/main/skills/demo/SKILL.md",
    ).sub,
    ["skills", "demo"],
  );
  assert.equal(
    githubLocation("https://github.com/owner/repo/tree/main/demo").ref,
    "main",
  );
  for (const url of [
    "http://github.com/o/r",
    "https://evil.com/o/r",
    "https://github.com:444/o/r",
    "https://github.com/o/r/tree/main/%2e%2e%2fevil",
    "https://github.com/o/r/blob/main/readme.md",
  ])
    assert.throws(() => githubLocation(url));
  const all = {
    "repo-main/skills/a/SKILL.md": encoded("skill"),
    "repo-main/skills/a/assets/a.txt": encoded("asset"),
    "repo-main/skills/b/SKILL.md": encoded("other"),
  };
  assert.throws(() => githubArchiveFiles(all, []), /多个 Skill/);
  assert.deepEqual(Object.keys(githubArchiveFiles(all, ["skills", "a"])), [
    "SKILL.md",
    "assets/a.txt",
  ]);
});
test("Codex SDK adapter passes model and effort for all stages, forwards only controlled proposals (SDK Mock)", async () => {
  const f = await fixture();
  const oldBinary = process.env.WORKBENCH_CODEX_BINARY,
    oldKey = process.env.WORKBENCH_CODEX_API_KEY;
  process.env.WORKBENCH_CODEX_BINARY = "/bin/echo";
  const oldMode = process.env.WORKBENCH_CODEX_AUTH_MODE;
  process.env.WORKBENCH_CODEX_AUTH_MODE = "api-key";
  process.env.WORKBENCH_CODEX_API_KEY = "test-only-not-a-real-key";
  try {
    const calls: any[] = [];
    let threadOptions: any, clientOptions: any;
    const runtime = new CodexExecutor(((opts: any) => {
      clientOptions = opts;
      return {
        startThread: (opts: any) => {
          threadOptions = opts;
          return {
            runStreamed: async (request: any) => ({
              events: (async function* () {
                calls.push(request);
                yield { type: "thread.started", thread_id: "test-thread" };
                yield {
                  type: "item.completed",
                  item: {
                    type: "agent_message",
                    text: JSON.stringify({
                      content: "候选正文",
                      metadataJson: "{}",
                      summary: "完成",
                      patches: [],
                      question: "",
                    }),
                  },
                };
              })(),
            }),
          };
        },
      };
    }) as any);
    const host: any = {
      read: async (n: string, args: any) => {
        calls.push({ n, args });
        return {};
      },
      progress: () => {},
      session: () => {},
    };
    const router = new RuntimeRouter(
      {
        run: async () => {
          throw new Error("must not silently use Claude");
        },
      },
      runtime,
    );
    for (const kind of ["requirement", "prototype", "prd", "review"])
      await router.run(
        {
          id: kind,
          kind,
          prompt: "执行",
          root: f.root,
          model: "gpt-6-astra",
          signal: new AbortController().signal,
          snapshot: {
            executor: "codex",
            reasoningEffort: "high",
            releases: [],
            knowledge: [],
          },
        },
        host,
      );
    assert.equal(threadOptions.model, "gpt-6-astra");
    assert.equal(threadOptions.modelReasoningEffort, "high");
    assert.equal(threadOptions.sandboxMode, "read-only");
    assert.equal(clientOptions.config.features.shell_tool, false);
    assert.equal(clientOptions.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(calls.filter((x) => x.n === "propose_artifact").length, 4);
    await submitCodexOutput(
      JSON.stringify({
        content: "",
        metadataJson: "{}",
        summary: "需确认",
        patches: [],
        question: "目标用户是谁？",
      }),
      host,
    );
    assert.equal(calls.at(-1).n, "ask_question");
    await assert.rejects(() =>
      submitCodexOutput(JSON.stringify({ tool: "deleteProject" }), host),
    );
  } finally {
    if (oldBinary === undefined) delete process.env.WORKBENCH_CODEX_BINARY;
    else process.env.WORKBENCH_CODEX_BINARY = oldBinary;
    if (oldMode === undefined) delete process.env.WORKBENCH_CODEX_AUTH_MODE;
    else process.env.WORKBENCH_CODEX_AUTH_MODE = oldMode;
    if (oldKey === undefined) delete process.env.WORKBENCH_CODEX_API_KEY;
    else process.env.WORKBENCH_CODEX_API_KEY = oldKey;
    await f.close();
  }
});
