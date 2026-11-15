-- P6 map editor: an optional ground plan per festival.
-- Coordinates of stages and POIs are relative to the map (x 0–1000, y 0–height; see src/map.ts).
CREATE TABLE festival_maps (
  festival_id TEXT PRIMARY KEY REFERENCES festivals(id) ON DELETE CASCADE,
  height REAL NOT NULL DEFAULT 940,
  plan_id TEXT,             -- random id of the current plan image, part of its (cacheable) URL
  plan TEXT,                -- data: URL (PNG/WebP/JPEG)
  terrain TEXT NOT NULL DEFAULT 'plain' CHECK (terrain IN ('demo', 'plain')),
  updated_at INTEGER NOT NULL
);

-- the original demo festival keeps its drawn grounds
INSERT INTO festival_maps (festival_id, height, terrain, updated_at) VALUES ('realm', 940, 'demo', 0);

-- stage markers are derived from the stage list from now on (single source for the position)
DELETE FROM pois WHERE cat = 'stage';
