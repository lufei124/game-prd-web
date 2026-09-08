CREATE TABLE IF NOT EXISTS knowledge_chunks(
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  requirement_id TEXT,
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  heading_path TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  search_text TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_knowledge ON knowledge_chunks(knowledge_id, ordinal);
CREATE INDEX IF NOT EXISTS knowledge_chunks_document ON knowledge_chunks(document_id, knowledge_id);
CREATE INDEX IF NOT EXISTS knowledge_chunks_scope ON knowledge_chunks(project_id, requirement_id);
CREATE INDEX IF NOT EXISTS knowledge_chunks_hash ON knowledge_chunks(knowledge_id, content_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  chunk_id UNINDEXED,
  title,
  heading,
  search_text,
  tokenize='unicode61 remove_diacritics 2'
);

INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'));
