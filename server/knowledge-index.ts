import { hash, now, type Store } from "./db.ts";

export type PersistedChunk = {
  id: string;
  knowledgeId: string;
  documentId: string;
  projectId: string;
  requirementId: string | null;
  ordinal: number;
  heading: string;
  headingPath: string;
  content: string;
  searchText: string;
  charStart: number;
  charEnd: number;
  contentHash: string;
  createdAt: string;
};

export function queryTerms(query: string) {
  const lower = query.normalize("NFKC").toLowerCase();
  const words =
    lower.match(/[a-z0-9][a-z0-9._/-]*|[\u4e00-\u9fff]{2,8}/g) || [];
  const han = lower.match(/[\u4e00-\u9fff]+/g) || [];
  const bigrams = han.flatMap((run) =>
    run.length < 2
      ? [run]
      : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)),
  );
  return [...new Set([...words, ...bigrams].filter(Boolean))].slice(0, 80);
}

export function searchText(value: string) {
  return queryTerms(value).join(" ");
}

export function splitChunks(text: string, max = 1100, overlap = 160) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n(?=#{1,6}\s)|\n{2,}/).filter(Boolean);
  const result: Array<{
    ordinal: number;
    content: string;
    heading: string;
    headingPath: string;
    charStart: number;
    charEnd: number;
  }> = [];
  let carry = "";
  let carryHeading = "";
  let carryHeadingPath = "";
  const headings: string[] = [];
  let cursor = 0;
  const push = (
    body: string,
    heading: string,
    headingPath: string,
    knownStart?: number,
  ) => {
    const content = body.trim();
    if (!content) return;
    const at =
      knownStart === undefined
        ? normalized.indexOf(content, cursor)
        : knownStart;
    const charStart = at >= 0 ? at : cursor;
    cursor = Math.max(cursor, charStart + content.length);
    result.push({
      ordinal: result.length,
      content,
      heading,
      headingPath: headingPath || heading,
      charStart,
      charEnd: charStart + content.length,
    });
  };
  for (const block of blocks) {
    const blockStart = normalized.indexOf(block, Math.max(0, cursor - overlap));
    const match = block.match(/^(#{1,6})\s+(.+)$/m);
    if (match) {
      const level = match[1].length;
      headings.splice(level - 1);
      headings[level - 1] = match[2].trim();
    }
    const heading = headings.filter(Boolean).at(-1) || "";
    const headingPath = headings.filter(Boolean).join(" / ") || heading;
    const next = carry ? `${carry}\n\n${block}` : block;
    if (next.length <= max) {
      if (!carry) {
        carryHeading = heading;
        carryHeadingPath = headingPath;
      }
      carry = next;
      continue;
    }
    if (carry) push(carry, carryHeading, carryHeadingPath);
    if (block.length <= max) {
      carry = block;
      carryHeading = heading;
      carryHeadingPath = headingPath;
      continue;
    }
    for (
      let start = 0;
      start < block.length;
      start += Math.max(1, max - overlap)
    )
      push(
        block.slice(start, start + max),
        heading,
        headingPath,
        blockStart >= 0 ? blockStart + start : undefined,
      );
    carry = "";
    carryHeading = "";
    carryHeadingPath = "";
  }
  if (carry) push(carry, carryHeading, carryHeadingPath);
  return result;
}

export class KnowledgeIndex {
  constructor(public s: Store) {}

  indexVersion(knowledge: any) {
    if (knowledge.status !== "parsed" || !knowledge.documentId) return [];
    const existing = this.s.db
      .prepare(
        "SELECT id FROM knowledge_chunks WHERE knowledge_id=? ORDER BY ordinal",
      )
      .all(knowledge.id) as Array<{ id: string }>;
    const split = splitChunks(knowledge.text);
    const indexed = existing.reduce(
      (sum, row) =>
        sum +
        Number(
          (
            this.s.db
              .prepare("SELECT count(*) n FROM knowledge_fts WHERE chunk_id=?")
              .get(row.id) as any
          ).n,
        ),
      0,
    );
    if (existing.length === split.length && indexed === existing.length)
      return existing.map((x) => x.id);
    const removeFts = this.s.db.prepare(
      "DELETE FROM knowledge_fts WHERE chunk_id=?",
    );
    for (const row of existing) removeFts.run(row.id);
    this.s.db
      .prepare("DELETE FROM knowledge_chunks WHERE knowledge_id=?")
      .run(knowledge.id);
    const rows = split.map((chunk) => {
      const contentHash = hash(chunk.content);
      return {
        id: hash(`${knowledge.id}:${chunk.ordinal}:${contentHash}`),
        knowledgeId: knowledge.id,
        documentId: knowledge.documentId,
        projectId: knowledge.projectId,
        requirementId: knowledge.requirementId || null,
        ...chunk,
        searchText: searchText(
          `${knowledge.name || ""} ${chunk.headingPath} ${chunk.content}`,
        ),
        contentHash,
        createdAt: knowledge.createdAt || now(),
      } satisfies PersistedChunk;
    });
    const insert = this.s.db.prepare(
      `INSERT OR IGNORE INTO knowledge_chunks
       (id,knowledge_id,document_id,project_id,requirement_id,ordinal,heading,heading_path,content,search_text,char_start,char_end,content_hash,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const fts = this.s.db.prepare(
      "INSERT INTO knowledge_fts(chunk_id,title,heading,search_text) VALUES(?,?,?,?)",
    );
    for (const row of rows) {
      const changed = insert.run(
        row.id,
        row.knowledgeId,
        row.documentId,
        row.projectId,
        row.requirementId,
        row.ordinal,
        row.heading,
        row.headingPath,
        row.content,
        row.searchText,
        row.charStart,
        row.charEnd,
        row.contentHash,
        row.createdAt,
      ).changes;
      if (changed)
        fts.run(row.id, knowledge.name || "", row.heading, row.searchText);
    }
    return rows.map((x) => x.id);
  }

  chunks(knowledgeId: string): PersistedChunk[] {
    return (
      this.s.db
        .prepare(
          "SELECT * FROM knowledge_chunks WHERE knowledge_id=? ORDER BY ordinal",
        )
        .all(knowledgeId) as any[]
    ).map(fromRow);
  }

  candidates(
    projectId: string,
    requirementId: string | null,
    query: string,
    limit = 30,
  ) {
    const terms = queryTerms(query);
    if (!terms.length) return [];
    const expression = terms
      .map((x) => `"${x.replaceAll('"', '""')}"`)
      .join(" OR ");
    const rows = this.s.db
      .prepare(
        `SELECT c.*, bm25(knowledge_fts, 0.0, 8.0, 4.0, 1.0) AS rank
         FROM knowledge_fts
         JOIN knowledge_chunks c ON c.id=knowledge_fts.chunk_id
         JOIN entities e ON e.kind='knowledge' AND e.id=c.knowledge_id
         WHERE knowledge_fts MATCH ? AND c.project_id=?
           AND (c.requirement_id IS NULL OR c.requirement_id=?)
           AND COALESCE(json_extract(e.data,'$.versionStatus'),'current')='current'
           AND json_extract(e.data,'$.deletedAt') IS NULL
           AND json_extract(e.data,'$.status')='parsed'
         ORDER BY rank LIMIT ?`,
      )
      .all(expression, projectId, requirementId || "", limit) as any[];
    return rows.map((row) => ({
      ...fromRow(row),
      lexicalScore: Math.max(0, -Number(row.rank || 0)),
      matchedTerms: terms.filter((term) =>
        `${row.heading} ${row.content}`.toLowerCase().includes(term),
      ),
    }));
  }
}

function fromRow(row: any): PersistedChunk {
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    documentId: row.document_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    ordinal: row.ordinal,
    heading: row.heading,
    headingPath: row.heading_path,
    content: row.content,
    searchText: row.search_text,
    charStart: row.char_start,
    charEnd: row.char_end,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}
