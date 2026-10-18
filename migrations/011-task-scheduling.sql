ALTER TABLE task_reminders ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;
CREATE TABLE task_followup_preferences (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 enabled BOOLEAN NOT NULL DEFAULT TRUE,timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
 quiet_enabled BOOLEAN NOT NULL DEFAULT TRUE,quiet_start TEXT NOT NULL DEFAULT '22:00',quiet_end TEXT NOT NULL DEFAULT '08:00',
 daily_limit INTEGER NOT NULL DEFAULT 5 CHECK(daily_limit BETWEEN 1 AND 20),
 followup_minutes INTEGER NOT NULL DEFAULT 0 CHECK(followup_minutes IN (0,60,240,1440)),
 revision BIGINT NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE task_recurrences (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 template_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekdays','weekly','monthly')),
 interval_count INTEGER NOT NULL CHECK(interval_count BETWEEN 1 AND 12),
 first_day TEXT NOT NULL,next_day TEXT NOT NULL,end_day TEXT NOT NULL DEFAULT '',local_time TEXT NOT NULL,timezone TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled','ended')),
 revision BIGINT NOT NULL DEFAULT 1,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_live_recurrence_per_member_task ON task_recurrences(tenant_id,user_id,template_task_id) WHERE status IN ('active','paused');
CREATE TABLE task_occurrences (
 series_id TEXT NOT NULL REFERENCES task_recurrences(id) ON DELETE CASCADE,day TEXT NOT NULL,
 task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(series_id,day)
);
CREATE TABLE task_followup_notifications (
 reminder_id TEXT PRIMARY KEY REFERENCES task_reminders(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 notified_at TIMESTAMPTZ NOT NULL,nudge_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE task_reminder_events (
 id TEXT PRIMARY KEY,reminder_id TEXT NOT NULL REFERENCES task_reminders(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),event TEXT NOT NULL,
 previous_at TEXT NOT NULL DEFAULT '',next_at TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reminder_event_member_date ON task_reminder_events(tenant_id,user_id,created_at);
CREATE TABLE task_scheduler_heartbeat (id TEXT PRIMARY KEY,heartbeat TIMESTAMPTZ NOT NULL);
-- Version every lifecycle change, including board completion and legacy assistant updates.
CREATE FUNCTION humeto_reminder_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status,NEW.remind_at) IS DISTINCT FROM (OLD.status,OLD.remind_at) THEN NEW.revision=OLD.revision+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reminder_revision BEFORE UPDATE ON task_reminders FOR EACH ROW EXECUTE FUNCTION humeto_reminder_revision();
