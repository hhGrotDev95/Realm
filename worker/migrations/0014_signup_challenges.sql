-- Audit F08: one-time proof-of-work challenges for sign-ups from busy shared IPs (festival WLAN).
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  bits INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
