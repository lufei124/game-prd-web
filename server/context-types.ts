export type RecallPolicy = "always" | "conditional" | "never";
// `user` is reserved for an explicit opt-in V2 scope and is never selected by MVP.
export type ContextScope = "session" | "project" | "user";
export type ContextKind = "rule" | "skill" | "knowledge" | "learning";
export type RecallReasonCode =
  | "stage_requires_knowledge"
  | "pinned_material"
  | "lexical_hit"
  | "no_relevant_hit"
  | "trivial_visual_edit"
  | "explicit_user_reference";

export type OmissionReason =
  | "duplicate"
  | "lower_score"
  | "same_document_limit"
  | "deprecated"
  | "budget_exceeded"
  | "scope_filtered"
  | "superseded";

export type ContextItem = {
  citationId: string;
  documentId: string;
  knowledgeId: string;
  chunkIds: string[];
  title: string;
  sourceType: "directory" | "feishu" | "upload";
  sourceUrl?: string;
  sourcePath?: string;
  sourceRevision?: string | number;
  heading: string;
  content: string;
  capturedAt: string;
  mediaType?: "image";
  possibleConflict?: boolean;
};

export type ContextPack = {
  id: string;
  taskId: string;
  projectId: string;
  requirementId: string;
  items: ContextItem[];
  tokenBudget: number;
  estimatedTokens: number;
  createdAt: string;
};

export type RecallTrace = {
  id: string;
  taskId: string;
  projectId: string;
  requirementId: string;
  policy: RecallPolicy;
  recallCheck: {
    needed: boolean;
    reasonCode: RecallReasonCode;
    topScore?: number;
    matchedTerms: string[];
  };
  queries: string[];
  scope: ContextScope[];
  candidateChunks: Array<{
    chunkId: string;
    documentId: string;
    lexicalScore: number;
    matchedTerms: string[];
  }>;
  selectedChunks: string[];
  omitted: Array<{ chunkId: string; reasonCode: OmissionReason }>;
  tokenBudget: number;
  estimatedTokens: number;
  createdAt: string;
};
