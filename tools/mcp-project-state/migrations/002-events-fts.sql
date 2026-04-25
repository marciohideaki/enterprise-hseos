-- Migration 002 — FTS5 virtual table over as_events
-- Enables cross-run search: "qual agente tocou auth nas últimas 30 runs?"
-- Indexed columns: kind + payload_json. Triggers keep FTS in sync.

CREATE VIRTUAL TABLE IF NOT EXISTS as_events_fts USING fts5(
  kind,
  payload_json,
  content='as_events',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS as_events_ai AFTER INSERT ON as_events BEGIN
  INSERT INTO as_events_fts(rowid, kind, payload_json)
  VALUES (new.id, new.kind, new.payload_json);
END;

CREATE TRIGGER IF NOT EXISTS as_events_ad AFTER DELETE ON as_events BEGIN
  INSERT INTO as_events_fts(as_events_fts, rowid, kind, payload_json)
  VALUES ('delete', old.id, old.kind, old.payload_json);
END;

CREATE TRIGGER IF NOT EXISTS as_events_au AFTER UPDATE ON as_events BEGIN
  INSERT INTO as_events_fts(as_events_fts, rowid, kind, payload_json)
  VALUES ('delete', old.id, old.kind, old.payload_json);
  INSERT INTO as_events_fts(rowid, kind, payload_json)
  VALUES (new.id, new.kind, new.payload_json);
END;
