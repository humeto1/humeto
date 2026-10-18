CREATE TABLE focus_sessions (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 task_id TEXT NOT NULL REFERENCES tasks(id),
 target_minutes INTEGER NOT NULL CHECK(target_minutes BETWEEN 1 AND 720),
 state TEXT NOT NULL CHECK(state IN ('running','paused','blocked','completed','stopped')),
 elapsed_seconds BIGINT NOT NULL DEFAULT 0 CHECK(elapsed_seconds>=0),
 running_since TIMESTAMPTZ,
 check_in_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 ended_at TIMESTAMPTZ,
 note TEXT NOT NULL DEFAULT '',
 revision BIGINT NOT NULL DEFAULT 1,
 CHECK ((state='running') = (running_since IS NOT NULL)),
 CHECK ((state IN ('completed','stopped')) = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX focus_one_active ON focus_sessions(tenant_id,user_id) WHERE ended_at IS NULL;
CREATE INDEX focus_history ON focus_sessions(tenant_id,user_id,started_at DESC);
CREATE TABLE focus_events (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 event TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 elapsed_seconds BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A task completed from a board or assistant also stops its running timers.
CREATE FUNCTION humeto_focus_task_done() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.stage='Done' AND OLD.stage IS DISTINCT FROM NEW.stage THEN
  WITH ended AS (
   UPDATE focus_sessions SET
    elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-running_since)))::bigint) END,
    running_since=NULL,check_in_at=NULL,state='completed',ended_at=clock_timestamp(),revision=revision+1
   WHERE task_id=NEW.id AND tenant_id=NEW.tenant_id AND ended_at IS NULL
   RETURNING *
  ) INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,elapsed_seconds)
   SELECT gen_random_uuid()::text,id,tenant_id,user_id,'completed',elapsed_seconds FROM ended;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER focus_task_done AFTER UPDATE OF stage ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_focus_task_done();
