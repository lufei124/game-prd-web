import { rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { Store, check } from "./db.ts";
// Keep a durable tombstone until every file has been removed. Interrupted cleanup is retryable.
export async function purgeProject(
  s: Store,
  id: string,
  confirmedName: string,
  actor = "user",
) {
  check(actor === "user", "只有用户可以永久删除项目", 403);
  const trash = s.get("projectTrash", id);
  check(confirmedName === trash.name, "请输入完整项目名称确认永久删除", 409);
  check(!s.maybe("project", id), "项目已经恢复，不能永久删除", 409);
  const safeId = (value: string) => {
    check(/^[a-zA-Z0-9_-]+$/.test(value), "无效文件标识，已阻止清理", 409);
    return value;
  };
  const entries = trash.entries.flatMap((entry: any) =>
    entry.kind === "requirementTrash" ? entry.data.entries : [entry],
  );
  const paths: string[][] = [];
  for (const { kind, data } of entries) {
    if (kind === "knowledge") paths.push(["files", safeId(data.id)]);
    if (kind === "task")
      for (const folder of ["codex-work", "codex-home", "agent-work"])
        paths.push([folder, safeId(data.id)]);
    if (kind === "publication") paths.push(["delivery", safeId(data.id)]);
  }
  s.put("projectTrash", { ...trash, purging: true });
  for (const parts of paths) {
    const parent = join(s.root, parts[0]);
    try {
      check(
        !(await lstat(parent)).isSymbolicLink(),
        "清理目录不能是软链接",
        409,
      );
    } catch (e: any) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    await rm(join(s.root, ...parts), { recursive: true, force: true });
  }
  // Legacy task transcripts use an encoded working directory, separate from credentials.
  const transcripts = join(s.root, "agent-home", ".claude", "projects");
  for (const { kind, data } of entries)
    if (kind === "task") {
      const encoded = join(s.root, "agent-work", safeId(data.id)).replace(
        /[^a-zA-Z0-9]/g,
        "-",
      );
      let safe = true;
      for (const part of [
        join(s.root, "agent-home"),
        join(s.root, "agent-home", ".claude"),
        transcripts,
      ]) {
        try {
          check(
            !(await lstat(part)).isSymbolicLink(),
            "会话目录不能是软链接",
            409,
          );
        } catch (e: any) {
          if (e.code === "ENOENT") {
            safe = false;
            break;
          }
          throw e;
        }
      }
      if (safe)
        await rm(join(transcripts, encoded), { recursive: true, force: true });
    }
  return s.tx(() => {
    const chunks = s.db
      .prepare("SELECT id FROM knowledge_chunks WHERE project_id=?")
      .all(id) as Array<{ id: string }>;
    const removeFts = s.db.prepare(
      "DELETE FROM knowledge_fts WHERE chunk_id=?",
    );
    for (const chunk of chunks) removeFts.run(chunk.id);
    s.db.prepare("DELETE FROM knowledge_chunks WHERE project_id=?").run(id);
    s.remove("projectTrash", id);
    s.audit(actor, "project.purge", id);
    return { id, deleted: true, permanent: true };
  });
}
