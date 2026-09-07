import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/db.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { Extensions, encoded } from "../server/extensions.ts";
import { Domain } from "../server/domain.ts";

const skill = (name: string, body = "历史规则") => ({
  "SKILL.md": encoded(
    `---\nname: ${name}\ndescription: 历史资源\n---\n${body}`,
  ),
});
test("standalone migration preserves histories, IDs, bindings, user extensions and explicit directory grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "prd-migration-"));
  const s = new Store(root);
  try {
    const ex = new Extensions(s),
      domain = new Domain(s);
    const project = domain.project("网站改版");
    const old = ex.install(
      skill("game-requirement-discovery"),
      "upstream:mobile-game-product-forge/game-requirement-discovery",
      {
        name: "需求整理与确认",
        type: "skill",
        stages: ["requirement"],
        permissions: ["artifact.draft"],
      },
    );
    s.put("extension", {
      ...old.extension,
      enabled: false,
      projectIds: [project.id],
    });
    const edited = ex.install(
      skill("game-prototype"),
      "upstream:mobile-game-product-forge/game-prototype",
      {
        name: "交互原型生成",
        type: "skill",
        stages: ["prototype"],
        permissions: ["artifact.draft"],
      },
    );
    ex.install(
      skill("game-prototype", "用户专用方案"),
      "local-editor",
      {
        name: "我的特殊原型",
        type: "skill",
        stages: ["prototype"],
        permissions: ["artifact.draft"],
      },
      edited.extension.id,
    );
    const imported = ex.install(
      skill("custom-skill"),
      "https://github.com/example/custom",
      { name: "用户导入", type: "skill", stages: ["review"], permissions: [] },
    );
    const req = domain.requirement(project.id, "导航改版"),
      version = domain.save(req.id, "requirement", "保留用户规则", null);
    domain.confirm(req.id, "requirement", version.id);
    s.put("task", {
      id: "past-task",
      requirementId: req.id,
      projectId: project.id,
      status: "completed",
      snapshot: { releases: [old.release], versions: [version] },
    });
    s.put("projectTrash", {
      id: "old-trash",
      entries: [{ kind: "version", data: version }],
    });
    s.put("project", {
      ...project,
      defaults: {
        skills: { requirement: old.extension.id },
        styleId: "custom-style",
      },
    });
    s.put("settings", {
      id: "system",
      executor: "claude",
      model: "claude-custom",
      reasoningEffort: "high",
      authorizedRoots: [
        "/sample/mobile-game-product-forge/",
        "/sample/explicit-resources",
      ],
      defaults: {
        skills: {
          requirement: old.extension.id,
          prototype: edited.extension.id,
        },
      },
    });
    const preservedKinds = [
      "project",
      "requirement",
      "version",
      "confirmation",
      "task",
      "projectTrash",
    ];
    const preserved = Object.fromEntries(
      preservedKinds.map((k) => [k, s.all(k)]),
    );
    const oldReleases = s.all("release"),
      userExt = s.get("extension", edited.extension.id),
      importedExt = s.get("extension", imported.extension.id);
    await bootstrap(s);
    for (const kind of preservedKinds)
      assert.deepEqual(s.all(kind), preserved[kind]);
    for (const release of oldReleases)
      assert.deepEqual(s.get("release", release.id), release);
    assert.deepEqual(s.get("extension", edited.extension.id), userExt);
    assert.deepEqual(s.get("extension", imported.extension.id), importedExt);
    const migrated = s.get("extension", old.extension.id);
    assert.notEqual(migrated.currentRelease, old.release.id);
    assert.equal(migrated.enabled, false);
    assert.deepEqual(migrated.projectIds, [project.id]);
    assert.match(
      s.get("release", migrated.currentRelease).source,
      /^builtin:game-prd-web/,
    );
    const settings = s.get("settings", "system");
    assert.equal(settings.model, "claude-custom");
    assert.equal(settings.defaults.skills.requirement, old.extension.id);
    assert.equal(settings.defaults.skills.prototype, edited.extension.id);
    assert.deepEqual(settings.authorizedRoots, ["/sample/explicit-resources"]);
    const snapshot = s.db
      .prepare("SELECT * FROM entities ORDER BY kind,id")
      .all();
    const audit = s.db.prepare("SELECT * FROM audit").all();
    await bootstrap(s);
    assert.deepEqual(
      s.db.prepare("SELECT * FROM entities ORDER BY kind,id").all(),
      snapshot,
    );
    assert.deepEqual(s.db.prepare("SELECT * FROM audit").all(), audit);
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fresh installation is self-contained, has all generic stages, and resolves selected resource links", async () => {
  const root = await mkdtemp(join(tmpdir(), "prd-standalone-"));
  const s = new Store(root);
  try {
    await bootstrap(s);
    const ex = new Extensions(s);
    const all = ex.list();
    assert.equal(all.length, 9);
    assert.deepEqual(s.get("settings", "system").authorizedRoots, []);
    for (const stage of ["requirement", "prototype", "prd", "review"]) {
      const id = s.get("settings", "system").defaults.skills[stage];
      const release = ex.select(id, "new-project", stage);
      assert.match(release.source, /^builtin:game-prd-web/);
      assert.ok(release.files[release.main]);
      const main = Buffer.from(
        release.files[release.main],
        "base64",
      ).toString();
      assert.doesNotMatch(
        main,
        /mobile-game-product-forge|00-stage-state|FORGE_SOURCE/,
      );
      if (stage === "prototype")
        assert.ok(release.files["references/prototype-contract.md"]);
    }
    const index = await readFile(
      new URL("../server/index.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(index, /FORGE_SOURCE|mobile-game-product-forge/);
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});
