-- Site plan image (data: URL) uploaded in the map editor; NULL = the built-in illustration.
ALTER TABLE festivals ADD COLUMN site_map TEXT;
-- Stage pins are derived from the stages table from now on (one source for positions).
DELETE FROM pois WHERE id LIKE 'stage-%';
