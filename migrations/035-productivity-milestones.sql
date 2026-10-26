ALTER TABLE projects ADD COLUMN completed_at TIMESTAMPTZ;
ALTER TABLE goals ADD COLUMN completed_at TIMESTAMPTZ;
CREATE FUNCTION humeto_plan_completed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='Completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN NEW.completed_at=clock_timestamp();
 ELSIF NEW.status<>'Completed' THEN NEW.completed_at=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_completed BEFORE INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION humeto_plan_completed();
CREATE TRIGGER goal_completed BEFORE INSERT OR UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION humeto_plan_completed();
CREATE TABLE focus_work_intervals(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,CHECK(ended_at IS NULL OR ended_at>=started_at));
CREATE UNIQUE INDEX focus_open_interval ON focus_work_intervals(session_id) WHERE ended_at IS NULL;
CREATE INDEX focus_interval_report ON focus_work_intervals(tenant_id,user_id,started_at);
-- Recover measured historical slices from monotonic counters and their recorded event timestamps.
INSERT INTO focus_work_intervals(session_id,tenant_id,user_id,task_id,started_at,ended_at)
SELECT e.session_id,e.tenant_id,e.user_id,f.task_id,e.created_at-(e.elapsed_seconds-e.previous_seconds)*interval '1 second',e.created_at
FROM (SELECT *,lag(elapsed_seconds,1,0::bigint) OVER(PARTITION BY session_id ORDER BY created_at,id) AS previous_seconds FROM focus_events) e JOIN focus_sessions f ON f.id=e.session_id
WHERE e.elapsed_seconds>e.previous_seconds;
INSERT INTO focus_work_intervals(session_id,tenant_id,user_id,task_id,started_at) SELECT id,tenant_id,user_id,task_id,running_since FROM focus_sessions WHERE running_since IS NOT NULL;
CREATE FUNCTION humeto_focus_intervals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.running_since IS NOT DISTINCT FROM NEW.running_since THEN RETURN NEW; END IF;
 UPDATE focus_work_intervals SET ended_at=GREATEST(started_at,clock_timestamp()) WHERE session_id=NEW.id AND ended_at IS NULL;
 IF NEW.running_since IS NOT NULL THEN INSERT INTO focus_work_intervals(session_id,tenant_id,user_id,task_id,started_at) VALUES(NEW.id,NEW.tenant_id,NEW.user_id,NEW.task_id,NEW.running_since); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER focus_intervals AFTER INSERT OR UPDATE ON focus_sessions FOR EACH ROW EXECUTE FUNCTION humeto_focus_intervals();
CREATE TABLE plan_milestones(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,tenant_id TEXT NOT NULL REFERENCES tenants(id),entity_type TEXT NOT NULL CHECK(entity_type IN ('project','goal')),entity_id TEXT NOT NULL,title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 160),target_date TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Completed')),completed_at TIMESTAMPTZ,revision BIGINT NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX milestone_parent ON plan_milestones(tenant_id,entity_type,entity_id);
CREATE TABLE milestone_tasks(milestone_id TEXT NOT NULL REFERENCES plan_milestones(id) ON DELETE CASCADE,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,PRIMARY KEY(milestone_id,task_id));
