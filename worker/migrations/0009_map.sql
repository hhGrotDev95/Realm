-- P6: per-festival ground plan. JSON {"height": <canvas height>, "image": "<data URL>"}; the canvas is
-- always 1000 units wide, so marker coordinates are relative to the plan and survive re-uploads.
ALTER TABLE festivals ADD COLUMN map TEXT NOT NULL DEFAULT '{}';
