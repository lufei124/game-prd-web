import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { Store, uid, now, check, hash } from "./db.ts";
import { KnowledgeTree } from "./knowledge-tree.ts";
export class Knowledge {
  constructor(public s: Store) {
    new KnowledgeTree(s).migrate();
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
  ) {
    new KnowledgeTree(this.s).folder(projectId, folderId);
    if (requirementId)
      check(
        this.s.get("requirement", requirementId).projectId === projectId,
        "需求不属于项目",
        403,
      );
    check(bytes.length <= 20 * 1024 * 1024, "资料不得超过 20MB");
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
    const previous = this.s
      .all("knowledge")
      .filter(
        (x) =>
          x.projectId === projectId &&
          x.requirementId === requirementId &&
          x.source === source &&
          x.name === basename(name),
      );
    const item = {
      id,
      projectId,
      requirementId,
      name: basename(name),
      source,
      module,
      folderId,
      state,
      version: previous.length + 1,
      hash: hash(bytes.toString("base64")),
      text,
      status,
      error,
      createdAt: now(),
    };
    this.s.put("knowledge", item);
    return item;
  }
  search(
    projectId: string,
    requirementId: string | null,
    query: string,
    items?: any[],
  ) {
    const tokens = [
      ...new Set(
        query.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{1,2}/g) || [],
      ),
    ];
    return (items || this.s.all("knowledge"))
      .filter(
        (x) =>
          !x.deletedAt &&
          x.projectId === projectId &&
          (!x.requirementId || x.requirementId === requirementId) &&
          x.status === "parsed",
      )
      .map((x) => ({
        ...x,
        score: tokens.reduce(
          (n, t) =>
            n +
            (x.name.toLowerCase().includes(t) ? 8 : 0) +
            (x.module.includes(t) ? 5 : 0) +
            Math.min(x.text.toLowerCase().split(t).length - 1, 5),
          0,
        ),
      }))
      .filter((x) => !tokens.length || x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }
  conflicts(projectId: string) {
    const items = this.s
      .all("knowledge")
      .filter((x) => x.projectId === projectId && !x.deletedAt);
    const pairs: any[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j];
        if (
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
