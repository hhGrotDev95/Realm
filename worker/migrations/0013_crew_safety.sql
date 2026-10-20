-- Audit F05/F09/F06: crews can require the owner's approval to join (on for new crews),
-- members wait as unapproved until then; reports can be verified by the organizer.
ALTER TABLE crews ADD COLUMN approve_joins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crew_members ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
