-- Official notices published by the organizer (admin token), readable by everyone.
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  place TEXT,
  poi TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER -- NULL: valid until deleted
);
CREATE INDEX announcements_created ON announcements(created_at);
