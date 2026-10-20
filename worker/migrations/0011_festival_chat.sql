-- Optional public chat for all visitors of a festival (module "festivalchat", opt-in).
-- Soft deletes and updated_at let incremental polls deliver deletions and hides.
CREATE TABLE festival_messages (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, -- 1 = by author, 2 = by organizer
  restored INTEGER NOT NULL DEFAULT 0 -- organizer reviewed the flags and kept it
);
CREATE INDEX festival_messages_updated ON festival_messages(festival_id, updated_at);

CREATE TABLE festival_message_flags (
  message_id TEXT NOT NULL REFERENCES festival_messages(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, guest_id)
);
