import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/db.ts";
import { Domain } from "../server/domain.ts";
import { purgeProject } from "../server/project-purge.ts";
import {
  authHome,
  codexAuthMode,
  codexStatus,
  startCodexLogin,
  logoutCodex,
  withCodexAuth,
} from "../server/codex-auth.ts";

test("subscription login lifecycle and isolated token refresh (fake CLI, no online calls)", async () => {
  const root = await mkdtemp(join(tmpdir(), "subscription-test-"));
  const oldMode = process.env.WORKBENCH_CODEX_AUTH_MODE,
    oldBinary = process.env.WORKBENCH_CODEX_BINARY;
  delete process.env.WORKBENCH_CODEX_AUTH_MODE;
  const binary = join(root, "fake-codex");
  await writeFile(
    binary,
    '#!/bin/sh\nif [ "$4" = "status" ]; then test -f "$CODEX_HOME/auth.json" || exit 1; printf "Logged in using ChatGPT"; exit 0; fi\nprintf "https://auth.openai.com/codex/device\\nABCD-EFGH\\n"\n/bin/sleep 1\nprintf \'{"fake":"initial"}\' > "$CODEX_HOME/auth.json"\n',
    { mode: 0o700 },
  );
  process.env.WORKBENCH_CODEX_BINARY = binary;
  try {
    assert.equal(codexAuthMode(), "subscription");
    assert.equal((await codexStatus(root)).state, "unconfigured");
    await startCodexLogin(root);
    for (let i = 0; i < 50 && !(await codexStatus(root)).login?.code; i++)
      await new Promise((r) => setTimeout(r, 20));
    const pending = await codexStatus(root);
    assert.equal(pending.login?.code, "ABCD-EFGH");
    assert.equal(pending.login?.url, "https://auth.openai.com/codex/device");
    for (
      let i = 0;
      i < 100 && (await codexStatus(root)).login?.state === "waiting";
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    assert.equal((await codexStatus(root)).state, "configured");
    const taskHome = join(root, "codex-home", "task-a");
    await withCodexAuth(
      root,
      taskHome,
      new AbortController().signal,
      async () => {
        assert.equal(
          await readFile(join(taskHome, "auth.json"), "utf8"),
          '{"fake":"initial"}',
        );
        await assert.rejects(logoutCodex(root), /任务结束/);
        await assert.rejects(
          withCodexAuth(
            root,
            join(root, "task-b"),
            new AbortController().signal,
            async () => {},
          ),
          /另一个 Codex/,
        );
        await writeFile(join(taskHome, "auth.json"), '{"fake":"refreshed"}');
      },
    );
    assert.equal(existsSync(join(taskHome, "auth.json")), false);
    assert.equal(
      await readFile(join(authHome(root), "auth.json"), "utf8"),
      '{"fake":"refreshed"}',
    );
    await assert.rejects(
      withCodexAuth(root, taskHome, new AbortController().signal, async () => {
        throw new Error("cancelled");
      }),
      /cancelled/,
    );
    assert.equal(existsSync(join(taskHome, "auth.json")), false);
    assert(!JSON.stringify(await codexStatus(root)).includes("refreshed"));
    await logoutCodex(root);
    assert.equal((await codexStatus(root)).state, "unconfigured");
    await startCodexLogin(root);
    await logoutCodex(root);
    assert.equal(existsSync(join(authHome(root), "auth.json")), false);
  } finally {
    if (oldMode === undefined) delete process.env.WORKBENCH_CODEX_AUTH_MODE;
    else process.env.WORKBENCH_CODEX_AUTH_MODE = oldMode;
    if (oldBinary === undefined) delete process.env.WORKBENCH_CODEX_BINARY;
    else process.env.WORKBENCH_CODEX_BINARY = oldBinary;
    await rm(root, { recursive: true, force: true });
  }
});
test("permanent deletion requires trusted exact-name confirmation and removes only owned files", async () => {
  const root = await mkdtemp(join(tmpdir(), "purge-test-")),
    s = new Store(root),
    d = new Domain(s);
  try {
    const p = d.project("永久删除测试"),
      r = d.requirement(p.id, "需求"),
      keep = d.project("保留项目");
    s.put("knowledge", { id: "owned-file", projectId: p.id });
    s.put("task", {
      id: "owned-task",
      projectId: p.id,
      requirementId: r.id,
      status: "completed",
    });
    await mkdir(join(root, "files"));
    await writeFile(join(root, "files", "owned-file"), "owned");
    await writeFile(join(root, "files", "keep"), "keep");
    await mkdir(join(root, "codex-work", "owned-task"), { recursive: true });
    await writeFile(join(root, "codex-work", "owned-task", "output"), "owned");
    d.deleteProject(p.id, p.name);
    await assert.rejects(purgeProject(s, p.id, p.name, "agent"), /只有用户/);
    await assert.rejects(purgeProject(s, p.id, "错误"), /完整项目名称/);
    assert(existsSync(join(root, "files", "owned-file")));
    await purgeProject(s, p.id, p.name);
    assert(!s.maybe("projectTrash", p.id));
    assert(s.get("project", keep.id));
    assert(!existsSync(join(root, "files", "owned-file")));
    assert(!existsSync(join(root, "codex-work", "owned-task")));
    assert(existsSync(join(root, "files", "keep")));
    assert.throws(() => d.restoreProject(p.id), /不存在/);
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("interrupted purge blocks restore, rejects symlinks and retries safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "purge-retry-")),
    outside = await mkdtemp(join(tmpdir(), "purge-outside-")),
    s = new Store(root),
    d = new Domain(s);
  try {
    const p = d.project("重试清理");
    s.put("knowledge", { id: "protected", projectId: p.id });
    await writeFile(join(outside, "protected"), "safe");
    await symlink(outside, join(root, "files"));
    d.deleteProject(p.id, p.name);
    await assert.rejects(purgeProject(s, p.id, p.name), /软链接/);
    assert.throws(() => d.restoreProject(p.id), /不能恢复/);
    assert.equal(await readFile(join(outside, "protected"), "utf8"), "safe");
    await rm(join(root, "files"));
    await purgeProject(s, p.id, p.name);
    assert(!s.maybe("projectTrash", p.id));
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
