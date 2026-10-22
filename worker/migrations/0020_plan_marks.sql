-- Reminders and "Were you there?" answers per act, backed up next to the plan so that restoring a
-- profile on a new device brings them back. attended: NULL = not answered, 0 = no, 1 = yes.
-- Personal data of the guest: goes with the guest (cascade) and with the festival.
CREATE TABLE plan_marks (
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  act_id TEXT NOT NULL,
  remind INTEGER NOT NULL DEFAULT 0,
  attended INTEGER,
  PRIMARY KEY (guest_id, festival_id, act_id)
);
