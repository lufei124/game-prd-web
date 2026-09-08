import { dirname, basename, normalize, sep } from "node:path";
import { hash, now, type Store } from "./db.ts";

export type SourceType = "directory" | "feishu" | "upload";

const stableId = (kind: string, value: string) =>
  `${kind}-${hash(value).slice(0, 24)}`;

export class KnowledgeSources {
  constructor(public s: Store) {}

  migrate() {
    this.s.tx(() => {
      for (const project of this.s.all("project")) {
        for (const legacy of project.defaults?.knowledgeSources || []) {
          const locator = legacy.location || legacy.locator;
          const migrated = this.s
            .all("knowledgeSource")
            .some(
              (x) =>
                x.projectId === project.id &&
                x.type === legacy.type &&
                x.locator === locator,
            );
          if (!migrated)
            this.ensure(project.id, {
              id: legacy.id,
              type: legacy.type,
              name: legacy.name,
              locator,
              lastSyncedAt: legacy.lastSynced,
              lastSyncStatus: legacy.error ? "failed" : "idle",
              lastSyncError: legacy.error || "",
            });
        }
      }
      const groups = new Map<string, any[]>();
      for (const knowledge of this.s.all("knowledge")) {
        const key = [
          knowledge.projectId,
          knowledge.requirementId || "project",
          knowledge.source || "upload",
          knowledge.name || knowledge.id,
        ].join("|");
        groups.set(key, [...(groups.get(key) || []), knowledge]);
      }
      for (const versions of groups.values()) {
        versions.sort(
          (a, b) =>
            (a.version || 0) - (b.version || 0) ||
            String(a.createdAt).localeCompare(String(b.createdAt)),
        );
        const sample = versions[0];
        const inferred = this.infer(sample);
        const source = this.ensure(sample.projectId, inferred);
        const externalId = inferred.externalId || sample.name;
        const documentId =
          sample.documentId ||
          stableId(
            "doc",
            `${sample.projectId}|${sample.requirementId || "project"}|${source.id}|${externalId}`,
          );
        let previous: string | null = null;
        versions.forEach((version, index) => {
          const current = index === versions.length - 1;
          const updated = {
            ...version,
            sourceId: version.sourceId || source.id,
            documentId: version.documentId || documentId,
            sourceUrl:
              version.sourceUrl ||
              (inferred.type === "feishu" ? inferred.locator : undefined),
            sourceRevision: version.sourceRevision,
            capturedAt: version.capturedAt || version.createdAt,
            versionStatus:
              version.versionStatus || (current ? "current" : "superseded"),
            supersedesId: version.supersedesId || previous,
          };
          this.s.put("knowledge", updated);
          previous = version.id;
        });
        const latest = this.s.get("knowledge", versions.at(-1).id);
        const existing = this.s.maybe("knowledgeDocument", documentId);
        this.s.put("knowledgeDocument", {
          id: documentId,
          projectId: sample.projectId,
          requirementId: sample.requirementId || null,
          sourceId: source.id,
          externalId,
          title: sample.name,
          sourceUrl: latest.sourceUrl,
          currentVersionId: latest.id,
          status: existing?.status || "active",
          tags: existing?.tags || [],
          createdAt: existing?.createdAt || sample.createdAt || now(),
          updatedAt: latest.capturedAt || latest.createdAt || now(),
        });
      }
      for (const link of this.s.all("knowledgeLink")) {
        if (link.documentId) continue;
        const version = this.s.maybe("knowledge", link.knowledgeId);
        if (version?.documentId)
          this.s.put("knowledgeLink", {
            ...link,
            documentId: version.documentId,
          });
      }
    });
  }

  infer(knowledge: any) {
    const source = String(knowledge.source || "");
    if (source.startsWith("feishu:")) {
      const token = source.slice(7);
      const existing = this.s
        .all("knowledgeSource")
        .find(
          (x) =>
            x.projectId === knowledge.projectId &&
            x.type === "feishu" &&
            (x.locator === token || String(x.locator).includes(token)),
        );
      return {
        id: existing?.id,
        type: "feishu" as const,
        name: existing?.name || "飞书文档",
        locator: existing?.locator || knowledge.sourceUrl || token,
        externalId: token,
      };
    }
    if (source.startsWith("directory:")) {
      const path = source.slice(10);
      const existing = this.s
        .all("knowledgeSource")
        .filter(
          (x) =>
            x.projectId === knowledge.projectId &&
            x.type === "directory" &&
            (path === x.locator || path.startsWith(normalize(x.locator + sep))),
        )
        .sort((a, b) => b.locator.length - a.locator.length)[0];
      const root = existing?.locator || dirname(path);
      const externalId = path.startsWith(normalize(root + sep))
        ? path
            .slice(normalize(root + sep).length)
            .split(sep)
            .join("/")
        : basename(path);
      return {
        id: existing?.id,
        type: "directory" as const,
        name: existing?.name || basename(root) || "本地文件夹",
        locator: root,
        externalId,
      };
    }
    return {
      id: undefined,
      type: "upload" as const,
      name: "项目上传",
      locator: `project:${knowledge.projectId}:uploads`,
      externalId: knowledge.name || knowledge.id,
    };
  }

  ensure(projectId: string, input: any) {
    const locator = String(input.locator || "").trim();
    const type: SourceType = input.type || "upload";
    const existing = this.s
      .all("knowledgeSource")
      .find(
        (x) =>
          x.projectId === projectId && x.type === type && x.locator === locator,
      );
    if (existing)
      return existing.removedAt
        ? this.s.put("knowledgeSource", {
            ...existing,
            name: input.name || existing.name,
            removedAt: undefined,
            updatedAt: now(),
          })
        : existing;
    const at = now();
    return this.s.put("knowledgeSource", {
      id: input.id || stableId("source", `${projectId}|${type}|${locator}`),
      projectId,
      type,
      name:
        input.name ||
        (type === "upload" ? "项目上传" : basename(locator) || "资料源"),
      locator,
      readOnly: true,
      lastSyncedAt: input.lastSyncedAt,
      lastSyncStatus: input.lastSyncStatus || "idle",
      lastSyncError: input.lastSyncError || "",
      createdAt: input.createdAt || at,
      updatedAt: input.updatedAt || at,
    });
  }

  externalId(source: any, name: string) {
    if (source.type !== "directory") return name;
    const full = normalize(name);
    const root = normalize(source.locator + sep);
    return full.startsWith(root)
      ? full.slice(root.length).split(sep).join("/")
      : full.split(sep).join("/");
  }

  synced(
    id: string,
    status: "success" | "failed",
    error = "",
    lastChanges?: number,
  ) {
    const source = this.s.get("knowledgeSource", id);
    return this.s.put("knowledgeSource", {
      ...source,
      lastSyncedAt: now(),
      lastSyncStatus: status,
      lastSyncError: error,
      ...(lastChanges === undefined ? {} : { lastChanges }),
      updatedAt: now(),
    });
  }
}
