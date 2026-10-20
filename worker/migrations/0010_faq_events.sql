-- Anonymous FAQ-bot usage for the organizer's analytics: which answers are used, which
-- questions found none. No guest id; a missed question keeps only its normalized text.
CREATE TABLE faq_events (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'hit' | 'miss'
  faq_id TEXT,
  question TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX faq_events_festival ON faq_events(festival_id, kind);
