-- P6 map editor: per-festival map settings (ground image or built-in art).
-- Stage markers are derived from `stages` (x/y); `pois` keeps only non-stage points.
ALTER TABLE festivals ADD COLUMN map TEXT NOT NULL DEFAULT '{}';
UPDATE festivals SET map = '{"art":"demo"}' WHERE id = 'realm';
DELETE FROM pois WHERE cat = 'stage';
