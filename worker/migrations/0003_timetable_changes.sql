-- Organizer overrides for the published timetable: delays, stage moves, cancellations.
-- Acts are identified by their stable timetable id (e.g. "1-arcturus").
CREATE TABLE timetable_changes (
  act_id TEXT PRIMARY KEY,
  start_min INTEGER,  -- minutes after midnight of the festival day (may exceed 1440)
  end_min INTEGER,
  stage TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at INTEGER NOT NULL
);
