-- Multi-tenancy: every festival is an isolated tenant. Existing data belongs to the
-- original demo festival ('realm'), so nothing is lost when this migration runs.

CREATE TABLE festivals (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND length(slug) BETWEEN 2 AND 40),
  name TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  theme TEXT NOT NULL DEFAULT '{}',   -- JSON, see docs (brand colour, logo, font)
  modules TEXT NOT NULL DEFAULT '{}', -- JSON map of module -> enabled
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE festival_days (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL CHECK (idx BETWEEN 0 AND 13),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  label TEXT NOT NULL,
  short TEXT NOT NULL,
  PRIMARY KEY (festival_id, idx)
);

CREATE TABLE stages (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  vibe TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (festival_id, id)
);

CREATE TABLE acts (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  day INTEGER NOT NULL,
  stage_id TEXT NOT NULL,
  artist TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL CHECK (end_min > start_min),
  genre TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  popularity REAL NOT NULL DEFAULT 0.5,
  PRIMARY KEY (festival_id, id),
  FOREIGN KEY (festival_id, stage_id) REFERENCES stages(festival_id, id)
);
CREATE INDEX acts_day ON acts(festival_id, day, start_min);

CREATE TABLE pois (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  cat TEXT NOT NULL,
  name TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT,
  important INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (festival_id, id)
);

INSERT INTO festivals (id, slug, name, location, status, created_at, updated_at)
VALUES ('realm', 'realm-open-air', 'Realm Open Air', 'Lüneburger Heide', 'published', 0, 0);

-- Tenant column on existing tables (default = the original festival). SQLite cannot add a
-- REFERENCES column with a default, so the worker's tenant middleware guards these ids.
ALTER TABLE crews ADD COLUMN festival_id TEXT NOT NULL DEFAULT 'realm';
ALTER TABLE reports ADD COLUMN festival_id TEXT NOT NULL DEFAULT 'realm';
ALTER TABLE announcements ADD COLUMN festival_id TEXT NOT NULL DEFAULT 'realm';
CREATE INDEX crews_festival ON crews(festival_id);
CREATE INDEX reports_festival ON reports(festival_id, expires_at);
CREATE INDEX announcements_festival ON announcements(festival_id, created_at);

-- Tables whose primary key must include the festival are rebuilt with their data.
CREATE TABLE plans_new (
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  act_id TEXT NOT NULL,
  PRIMARY KEY (guest_id, festival_id, act_id)
);
INSERT INTO plans_new (guest_id, festival_id, act_id) SELECT guest_id, 'realm', act_id FROM plans;
DROP TABLE plans;
ALTER TABLE plans_new RENAME TO plans;

CREATE TABLE steps_new (
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  total INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (guest_id, festival_id, day)
);
INSERT INTO steps_new (guest_id, festival_id, day, total, synced_at) SELECT guest_id, 'realm', day, total, synced_at FROM steps;
DROP TABLE steps;
ALTER TABLE steps_new RENAME TO steps;

CREATE TABLE timetable_changes_new (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  act_id TEXT NOT NULL,
  start_min INTEGER,
  end_min INTEGER,
  stage TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (festival_id, act_id)
);
INSERT INTO timetable_changes_new SELECT 'realm', act_id, start_min, end_min, stage, cancelled, note, updated_at FROM timetable_changes;
DROP TABLE timetable_changes;
ALTER TABLE timetable_changes_new RENAME TO timetable_changes;
