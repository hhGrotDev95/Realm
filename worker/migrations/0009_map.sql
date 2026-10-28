-- P6 map editor: each festival has its own ground plan (frame size + optional image).
-- Marker coordinates stay in the frame's units (width 1000); the frame height follows the
-- image's aspect ratio. Stage markers are now derived from the stages table, so the stored
-- copies are removed (they had the same coordinates).
ALTER TABLE festivals ADD COLUMN map TEXT NOT NULL DEFAULT '{}';
UPDATE festivals SET map = '{"ground":"demo"}' WHERE id = 'realm';
DELETE FROM pois WHERE cat = 'stage';
