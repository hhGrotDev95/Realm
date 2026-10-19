-- Crew moderation: members can flag messages; the crew owner (crews.created_by)
-- can delete messages and remove members, who then cannot rejoin.
CREATE TABLE message_flags (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, guest_id)
);

CREATE TABLE crew_bans (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (crew_id, guest_id)
);

-- Soft delete so incremental polls (?since=) also deliver deletions and hides.
ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN updated_at INTEGER;
CREATE INDEX messages_crew_updated ON messages(crew_id, updated_at);
