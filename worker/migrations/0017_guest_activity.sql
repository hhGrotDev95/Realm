-- Audit F12: inactive guest profiles are deleted after a fixed period; this records the last activity.
ALTER TABLE guests ADD COLUMN last_seen INTEGER;
UPDATE guests SET last_seen = created_at;
