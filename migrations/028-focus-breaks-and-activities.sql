ALTER TABLE focus_sessions ADD COLUMN break_until TIMESTAMPTZ;
ALTER TABLE focus_sessions ADD COLUMN break_kind TEXT NOT NULL DEFAULT '';
CREATE TABLE task_activities (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,created_by TEXT NOT NULL REFERENCES users(id),
 performer_kind TEXT NOT NULL CHECK(performer_kind IN ('team','automation','waiting')),performer_id TEXT REFERENCES users(id),performer_label TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','paused','ended')),elapsed_seconds BIGINT NOT NULL DEFAULT 0,running_since TIMESTAMPTZ DEFAULT now(),
 check_in_at TIMESTAMPTZ,note TEXT NOT NULL,reminder_id TEXT REFERENCES task_reminders(id) ON DELETE SET NULL,revision BIGINT NOT NULL DEFAULT 1,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),ended_at TIMESTAMPTZ
);
CREATE INDEX task_activity_task ON task_activities(tenant_id,task_id,started_at DESC);
CREATE TABLE task_activity_events(id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES task_activities(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES users(id),event TEXT NOT NULL,note TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE FUNCTION humeto_task_activity_done() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.stage='Done' AND OLD.stage IS DISTINCT FROM NEW.stage THEN
  UPDATE task_reminders SET status='cancelled' WHERE id IN (SELECT reminder_id FROM task_activities WHERE tenant_id=NEW.tenant_id AND task_id=NEW.id AND state!='ended');
  UPDATE task_activities SET elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-running_since)))::bigint) END,state='ended',running_since=NULL,check_in_at=NULL,ended_at=now(),revision=revision+1 WHERE tenant_id=NEW.tenant_id AND task_id=NEW.id AND state!='ended';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER task_activity_done AFTER UPDATE OF stage ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_task_activity_done();
