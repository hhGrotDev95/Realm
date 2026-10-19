-- Guests are pseudonymous: a random id plus a bearer token (only its hash is stored).
CREATE TABLE guests (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT,
  color TEXT NOT NULL DEFAULT '#A58CFF',
  recovery_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE crews (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL, -- informational; crews outlive their creator
  created_at INTEGER NOT NULL
);

-- Location is coarse on purpose: only the stage area, never coordinates.
CREATE TABLE crew_members (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  share_location INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  location_at INTEGER,
  PRIMARY KEY (crew_id, guest_id)
);

CREATE TABLE plans (
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  act_id TEXT NOT NULL,
  PRIMARY KEY (guest_id, act_id)
);

-- Step challenge: opt-in, one daily total per festival day, nothing else.
CREATE TABLE steps (
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  total INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (guest_id, day)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_crew ON messages(crew_id, created_at);

CREATE TABLE meetups (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  place TEXT NOT NULL,
  poi TEXT,
  act_id TEXT,
  day INTEGER NOT NULL,
  min INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX meetups_crew ON meetups(crew_id);

CREATE TABLE rsvps (
  meetup_id TEXT NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  going INTEGER NOT NULL,
  PRIMARY KEY (meetup_id, guest_id)
);

-- Community reports expire on their own; "still" votes extend them, "fixed" votes retire them.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  place TEXT,
  poi TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX reports_expiry ON reports(expires_at);

CREATE TABLE votes (
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('still', 'fixed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (report_id, guest_id)
);

-- Fixed-window rate limiting per guest and action.
CREATE TABLE rate (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL, -- window start (ms)
  count INTEGER NOT NULL
);
