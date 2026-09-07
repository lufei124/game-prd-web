import { DatabaseSync } from "node:sqlite";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// Run against stopped services or a frozen backup. Reports counts only, never entity contents.
const [before, after] = process.argv.slice(2);
if (!before || !after)
  throw new Error(
    "用法：node --import tsx scripts/verify-data-migration.ts <备份数据目录> <目标数据目录>",
  );
const a = new DatabaseSync(join(before, "workbench.sqlite"), {
  readOnly: true,
});
const b = new DatabaseSync(join(after, "workbench.sqlite"), { readOnly: true });
try {
  assert.equal(
    Object.values(b.prepare("PRAGMA integrity_check").get()!)[0],
    "ok",
  );
  const original = a.prepare("SELECT kind,id,data FROM entities").all() as {
    kind: string;
    id: string;
    data: string;
  }[];
  const lookup = b.prepare("SELECT data FROM entities WHERE kind=? AND id=?");
  const counts: Record<string, number> = {};
  for (const row of original) {
    const next = lookup.get(row.kind, row.id) as { data: string } | undefined;
    assert.ok(next, `缺少实体 ${row.kind}/${row.id}`);
    if (!["extension", "settings"].includes(row.kind))
      assert.deepEqual(
        JSON.parse(next.data),
        JSON.parse(row.data),
        `${row.kind}/${row.id} 内容变化`,
      );
    else if (row.kind === "extension") {
      const old = JSON.parse(row.data),
        current = JSON.parse(next.data);
      assert.equal(current.enabled, old.enabled);
      assert.deepEqual(current.projectIds, old.projectIds);
      const release = JSON.parse(
        (
          a
            .prepare("SELECT data FROM entities WHERE kind='release' AND id=?")
            .get(old.currentRelease) as any
        ).data,
      );
      const pristine =
        ["builtin", "upstream:mobile-game-product-forge/" + old.name].includes(
          release.source,
        ) || release.source.startsWith("upstream:mobile-game-product-forge/");
      const history = a
        .prepare(
          "SELECT count(*) AS n FROM entities WHERE kind='release' AND json_extract(data,'$.extensionId')=?",
        )
        .get(old.id) as any;
      if (!pristine || history.n !== 1)
        assert.deepEqual(current, old, "用户扩展被修改");
    }
    counts[row.kind] = (counts[row.kind] || 0) + 1;
  }
  const audits = a.prepare("SELECT * FROM audit").all();
  for (const row of audits as any[])
    assert.deepEqual(
      b.prepare("SELECT * FROM audit WHERE id=?").get(row.id),
      row,
      "审计记录变化",
    );
  let files = 0;
  async function verifyFiles(dir: string, relative = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const rel = join(relative, item.name);
      if (/^workbench\.sqlite(?:-|$)/.test(rel)) continue;
      assert.ok(!item.isSymbolicLink(), `不允许迁移数据软链接 ${rel}`);
      if (item.isDirectory()) await verifyFiles(join(dir, item.name), rel);
      else {
        assert.ok((await lstat(join(after, rel))).isFile());
        const digest = (data: Buffer) =>
          createHash("sha256").update(data).digest("hex");
        assert.equal(
          digest(await readFile(join(dir, item.name))),
          digest(await readFile(join(after, rel))),
          `文件变化 ${rel}`,
        );
        files++;
      }
    }
  }
  await verifyFiles(before);
  console.log(
    JSON.stringify({
      integrity: "ok",
      preservedEntities: counts,
      preservedAudit: audits.length,
      verifiedFiles: files,
    }),
  );
} finally {
  a.close();
  b.close();
}
