-- Before a "replace" import the current timetable is saved, so it can be restored.
CREATE TABLE import_snapshots (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL -- JSON: { stages, acts }
);
CREATE INDEX import_snapshots_festival ON import_snapshots(festival_id, created_at);
