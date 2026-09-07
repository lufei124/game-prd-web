CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entity_project ON entities(kind,json_extract(data,'$.projectId'));
      CREATE INDEX IF NOT EXISTS entity_requirement ON entities(kind,json_extract(data,'$.requirementId'));
      INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
