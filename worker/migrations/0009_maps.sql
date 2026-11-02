-- Map editor: each festival can upload its own site plan. Coordinates of stages and points of
-- interest live in a map space that is always 1000 units wide; its height follows the image's
-- aspect ratio (default 940, the built-in demo grounds). The image itself is stored once as
-- base64 and served as a binary file under a versioned, immutable URL.

CREATE TABLE festival_maps (
  festival_id TEXT PRIMARY KEY REFERENCES festivals(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  data TEXT NOT NULL,            -- base64 without the data: prefix
  height INTEGER NOT NULL CHECK (height BETWEEN 250 AND 4000),
  updated_at INTEGER NOT NULL
);

-- Stages are positioned on the stage itself from now on; their duplicate rows in pois are
-- folded into the stage (single source of truth) and the bundle derives the markers.
UPDATE stages SET
  x = COALESCE((SELECT p.x FROM pois p WHERE p.festival_id = stages.festival_id AND p.id = 'stage-' || stages.id), x),
  y = COALESCE((SELECT p.y FROM pois p WHERE p.festival_id = stages.festival_id AND p.id = 'stage-' || stages.id), y);
DELETE FROM pois WHERE cat = 'stage';
