import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { Store, uid, now, check, hash } from "./db.ts";
import { KnowledgeTree } from "./knowledge-tree.ts";

function queryTerms(query: string) {
  const lower = query.toLowerCase();
  const words = lower.match(/[a-z0-9][a-z0-9._-]+|[\u4e00-\u9fff]{2,8}/g) || [];
  const han = lower.match(/[\u4e00-\u9fff]+/g) || [];
  const bigrams = han.flatMap((run) =>
    run.length < 2
      ? [run]
      : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)),
  );
  return [...new Set([...words, ...bigrams].filter(Boolean))].slice(0, 80);
}

function chunks(text: string, max = 1100, overlap = 160) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n(?=#{1,6}\s)|\n{2,}/).filter(Boolean);
  const result: { index: number; text: string; heading: string }[] = [];
  let carry = "";
  let heading = "";
  let carryHeading = "";
  const push = (body: string, chunkHeading: string) => {
    const value = body.trim();
    if (!value) return;
    result.push({ index: result.length, text: value, heading: chunkHeading });
  };
  for (const block of blocks) {
    const h = block.match(/^#{1,6}\s+(.+)$/m);
    if (h) heading = h[1].trim();
    const blockHeading = heading;
    const next = carry ? carry + "\n\n" + block : block;
    if (next.length <= max) {
      if (!carry) carryHeading = blockHeading;
      carry = next;
      continue;
    }
    if (carry) push(carry, carryHeading);
    if (block.length <= max) {
      carry = block;
      carryHeading = blockHeading;
      continue;
    }
    let start = 0;
    while (start < block.length) {
      push(block.slice(start, start + max), blockHeading);
      start += Math.max(1, max - overlap);
    }
    carry = "";
    carryHeading = "";
  }
  if (carry) push(carry, carryHeading);
  return result;
}

function count(haystack: string, needle: string, limit = 6) {
  if (!needle) return 0;
  let n = 0;
  let at = 0;
  while (n < limit) {
    at = haystack.indexOf(needle, at);
    if (at < 0) break;
    n++;
    at += Math.max(1, needle.length);
  }
  return n;
}

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

    const fileName = basename(name);
    const contentHash = hash(bytes.toString("base64"));
    const previous = this.s
      .all("knowledge")
      .filter(
        (x) =>
          x.projectId === projectId &&
          x.requirementId === requirementId &&
          x.source === source &&
          x.name === fileName,
      )
      .sort((a, b) => (a.version || 0) - (b.version || 0));
    const latest = previous.at(-1);

    // A source sync is idempotent: identical source bytes do not create another
    // database version or another copy of the same file. Historical task
    // snapshots keep referencing the previous immutable record.
    if (latest && !latest.deletedAt && latest.hash === contentHash)
      return { ...latest, unchanged: true };

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

    const item = {
      id,
      projectId,
      requirementId,
      name: fileName,
      source,
      module,
      folderId,
      state,
      version: (latest?.version || 0) + 1,
      hash: contentHash,
      text,
      status,
      error,
      chunkCount: status === "parsed" ? chunks(text).length : 0,
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
    const terms = queryTerms(query);
    const phrase = query.trim().toLowerCase();
    const sourceItems = (items || this.s.all("knowledge")).filter(
      (x) =>
        !x.deletedAt &&
        x.projectId === projectId &&
        (!x.requirementId || x.requirementId === requirementId) &&
        x.status === "parsed",
    );

    const latest = new Map<string, any>();
    for (const item of sourceItems) {
      const key = `${item.requirementId || "project"}|${item.source}|${item.name}`;
      const current = latest.get(key);
      if (!current || (current.version || 0) < (item.version || 0))
        latest.set(key, item);
    }

    return [...latest.values()]
      .map((item) => {
        const name = String(item.name || "").toLowerCase();
        const module = String(item.module || "").toLowerCase();
        const ranked = chunks(item.text).map((chunk) => {
          const body = chunk.text.toLowerCase();
          const heading = chunk.heading.toLowerCase();
          let score = 0;
          for (const term of terms) {
            score += count(body, term) * 2;
            if (heading.includes(term)) score += 8;
            if (name.includes(term)) score += 10;
            if (module.includes(term)) score += 5;
          }
          if (phrase.length >= 4 && body.includes(phrase)) score += 18;
          return { ...chunk, score };
        });
        const matchedChunks = ranked
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        const score =
          matchedChunks.reduce((sum, x, i) => sum + x.score / (i + 1), 0) +
          (matchedChunks.length ? 2 : 0);
        const { text: _fullText, ...document } = item;
        return { ...document, score, matchedChunks };
      })
      .filter((x) => !terms.length || x.score > 0)
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
