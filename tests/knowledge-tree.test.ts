import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/db.ts";
import { Domain } from "../server/domain.ts";
import { Knowledge } from "../server/knowledge.ts";
import { KnowledgeTree } from "../server/knowledge-tree.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { Tasks } from "../server/tasks.ts";
import { Extensions } from "../server/extensions.ts";
import { MockRuntime } from "./fixtures.ts";

test("knowledge folders migrate legacy modules idempotently without changing history", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge-tree-")),
    s = new Store(root),
    d = new Domain(s);
  try {
    const p = d.project("项目");
    s.put("knowledge", {
      id: "legacy",
      projectId: p.id,
      module: "界面规范",
      name: "old.md",
      hash: "unchanged",
      text: "fact",
    });
    s.put("knowledge", {
      id: "root",
      projectId: p.id,
      module: "general",
      name: "root.md",
    });
    s.put("task", {
      id: "history",
      snapshot: {
        knowledge: [{ id: "legacy", module: "界面规范", hash: "unchanged" }],
      },
    });
    const before = JSON.stringify(s.get("task", "history"));
    new Knowledge(s);
    new Knowledge(s);
    assert.equal(s.all("knowledgeFolder").length, 1);
    assert.equal(s.get("knowledge", "root").folderId, null);
    assert.equal(s.get("knowledge", "legacy").hash, "unchanged");
    assert.equal(JSON.stringify(s.get("task", "history")), before);
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("directory scope, linked materials, deletion and frozen task references (Mock)", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge-links-")),
    s = new Store(root);
  await bootstrap(s);
  const d = new Domain(s),
    k = new Knowledge(s),
    tree = new KnowledgeTree(s);
  try {
    const p = d.project("项目"),
      foreign = d.project("其他项目"),
      r = d.requirement(p.id, "新需求");
    const folder = tree.create(p.id, "规范"),
      child = tree.create(p.id, "页面", folder.id),
      other = tree.create(foreign.id, "其他");
    assert.throws(() => tree.create(p.id, "bad", other.id), /不属于/);
    assert.throws(() => tree.create(p.id, "../bad"), /无效/);
    const file = await k.import(
      p.id,
      null,
      "rule.md",
      Buffer.from("固定的规则"),
      "test",
      "general",
      "pending",
      child.id,
    );
    assert.throws(() => tree.moveFile(file.id, other.id), /不属于/);
    assert.throws(
      () => tree.link(d.requirement(foreign.id, "越权").id, file.id),
      /当前项目/,
    );
    tree.link(r.id, file.id);
    tree.link(r.id, file.id);
    assert.equal(s.all("knowledgeLink").length, 1);
    const runtime = new MockRuntime();
    runtime.fail = true;
    const tasks = new Tasks(s, d, new Extensions(s), k, runtime);
    const task = tasks.create(r.id, { kind: "requirement", prompt: "总结" });
    const frozen = JSON.stringify(task.snapshot);
    assert(task.snapshot.knowledge.some((x: any) => x.id === file.id));
    assert.throws(() => tree.removeFile(file.id, "agent"), /仅用户/);
    tree.removeFolder(folder.id);
    assert.equal(
      s.all("knowledgeFolder").filter((x) => x.projectId === p.id).length,
      0,
    );
    assert.equal(s.all("knowledgeLink").length, 0);
    assert.equal(k.search(p.id, r.id, "").length, 0);
    assert.equal(JSON.stringify(s.get("task", task.id).snapshot), frozen);
    assert.equal((await k.file(file.id)).toString(), "固定的规则");
    assert.throws(() => tree.link(r.id, file.id), /当前项目/);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.throws(
      () =>
        tasks.create(r.id, {
          kind: "requirement",
          prompt: "总结",
          referenceIds: [file.id],
        }),
      /不属于/,
    );
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});
