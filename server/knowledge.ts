import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { Store, uid, now, check, hash } from "./db.ts";
import { KnowledgeTree } from "./knowledge-tree.ts";
import { KnowledgeIndex, queryTerms, splitChunks } from "./knowledge-index.ts";
import { KnowledgeSources } from "./knowledge-source.ts";

export type KnowledgeSearchResult = any;

export class Knowledge {
  index: KnowledgeIndex;
  sources: KnowledgeSources;
  constructor(public s: Store) {
    new KnowledgeTree(s).migrate();
    this.sources = new KnowledgeSources(s);
    this.sources.migrate();
    this.index = new KnowledgeIndex(s);
    for (const item of s
      .all("knowledge")
      .filter((x) => x.versionStatus === "current" && x.status === "parsed"))
      this.index.indexVersion(item);
  }

  async import(
    projectId: string,
    requirementId: string | null,
    name: string,
    bytes: Buffer,
    source: string,
    module = "general",
    state = "pending",
    folderId: string | null = null,
    metadata: {
      sourceId?: string;
      sourceType?: "directory" | "feishu" | "upload";
      locator?: string;
      externalId?: string;
      sourceRevision?: string | number;
      sourceUpdatedAt?: string;
      sourceUrl?: string;
      syncedAt?: string;
    } = {},
  ) {
    new KnowledgeTree(this.s).folder(projectId, folderId);
    if (requirementId)
      check(
        this.s.get("requirement", requirementId).projectId === projectId,
        "需求不属于项目",
        403,
      );
    check(bytes.length <= 20 * 1024 * 1024, "资料不得超过 20MB");

    const fileName = basename(name);
    const contentHash = hash(bytes.toString("base64"));
    const inferred = this.sources.infer({
      projectId,
      source,
      name,
      sourceUrl: metadata.sourceUrl,
    });
    const sourceEntity = metadata.sourceId
      ? this.s.get("knowledgeSource", metadata.sourceId)
      : this.sources.ensure(projectId, {
          id: inferred.id,
          type: metadata.sourceType || inferred.type,
          name: inferred.name,
          locator: metadata.locator || inferred.locator,
        });
    check(sourceEntity.projectId === projectId, "资料源不属于项目", 403);
    const externalId = metadata.externalId || inferred.externalId || fileName;
    const documentId = `doc-${hash(`${projectId}|${requirementId || "project"}|${sourceEntity.id}|${externalId}`).slice(0, 24)}`;
    const previous = this.s
      .all("knowledge")
      .filter(
        (x) =>
          x.projectId === projectId &&
          x.requirementId === requirementId &&
          (x.documentId === documentId ||
            (!x.documentId && x.source === source && x.name === fileName)),
      )
      .sort((a, b) => (a.version || 0) - (b.version || 0));
    const latest = previous.at(-1);

    // A source sync is idempotent: identical source bytes do not create another
    // database version or another copy of the same file. Historical task
    // snapshots keep referencing the previous immutable record.
    if (latest && !latest.deletedAt && latest.hash === contentHash) {
      const syncedAt = metadata.syncedAt || now();
      const refreshed = {
        ...latest,
        sourceRevision: metadata.sourceRevision ?? latest.sourceRevision,
        sourceUpdatedAt: metadata.sourceUpdatedAt ?? latest.sourceUpdatedAt,
        sourceUrl: metadata.sourceUrl ?? latest.sourceUrl,
        syncedAt,
      };
      this.s.put("knowledge", refreshed);
      const document = this.s.maybe("knowledgeDocument", documentId);
      if (document)
        this.s.put("knowledgeDocument", {
          ...document,
          sourceUrl: refreshed.sourceUrl,
          updatedAt: syncedAt,
        });
      return { ...refreshed, unchanged: true };
    }

    const id = uid();
    await mkdir(join(this.s.root, "files"), { recursive: true, mode: 0o700 });
    await writeFile(join(this.s.root, "files", id), bytes, { mode: 0o600 });

    let text = "",
      status = "parsed",
      error = "";
    const ext = extname(name).toLowerCase();
    try {
      if ([".md", ".txt", ".csv"].includes(ext)) text = bytes.toString("utf8");
      else if (ext === ".docx") {
        const mammoth = await import("mammoth");
        text = (await mammoth.extractRawText({ buffer: bytes })).value;
      } else if (ext === ".pdf") {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: bytes });
        try {
          text = (await parser.getText()).text;
        } finally {
          await parser.destroy();
        }
        if (!text.trim()) {
          status = "unparsed";
          error = "扫描型 PDF 尚未 OCR";
        }
      } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
        status = "image";
        error = "保留图片原文件；文本索引未理解图像。可作为显式视觉参考读取。";
      } else {
        status = "unparsed";
        error = "暂不支持此格式的文本解析";
      }
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : "解析失败";
    }

    const capturedAt = metadata.syncedAt || now();
    const item = {
      id,
      projectId,
      requirementId,
      name: fileName,
      source,
      sourceId: sourceEntity.id,
      documentId,
      sourceRevision: metadata.sourceRevision,
      sourceUpdatedAt: metadata.sourceUpdatedAt,
      sourceUrl: metadata.sourceUrl,
      syncedAt: capturedAt,
      capturedAt,
      module,
      folderId,
      state,
      version: (latest?.version || 0) + 1,
      hash: contentHash,
      text,
      status,
      error,
      chunkCount: status === "parsed" ? splitChunks(text).length : 0,
      versionStatus: "current",
      supersedesId: latest?.id || null,
      createdAt: capturedAt,
    };
    this.s.tx(() => {
      if (latest)
        this.s.put("knowledge", { ...latest, versionStatus: "superseded" });
      this.s.put("knowledge", item);
      const existing = this.s.maybe("knowledgeDocument", documentId);
      this.s.put("knowledgeDocument", {
        id: documentId,
        projectId,
        requirementId,
        sourceId: sourceEntity.id,
        externalId,
        title: fileName,
        sourceUrl: metadata.sourceUrl || existing?.sourceUrl,
        currentVersionId: id,
        status: "active",
        tags: existing?.tags || [],
        createdAt: existing?.createdAt || capturedAt,
        updatedAt: capturedAt,
      });
      this.index.indexVersion(item);
    });
    return item;
  }

  search(
    projectId: string,
    requirementId: string | null,
    query: string,
    items?: any[],
  ) {
    const terms = queryTerms(query);
    const phrase = query.trim().toLowerCase();
    const allowed = new Set(
      (items || this.s.all("knowledge")).map((x) => x.id),
    );
    const sourceItems = this.s
      .all("knowledge")
      .filter(
        (x) =>
          allowed.has(x.id) &&
          !x.deletedAt &&
          x.projectId === projectId &&
          (!x.requirementId || x.requirementId === requirementId) &&
          x.status === "parsed" &&
          x.versionStatus === "current",
      );
    const byId = new Map(sourceItems.map((x) => [x.id, x]));
    const byDocument = new Map<string, any[]>();
    for (const candidate of this.index.candidates(
      projectId,
      requirementId,
      query,
      30,
    )) {
      const item = byId.get(candidate.knowledgeId);
      if (!item) continue;
      const title = String(item.name || "").toLowerCase();
      const heading = candidate.heading.toLowerCase();
      const body = candidate.content.toLowerCase();
      let score = candidate.lexicalScore;
      if (title === phrase || title.replace(/\.[^.]+$/, "") === phrase)
        score += 24;
      if (heading === phrase) score += 16;
      for (const term of terms) {
        if (title.includes(term)) score += 10;
        if (heading.includes(term)) score += 8;
      }
      if (phrase.length >= 4 && body.includes(phrase)) score += 18;
      const list = byDocument.get(item.documentId) || [];
      list.push({
        id: candidate.id,
        index: candidate.ordinal,
        text: candidate.content,
        heading: candidate.heading,
        headingPath: candidate.headingPath,
        score,
        lexicalScore: candidate.lexicalScore,
        matchedTerms: candidate.matchedTerms,
      });
      byDocument.set(item.documentId, list);
    }
    return [...byDocument.entries()]
      .map(([documentId, matches]) => {
        const item = sourceItems.find((x) => x.documentId === documentId)!;
        const matchedChunks = matches
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        const document = this.searchResult(item, matchedChunks);
        return {
          ...document,
          score: matchedChunks.reduce(
            (sum, x, i) => sum + x.score / (i + 1),
            0,
          ),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }

  searchResult(item: any, matchedChunks: any[]) {
    const document = this.s.maybe("knowledgeDocument", item.documentId);
    const { text: _text, ...version } = item;
    return {
      ...version,
      externalId: document?.externalId,
      documentStatus: document?.status || "active",
      matchedChunks,
    };
  }

  conflicts(projectId: string) {
    const items = this.s
      .all("knowledge")
      .filter(
        (x) =>
          x.projectId === projectId &&
          !x.deletedAt &&
          x.versionStatus === "current" &&
          this.s.maybe("knowledgeDocument", x.documentId)?.status === "active",
      );
    const pairs: any[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j];
        if (
          a.documentId !== b.documentId &&
          a.folderId === b.folderId &&
          a.module === b.module &&
          a.name === b.name &&
          a.hash !== b.hash
        )
          pairs.push({
            left: a.id,
            right: b.id,
            reason: "同模块同名资料内容不同，需人工核对，不自动判定谁正确",
          });
      }
    return pairs;
  }

  propose(id: string, text: string, reason: string, actor = "agent") {
    const k = this.s.get("knowledge", id);
    check(!k.requirementId, "仅项目知识支持更新提案");
    return this.s.put("proposal", {
      id: uid(),
      knowledgeId: id,
      baseHash: k.hash,
      text,
      reason,
      status: "pending",
      actor,
      createdAt: now(),
    });
  }

  async adopt(id: string, actor = "user") {
    check(actor === "user", "正式知识更新必须由用户采纳", 403);
    const p = this.s.get("proposal", id);
    check(p.status === "pending", "提案已处理", 409);
    const k = this.s.get("knowledge", p.knowledgeId);
    check(k.hash === p.baseHash, "基础资料版本不符", 409);
    const newer = this.s
      .all("knowledge")
      .some(
        (x) =>
          x.projectId === k.projectId &&
          x.name === k.name &&
          x.source === k.source &&
          x.version > k.version,
      );
    check(!newer, "存在更新的知识版本，请重新提出更新", 409);
    const result = await this.import(
      k.projectId,
      null,
      k.name,
      Buffer.from(p.text),
      k.source,
      k.module,
      "confirmed",
    );
    p.status = "adopted";
    p.resultId = result.id;
    this.s.put("proposal", p);
    this.s.audit(actor, "knowledge.adopt", id);
    return result;
  }

  file(id: string) {
    this.s.get("knowledge", id);
    return readFile(join(this.s.root, "files", id));
  }
}
