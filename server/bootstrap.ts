import matter from "gray-matter";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { assistantDefaults } from "./assistant-settings.ts";
import { Extensions, encoded } from "./extensions.ts";
import { Store } from "./db.ts";

// Legacy identifiers are migration data, never filesystem locations or dependencies.
const catalog = [
  {
    key: "requirement",
    name: "需求整理与确认",
    type: "skill",
    stage: "requirement",
    path: "skills/requirement/SKILL.md",
    legacy: "game-requirement-discovery",
  },
  {
    key: "prototype",
    name: "交互原型生成",
    type: "skill",
    stage: "prototype",
    path: "skills/prototype/SKILL.md",
    legacy: "game-prototype",
  },
  {
    key: "wireframe",
    name: "低保真线框原型",
    type: "skill",
    stage: "prototype",
    path: "skills/wireframe/SKILL.md",
    legacy: "game-wireframe-prototype",
  },
  {
    key: "prd",
    name: "研发需求文档编写",
    type: "skill",
    stage: "prd",
    path: "skills/prd/SKILL.md",
    legacy: "game-prd-writing",
  },
  {
    key: "review",
    name: "需求文档评审",
    type: "skill",
    stage: "review",
    path: "skills/review/SKILL.md",
    legacy: "game-prd-review",
  },
  {
    key: "mint",
    name: "清透薄荷风格",
    type: "style",
    stage: "prototype",
    path: "mint/SKILL.md",
    legacy: "mint-product-style",
  },
  {
    key: "ink",
    name: "墨色编辑风格",
    type: "style",
    stage: "prototype",
    path: "ink/SKILL.md",
    legacy: "ink-editorial-style",
  },
  {
    key: "template",
    name: "研发执行版",
    type: "template",
    stage: "prd",
    path: "prd.md",
    legacy: "研发执行版",
  },
];
const legacyPrefix = "upstream:mobile-game-product-forge/";

export async function bootstrap(s: Store) {
  if (s.maybe("settings", "system")?.standaloneDefaultsRevision === 1) return;
  // Read every bundled file before starting a transaction: missing resources leave no partial upgrade.
  const bundles = await Promise.all(
    catalog.map(async (spec) => {
      const raw = await readFile(
        new URL(`../defaults/${spec.path}`, import.meta.url),
        "utf8",
      );
      const files: Record<string, string> = { [spec.path]: encoded(raw) };
      if (["prototype", "wireframe"].includes(spec.key))
        files["references/prototype-contract.md"] = encoded(
          await readFile(
            new URL(
              "../defaults/references/prototype-contract.md",
              import.meta.url,
            ),
            "utf8",
          ),
        );
      return {
        spec,
        files,
        description: String(
          matter(raw).data.description || "自定义产物结构与写作要求。",
        ),
      };
    }),
  );
  const ex = new Extensions(s);
  s.tx(() => {
    const ids: Record<string, string> = {};
    for (const { spec, files, description } of bundles) {
      const existing = s.all("extension").find((e) => {
        if (e.builtinKey === spec.key) return true;
        const releases = s.all("release").filter((r) => r.extensionId === e.id);
        // A user update/rollback/import history is never treated as a pristine system extension.
        if (releases.length !== 1) return false;
        const current = s.get("release", e.currentRelease);
        if (
          current.source !== "builtin" &&
          current.source !== legacyPrefix + spec.legacy
        )
          return false;
        const slug = matter(
          Buffer.from(current.files[current.main], "base64").toString("utf8"),
        ).data.name;
        return slug === spec.legacy;
      });
      if (existing?.builtinKey) {
        ids[spec.key] = existing.id;
        continue;
      }
      const installed = ex.install(
        files,
        `builtin:game-prd-web/${spec.key}@1`,
        {
          name: spec.name,
          type: spec.type,
          stages: [spec.stage],
          permissions:
            spec.type === "template"
              ? []
              : ["resource.read", "artifact.draft", "knowledge.read"],
        },
        existing?.id,
      );
      const e = installed.extension;
      s.put("extension", {
        ...e,
        builtinKey: spec.key,
        displayName: spec.name,
        description,
      });
      ids[spec.key] = e.id;
    }
    const previous = s.maybe("settings", "system");
    const defaults = previous?.defaults || {};
    s.put("settings", {
      id: "system",
      ...assistantDefaults,
      ...previous,
      defaults: {
        ...defaults,
        styleId: defaults.styleId || ids.mint,
        templateId: defaults.templateId || ids.template,
        skills: Object.fromEntries(
          ["requirement", "prototype", "prd", "review"].map((stage) => [
            stage,
            defaults.skills?.[stage] || ids[stage],
          ]),
        ),
      },
      // Old bootstrap automatically granted its source root. It is no longer an authorized source.
      authorizedRoots: (previous?.authorizedRoots || []).filter(
        (p: string) =>
          basename(p.replace(/[\\/]+$/, "")) !== "mobile-game-product-forge",
      ),
      standaloneDefaultsRevision: 1,
    });
    s.db
      .prepare("INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'))")
      .run();
    s.audit("system", "standalone.defaults.migrate", "system", {
      version: 1,
      extensions: ids,
    });
  });
}
