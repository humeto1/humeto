-- Future events include inherited project goals; existing historical snapshots remain unchanged.
CREATE OR REPLACE FUNCTION humeto_task_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project_name TEXT; goal_snapshot TEXT;
BEGIN
 SELECT title INTO project_name FROM projects WHERE id=NEW.project_id AND tenant_id=NEW.tenant_id;
 IF TG_OP='INSERT' THEN
  INSERT INTO task_events(id,tenant_id,task_id,event,from_stage,to_stage,title,project_id,project_title,actor_id)
  VALUES(gen_random_uuid()::text,NEW.tenant_id,NEW.id,'created','',NEW.stage,NEW.title,NEW.project_id,COALESCE(project_name,''),NEW.last_actor_id);
 ELSIF OLD.stage IS DISTINCT FROM NEW.stage THEN
  SELECT COALESCE(json_agg(json_build_object('id',g.id,'title',g.title) ORDER BY g.id)::text,'[]') INTO goal_snapshot FROM goals g WHERE g.tenant_id=NEW.tenant_id AND (g.id IN (SELECT l.goal_id FROM task_goals l WHERE l.task_id=NEW.id AND l.tenant_id=NEW.tenant_id) OR g.id IN (SELECT p.goal_id FROM projects p WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id));
  INSERT INTO task_events(id,tenant_id,task_id,event,from_stage,to_stage,title,project_id,project_title,goals_json,actor_id)
  VALUES(gen_random_uuid()::text,NEW.tenant_id,NEW.id,CASE WHEN NEW.stage='Done' THEN 'completed' WHEN OLD.stage='Done' THEN 'reopened' ELSE 'stage_changed' END,OLD.stage,NEW.stage,NEW.title,NEW.project_id,COALESCE(project_name,''),goal_snapshot,NEW.last_actor_id);
  IF NEW.stage='Done' THEN UPDATE task_reminders SET status='completed' WHERE task_id=NEW.id AND tenant_id=NEW.tenant_id AND status='scheduled'; END IF;
 END IF;
 RETURN NEW;
END $$;
