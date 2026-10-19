CREATE TABLE journey_stage_visits (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),
 kind TEXT NOT NULL CHECK(kind IN ('leads','applicants','applications')),entity_id TEXT NOT NULL,stage TEXT NOT NULL,
 entered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),exited_at TIMESTAMPTZ,baseline BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX journey_one_current_stage ON journey_stage_visits(tenant_id,kind,entity_id) WHERE exited_at IS NULL;
CREATE INDEX journey_stage_history ON journey_stage_visits(tenant_id,kind,entity_id,entered_at);
-- Existing records start an observation window; their previous stage duration is unknown.
INSERT INTO journey_stage_visits(tenant_id,kind,entity_id,stage,baseline) SELECT tenant_id,'leads',id,stage,TRUE FROM leads;
INSERT INTO journey_stage_visits(tenant_id,kind,entity_id,stage,baseline) SELECT tenant_id,'applicants',id,journey_stage,TRUE FROM people;
INSERT INTO journey_stage_visits(tenant_id,kind,entity_id,stage,baseline) SELECT tenant_id,'applications',id,status,TRUE FROM applications;
CREATE FUNCTION humeto_journey_visit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_stage TEXT;old_stage TEXT;kind_name TEXT;at_time TIMESTAMPTZ:=clock_timestamp();
BEGIN
 kind_name:=CASE TG_TABLE_NAME WHEN 'people' THEN 'applicants' ELSE TG_TABLE_NAME END;
 new_stage:=to_jsonb(NEW)->>(CASE TG_TABLE_NAME WHEN 'people' THEN 'journey_stage' WHEN 'leads' THEN 'stage' ELSE 'status' END);
 IF TG_OP='UPDATE' THEN
  old_stage:=to_jsonb(OLD)->>(CASE TG_TABLE_NAME WHEN 'people' THEN 'journey_stage' WHEN 'leads' THEN 'stage' ELSE 'status' END);
  IF new_stage IS NOT DISTINCT FROM old_stage THEN RETURN NEW;END IF;
  UPDATE journey_stage_visits SET exited_at=at_time WHERE tenant_id=NEW.tenant_id AND kind=kind_name AND entity_id=NEW.id AND exited_at IS NULL;
 END IF;
 INSERT INTO journey_stage_visits(tenant_id,kind,entity_id,stage,entered_at) VALUES(NEW.tenant_id,kind_name,NEW.id,new_stage,at_time);
 RETURN NEW;
END $$;
CREATE TRIGGER journey_lead_visit AFTER INSERT OR UPDATE OF stage ON leads FOR EACH ROW EXECUTE FUNCTION humeto_journey_visit();
CREATE TRIGGER journey_applicant_visit AFTER INSERT OR UPDATE OF journey_stage ON people FOR EACH ROW EXECUTE FUNCTION humeto_journey_visit();
CREATE TRIGGER journey_application_visit AFTER INSERT OR UPDATE OF status ON applications FOR EACH ROW EXECUTE FUNCTION humeto_journey_visit();
CREATE TABLE journey_deadlines (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),kind TEXT NOT NULL CHECK(kind IN ('leads','applicants','applications')),entity_id TEXT NOT NULL,
 due_date TEXT NOT NULL DEFAULT '',timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',label TEXT NOT NULL DEFAULT '',
 revision BIGINT NOT NULL DEFAULT 1,updated_by TEXT NOT NULL REFERENCES users(id),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,kind,entity_id)
);
