-- Database-boundary task events apply equally to manual, assistant and future job writes.
CREATE FUNCTION humeto_task_before_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.stage IS DISTINCT FROM NEW.stage THEN
  NEW.completed_at := CASE WHEN NEW.stage='Done' THEN to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION humeto_task_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project_name TEXT; goal_snapshot TEXT;
BEGIN
 SELECT title INTO project_name FROM projects WHERE id=NEW.project_id AND tenant_id=NEW.tenant_id;
 IF TG_OP='INSERT' THEN
  INSERT INTO task_events(id,tenant_id,task_id,event,from_stage,to_stage,title,project_id,project_title,actor_id)
  VALUES(gen_random_uuid()::text,NEW.tenant_id,NEW.id,'created','',NEW.stage,NEW.title,NEW.project_id,COALESCE(project_name,''),NEW.last_actor_id);
 ELSIF OLD.stage IS DISTINCT FROM NEW.stage THEN
  SELECT COALESCE(json_agg(json_build_object('id',g.id,'title',g.title) ORDER BY g.id)::text,'[]') INTO goal_snapshot FROM task_goals l JOIN goals g ON g.id=l.goal_id AND g.tenant_id=l.tenant_id WHERE l.task_id=NEW.id AND l.tenant_id=NEW.tenant_id;
  INSERT INTO task_events(id,tenant_id,task_id,event,from_stage,to_stage,title,project_id,project_title,goals_json,actor_id)
  VALUES(gen_random_uuid()::text,NEW.tenant_id,NEW.id,CASE WHEN NEW.stage='Done' THEN 'completed' WHEN OLD.stage='Done' THEN 'reopened' ELSE 'stage_changed' END,OLD.stage,NEW.stage,NEW.title,NEW.project_id,COALESCE(project_name,''),goal_snapshot,NEW.last_actor_id);
  IF NEW.stage='Done' THEN UPDATE task_reminders SET status='completed' WHERE task_id=NEW.id AND tenant_id=NEW.tenant_id AND status='scheduled'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_before_stage BEFORE UPDATE OF stage ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_task_before_stage();
CREATE TRIGGER task_created_event AFTER INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_task_event();
CREATE TRIGGER task_stage_event AFTER UPDATE OF stage ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_task_event();
