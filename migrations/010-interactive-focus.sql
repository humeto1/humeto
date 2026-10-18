ALTER TABLE focus_sessions ADD COLUMN progress INTEGER CHECK(progress BETWEEN 0 AND 100);
ALTER TABLE focus_sessions ADD COLUMN next_step TEXT NOT NULL DEFAULT '';
ALTER TABLE focus_sessions ADD COLUMN blocker TEXT NOT NULL DEFAULT '' CHECK(blocker IN ('','waiting','unclear','overwhelmed','other'));
ALTER TABLE focus_events ADD COLUMN progress INTEGER CHECK(progress BETWEEN 0 AND 100);
ALTER TABLE focus_events ADD COLUMN next_step TEXT NOT NULL DEFAULT '';
ALTER TABLE focus_events ADD COLUMN blocker TEXT NOT NULL DEFAULT '';
ALTER TABLE focus_events ADD COLUMN assistant_reply TEXT NOT NULL DEFAULT '';
