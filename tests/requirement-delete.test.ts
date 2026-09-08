import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/db.ts";
import { Domain } from "../server/domain.ts";
import { Knowledge } from "../server/knowledge.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { purgeProject, purgeRequirement } from "../server/project-purge.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "requirement-delete-"));
  const s = new Store(root);
  await bootstrap(s);
  const d = new Domain(s);
  return {
    root,
    s,
    d,
    close: async () => {
      s.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("requirement deletion checks user, exact name, active tasks and publishing", async () => {
  const f = await fixture();
  try {
    const p = f.d.project("项目"),
      r = f.d.requirement(p.id, "需求");
    assert.throws(() => f.d.deleteRequirement(r.id, r.name, "agent"), /用户/);
    assert.throws(() => f.d.deleteRequirement(r.id, "错误"), /名称/);
    for (const status of ["queued", "running", "waiting"]) {
      f.s.put("task", {
        id: "task",
        requirementId: r.id,
        projectId: p.id,
        status,
      });
      assert.throws(() => f.d.deleteRequirement(r.id, r.name), /任务/);
      assert(f.s.maybe("requirement", r.id));
    }
    f.s.put("task", {
      id: "task",
      requirementId: r.id,
      projectId: p.id,
      status: "completed",
    });
    f.s.put("publication", {
      id: "pub",
      requirementId: r.id,
      status: "writing",
    });
    assert.throws(() => f.d.deleteRequirement(r.id, r.name), /发布/);
  } finally {
    await f.close();
  }
});

test("requirement recycle and restore preserve immutable history, attachments and sibling data atomically", async () => {
  const f = await fixture();
  try {
    const p = f.d.project("项目"),
      r = f.d.requirement(p.id, "需求"),
      other = f.d.requirement(p.id, "保留需求");
    const k = new Knowledge(f.s);
    const shared = await k.import(
      p.id,
      null,
      "共享.md",
      Buffer.from("共享规则"),
      "manual:shared",
    );
    const owned = await k.import(
      p.id,
      r.id,
      "专属.md",
      Buffer.from("专属规则"),
      "upload:owned",
    );
    const v = f.d.save(r.id, "requirement", "# 需求", null);
    f.d.confirm(r.id, "requirement", v.id);
    const storedVersion = f.s.get("version", v.id);
    f.s.put("message", {
      id: "message",
      requirementId: r.id,
      content: "保留内容",
    });
    f.s.put("task", {
      id: "task",
      requirementId: r.id,
      projectId: p.id,
      status: "completed",
      snapshot: {
        heads: { requirement: v.id },
        contextPack: { items: [{ knowledgeId: owned.id }] },
      },
    });
    const snapshot = JSON.stringify(f.s.get("requirement", r.id));
    const task = JSON.stringify(f.s.get("task", "task"));
    const chunks = k.index.chunks(owned.id);
    f.d.deleteRequirement(r.id, r.name);
    assert(!f.s.maybe("requirement", r.id));
    assert(!f.s.maybe("knowledge", owned.id));
    assert(f.s.maybe("knowledge", shared.id));
    assert(f.s.maybe("requirement", other.id));
    assert.equal(
      (await readFile(join(f.root, "files", owned.id))).toString(),
      "专属规则",
    );
    assert(
      k
        .search(p.id, r.id, "专属规则")
        .every((item: any) => item.id !== owned.id),
    );
    assert.deepEqual(k.index.chunks(owned.id), chunks);
    assert.throws(() => f.d.restoreRequirement(r.id, "agent"), /用户/);
    f.s.put("message", { id: "message", content: "冲突" });
    assert.throws(() => f.d.restoreRequirement(r.id), /覆盖/);
    assert(!f.s.maybe("requirement", r.id));
    f.s.remove("message", "message");
    f.d.restoreRequirement(r.id);
    assert.equal(JSON.stringify(f.s.get("requirement", r.id)), snapshot);
    assert.equal(JSON.stringify(f.s.get("task", "task")), task);
    assert.deepEqual(f.s.get("version", v.id), storedVersion);
    assert(
      k
        .search(p.id, r.id, "专属规则")
        .some((item: any) => item.id === owned.id),
    );
    assert(!f.s.maybe("requirementTrash", r.id));
  } finally {
    await f.close();
  }
});

test("project recovery and permanent cleanup include already recycled requirements", async () => {
  const f = await fixture();
  try {
    const p = f.d.project("项目"),
      r = f.d.requirement(p.id, "需求");
    const k = new Knowledge(f.s);
    const owned = await k.import(
      p.id,
      r.id,
      "专属.md",
      Buffer.from("专属规则"),
      "upload:owned",
    );
    f.d.deleteRequirement(r.id, r.name);
    f.d.deleteProject(p.id, p.name);
    assert(!f.s.maybe("requirementTrash", r.id));
    f.d.restoreProject(p.id);
    assert(f.s.maybe("requirementTrash", r.id));
    f.d.restoreRequirement(r.id);
    assert(f.s.maybe("knowledge", owned.id));
    f.d.deleteRequirement(r.id, r.name);
    f.d.deleteProject(p.id, p.name);
    await purgeProject(f.s, p.id, p.name);
    await assert.rejects(readFile(join(f.root, "files", owned.id)));
    assert.deepEqual(k.index.chunks(owned.id), []);
    assert(!f.s.maybe("requirementTrash", r.id));
  } finally {
    await f.close();
  }
});

test("permanent requirement deletion clears owned files and index only, blocks restore while purging", async () => {
  const f = await fixture();
  try {
    const p = f.d.project("项目"),
      r = f.d.requirement(p.id, "需求"),
      other = f.d.requirement(p.id, "其他需求");
    const k = new Knowledge(f.s);
    const shared = await k.import(
      p.id,
      null,
      "共享.md",
      Buffer.from("共享规则"),
      "manual:shared",
    );
    const owned = await k.import(
      p.id,
      r.id,
      "独有.md",
      Buffer.from("独有规则"),
      "upload:owned",
    );
    f.d.deleteRequirement(r.id, r.name);
    await assert.rejects(purgeRequirement(f.s, r.id, r.name, "agent"), /用户/);
    await assert.rejects(purgeRequirement(f.s, r.id, "错误"), /名称/);
    f.s.put("requirementTrash", {
      ...f.s.get("requirementTrash", r.id),
      purging: true,
    });
    assert.throws(() => f.d.restoreRequirement(r.id), /不能恢复/);
    assert.throws(() => f.d.deleteProject(p.id, p.name), /清理/);
    await purgeRequirement(f.s, r.id, r.name);
    assert(!f.s.maybe("requirementTrash", r.id));
    await assert.rejects(readFile(join(f.root, "files", owned.id)));
    assert.equal(
      (await readFile(join(f.root, "files", shared.id))).toString(),
      "共享规则",
    );
    assert.equal(k.index.chunks(owned.id).length, 0);
    assert(k.index.chunks(shared.id).length > 0);
    assert(f.s.maybe("requirement", other.id));
    assert.throws(() => f.d.restoreRequirement(r.id));
  } finally {
    await f.close();
  }
});
