import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/db.ts";
import { Domain } from "../server/domain.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { Extensions } from "../server/extensions.ts";
import { Tasks } from "../server/tasks.ts";
import { Knowledge } from "../server/knowledge.ts";
import { conversationOptions } from "../server/conversation.ts";
import { runReviewPanel, reviewRoles } from "../server/review-panel.ts";

test("conversation stage is explicit; keywords do not switch stage or style", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-"));
  const s = new Store(root);
  try {
    await bootstrap(s);
    const d = new Domain(s), p = d.project("产品"), r = d.requirement(p.id, "需求");
    const o = conversationOptions(s, r.id, { prompt: "PRD 和原型是什么意思？切换墨色风格", stage: "requirement" });
    assert.equal(o.kind, "requirement");
    assert.equal(o.styleId, undefined);
    const v = d.save(r.id, "requirement", "需求卡", null);
    d.confirm(r.id, "requirement", v.id);
    assert.equal(conversationOptions(s, r.id, { prompt: "你好" }).kind, "prototype");
    assert.equal(conversationOptions(s, r.id, { prompt: "修改按钮操作", stage: "prototype" }).scope, "layout");
    assert.equal(conversationOptions(s, r.id, { prompt: "补充需求卡", stage: "requirement" }).kind, "requirement");
    const style = new Extensions(s).list().find((e) => e.name === "低保真线框风格")!;
    s.put("requirement", { ...s.get("requirement", r.id), assistantDefaults: { styleId: style.id } });
    const tasks = new Tasks(s, d, new Extensions(s), new Knowledge(s), { async run() { return "讨论"; } });
    const t = tasks.create(r.id, conversationOptions(s, r.id, { prompt: "讨论原型", stage: "prototype" }));
    assert.equal(t.snapshot.releases.filter((x: any) => x.manifest.type === "style").length, 1);
    assert.equal(t.snapshot.releases.find((x: any) => x.manifest.type === "style").extensionId, style.id);
    tasks.cancel(t.id);
    await new Promise(resolve => setImmediate(resolve));
  } finally { s.close(); await rm(root, { recursive: true, force: true }); }
});

test("review uses three isolated calls and publishes one aggregate; partial failures publish nothing (Mock)", async () => {
  const inputs: any[] = [], outputs: any[] = [];
  const runtime = { async run(input: any, host: any) {
    inputs.push(input);
    await host.read("propose_artifact", { metadata: { summary: "已检查", issues: [{ id: "same", severity: "major", description: "需澄清", suggestion: "补充规则" }] } });
    return "评审完成";
  } };
  const input: any = { id: "review", kind: "review", prompt: "评审", snapshot: { reviewRoles, heads: { prd: "frozen" } }, signal: new AbortController().signal };
  const host: any = { progress() {}, session() {}, async read(name: string, args: any) { outputs.push({ name, args }); } };
  await runReviewPanel(runtime, input, host);
  assert.equal(inputs.length, 3);
  assert.equal(new Set(inputs.map(i => i.prompt)).size, 3);
  assert(inputs.every(i => i.snapshot === input.snapshot));
  assert.equal(outputs.length, 1);
  assert.equal(new Set(outputs[0].args.metadata.issues.map((i: any) => i.id)).size, 3);
  outputs.length = 0;
  await assert.rejects(runReviewPanel({ async run() { throw new Error("offline"); } }, input, host), /offline/);
  assert.equal(outputs.length, 0);
});

test("default upgrade backs up data and appends releases while preserving user edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-upgrade-"));
  const s = new Store(root);
  try {
    await bootstrap(s);
    const ex = new Extensions(s);
    const reqSkill = s.all("extension").find(e => e.builtinKey === "requirement");
    const old = s.get("release", reqSkill.currentRelease);
    // Simulate the previous pristine bundled release without mutating real data.
    const previous = { ...old, files: { ...old.files, [old.main]: Buffer.from("old instructions").toString("base64") }, source: "builtin:game-prd-web/requirement@1" };
    s.put("release", previous);
    const prototype = s.all("extension").find(e => e.builtinKey === "prototype");
    const protoRelease = s.get("release", prototype.currentRelease);
    const user = ex.install(protoRelease.files, "local-editor", protoRelease.manifest, prototype.id);
    s.put("settings", { ...s.get("settings", "system"), standaloneDefaultsRevision: 1 });
    await bootstrap(s);
    assert.notEqual(s.get("extension", reqSkill.id).currentRelease, old.id);
    assert.deepEqual(s.get("release", old.id), previous);
    assert.equal(s.get("extension", prototype.id).currentRelease, user.release.id);
    assert.equal((await readdir(join(root, "backups"))).length, 1);
    const releases = s.all("release");
    await bootstrap(s);
    assert.deepEqual(s.all("release"), releases);
  } finally { s.close(); await rm(root, { recursive: true, force: true }); }
});
