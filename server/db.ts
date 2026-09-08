import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
export const uid = () => randomUUID();
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const now = () => new Date().toISOString();
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function check(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new Fault(status, message);
}
export class Store {
  db: DatabaseSync;
  closed = false;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    this.db = new DatabaseSync(join(root, "workbench.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      readFileSync(new URL("./migrations/001.sql", import.meta.url), "utf8"),
    );
    const needsKnowledgeContext = !this.db
      .prepare("SELECT 1 FROM migrations WHERE version=3")
      .get();
    if (needsKnowledgeContext) {
      const rows = this.db
        .prepare("SELECT kind,id,data FROM entities ORDER BY kind,id")
        .all();
      if (rows.length) {
        const backupDir = join(root, "backups");
        mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const backupPath = join(
          backupDir,
          `knowledge-context-v3-${Date.now()}.sqlite`,
        );
        this.db.prepare("VACUUM INTO ?").run(backupPath);
        const copy = new DatabaseSync(backupPath, { readOnly: true });
        try {
          check(
            JSON.stringify(
              copy
                .prepare("SELECT kind,id,data FROM entities ORDER BY kind,id")
                .all(),
            ) === JSON.stringify(rows),
            "Knowledge Context 迁移备份校验失败",
          );
          check(
            Object.values(copy.prepare("PRAGMA integrity_check").get()!)[0] ===
              "ok",
            "Knowledge Context 迁移备份完整性校验失败",
          );
        } finally {
          copy.close();
        }
      }
    }
    this.db.exec(
      readFileSync(
        new URL("./migrations/003_knowledge_context.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  all<T = any>(kind: string): T[] {
    return this.db
      .prepare("SELECT data FROM entities WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r: any) => JSON.parse(r.data));
  }
  get<T = any>(kind: string, id: string): T {
    const r = this.db
      .prepare("SELECT data FROM entities WHERE kind=? AND id=?")
      .get(kind, id) as any;
    check(r, `${kind} 不存在`, 404);
    return JSON.parse(r.data);
  }
  maybe<T = any>(kind: string, id: string): T | undefined {
    try {
      return this.get<T>(kind, id);
    } catch {
      return undefined;
    }
  }
  put(kind: string, obj: any) {
    this.db
      .prepare(
        "INSERT INTO entities(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, obj.id, JSON.stringify(obj));
    return obj;
  }
  remove(kind: string, id: string) {
    this.db.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind, id);
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(actor: string, action: string, id: string, details: unknown = {}) {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
      .run(uid(), now(), actor, action, id, JSON.stringify(details));
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}
