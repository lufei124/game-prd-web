import matter from "gray-matter";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { assistantDefaults } from "./assistant-settings.ts";
import { Extensions, encoded } from "./extensions.ts";
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, check } from "./db.ts";

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
  { key: "wireframe-style", name: "低保真线框风格", type: "style", stage: "prototype", path: "wireframe/SKILL.md", legacy: "low-fidelity-wireframe-style" },
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
  if (s.maybe("settings", "system")?.standaloneDefaultsRevision === 2) return;
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
  // Startup has not opened HTTP routes or started model tasks. Keep a complete
  // local backup before upgrading installed defaults, and compare exact rows.
  const before = s.db.prepare("SELECT * FROM entities ORDER BY kind,id").all();
  if (s.maybe("settings", "system")) {
    const backup = join(s.root, "backups", "defaults-v2-" + Date.now());
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(s.root)) {
      if (entry === "backups" || entry.startsWith("workbench.sqlite")) continue;
      cpSync(join(s.root, entry), join(backup, entry), { recursive: true, dereference: false });
    }
    s.db.prepare("VACUUM INTO ?").run(join(backup, "workbench.sqlite"));
    const copy = new DatabaseSync(join(backup, "workbench.sqlite"), { readOnly: true });
    try {
      check(JSON.stringify(copy.prepare("SELECT * FROM entities ORDER BY kind,id").all()) === JSON.stringify(before), "默认扩展升级备份校验失败");
      check(Object.values(copy.prepare("PRAGMA integrity_check").get()!)[0] === "ok", "备份数据库完整性校验失败");
    } finally { copy.close(); }
  }
  const ex = new Extensions(s);
  s.tx(() => {
    check(JSON.stringify(s.db.prepare("SELECT * FROM entities ORDER BY kind,id").all()) === JSON.stringify(before), "备份后数据库发生变化，已中止默认扩展升级");
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
        const current = s.get("release", existing.currentRelease);
        const userEdited = s.all("release").some((r) => r.extensionId === existing.id && !r.source.startsWith("builtin:game-prd-web/") && !r.source.startsWith(legacyPrefix));
        if (userEdited || !current.source.startsWith("builtin:game-prd-web/") || JSON.stringify(current.files) === JSON.stringify(files)) {
          ids[spec.key] = existing.id;
          continue;
        }
      }
      const installed = ex.install(
        files,
        `builtin:game-prd-web/${spec.key}@2`,
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
      standaloneDefaultsRevision: 2,
    });
    s.db
      .prepare("INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'))")
      .run();
    for (const row of before as any[]) {
      if (["settings", "extension"].includes(row.kind)) continue;
      check(JSON.stringify(s.get(row.kind, row.id)) === row.data, "升级不得改变既有记录或历史版本");
    }
    s.audit("system", "standalone.defaults.migrate", "system", {
      version: 2,
      extensions: ids,
    });
  });
}
