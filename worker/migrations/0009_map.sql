-- P6 map editor: per-festival ground plan and editable markers.
-- festivals.map: {"ground":"demo"|"plain","image":{"v":hash,"w":px,"h":px}} – the map is always
-- 1000 units wide; its height follows the ground plan's aspect ratio (940 without an image).
ALTER TABLE festivals ADD COLUMN map TEXT NOT NULL DEFAULT '{}';
UPDATE festivals SET map = '{"ground":"demo"}' WHERE id = 'realm';

-- The uploaded ground plan (base64), served separately so the festival document stays small.
CREATE TABLE map_images (
  festival_id TEXT PRIMARY KEY REFERENCES festivals(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Stage markers are derived from the stages table from now on (one position per stage);
-- the duplicated copies in pois are dropped.
DELETE FROM pois WHERE cat = 'stage';
