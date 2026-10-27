-- Map editor: a festival's own site plan ({ image: data URL, height: map units }).
-- Marker positions stay in pois/stages (x 0–1000, y 0–height); '{}' = built-in demo ground.
ALTER TABLE festivals ADD COLUMN map TEXT NOT NULL DEFAULT '{}';
