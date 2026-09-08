import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDualPrototype, prototypeSchema } from "../server/domain.ts";
import { html, metadata } from "./fixtures.ts";
test("dual prototype requires both styles and one matching explanation per page", () => {
  assert.doesNotThrow(() => validateDualPrototype(html(), metadata));
  assert.throws(
    () =>
      validateDualPrototype(
        html().replace('id="prototype-wireframe"', 'id="missing"'),
        metadata,
      ),
    /prototype-wireframe/,
  );
  const invalid = structuredClone(metadata);
  invalid.presentation.explanations[0].pageId = "unknown";
  assert.throws(() => validateDualPrototype(html(), invalid), /对应解释/);
  const duplicate = structuredClone(metadata);
  duplicate.presentation.explanations.push(
    duplicate.presentation.explanations[0],
  );
  assert.throws(() => validateDualPrototype(html(), duplicate), /不可重复/);
  const legacy: any = structuredClone(metadata);
  delete legacy.presentation;
  assert.doesNotThrow(() => prototypeSchema.parse(legacy));
  assert.throws(() => validateDualPrototype(html(), legacy), /同时提供/);
  assert.throws(
    () =>
      validateDualPrototype(html().replace("每日奖励页", "其他说明"), metadata),
    /不一致/,
  );
});

test("new tasks based on legacy single-view versions still require a dual prototype", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Store } = await import("../server/db.ts");
  const { Domain } = await import("../server/domain.ts");
  const { bootstrap } = await import("../server/bootstrap.ts");
  const { Extensions } = await import("../server/extensions.ts");
  const { Knowledge } = await import("../server/knowledge.ts");
  const { Tasks } = await import("../server/tasks.ts");
  const root = await mkdtemp(join(tmpdir(), "legacy-dual-")),
    s = new Store(root);
  try {
    await bootstrap(s);
    const d = new Domain(s),
      p = d.project("legacy"),
      r = d.requirement(p.id, "legacy", "prototype");
    const legacy: any = structuredClone(metadata);
    delete legacy.presentation;
    const content = html().replace(
      JSON.stringify(metadata),
      JSON.stringify(legacy),
    );
    const v = d.save(r.id, "prototype", content, null, legacy);
    const tasks = new Tasks(s, d, new Extensions(s), new Knowledge(s), {
      async run() {
        return "Mock";
      },
    });
    const t = tasks.create(r.id, {
      kind: "prototype",
      prompt: "重新生成原型",
      scope: "layout",
    });
    assert.equal(t.base, v.id);
    assert.equal(t.snapshot.dualPrototype, true);
    assert.equal(t.snapshot.upgradePrototype, true);
    assert.throws(() => validateDualPrototype(content, legacy), /同时提供/);
    assert.equal(s.get("version", v.id).metadata.presentation, undefined);
    tasks.cancel(t.id);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});
