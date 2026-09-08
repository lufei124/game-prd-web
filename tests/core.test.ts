import { test } from "node:test";
import { request } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../server/db.ts";
import { Domain, completeness, prototypeSchema } from "../server/domain.ts";
import {
  Extensions,
  directoryFiles,
  encoded,
  unzip,
  safeName,
} from "../server/extensions.ts";
import { Knowledge } from "../server/knowledge.ts";
import { Tasks, patchContent, redact } from "../server/tasks.ts";
import { PluginRegistry, Delivery, docToken } from "../server/plugins.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { createApp } from "../server/app.ts";
import { metadata, html, prd, MockRuntime, MockLark } from "./fixtures.ts";
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "forge-test-"));
  const s = new Store(root);
  await bootstrap(s);
  const d = new Domain(s),
    e = new Extensions(s),
    k = new Knowledge(s),
    runtime = new MockRuntime(),
    t = new Tasks(s, d, e, k, runtime);
  const p = d.project("测试项目");
  const r = d.requirement(p.id, "每日奖励");
  return {
    root,
    s,
    d,
    e,
    k,
    t,
    p,
    r,
    runtime,
    close: async () => {
      s.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const wait = async (t: Tasks, id: string) => {
  for (let i = 0; i < 200; i++) {
    const task = t.s.get("task", id);
    if (!["queued", "running"].includes(task.status)) return task;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("task timeout");
};
function confirmed(f: any) {
  const req = f.d.save(f.r.id, "requirement", "每日奖励，每天一次。", null);
  f.d.confirm(f.r.id, "requirement", req.id);
  const proto = f.d.save(f.r.id, "prototype", html(), null, metadata);
  f.d.confirm(f.r.id, "prototype", proto.id);
  return { req, proto };
}
function final(f: any) {
  const c = confirmed(f);
  const doc = f.d.save(f.r.id, "prd", prd, null);
  const review = f.d.save(f.r.id, "review", "review", null, {
    issues: [],
    summary: "reviewed",
  });
  f.d.finalize(f.r.id, doc.id);
  return { ...c, doc, review };
}

test("full workflow with knowledge, two selected style Skills, local patch, restore, confirm and actual custom template snapshot", async () => {
  const f = await setup();
  try {
    const k = await f.k.import(
      f.p.id,
      null,
      "rules.md",
      Buffer.from("每日奖励：每天只能领取一次。"),
      "user-upload",
      "rewards",
      "live",
    );
    assert.equal(k.status, "parsed");
    const task = f.t.create(f.r.id, {
      kind: "requirement",
      prompt: "整理每日奖励",
    });
    const done = await wait(f.t, task.id);
    assert.equal(done.status, "completed");
    f.d.confirm(f.r.id, "requirement", done.resultId);
    let t = f.t.create(f.r.id, { kind: "prototype", prompt: "生成每日奖励" });
    let a = await wait(f.t, t.id);
    assert.equal(a.status, "completed");
    const mint = f.s.get("version", a.resultId);
    assert.match(mint.content, /#397e68/);
    const ink = f.e.list().find((x) => x.name === "墨色编辑风格");
    t = f.t.create(f.r.id, {
      kind: "prototype",
      prompt: "只改变配色风格",
      styleId: ink.id,
      scope: "visual",
    });
    a = await wait(f.t, t.id);
    assert.equal(a.status, "completed");
    const dark = f.s.get("version", a.resultId);
    assert.match(dark.content, /#202521/);
    assert.deepEqual(dark.metadata, mint.metadata);
    const restored = f.d.restore(f.r.id, mint.id, dark.id);
    assert.equal(restored.content, mint.content);
    f.d.confirm(f.r.id, "prototype", restored.id);
    const custom = f.e.install(
      { "template.md": encoded("# 文档\n## 核心决策\n## 测试约定\n") },
      "test",
      { name: "custom", type: "template", stages: ["prd"] },
    );
    t = f.t.create(f.r.id, {
      kind: "prd",
      prompt: "撰写 PRD",
      templateId: custom.extension.id,
    });
    const fixed = f.s
      .get("task", t.id)
      .snapshot.releases.find(
        (x: any) => x.extensionId === custom.extension.id,
      ).id;
    f.e.install(
      { "template.md": encoded("# changed\n## 不应出现") },
      "test",
      { name: "custom", type: "template", stages: ["prd"] },
      custom.extension.id,
    );
    a = await wait(f.t, t.id);
    assert.equal(a.status, "completed");
    const doc = f.s.get("version", a.resultId);
    assert.match(doc.content, /核心决策/);
    assert.doesNotMatch(doc.content, /不应出现/);
    assert.notEqual(
      f.s.get("extension", custom.extension.id).currentRelease,
      fixed,
    );
    t = f.t.create(f.r.id, { kind: "review", prompt: "评审" });
    a = await wait(f.t, t.id);
    assert.equal(a.status, "completed");
    f.d.finalize(f.r.id, doc.id);
    f.d.save(f.r.id, "prototype", html(true), restored.id, metadata);
    const state = f.s.get("requirement", f.r.id);
    assert.equal(state.stale, true);
    assert.equal(state.finalVersion, doc.id);
  } finally {
    await f.close();
  }
});

test("confirmation cannot be inferred, Agent cannot confirm, waive, finalize or publish", async () => {
  const f = await setup();
  try {
    assert.throws(
      () => f.d.save(f.r.id, "prototype", html(), null, metadata),
      /确认当前需求/,
    );
    const v = f.d.save(f.r.id, "requirement", "目标", null);
    assert.throws(
      () => f.d.confirm(f.r.id, "requirement", v.id, "agent"),
      /无权/,
    );
    assert.throws(() => f.d.waive(f.r.id, v.id, "无需 UI", "agent"), /无权/);
    assert.throws(() => f.d.finalize(f.r.id, v.id, "agent"), /无权/);
    f.d.confirm(f.r.id, "requirement", v.id);
    f.d.waive(f.r.id, v.id, "仅后端配置，无 UI 或交互改动");
    assert.ok(f.d.save(f.r.id, "prd", prd, null));
  } finally {
    await f.close();
  }
});

test("optimistic concurrency preserves manual edits and keeps AI candidate", async () => {
  const f = await setup();
  try {
    f.runtime.delay = 60;
    const base = f.d.save(f.r.id, "requirement", "base", null);
    const t = f.t.create(f.r.id, { kind: "requirement", prompt: "AI modify" });
    f.d.save(f.r.id, "requirement", "manual", base.id);
    const done = await wait(f.t, t.id);
    assert.equal(done.status, "failed");
    assert.ok(done.candidate);
    assert.equal(
      f.s.get("version", f.s.get("requirement", f.r.id).heads.requirement)
        .content,
      "manual",
    );
  } finally {
    await f.close();
  }
});

test("cancel, retry, restart recovery and snapshots persist", async () => {
  const f = await setup();
  try {
    f.runtime.delay = 90;
    const t = f.t.create(f.r.id, { kind: "requirement", prompt: "整理" });
    await new Promise((r) => setTimeout(r, 15));
    f.t.cancel(t.id);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(f.s.get("task", t.id).status, "cancelled");
    assert.equal(f.d.versions(f.r.id).length, 0);
    f.runtime.delay = 0;
    const again = f.t.retry(t.id);
    assert.equal((await wait(f.t, again.id)).status, "completed");
    f.s.put("task", {
      ...f.s.get("task", t.id),
      id: "restart",
      status: "running",
    });
    f.t.recover();
    assert.equal(f.s.get("task", "restart").status, "interrupted");
    f.s.close();
    const reopened = new Store(f.root);
    assert.equal(reopened.all("version").length, 1);
    reopened.close();
  } finally {
    await f.close();
  }
});

test("upstream edits invalidate PRD generation and historical restore stays stale", async () => {
  const f = await setup();
  try {
    const { req, proto, doc } = final(f);
    const changed = f.d.save(
      f.r.id,
      "prototype",
      html(true),
      proto.id,
      metadata,
    );
    f.d.confirm(f.r.id, "prototype", changed.id);
    const restored = f.d.restore(f.r.id, doc.id, doc.id);
    assert.equal(f.s.get("requirement", f.r.id).stale, true);
    assert.throws(() => f.d.finalize(f.r.id, restored.id), /待同步/);
    const req2 = f.d.save(f.r.id, "requirement", "修改核心规则", req.id);
    f.d.confirm(f.r.id, "requirement", req2.id);
    assert.throws(
      () => f.d.confirm(f.r.id, "prototype", changed.id),
      /旧需求版本/,
    );
  } finally {
    await f.close();
  }
});

test("visual patches cannot change logic, selection cannot escape, malformed metadata rejected", async () => {
  assert.throws(
    () =>
      patchContent(
        html(),
        [{ search: "claimed=false", replace: "claimed=true" }],
        "visual",
      ),
    /不唯一/,
  );
  assert.throws(
    () =>
      patchContent(
        html(),
        [{ search: "textContent='领取成功'", replace: "textContent='错误'" }],
        "visual",
      ),
    /禁止/,
  );
  assert.throws(
    () =>
      patchContent(
        "hello world",
        [{ search: "world", replace: "bad" }],
        "layout",
        "hello",
      ),
    /超出选区/,
  );
  const f = await setup();
  try {
    const r = f.d.requirement(f.p.id, "only", "prototype");
    assert.throws(
      () =>
        f.d.save(r.id, "prototype", html(), null, { ...metadata, pages: [] }),
      /Too small/,
    );
    assert.throws(
      () =>
        f.d.save(r.id, "prototype", html(), null, {
          ...metadata,
          module: "different",
        }),
      /不一致/,
    );
  } finally {
    await f.close();
  }
});

test("extension disabled, binding, permissions and dependencies enforced and rollback works", async () => {
  const f = await setup();
  try {
    const a = f.e.list()[0];
    f.s.put("extension", { ...f.s.get("extension", a.id), enabled: false });
    assert.throws(() => f.e.select(a.id, f.p.id, "requirement"), /停用/);
    f.s.put("extension", {
      ...f.s.get("extension", a.id),
      enabled: true,
      projectIds: ["other"],
    });
    assert.throws(() => f.e.select(a.id, f.p.id, "requirement"), /绑定/);
    const ex = f.e.install(
      {
        "SKILL.md": encoded(
          "---\nname: dangerous\ndescription: test\n---\n# test",
        ),
        "scripts/x.sh": encoded("touch /tmp/MUST_NOT_EXECUTE"),
      },
      "test",
      { type: "skill", stages: ["prototype"], permissions: ["shell"] },
    );
    assert.equal(ex.release.compatible, false);
    assert.throws(
      () => f.e.select(ex.extension.id, f.p.id, "prototype"),
      /权限/,
    );
    assert.ok(ex.release.files["scripts/x.sh"]);
    const updated = f.e.install(
      {
        "SKILL.md": encoded(
          "---\nname: dangerous\ndescription: test\n---\n# update",
        ),
      },
      "test",
      { type: "skill", stages: ["prototype"] },
      ex.extension.id,
    );
    f.e.rollback(ex.extension.id, ex.release.id);
    assert.equal(
      f.s.get("extension", ex.extension.id).currentRelease,
      ex.release.id,
    );
  } finally {
    await f.close();
  }
});

test("directory traversal, symlinks, unauthorized roots and malicious ZIP are denied", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-import-"));
  try {
    await mkdir(join(root, "allowed"));
    await writeFile(join(root, "secret.txt"), "secret");
    await symlink(join(root, "secret.txt"), join(root, "allowed", "link"));
    await assert.rejects(
      directoryFiles(join(root, "allowed"), [join(root, "allowed")]),
      /软链接/,
    );
    await assert.rejects(
      directoryFiles(root, [join(root, "allowed")]),
      /未获授权/,
    );
    for (const path of [
      "../secret",
      "/etc/passwd",
      "a/../../secret",
      "C:/secret",
      "a\\b",
      ".env",
    ])
      assert.throws(() => safeName(path), /不安全/);
    const malicious = execFileSync("python3", [
      "-c",
      'import zipfile,io,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:z.writestr("../escape.txt","bad")\nsys.stdout.buffer.write(b.getvalue())',
    ]);
    await assert.rejects(unzip(malicious));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("knowledge formats, provenance, conflicts and trusted proposal adoption", async () => {
  const f = await setup();
  try {
    const a = await f.k.import(
      f.p.id,
      null,
      "rule.md",
      Buffer.from("每天领取一次"),
      "manual",
      "rewards",
      "live",
    );
    const b = await f.k.import(
      f.p.id,
      null,
      "rule.md",
      Buffer.from("每天领取两次"),
      "manual",
      "rewards",
      "pending",
    );
    assert.equal(b.version, 2);
    // Historical versions of one logical document are lineage, not conflict.
    assert.equal(f.k.conflicts(f.p.id).length, 0);
    assert.ok(f.k.search(f.p.id, null, "领取").length);
    const image = await f.k.import(
      f.p.id,
      null,
      "pic.png",
      Buffer.from("not parsed"),
      "image",
    );
    assert.equal(image.status, "image");
    assert.equal(image.text, "");
    const unknown = await f.k.import(
      f.p.id,
      null,
      "x.bin",
      Buffer.from("bytes"),
      "upload",
    );
    assert.equal(unknown.status, "unparsed");
    const p = f.k.propose(b.id, "每天领取三次", "用户新目标");
    await assert.rejects(f.k.adopt(p.id, "agent"), /必须由用户/);
    const next = await f.k.adopt(p.id);
    assert.equal(next.version, 3);
    assert.equal(f.s.get("knowledge", a.id).text, "每天领取一次");
    await assert.rejects(f.k.adopt(p.id), /已处理/);
  } finally {
    await f.close();
  }
});

test("tool boundary blocks foreign resources, missing tools and cancelled calls", async () => {
  const f = await setup();
  try {
    const t = f.t.create(f.r.id, { kind: "requirement", prompt: "test" });
    f.s.put("task", { ...t, status: "running" });
    await assert.rejects(f.t.dispatch(t.id, "publish", {}), /未授权/);
    await assert.rejects(
      f.t.dispatch(t.id, "read_resource", {
        releaseId: "other",
        path: "../../.env",
      }),
      /范围|扩展/,
    );
    await assert.rejects(
      f.t.dispatch(t.id, "read_knowledge", { id: "foreign" }),
      /范围/,
    );
    f.t.cancel(t.id);
    await assert.rejects(f.t.dispatch(t.id, "propose_artifact", {}), /已停止/);
  } finally {
    await f.close();
  }
});

test("publish retry idempotency, remote conflict and final state separation", async () => {
  const f = await setup();
  try {
    const { doc } = final(f);
    const mock = new MockLark(),
      registry = new PluginRegistry();
    registry.register(mock);
    const delivery = new Delivery(f.s, registry);
    const approval = await delivery.prepare(f.r.id, doc.id, "my_library");
    const published = await delivery.publish(approval.id);
    assert.equal(published.status, "published");
    await delivery.publish(approval.id);
    assert.equal(mock.creates, 1);
    const remote = await mock.fetch(published.remoteId);
    mock.docs.set(remote.id, {
      ...remote,
      content: "remote edit",
      revision: 2,
    });
    await assert.rejects(
      delivery.prepare(f.r.id, doc.id, "my_library"),
      /远端修改/,
    );
    assert.equal(f.s.get("requirement", f.r.id).finalVersion, doc.id);
  } finally {
    await f.close();
  }
});

test("ambiguous remote create never repeats, reconcile verifies marker", async () => {
  const f = await setup();
  try {
    const { doc } = final(f);
    const mock = new MockLark();
    mock.uncertain = true;
    const registry = new PluginRegistry();
    registry.register(mock);
    const delivery = new Delivery(f.s, registry);
    const a = await delivery.prepare(f.r.id, doc.id, "my_library");
    await assert.rejects(delivery.publish(a.id), /timeout/);
    const record = f.s.all("publication")[0];
    assert.equal(record.status, "uncertain");
    await assert.rejects(
      delivery.prepare(f.r.id, doc.id, "my_library"),
      /核验/,
    );
    await assert.rejects(delivery.publish(a.id));
    assert.equal(mock.creates, 1);
    await delivery.reconcile(record.id, "remote1");
    assert.equal(f.s.get("publication", record.id).status, "published");
    assert.equal(f.s.get("requirement", f.r.id).finalVersion, doc.id);
  } finally {
    await f.close();
  }
});

test("publish checks remote again after approval and missing permissions", async () => {
  const f = await setup();
  try {
    const { doc } = final(f);
    const mock = new MockLark(),
      reg = new PluginRegistry();
    reg.register(mock);
    const delivery = new Delivery(f.s, reg);
    mock.configured = false;
    await assert.rejects(delivery.prepare(f.r.id, doc.id, "my_library"));
    mock.configured = true;
    const first = await delivery.publish(
      (await delivery.prepare(f.r.id, doc.id, "my_library")).id,
    );
    const v2 = f.d.save(f.r.id, "prd", prd + "\n更多说明", doc.id);
    const review = f.d.save(
      f.r.id,
      "review",
      "review",
      f.s.get("requirement", f.r.id).heads.review,
      { summary: "ok", issues: [] },
    );
    f.d.finalize(f.r.id, v2.id);
    const a = await delivery.prepare(f.r.id, v2.id, "my_library");
    const remote = await mock.fetch(first.remoteId);
    mock.docs.set(remote.id, { ...remote, revision: 99 });
    await assert.rejects(delivery.publish(a.id), /发生修改/);
    assert.equal(mock.updates, 0);
  } finally {
    await f.close();
  }
});

test("custom section names are accepted, completeness checks content not fixed headings", () => {
  assert.deepEqual(
    completeness(
      "# 决策\nR-001 每天一次\n# 测试约定\nAC-001 验证 R-001\n失败重试",
    ),
    [],
  );
  assert.ok(completeness("# 漂亮标题").length >= 3);
});

test("logs redact key-shaped secrets and remote tokens disallow arbitrary URLs", () => {
  assert.equal(redact("sk-test_secret_123456789"), "[redacted]");
  assert.throws(() => docToken("https://evil.com/docx/abcdef"), /官方/);
  assert.throws(() => docToken("--command=overwrite"), /无效/);
});

test("HTTP CSRF, DNS rebinding and preview isolation headers", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-api-"));
  const f = await createApp(root, {
    runtime: new MockRuntime(),
    plugin: new MockLark(),
    test: true,
  });
  const server = f.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    const boot = await fetch(base + "/api/bootstrap");
    const cookie = boot.headers.get("set-cookie")!.split(";")[0];
    const data = await boot.json();
    let r = await fetch(base + "/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: '{"name":"forbidden"}',
    });
    assert.equal(r.status, 403);
    r = await fetch(base + "/api/bootstrap", { headers: { Origin: "null" } });
    assert.equal(r.status, 403);
    const hostCode = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          base + "/api/bootstrap",
          { headers: { host: "evil.test" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(hostCode, 403);
    const p = f.domain.project("api"),
      req = f.domain.requirement(p.id, "prototype", "prototype");
    const v = f.domain.save(req.id, "prototype", html(), null, metadata);
    r = await fetch(base + "/api/versions/" + v.id + "/preview", {
      headers: { cookie },
    });
    assert.match(
      r.headers.get("content-security-policy")!,
      /sandbox allow-scripts/,
    );
    assert.match(
      r.headers.get("content-security-policy")!,
      /connect-src 'none'/,
    );
    assert.doesNotMatch(
      r.headers.get("content-security-policy")!,
      /allow-same-origin/,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    f.s.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("extension pack import is atomic and retains standard Skill resource tree", async () => {
  const f = await setup();
  try {
    const files = {
      "workbench-pack.json": encoded(
        JSON.stringify({
          name: "combo",
          extensions: [
            {
              path: "style",
              metadata: {
                name: "pack style",
                type: "style",
                stages: ["prototype"],
              },
            },
            {
              path: "template",
              metadata: {
                name: "pack template",
                type: "template",
                stages: ["prd"],
              },
            },
          ],
        }),
      ),
      "style/SKILL.md": encoded(
        "---\nname: pack-style\ndescription: bundled style\n---\n# style",
      ),
      "style/assets/tokens.json": encoded('{"accent":"orange"}'),
      "template/template.md": encoded("# 文档\n## 决策"),
    };
    const result = f.e.install(files, "test-pack");
    assert.equal(result.installed.length, 2);
    assert.ok(result.installed[0].release.files["assets/tokens.json"]);
    const count = f.e.list().length;
    files["template/template.md"] = "";
    files["workbench-pack.json"] = encoded(
      JSON.stringify({
        name: "bad",
        extensions: [
          { path: "style", metadata: { name: "ok", type: "style" } },
          { path: "missing", metadata: { name: "bad", type: "template" } },
        ],
      }),
    );
    assert.throws(() => f.e.install(files, "bad"));
    assert.equal(f.e.list().length, count);
  } finally {
    await f.close();
  }
});

test("empty heads are not interpreted as a final document", async () => {
  const f = await setup();
  try {
    assert.equal(f.d.stage(f.r), "需求整理与确认");
    const c = confirmed(f);
    assert.equal(
      f.d.stage(f.s.get("requirement", f.r.id)),
      "原型已确认 / 编写 PRD",
    );
  } finally {
    await f.close();
  }
});

test("self-contained prototype contract validates required fields and types", () => {
  assert.equal(prototypeSchema.parse(metadata).schemaVersion, "1.0");
  assert.throws(() => prototypeSchema.parse({ ...metadata, pages: [] }));
  assert.throws(() =>
    prototypeSchema.parse({
      ...metadata,
      device: { platform: [], orientation: "invalid" },
    }),
  );
  assert.throws(() =>
    prototypeSchema.parse({ ...metadata, prototypeStatus: "published" }),
  );
});

test("explicitly accepted remote conflict can be published using a new final PRD", async () => {
  const f = await setup();
  try {
    const { doc } = final(f);
    const mock = new MockLark(),
      reg = new PluginRegistry();
    reg.register(mock);
    const delivery = new Delivery(f.s, reg);
    const first = await delivery.publish(
      (await delivery.prepare(f.r.id, doc.id, "my_library")).id,
    );
    const remote = await mock.fetch(first.remoteId);
    mock.docs.set(remote.id, {
      ...remote,
      content: remote.content + "\n远端新增规则",
      revision: 2,
    });
    const next = f.d.save(f.r.id, "prd", prd + "\n远端新增规则已合并", doc.id);
    f.d.save(
      f.r.id,
      "review",
      "review",
      f.s.get("requirement", f.r.id).heads.review,
      { summary: "ok", issues: [] },
    );
    f.d.finalize(f.r.id, next.id);
    await assert.rejects(
      delivery.prepare(f.r.id, next.id, "my_library"),
      /远端修改/,
    );
    const ticket = await delivery.previewRemote(first.id);
    await delivery.acceptRemote(ticket.id);
    const p = await delivery.publish(
      (await delivery.prepare(f.r.id, next.id, "my_library")).id,
    );
    assert.equal(p.status, "published");
    assert.equal(mock.creates, 1);
    assert.equal(mock.updates, 1);
  } finally {
    await f.close();
  }
});

test("DOCX and PDF parsing produces actual extracted text", async () => {
  const f = await setup();
  try {
    const docx = execFileSync("python3", [
      "-c",
      `import io,zipfile,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Daily reward rule</w:t></w:r></w:p></w:body></w:document>')
sys.stdout.buffer.write(b.getvalue())`,
    ]);
    const parsed = await f.k.import(f.p.id, null, "rule.docx", docx, "test");
    assert.equal(parsed.status, "parsed");
    assert.match(parsed.text, /Daily reward rule/);
    const pdf = execFileSync("python3", [
      "-c",
      `import sys
objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
stream='BT /F1 12 Tf 50 700 Td (Daily PDF reward) Tj ET'
objects.append('<< /Length '+str(len(stream))+' >>\\nstream\\n'+stream+'\\nendstream')
data=b'%PDF-1.4\\n'; offsets=[0]
for i,o in enumerate(objects,1):
 offsets.append(len(data)); data+=(str(i)+' 0 obj\\n'+o+'\\nendobj\\n').encode()
xref=len(data);data+=('xref\\n0 6\\n0000000000 65535 f \\n'+''.join(f'{x:010} 00000 n \\n' for x in offsets[1:])+f'trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n{xref}\\n%%EOF').encode();sys.stdout.buffer.write(data)`,
    ]);
    const parsedPdf = await f.k.import(f.p.id, null, "rule.pdf", pdf, "test");
    assert.equal(parsedPdf.status, "parsed", parsedPdf.error);
    assert.match(parsedPdf.text, /Daily PDF reward/);
  } finally {
    await f.close();
  }
});

test("a delivery marker alone cannot falsely verify a partial remote document", async () => {
  const f = await setup();
  try {
    const { doc } = final(f);
    const mock = new MockLark();
    const create = mock.create.bind(mock);
    mock.create = async (title, content, target) => {
      const result = await create(title, content, target);
      const remote = mock.docs.get(result.id)!;
      mock.docs.set(result.id, {
        ...remote,
        content: content.match(/交付标识：.+/)![0],
      });
      return result;
    };
    const registry = new PluginRegistry();
    registry.register(mock);
    const delivery = new Delivery(f.s, registry);
    const a = await delivery.prepare(f.r.id, doc.id, "my_library");
    await assert.rejects(delivery.publish(a.id), /正文|内容/);
    assert.equal(f.s.all("publication")[0].status, "uncertain");
    assert.equal(f.s.get("requirement", f.r.id).finalVersion, doc.id);
  } finally {
    await f.close();
  }
});
