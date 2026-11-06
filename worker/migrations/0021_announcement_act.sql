-- Backlog 5(g): an announcement prepared from a timetable change remembers its act, so the console
-- can offer to remove it when the change is reverted or replaced (it would contradict the programme).
ALTER TABLE announcements ADD COLUMN act_id TEXT;
CREATE INDEX announcements_act ON announcements (festival_id, act_id);
