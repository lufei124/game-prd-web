import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/db.ts";
import { Domain } from "../server/domain.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { Knowledge } from "../server/knowledge.ts";
import { Extensions } from "../server/extensions.ts";
import { Tasks } from "../server/tasks.ts";
import { conversationOptions } from "../server/conversation.ts";
import { syncLocalCodexSkills } from "../server/codex-auth.ts";
import { html, metadata, MockRuntime } from "./fixtures.ts";

async function waitFor(store: Store, taskId: string) {
  for (let i = 0; i < 100; i++) {
    const task = store.get<any>("task", taskId);
    if (!["queued", "running"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("task timeout");
}

test("prototype candidate remains preview-only until apply and discard is durable", async () => {
  const root = await mkdtemp(join(tmpdir(), "candidate-lifecycle-"));
  const store = new Store(root);
  try {
    await bootstrap(store);
    const domain = new Domain(store);
    const project = domain.project("候选生命周期");
    const requirement = domain.requirement(project.id, "每日奖励");
    const requirementVersion = domain.save(
      requirement.id,
      "requirement",
      "# 需求卡\n每日奖励",
      null,
    );
    domain.confirm(requirement.id, "requirement", requirementVersion.id);
    const prototype = domain.save(
      requirement.id,
      "prototype",
      html(),
      null,
      metadata,
    );
    const tasks = new Tasks(
      store,
      domain,
      new Extensions(store),
      new Knowledge(store),
      new MockRuntime(),
    );

    const first = tasks.create(
      requirement.id,
      conversationOptions(store, requirement.id, {
        prompt: "把这个按钮放到右边",
        stage: "prototype",
      }),
    );
    const candidate = await waitFor(store, first.id);
    assert.equal(candidate.candidateReady, true);
    assert.equal(
      store.get<any>("requirement", requirement.id).heads.prototype,
      prototype.id,
    );
    const applied = tasks.applyCandidate(first.id);
    assert.notEqual(applied.id, prototype.id);
    assert.match(applied.content, /float:right/);
    assert.equal(store.get<any>("task", first.id).candidateReady, false);
    assert.throws(() => tasks.applyCandidate(first.id), /已经应用/);

    const second = tasks.create(
      requirement.id,
      conversationOptions(store, requirement.id, {
        prompt: "再把这个按钮放到右边",
        stage: "prototype",
      }),
    );
    await waitFor(store, second.id);
    const beforeDiscard = store.get<any>("requirement", requirement.id).heads
      .prototype;
    tasks.discardCandidate(second.id);
    const discarded = store.get<any>("task", second.id);
    assert.equal(discarded.candidate, null);
    assert.ok(discarded.discardedAt);
    assert.equal(
      store.get<any>("requirement", requirement.id).heads.prototype,
      beforeDiscard,
    );
    assert.throws(
      () =>
        domain.save(
          requirement.id,
          "prototype",
          html().replace(
            "</body>",
            '<img src="https://example.com/a.png"></body>',
          ),
          beforeDiscard,
          metadata,
        ),
      /外部网络资源/,
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("one answer closes only the newest waiting frontier", async () => {
  const root = await mkdtemp(join(tmpdir(), "frontier-answer-"));
  const store = new Store(root);
  try {
    await bootstrap(store);
    const domain = new Domain(store);
    const project = domain.project("澄清");
    const requirement = domain.requirement(project.id, "登录");
    store.put("task", {
      id: "older",
      requirementId: requirement.id,
      status: "waiting",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    store.put("question", {
      id: "older-q",
      taskId: "older",
      requirementId: requirement.id,
      question: "旧问题",
      status: "open",
    });
    store.put("task", {
      id: "newer",
      requirementId: requirement.id,
      status: "waiting",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    store.put("question", {
      id: "newer-q",
      taskId: "newer",
      requirementId: requirement.id,
      question: "当前 frontier",
      status: "open",
    });
    const tasks = new Tasks(
      store,
      domain,
      new Extensions(store),
      new Knowledge(store),
      {
        async run() {
          return "继续澄清";
        },
      },
    );
    tasks.create(
      requirement.id,
      conversationOptions(store, requirement.id, { prompt: "企业管理员" }),
    );
    assert.equal(store.get<any>("question", "older-q").status, "open");
    assert.equal(store.get<any>("question", "newer-q").status, "answered");
    assert.equal(store.get<any>("question", "newer-q").answer, "企业管理员");
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("chunked Chinese retrieval returns relevant snippets without whole documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "chunk-search-"));
  const store = new Store(root);
  try {
    const domain = new Domain(store);
    const project = domain.project("知识检索");
    const knowledge = new Knowledge(store);
    const long = [
      "# 账户规范",
      "普通说明。".repeat(260),
      "## 退款与会员规则",
      "会员退款必须在订单详情页发起，超过七天不可退款。",
      "其他说明。".repeat(260),
      "## 风控",
      "高风险账号需要人工复核。",
    ].join("\n\n");
    await knowledge.import(
      project.id,
      null,
      "长期会员规则.md",
      Buffer.from(long),
      "test:membership",
    );
    await knowledge.import(
      project.id,
      null,
      "支付说明.md",
      Buffer.from("# 支付\n正文只讨论银行卡支付。"),
      "test:payment",
    );

    for (const query of [
      "会员退款",
      "退款规则",
      "长期会员规则",
      "订单详情页发起",
    ]) {
      const results = knowledge.search(project.id, null, query);
      assert.equal(results[0].name, "长期会员规则.md");
      assert.equal("text" in results[0], false);
      assert.ok(results[0].matchedChunks.length > 0);
      assert.ok(
        results[0].matchedChunks.every(
          (chunk: any) => chunk.text.length <= 1100,
        ),
      );
    }
    const bodyHit = knowledge.search(project.id, null, "超过七天不可退款")[0];
    assert.match(bodyHit.matchedChunks[0].text, /超过七天不可退款/);
    assert.equal(bodyHit.matchedChunks[0].heading, "退款与会员规则");
    assert.ok(bodyHit.chunkCount >= 3);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("local Codex skills copy regular files, skip symlinks and preserve credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-skills-"));
  const source = join(root, "source");
  const home = join(root, "home");
  const previous = process.env.WORKBENCH_CODEX_SKILLS_DIR;
  try {
    await mkdir(join(source, "demo"), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(join(source, "demo", "SKILL.md"), "# Demo skill");
    await writeFile(join(root, "outside.txt"), "do not copy");
    await symlink(
      join(root, "outside.txt"),
      join(source, "demo", "outside-link"),
    );
    await writeFile(join(home, "auth.json"), "credential-sentinel");
    process.env.WORKBENCH_CODEX_SKILLS_DIR = source;
    const result = await syncLocalCodexSkills(home);
    assert.equal(result.files, 1);
    assert.equal(
      await readFile(join(home, "skills", "demo", "SKILL.md"), "utf8"),
      "# Demo skill",
    );
    await assert.rejects(
      readFile(join(home, "skills", "demo", "outside-link")),
    );
    assert.equal(
      await readFile(join(home, "auth.json"), "utf8"),
      "credential-sentinel",
    );
  } finally {
    if (previous === undefined) delete process.env.WORKBENCH_CODEX_SKILLS_DIR;
    else process.env.WORKBENCH_CODEX_SKILLS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
