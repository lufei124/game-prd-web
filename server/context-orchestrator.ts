import { uid, now, hash, type Store } from "./db.ts";
import type {
  ContextItem,
  ContextPack,
  RecallPolicy,
  RecallReasonCode,
  RecallTrace,
} from "./context-types.ts";
import { Knowledge, type KnowledgeSearchResult } from "./knowledge.ts";
import { queryTerms } from "./knowledge-index.ts";

const budgets: Record<string, number> = {
  chatOnly: 3000,
  requirement: 5000,
  prototype: 5000,
  prd: 6500,
  review: 5000,
};

const businessTerms =
  /规则|业务|数据|权限|状态|购买|数量|库存|货币|价格|上限|限制|异常|错误|配置|接口|API|ItemId|NPC|StoryType/i;
const trivialVisual =
  /^(请)?(把|将)?[^\n]{0,28}(按钮|文字|字体|区域|卡片|图标|间距|边距|颜色|字号)[^\n]{0,24}(右移|左移|上移|下移|向右移动|向左移动|向上移动|向下移动|大一点|小一点|改成|调整|加宽|缩小|16\s*(px)?)。?$/i;

export function recallPolicy(input: any): RecallPolicy {
  if (input.referenceIds?.length || input.pinnedKnowledgeIds?.length)
    return "always";
  if (input.chatOnly) return "conditional";
  if (["requirement", "prd", "review"].includes(input.stage)) return "always";
  if (input.stage === "prototype") {
    if (!input.hasPrototype) return "always";
    if (
      input.selection &&
      trivialVisual.test(input.prompt.split("\n")[0].trim()) &&
      !businessTerms.test(input.prompt.split("\n")[0])
    )
      return "never";
    return "conditional";
  }
  return "conditional";
}

const dictionary: Array<[RegExp, string]> = [
  [/商店|购买/, "shop purchase max buy quantity"],
  [/库存|持有/, "inventory holding limit"],
  [/价格|货币/, "price currency"],
  [/退款/, "refund policy"],
  [/权限/, "permission role access"],
  [/异常|错误/, "error exception fallback"],
];

export function planQueries(input: any) {
  const base = [input.requirementName, input.prompt]
    .filter(Boolean)
    .join(" ")
    .trim();
  const identifiers =
    base.match(
      /\b(?:[A-Z][A-Za-z0-9_-]{2,}|[\w.-]+\.(?:md|txt|json|csv)|[A-Z_]+-?\d+)\b/g,
    ) || [];
  const expansion = dictionary
    .filter(([pattern]) => pattern.test(base))
    .map(([, words]) => words)
    .join(" ");
  const artifact = (input.artifactNames || []).join(" ");
  const pinned = (input.pinnedNames || []).join(" ");
  return [
    ...new Set(
      [
        base,
        [input.requirementName, artifact, pinned, ...identifiers]
          .filter(Boolean)
          .join(" "),
        [
          base.match(/[\u4e00-\u9fff]{2,12}/g)?.join(" "),
          expansion,
          ...identifiers,
        ]
          .filter(Boolean)
          .join(" "),
      ].filter((x) => x.trim()),
    ),
  ].slice(0, 3);
}

export class ContextOrchestrator {
  constructor(
    public s: Store,
    public knowledge: Knowledge,
  ) {}

  buildContext(input: {
    taskId: string;
    projectId: string;
    requirementId: string;
    requirementName: string;
    prompt: string;
    stage: string;
    chatOnly?: boolean;
    selection?: string;
    hasPrototype?: boolean;
    referenceIds?: string[];
    pinnedKnowledgeIds?: string[];
    artifactNames?: string[];
  }): { contextPack: ContextPack; recallTrace: RecallTrace } {
    const policy = recallPolicy(input);
    const pinnedRequested = [
      ...new Set([
        ...(input.referenceIds || []),
        ...(input.pinnedKnowledgeIds || []),
      ]),
    ];
    const pinnedIds = new Set<string>();
    for (const id of pinnedRequested) {
      const version = this.s.maybe("knowledge", id);
      if (!version || version.projectId !== input.projectId) continue;
      const document = version.documentId
        ? this.s.maybe("knowledgeDocument", version.documentId)
        : undefined;
      pinnedIds.add(document?.currentVersionId || version.id);
    }
    const queries = planQueries({
      ...input,
      pinnedNames: [...pinnedIds]
        .map((id) => this.s.maybe("knowledge", id)?.name)
        .filter(Boolean),
    });
    const candidates = new Map<string, any>();
    if (policy !== "never") {
      for (const query of queries)
        for (const document of this.knowledge.search(
          input.projectId,
          input.requirementId,
          query,
        ) as KnowledgeSearchResult[])
          for (const chunk of document.matchedChunks) {
            const current = candidates.get(chunk.id);
            const score =
              chunk.score +
              (pinnedIds.has(document.id) ? 100 : 0) +
              (document.requirementId === input.requirementId ? 24 : 0) -
              (document.documentStatus === "deprecated" ? 100 : 0) +
              (document.versionStatus === "current" ? 4 : 0);
            if (!current || score > current.score)
              candidates.set(chunk.id, { ...chunk, document, score });
          }
    }

    for (const knowledgeId of pinnedIds) {
      const version = this.s.maybe("knowledge", knowledgeId);
      if (!version || version.status !== "parsed") continue;
      const present = [...candidates.values()].some(
        (x) => x.document.id === knowledgeId,
      );
      if (!present) {
        const chunk = this.knowledge.index.chunks(knowledgeId)[0];
        if (chunk)
          candidates.set(chunk.id, {
            id: chunk.id,
            index: chunk.ordinal,
            text: chunk.content,
            heading: chunk.heading,
            headingPath: chunk.headingPath,
            score: 100,
            lexicalScore: 0,
            matchedTerms: [],
            document: this.knowledge.searchResult(version, []),
          });
      }
    }

    const scoreRanked = [...candidates.values()].sort(
      (a, b) => b.score - a.score || a.id.localeCompare(b.id),
    );
    const firstByDocument = new Set<string>();
    const ranked = [
      ...scoreRanked.filter((x) => {
        if (firstByDocument.has(x.document.documentId)) return false;
        firstByDocument.add(x.document.documentId);
        return true;
      }),
      ...scoreRanked.filter(
        (x, index) =>
          scoreRanked.findIndex(
            (candidate) =>
              candidate.document.documentId === x.document.documentId,
          ) !== index,
      ),
    ];
    const top = ranked[0];
    const matchedTerms = [
      ...new Set(ranked.flatMap((x) => x.matchedTerms || [])),
    ];
    let reasonCode: RecallReasonCode = "no_relevant_hit";
    if (policy === "never") reasonCode = "trivial_visual_edit";
    else if (input.referenceIds?.length) reasonCode = "explicit_user_reference";
    else if (pinnedIds.size) reasonCode = "pinned_material";
    else if (["requirement", "prd", "review"].includes(input.stage))
      reasonCode = "stage_requires_knowledge";
    else if (top) reasonCode = "lexical_hit";
    const needed =
      policy === "always" || (policy === "conditional" && Boolean(top));

    const tokenBudget =
      budgets[input.chatOnly ? "chatOnly" : input.stage] || 5000;
    const omitted: RecallTrace["omitted"] = [];
    const selected: any[] = [];
    const perDocument = new Map<string, number>();
    const seenContent = new Set<string>();
    let estimatedTokens = 0;
    if (needed) {
      for (const candidate of ranked) {
        const document = candidate.document;
        if (document.versionStatus !== "current") {
          omitted.push({ chunkId: candidate.id, reasonCode: "superseded" });
          continue;
        }
        if (document.documentStatus === "deprecated") {
          omitted.push({ chunkId: candidate.id, reasonCode: "deprecated" });
          continue;
        }
        if ((perDocument.get(document.documentId) || 0) >= 3) {
          omitted.push({
            chunkId: candidate.id,
            reasonCode: "same_document_limit",
          });
          continue;
        }
        const read = this.readSection(
          document.id,
          candidate.index,
          candidate.heading,
        );
        const contentKey = hash(read.content.trim());
        if (seenContent.has(contentKey)) {
          omitted.push({ chunkId: candidate.id, reasonCode: "duplicate" });
          continue;
        }
        const tokens = estimateTokens(read.content);
        if (estimatedTokens + tokens > tokenBudget) {
          omitted.push({
            chunkId: candidate.id,
            reasonCode: "budget_exceeded",
          });
          continue;
        }
        selected.push({ candidate, read });
        estimatedTokens += tokens;
        seenContent.add(contentKey);
        perDocument.set(
          document.documentId,
          (perDocument.get(document.documentId) || 0) + 1,
        );
      }
    }

    const conflictingDocuments = possibleConflicts(
      selected.map((x) => x.candidate.document),
    );
    const items: ContextItem[] = selected.map(({ candidate, read }, index) => {
      const document = candidate.document;
      const source = this.s.maybe("knowledgeSource", document.sourceId);
      return {
        citationId: `K${index + 1}`,
        documentId: document.documentId,
        knowledgeId: document.id,
        chunkIds: read.chunkIds,
        title: document.name,
        sourceType: source?.type || "upload",
        sourceUrl: document.sourceUrl,
        sourcePath:
          source?.type === "directory" ? document.externalId : undefined,
        sourceRevision: document.sourceRevision,
        heading: candidate.headingPath || candidate.heading || "",
        content: read.content,
        capturedAt: document.capturedAt || document.createdAt,
        possibleConflict:
          conflictingDocuments.has(document.documentId) || undefined,
      };
    });
    for (const knowledgeId of pinnedIds) {
      const version = this.s.maybe("knowledge", knowledgeId);
      if (!version || version.status !== "image") continue;
      const source = this.s.maybe("knowledgeSource", version.sourceId);
      const document = this.s.maybe("knowledgeDocument", version.documentId);
      items.push({
        citationId: `K${items.length + 1}`,
        documentId: version.documentId,
        knowledgeId: version.id,
        chunkIds: [],
        title: version.name,
        sourceType: source?.type || "upload",
        sourceUrl: version.sourceUrl,
        sourcePath:
          source?.type === "directory" ? document?.externalId : undefined,
        sourceRevision: version.sourceRevision,
        heading: "",
        content: "[显式图片参考；未进行 OCR]",
        capturedAt: version.capturedAt || version.createdAt,
        mediaType: "image",
      });
    }
    const createdAt = now();
    const contextPack: ContextPack = {
      id: uid(),
      taskId: input.taskId,
      projectId: input.projectId,
      requirementId: input.requirementId,
      items,
      tokenBudget,
      estimatedTokens,
      createdAt,
    };
    const recallTrace: RecallTrace = {
      id: uid(),
      taskId: input.taskId,
      projectId: input.projectId,
      requirementId: input.requirementId,
      policy,
      recallCheck: {
        needed,
        reasonCode,
        topScore: top?.score,
        matchedTerms,
      },
      queries,
      scope: ["session", "project"],
      candidateChunks: ranked.map((x) => ({
        chunkId: x.id,
        documentId: x.document.documentId,
        lexicalScore: x.lexicalScore || 0,
        matchedTerms: x.matchedTerms || [],
      })),
      selectedChunks: items.flatMap((x) => x.chunkIds),
      omitted,
      tokenBudget,
      estimatedTokens,
      createdAt,
    };
    return { contextPack, recallTrace };
  }

  private readSection(knowledgeId: string, ordinal: number, heading: string) {
    const chunks = this.knowledge.index.chunks(knowledgeId);
    const chosen = chunks.filter(
      (x) =>
        Math.abs(x.ordinal - ordinal) <= 1 &&
        (!heading || x.heading === heading),
    );
    const values = chosen.length
      ? chosen
      : chunks.filter((x) => x.ordinal === ordinal);
    return {
      chunkIds: values.map((x) => x.id),
      content: values.map((x) => x.content).join("\n\n"),
    };
  }
}

export function estimateTokens(text: string) {
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.ceil(han * 0.75 + (text.length - han) / 4);
}

function possibleConflicts(documents: any[]) {
  const ids = new Set<string>();
  for (let i = 0; i < documents.length; i++)
    for (let j = i + 1; j < documents.length; j++) {
      const a = documents[i],
        b = documents[j];
      if (
        a.documentId !== b.documentId &&
        a.hash !== b.hash &&
        a.module === b.module &&
        String(a.name).toLowerCase() === String(b.name).toLowerCase()
      ) {
        ids.add(a.documentId);
        ids.add(b.documentId);
      }
    }
  return ids;
}
