-- Task inclusion, repetition, CSF and KPI are independent activity properties.
ALTER TABLE tasks ADD COLUMN is_csf BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN is_kpi BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN activity_note TEXT NOT NULL DEFAULT '';
-- The existing WBS uses project_id as its plan key; allow goal-owned maps too.
ALTER TABLE project_wbs DROP CONSTRAINT project_wbs_project_id_fkey;
ALTER TABLE project_wbs ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'project' CHECK(entity_type IN ('project','goal'));
INSERT INTO tasks(id,tenant_id,title,project_id,storage_state,stage,is_csf,activity_note,created_at)
 SELECT id,tenant_id,title,CASE WHEN entity_type='project' THEN entity_id ELSE '' END,
 CASE WHEN status='archived' THEN 'archive' ELSE 'planning' END,
 CASE WHEN status='active' THEN 'In progress' ELSE 'To do' END,TRUE,description,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') FROM plan_success_factors;
INSERT INTO task_goals(tenant_id,task_id,goal_id)
 SELECT tenant_id,id,entity_id FROM plan_success_factors WHERE entity_type='goal';
INSERT INTO project_wbs(project_id,tenant_id,entity_type)
 SELECT DISTINCT entity_id,tenant_id,entity_type FROM plan_success_factors ON CONFLICT DO NOTHING;
INSERT INTO project_wbs_nodes(id,project_id,parent_id,position)
 SELECT id,entity_id,NULL,1000+row_number() OVER(PARTITION BY entity_id ORDER BY created_at,id)::int FROM plan_success_factors;
ALTER TABLE plan_kpis DROP CONSTRAINT plan_kpis_factor_id_fkey;
ALTER TABLE plan_kpis RENAME TO activity_kpis;
ALTER TABLE activity_kpis RENAME COLUMN factor_id TO activity_id;
ALTER TABLE activity_kpis ADD FOREIGN KEY(activity_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE tasks DISABLE TRIGGER task_storage_guard;
UPDATE tasks SET is_kpi=TRUE WHERE id IN(SELECT activity_id FROM activity_kpis);
ALTER TABLE tasks ENABLE TRIGGER task_storage_guard;
DROP TABLE plan_success_factors;
ALTER TABLE plan_financial_targets DROP CONSTRAINT plan_financial_targets_basis_check;
ALTER TABLE plan_financial_targets ADD CONSTRAINT plan_financial_targets_basis_check CHECK(basis IN ('project','occurrence','day','week','month','quarter','half_year','year'));
CREATE OR REPLACE FUNCTION humeto_wbs_project_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_parent TEXT;
BEGIN
 IF OLD.project_id IS DISTINCT FROM NEW.project_id AND EXISTS(SELECT 1 FROM project_wbs_nodes WHERE id=NEW.id AND project_id=OLD.project_id) THEN
  SELECT parent_id INTO old_parent FROM project_wbs_nodes WHERE id=NEW.id;
  UPDATE project_wbs_nodes SET parent_id=old_parent WHERE parent_id=NEW.id;
  DELETE FROM project_wbs_nodes WHERE id=NEW.id;
  UPDATE project_wbs SET revision=revision+1 WHERE project_id=OLD.project_id;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION humeto_plan_wbs_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM project_wbs WHERE project_id=OLD.id AND entity_type=CASE WHEN TG_TABLE_NAME='projects' THEN 'project' ELSE 'goal' END;
 RETURN OLD;
END $$;
CREATE TRIGGER project_wbs_cleanup AFTER DELETE ON projects FOR EACH ROW EXECUTE FUNCTION humeto_plan_wbs_cleanup();
CREATE TRIGGER goal_wbs_cleanup AFTER DELETE ON goals FOR EACH ROW EXECUTE FUNCTION humeto_plan_wbs_cleanup();
-- Every occurrence of a repetitive task displays the activity's current tags.
CREATE FUNCTION humeto_activity_tags() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical TEXT;
BEGIN
 IF pg_trigger_depth()>1 OR (OLD.is_csf,OLD.is_kpi) IS NOT DISTINCT FROM (NEW.is_csf,NEW.is_kpi) THEN RETURN NEW; END IF;
 SELECT r.template_task_id INTO canonical FROM task_occurrences o JOIN task_recurrences r ON r.id=o.series_id AND r.tenant_id=NEW.tenant_id WHERE o.task_id=NEW.id LIMIT 1;
 canonical=COALESCE(canonical,NEW.id);
 UPDATE tasks SET is_csf=NEW.is_csf,is_kpi=NEW.is_kpi,last_actor_id=NEW.last_actor_id,revision=revision+1
 WHERE tenant_id=NEW.tenant_id AND id!=NEW.id AND storage_state IN ('active','planning') AND (is_csf,is_kpi) IS DISTINCT FROM (NEW.is_csf,NEW.is_kpi)
 AND (id=canonical OR id IN(SELECT o.task_id FROM task_occurrences o JOIN task_recurrences r ON r.id=o.series_id WHERE r.template_task_id=canonical AND r.tenant_id=NEW.tenant_id));
 RETURN NEW;
END $$;
CREATE TRIGGER activity_tags AFTER UPDATE OF is_csf,is_kpi ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_activity_tags();
