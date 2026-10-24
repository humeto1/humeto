ALTER TABLE tasks ADD COLUMN storage_state TEXT NOT NULL DEFAULT 'active' CHECK(storage_state IN ('active','archive','bin'));
ALTER TABLE tasks ADD COLUMN stored_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN purge_after TIMESTAMPTZ;
ALTER TABLE tasks ADD CHECK ((storage_state='bin') = (purge_after IS NOT NULL));
CREATE INDEX task_bin_retention ON tasks(purge_after) WHERE storage_state='bin';
ALTER TABLE focus_sessions DROP CONSTRAINT focus_sessions_task_id_fkey;
ALTER TABLE focus_sessions ADD CONSTRAINT focus_sessions_task_id_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE task_reminders DROP CONSTRAINT task_reminders_fk_0;
ALTER TABLE task_reminders ADD CONSTRAINT task_reminders_fk_0 FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE;
CREATE FUNCTION humeto_task_storage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.storage_state!='active' AND NEW.storage_state=OLD.storage_state THEN RAISE EXCEPTION 'Restore the task before editing it'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_storage_guard BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_task_storage_guard();
CREATE FUNCTION humeto_task_stored() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.storage_state!='active' AND OLD.storage_state IS DISTINCT FROM NEW.storage_state THEN
  UPDATE task_reminders SET status='cancelled',revision=revision+1 WHERE task_id=NEW.id AND status='scheduled';
  WITH ended AS (
   UPDATE focus_sessions SET elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM(clock_timestamp()-running_since)))::bigint) END,running_since=NULL,check_in_at=NULL,break_until=NULL,state='stopped',ended_at=clock_timestamp(),revision=revision+1 WHERE task_id=NEW.id AND ended_at IS NULL RETURNING *
  ) INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,note,elapsed_seconds) SELECT gen_random_uuid()::text,id,tenant_id,user_id,'stopped','Task moved to '||NEW.storage_state,elapsed_seconds FROM ended;
  UPDATE task_activities SET elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM(clock_timestamp()-running_since)))::bigint) END,running_since=NULL,check_in_at=NULL,state='ended',ended_at=clock_timestamp(),revision=revision+1 WHERE task_id=NEW.id AND state!='ended';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_stored AFTER UPDATE OF storage_state ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_task_stored();
CREATE FUNCTION humeto_task_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND tenant_id=NEW.tenant_id AND storage_state='active') THEN RAISE EXCEPTION 'Task is unavailable; restore it before starting work'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER focus_storage_guard BEFORE INSERT OR UPDATE OF task_id ON focus_sessions FOR EACH ROW EXECUTE FUNCTION humeto_task_reference_guard();
CREATE TRIGGER reminder_storage_guard BEFORE INSERT OR UPDATE OF task_id ON task_reminders FOR EACH ROW EXECUTE FUNCTION humeto_task_reference_guard();
CREATE TRIGGER activity_storage_guard BEFORE INSERT OR UPDATE OF task_id ON task_activities FOR EACH ROW EXECUTE FUNCTION humeto_task_reference_guard();
CREATE FUNCTION humeto_task_delete_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM task_events WHERE task_id=OLD.id;
 DELETE FROM task_goals WHERE task_id=OLD.id;
 DELETE FROM lead_followups WHERE task_id=OLD.id;
 DELETE FROM work_assignments WHERE entity_type='task' AND entity_id=OLD.id;
 DELETE FROM assignment_revisions WHERE entity_type='task' AND entity_id=OLD.id;
 UPDATE task_occurrences SET disposition='skipped' WHERE task_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER task_delete_cleanup BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION humeto_task_delete_cleanup();
CREATE FUNCTION humeto_purge_task_bin(at_time TIMESTAMPTZ DEFAULT now(), scope_tenant TEXT DEFAULT '') RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE removed INTEGER;
BEGIN
 DELETE FROM tasks WHERE id IN (SELECT id FROM tasks WHERE storage_state='bin' AND purge_after<=at_time AND (scope_tenant='' OR tenant_id=scope_tenant) ORDER BY purge_after LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS removed = ROW_COUNT;
 RETURN removed;
END $$;
