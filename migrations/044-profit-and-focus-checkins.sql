CREATE TABLE task_profit_receipts (
 id UUID PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 session_id TEXT REFERENCES focus_sessions(id) ON DELETE SET NULL,
 amount_minor BIGINT NOT NULL CHECK(amount_minor>0 AND amount_minor<=100000000000),
 currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 received_day DATE NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 recorded_by TEXT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX task_profit_receipt_task ON task_profit_receipts(tenant_id,task_id,received_day);
CREATE TABLE profit_receipt_goals(receipt_id UUID NOT NULL REFERENCES task_profit_receipts(id) ON DELETE CASCADE,goal_id TEXT NOT NULL,PRIMARY KEY(receipt_id,goal_id));
ALTER TABLE task_profit_receipts ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
ALTER TABLE focus_sessions ADD COLUMN attendance_due_at TIMESTAMPTZ;
ALTER TABLE focus_sessions ADD COLUMN attendance_prompt_at TIMESTAMPTZ;
CREATE FUNCTION humeto_focus_attendance_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='running' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state OR NEW.check_in_at IS DISTINCT FROM OLD.check_in_at) THEN
  NEW.attendance_due_at=humeto_action_time()+interval '30 minutes';NEW.attendance_prompt_at=NULL;
 ELSIF NEW.state<>'running' THEN NEW.attendance_due_at=NULL;NEW.attendance_prompt_at=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER focus_attendance_schedule BEFORE INSERT OR UPDATE ON focus_sessions FOR EACH ROW EXECUTE FUNCTION humeto_focus_attendance_schedule();
UPDATE focus_sessions SET attendance_due_at=humeto_action_time()+interval '30 minutes' WHERE state='running';
CREATE FUNCTION humeto_focus_attendance_sweep(tenant_key TEXT,user_key TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 UPDATE focus_sessions SET attendance_prompt_at=attendance_due_at WHERE tenant_id=tenant_key AND user_id=user_key AND state='running' AND attendance_due_at<=humeto_action_time() AND attendance_prompt_at IS NULL;
 WITH overdue AS MATERIALIZED (
  SELECT id,attendance_due_at AS cutoff FROM focus_sessions WHERE tenant_id=tenant_key AND user_id=user_key AND state='running' AND attendance_due_at+interval '1 minute'<=humeto_action_time() FOR UPDATE
 ), held AS (
  UPDATE focus_sessions f SET elapsed_seconds=f.elapsed_seconds+GREATEST(0,floor(extract(epoch FROM (LEAST(humeto_action_time(),o.cutoff)-f.running_since)))::bigint),
   state='paused',running_since=NULL,check_in_at=NULL,revision=f.revision+1 FROM overdue o WHERE f.id=o.id
  RETURNING f.*,o.cutoff
 ), trimmed AS (
  UPDATE focus_work_intervals w SET ended_at=GREATEST(w.started_at,h.cutoff) FROM held h WHERE w.session_id=h.id AND w.ended_at>=h.cutoff RETURNING w.id
 ) INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,note,elapsed_seconds)
 SELECT gen_random_uuid()::text,id,tenant_id,user_id,'attendance_paused','No response to the 30 minute check-in',elapsed_seconds FROM held;
END $$;
CREATE TABLE project_wbs_commands(tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),command_id UUID NOT NULL,payload_hash TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,user_id,command_id));
CREATE INDEX task_profit_receipt_project ON task_profit_receipts(tenant_id,project_id,currency);
CREATE INDEX profit_receipt_goal ON profit_receipt_goals(goal_id,receipt_id);
CREATE INDEX focus_interval_task ON focus_work_intervals(tenant_id,task_id,started_at);
