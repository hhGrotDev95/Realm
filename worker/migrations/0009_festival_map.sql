-- P6 map editor: per-festival site plan (JSON: height in map units, optional image as
-- data: URL, terrain = 'demo' for the built-in demo grounds). Markers stay in `pois`.
ALTER TABLE festivals ADD COLUMN map TEXT NOT NULL DEFAULT '{}';
UPDATE festivals SET map = '{"height":940,"terrain":"demo"}' WHERE id = 'realm';
