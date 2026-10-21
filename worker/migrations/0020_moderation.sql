-- Reasoned reports and organizer decisions (Welle 7b).
ALTER TABLE message_flags ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE message_flags ADD COLUMN detail TEXT NOT NULL DEFAULT '';
ALTER TABLE festival_message_flags ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE festival_message_flags ADD COLUMN detail TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN restored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN moderation_reason TEXT;
ALTER TABLE festival_messages ADD COLUMN moderation_reason TEXT;
ALTER TABLE reports ADD COLUMN moderation_reason TEXT;
ALTER TABLE reports ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_log ADD COLUMN reason TEXT;
CREATE TABLE report_flags (
 report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
 guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
 category TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 PRIMARY KEY(report_id, guest_id)
);
CREATE TABLE moderation_decisions (
 id TEXT PRIMARY KEY,
 festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
 guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 target_id TEXT NOT NULL,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX moderation_decisions_owner ON moderation_decisions(guest_id, festival_id, created_at);
