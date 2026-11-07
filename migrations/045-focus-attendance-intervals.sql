-- Attendance response grace is not worked time; keep the interval chart and
-- session counter aligned at the 30-minute cutoff when nobody responds.
CREATE OR REPLACE FUNCTION humeto_focus_intervals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE finish_at TIMESTAMPTZ=humeto_action_time();
BEGIN
 IF TG_OP='UPDATE' AND OLD.running_since IS NOT DISTINCT FROM NEW.running_since THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.state='running' AND NEW.state='paused' AND OLD.attendance_due_at IS NOT NULL AND OLD.attendance_due_at+interval '1 minute'<=finish_at THEN finish_at=OLD.attendance_due_at; END IF;
 UPDATE focus_work_intervals SET ended_at=GREATEST(started_at,finish_at) WHERE session_id=NEW.id AND ended_at IS NULL;
 IF NEW.running_since IS NOT NULL THEN INSERT INTO focus_work_intervals(session_id,tenant_id,user_id,task_id,started_at) VALUES(NEW.id,NEW.tenant_id,NEW.user_id,NEW.task_id,NEW.running_since); END IF;
 RETURN NEW;
END $$;
