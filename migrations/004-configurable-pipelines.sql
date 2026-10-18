CREATE TABLE pipeline_settings (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 kind TEXT NOT NULL CHECK(kind IN ('leads','applicants','applications')),
 stages_json JSONB NOT NULL,
 redirects_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 revision BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,kind)
);
CREATE FUNCTION humeto_pipeline_redirect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind_name TEXT; stage_value TEXT; redirect_map JSONB; target TEXT;
BEGIN
 kind_name:=CASE TG_TABLE_NAME WHEN 'people' THEN 'applicants' ELSE TG_TABLE_NAME END;
 IF TG_TABLE_NAME='people' THEN stage_value:=NEW.journey_stage;
 ELSIF TG_TABLE_NAME='leads' THEN stage_value:=NEW.stage;
 ELSE stage_value:=NEW.status; END IF;
 SELECT redirects_json INTO redirect_map FROM pipeline_settings WHERE tenant_id=NEW.tenant_id AND kind=kind_name;
 target:=redirect_map->>stage_value;
 IF target IS NOT NULL THEN
  IF TG_TABLE_NAME='people' THEN NEW.journey_stage:=target;
  ELSIF TG_TABLE_NAME='leads' THEN NEW.stage:=target;
  ELSE NEW.status:=target; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pipeline_redirect BEFORE INSERT OR UPDATE ON people FOR EACH ROW EXECUTE FUNCTION humeto_pipeline_redirect();
CREATE TRIGGER pipeline_redirect BEFORE INSERT OR UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION humeto_pipeline_redirect();
CREATE TRIGGER pipeline_redirect BEFORE INSERT OR UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION humeto_pipeline_redirect();
