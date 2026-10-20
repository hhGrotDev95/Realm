-- Audit F01: personal organizer accounts instead of one global key. Platform admins see everything,
-- organizers only the festivals they are assigned to. Sessions expire and can be revoked; the
-- authenticator app (TOTP) is required before an account can work in the console; every change is logged.
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform', 'organizer')),
  password TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE admin_festivals (
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  PRIMARY KEY (admin_id, festival_id)
);

CREATE TABLE admin_invites (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  festival_id TEXT REFERENCES festivals(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  mfa INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  agent TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX admin_sessions_admin ON admin_sessions(admin_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  admin_name TEXT NOT NULL,
  festival TEXT,
  action TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_log_festival ON audit_log(festival, created_at);
