-- Audit F15: every festival has its own time zone; app clocks and reminders use it, not the phone's.
ALTER TABLE festivals ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Berlin';
