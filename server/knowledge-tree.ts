import { Store, check, uid, now } from "./db.ts";
export class KnowledgeTree {
  constructor(public s: Store) {}
  folder(projectId: string, folderId: string | null) {
    this.s.get("project", projectId);
    if (!folderId) return null;
    const folder = this.s.get("knowledgeFolder", folderId);
    check(folder.projectId === projectId, "目录不属于当前项目", 403);
    return folder;
  }
  create(projectId: string, name: string, parentId: string | null = null) {
    this.folder(projectId, parentId);
    name = name.trim();
    check(
      name &&
        name.length <= 100 &&
        !/[\\/]/.test(name) &&
        ![".", ".."].includes(name),
      "目录名称无效",
    );
    check(
      !this.s
        .all("knowledgeFolder")
        .some(
          (x) =>
            x.projectId === projectId &&
            x.parentId === parentId &&
            x.name === name,
        ),
      "同级目录已存在",
      409,
    );
    return this.s.put("knowledgeFolder", {
      id: uid(),
      projectId,
      parentId,
      name,
      createdAt: now(),
    });
  }
  migrate() {
    this.s.tx(() => {
      for (const k of this.s.all("knowledge")) {
        if ("folderId" in k) continue;
        let folderId = null;
        if (
          !k.requirementId &&
          k.module &&
          k.module !== "general" &&
          this.s.maybe("project", k.projectId)
        ) {
          let folder = this.s
            .all("knowledgeFolder")
            .find(
              (x) =>
                x.projectId === k.projectId &&
                x.parentId === null &&
                x.name === k.module,
            );
          if (!folder)
            folder = this.s.put("knowledgeFolder", {
              id: uid(),
              projectId: k.projectId,
              parentId: null,
              name: k.module,
              createdAt: now(),
            });
          folderId = folder.id;
        }
        this.s.put("knowledge", { ...k, folderId });
      }
    });
  }
  link(requirementId: string, knowledgeId: string) {
    const req = this.s.get("requirement", requirementId),
      k = this.s.get("knowledge", knowledgeId);
    check(
      !k.deletedAt && !k.requirementId && k.projectId === req.projectId,
      "只能添加当前项目知识库中的文件",
      403,
    );
    const existing = this.s
      .all("knowledgeLink")
      .find(
        (x) =>
          x.requirementId === requirementId && x.knowledgeId === knowledgeId,
      );
    return (
      existing ||
      this.s.put("knowledgeLink", {
        id: uid(),
        projectId: req.projectId,
        requirementId,
        knowledgeId,
        createdAt: now(),
      })
    );
  }
  unlink(requirementId: string, knowledgeId: string) {
    this.s.get("requirement", requirementId);
    for (const l of this.s
      .all("knowledgeLink")
      .filter(
        (x) =>
          x.requirementId === requirementId && x.knowledgeId === knowledgeId,
      ))
      this.s.remove("knowledgeLink", l.id);
    return { removed: true };
  }
  removeFile(id: string, actor = "user") {
    check(actor === "user", "仅用户可删除资料", 403);
    return this.s.tx(() => this.retire(id));
  }
  private retire(id: string) {
    const k = this.s.get("knowledge", id);
    this.s.put("knowledge", { ...k, deletedAt: k.deletedAt || now() });
    for (const l of this.s
      .all("knowledgeLink")
      .filter((x) => x.knowledgeId === id))
      this.s.remove("knowledgeLink", l.id);
    this.s.audit("user", "knowledge.delete", id);
    return { id, deleted: true };
  }
  removeFolder(id: string, actor = "user") {
    check(actor === "user", "仅用户可删除目录", 403);
    return this.s.tx(() => {
      const folder = this.s.get("knowledgeFolder", id),
        ids = new Set([id]);
      const folders = this.s
        .all("knowledgeFolder")
        .filter((x) => x.projectId === folder.projectId);
      let size = 0;
      while (size !== ids.size) {
        size = ids.size;
        for (const f of folders) if (ids.has(f.parentId)) ids.add(f.id);
      }
      for (const k of this.s
        .all("knowledge")
        .filter(
          (x) =>
            x.projectId === folder.projectId &&
            ids.has(x.folderId) &&
            !x.deletedAt,
        ))
        this.retire(k.id);
      for (const id of ids) this.s.remove("knowledgeFolder", id);
      return { deleted: true };
    });
  }
  moveFile(id: string, folderId: string | null) {
    const k = this.s.get("knowledge", id);
    check(!k.deletedAt && !k.requirementId, "只能移动知识库文件", 409);
    this.folder(k.projectId, folderId);
    return this.s.put("knowledge", { ...k, folderId });
  }
}
