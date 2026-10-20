-- Audit D10: the demo festival "Nordlicht" had no medical point on its map; going live now requires one.
INSERT OR IGNORE INTO pois (festival_id, status, id, cat, name, x, y, detail, important)
SELECT 'nordlicht', 'open', 'md1', 'medical', 'Sanität am Hafentor', 160, 200, 'Rund um die Uhr besetzt · Notruf 112', 1
WHERE EXISTS (SELECT 1 FROM festivals WHERE id = 'nordlicht');
