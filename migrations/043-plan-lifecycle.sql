-- Plan pauses are independent of task completion and survive edits from any client.
CREATE FUNCTION humeto_task_plan_paused(task_key TEXT) RETURNS BOOLEAN LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_key AND (
  EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.tenant_id=t.tenant_id AND (p.status='Paused' OR EXISTS(SELECT 1 FROM goals g WHERE g.id=p.goal_id AND g.tenant_id=t.tenant_id AND g.status='Paused')))
  OR EXISTS(SELECT 1 FROM task_goals l JOIN goals g ON g.id=l.goal_id AND g.tenant_id=l.tenant_id WHERE l.task_id=t.id AND l.tenant_id=t.tenant_id AND g.status='Paused')
 ));
$$;
CREATE FUNCTION humeto_paused_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.stage IS DISTINCT FROM OLD.stage AND humeto_task_plan_paused(OLD.id) THEN
  RAISE EXCEPTION 'Resume the project or goal before working on this task.' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paused_plan_task_guard BEFORE UPDATE OF stage ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_paused_task_guard();
CREATE FUNCTION humeto_paused_focus_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='running' AND humeto_task_plan_paused(NEW.task_id) THEN
  RAISE EXCEPTION 'Resume the project or goal before working on this task.' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paused_plan_focus_guard BEFORE INSERT OR UPDATE OF state ON focus_sessions FOR EACH ROW EXECUTE FUNCTION humeto_paused_focus_guard();
-- Resume at the next original schedule date, preserving weekday/month anchors.
CREATE FUNCTION humeto_plan_resume_day(next_value TEXT, frequency_value TEXT, interval_value INTEGER, anchor_value INTEGER, today DATE) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE candidate DATE=next_value::date; step INTEGER; month_first DATE; i INTEGER;
BEGIN
 IF candidate>=today THEN RETURN to_char(candidate,'YYYY-MM-DD'); END IF;
 IF frequency_value IN ('daily','weekly') THEN
  step=interval_value*CASE WHEN frequency_value='weekly' THEN 7 ELSE 1 END;
  candidate=candidate+(ceil((today-candidate)::numeric/step)::integer*step);
 ELSE
  WHILE candidate<today LOOP
   IF frequency_value IN ('monthly','yearly') THEN
    month_first=(date_trunc('month',candidate)+make_interval(months=>interval_value*CASE WHEN frequency_value='yearly' THEN 12 ELSE 1 END))::date;
    candidate=month_first+LEAST(anchor_value,((month_first+interval '1 month - 1 day')::date-month_first)+1)-1;
   ELSE
    FOR i IN 1..interval_value LOOP
     LOOP candidate=candidate+1; EXIT WHEN extract(isodow FROM candidate)<6; END LOOP;
    END LOOP;
   END IF;
  END LOOP;
 END IF;
 RETURN to_char(candidate,'YYYY-MM-DD');
END $$;
CREATE OR REPLACE FUNCTION humeto_wbs_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.storage_state='planning' OR (OLD.storage_state='planning' AND NEW.storage_state='active') THEN
  UPDATE task_recurrences SET wbs_suspended=(NEW.storage_state='planning'),
   next_day=CASE WHEN NEW.storage_state='active' THEN humeto_plan_resume_day(next_day,frequency,interval_count,substring(first_day,9,2)::integer,(humeto_action_time() AT TIME ZONE timezone)::date) ELSE next_day END,
   revision=revision+1 WHERE template_task_id=NEW.id AND tenant_id=NEW.tenant_id;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION humeto_plan_pause_effects() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected TEXT[];
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT COALESCE(array_agg(t.id),ARRAY[]::text[]) INTO affected FROM tasks t WHERE t.tenant_id=NEW.tenant_id AND
 CASE WHEN TG_TABLE_NAME='projects' THEN t.project_id=NEW.id ELSE
  EXISTS(SELECT 1 FROM task_goals l WHERE l.task_id=t.id AND l.tenant_id=t.tenant_id AND l.goal_id=NEW.id)
  OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.tenant_id=t.tenant_id AND p.goal_id=NEW.id)
 END;
 IF NEW.status='Paused' THEN
  WITH held AS (
   UPDATE focus_sessions SET elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (humeto_action_time()-running_since)))::bigint) END,
    state='paused',running_since=NULL,check_in_at=NULL,revision=revision+1
   WHERE tenant_id=NEW.tenant_id AND state='running' AND ended_at IS NULL AND task_id=ANY(affected)
   RETURNING *
  ) INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,note,elapsed_seconds)
   SELECT gen_random_uuid()::text,id,tenant_id,user_id,'plan_paused','Project or goal paused',elapsed_seconds FROM held;
 ELSIF OLD.status='Paused' AND NEW.status='Active' THEN
  UPDATE task_recurrences r SET next_day=humeto_plan_resume_day(next_day,frequency,interval_count,substring(first_day,9,2)::integer,(humeto_action_time() AT TIME ZONE r.timezone)::date),revision=revision+1
   WHERE tenant_id=NEW.tenant_id AND status='active' AND template_task_id=ANY(affected);
  UPDATE task_reminders SET status='cancelled' WHERE tenant_id=NEW.tenant_id AND status='scheduled' AND remind_at::timestamptz<humeto_action_time() AND task_id=ANY(affected);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_pause_effects AFTER UPDATE OF status ON projects FOR EACH ROW EXECUTE FUNCTION humeto_plan_pause_effects();
CREATE TRIGGER goal_pause_effects AFTER UPDATE OF status ON goals FOR EACH ROW EXECUTE FUNCTION humeto_plan_pause_effects();
-- Apply the same hold to sessions attached to plans already marked Paused.
WITH held AS (
 UPDATE focus_sessions SET elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (humeto_action_time()-running_since)))::bigint) END,
 state='paused',running_since=NULL,check_in_at=NULL,revision=revision+1
 WHERE state='running' AND ended_at IS NULL AND humeto_task_plan_paused(task_id) RETURNING *
) INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,note,elapsed_seconds)
 SELECT gen_random_uuid()::text,id,tenant_id,user_id,'plan_paused','Project or goal paused',elapsed_seconds FROM held;
