-- WBS categories and selected tasks share task identity and retained history.
ALTER TABLE tasks DROP CONSTRAINT tasks_storage_state_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_storage_state_check CHECK(storage_state IN ('active','archive','bin','planning'));
CREATE OR REPLACE FUNCTION humeto_task_storage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.storage_state NOT IN ('active','planning') AND NEW.storage_state=OLD.storage_state THEN RAISE EXCEPTION 'Restore the task before editing it'; END IF;
 RETURN NEW;
END $$;
CREATE TABLE project_wbs (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 revision BIGINT NOT NULL DEFAULT 1
);
CREATE TABLE project_wbs_nodes (
 id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES project_wbs(project_id) ON DELETE CASCADE,
 parent_id TEXT REFERENCES project_wbs_nodes(id) ON DELETE SET NULL,
 position INTEGER NOT NULL DEFAULT 0,
 CHECK(id IS DISTINCT FROM parent_id)
);
CREATE INDEX project_wbs_nodes_parent ON project_wbs_nodes(project_id,parent_id,position);
ALTER TABLE task_recurrences ADD COLUMN wbs_suspended BOOLEAN NOT NULL DEFAULT FALSE;
-- The scheduler must not generate occurrences while a box is only a category.
CREATE FUNCTION humeto_wbs_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.storage_state='planning' OR (OLD.storage_state='planning' AND NEW.storage_state='active') THEN
  UPDATE task_recurrences SET wbs_suspended=(NEW.storage_state='planning'),
   next_day=CASE WHEN NEW.storage_state='active' THEN GREATEST(next_day,to_char(timezone(timezone,now()),'YYYY-MM-DD')) ELSE next_day END,
   revision=revision+1 WHERE template_task_id=NEW.id AND tenant_id=NEW.tenant_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wbs_selection AFTER UPDATE OF storage_state ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_wbs_selection();

-- Moving a task between projects detaches its old box without losing children.
CREATE FUNCTION humeto_wbs_project_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_parent TEXT;
BEGIN
 IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
  SELECT parent_id INTO old_parent FROM project_wbs_nodes WHERE id=NEW.id;
  UPDATE project_wbs_nodes SET parent_id=old_parent WHERE parent_id=NEW.id;
  DELETE FROM project_wbs_nodes WHERE id=NEW.id;
  UPDATE project_wbs SET revision=revision+1 WHERE project_id=OLD.project_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wbs_project_move AFTER UPDATE OF project_id ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_wbs_project_move();
