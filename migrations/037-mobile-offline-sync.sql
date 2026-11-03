CREATE TABLE mobile_sync_commands (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 command_id UUID NOT NULL,payload_hash TEXT NOT NULL,result JSONB NOT NULL,
 client_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,command_id)
);
-- Set only by the authenticated sync transaction, never by a client SQL connection.
CREATE FUNCTION humeto_action_time() RETURNS TIMESTAMPTZ LANGUAGE sql VOLATILE AS $$
 SELECT COALESCE(NULLIF(current_setting('humeto.action_time',true),'')::timestamptz,clock_timestamp())
$$;
-- Preserve all existing trigger logic, using recorded action time for offline history.
DO $$ DECLARE fn TEXT; definition TEXT; BEGIN
 FOREACH fn IN ARRAY ARRAY['humeto_focus_task_done','humeto_focus_intervals','humeto_plan_completed','humeto_task_stored','humeto_task_before_stage'] LOOP
  SELECT pg_get_functiondef((fn||'()')::regprocedure) INTO definition;
  EXECUTE replace(definition,'clock_timestamp()','humeto_action_time()');
 END LOOP;
END $$;
ALTER TABLE focus_sessions ALTER COLUMN started_at SET DEFAULT humeto_action_time();
ALTER TABLE focus_events ALTER COLUMN created_at SET DEFAULT humeto_action_time();
ALTER TABLE task_events ALTER COLUMN created_at SET DEFAULT to_char(humeto_action_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE tasks ALTER COLUMN created_at SET DEFAULT to_char(humeto_action_time() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
ALTER TABLE projects ALTER COLUMN created_at SET DEFAULT to_char(humeto_action_time() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
ALTER TABLE goals ALTER COLUMN created_at SET DEFAULT to_char(humeto_action_time() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
