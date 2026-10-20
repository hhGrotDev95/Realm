-- Welle 7: legal notice and privacy information, per festival (the organizer's) and for the platform;
-- plus the minimum age the festival names for the social features.
ALTER TABLE festivals ADD COLUMN imprint TEXT;
ALTER TABLE festivals ADD COLUMN privacy TEXT;
ALTER TABLE festivals ADD COLUMN min_age INTEGER NOT NULL DEFAULT 16;
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
