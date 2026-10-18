CREATE TABLE ocr_jobs (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL REFERENCES people(id),
 document_id TEXT NOT NULL REFERENCES documents(id),document_version BIGINT NOT NULL,source_sha256 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','superseded')),
 language TEXT NOT NULL DEFAULT 'eng' CHECK(language='eng'),attempts BIGINT NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TIMESTAMPTZ,progress BIGINT NOT NULL DEFAULT 0,page_count BIGINT NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '',engine TEXT NOT NULL DEFAULT '',warnings JSONB NOT NULL DEFAULT '[]',
 revision BIGINT NOT NULL DEFAULT 1,requested_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,document_id,document_version)
);
CREATE INDEX ocr_queue ON ocr_jobs(status,created_at);
CREATE TABLE ocr_pages (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,tenant_id TEXT NOT NULL REFERENCES tenants(id),
 page_number BIGINT NOT NULL,width DOUBLE PRECISION NOT NULL,height DOUBLE PRECISION NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('pdf-text','tesseract')),text_content TEXT NOT NULL,
 lines JSONB NOT NULL,preview_name TEXT NOT NULL,UNIQUE(job_id,page_number)
);
CREATE TABLE document_facts (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,tenant_id TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL REFERENCES people(id),
 document_id TEXT NOT NULL REFERENCES documents(id),document_version BIGINT NOT NULL,page_number BIGINT NOT NULL,
 section_key TEXT NOT NULL,field_key TEXT NOT NULL,group_key TEXT NOT NULL DEFAULT '',label TEXT NOT NULL,
 extracted_value TEXT NOT NULL,chosen_value TEXT NOT NULL,source_excerpt TEXT NOT NULL,source_box JSONB,confidence DOUBLE PRECISION,
 method TEXT NOT NULL,warnings JSONB NOT NULL DEFAULT '[]',
 applicant_review TEXT NOT NULL DEFAULT 'pending' CHECK(applicant_review IN ('pending','confirmed','rejected')),
 staff_review TEXT NOT NULL DEFAULT 'pending' CHECK(staff_review IN ('pending','accepted','rejected')),
 applicant_reviewer TEXT REFERENCES users(id),staff_reviewer TEXT REFERENCES users(id),
 applicant_reviewed_at TIMESTAMPTZ,staff_reviewed_at TIMESTAMPTZ,
 source_stale BOOLEAN NOT NULL DEFAULT false,revision BIGINT NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fact_person ON document_facts(tenant_id,person_id);
CREATE TABLE document_fact_events (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),fact_id TEXT NOT NULL REFERENCES document_facts(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id),event TEXT NOT NULL,value TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE fact_applications (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL REFERENCES people(id),
 fact_id TEXT NOT NULL REFERENCES document_facts(id) ON DELETE CASCADE,section_key TEXT NOT NULL,field_key TEXT NOT NULL,record_id TEXT NOT NULL DEFAULT '',
 applied_value TEXT NOT NULL,intake_revision BIGINT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fact_profile ON fact_applications(tenant_id,person_id,section_key);
CREATE TABLE ocr_worker_heartbeats (worker_id TEXT PRIMARY KEY,seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),engine TEXT NOT NULL);
CREATE FUNCTION humeto_ocr_source_replaced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.current_version IS DISTINCT FROM NEW.current_version THEN
  UPDATE ocr_jobs SET status='superseded',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=now() WHERE document_id=NEW.id AND tenant_id=NEW.tenant_id AND document_version<>NEW.current_version AND status IN ('queued','running');
  INSERT INTO document_fact_events(id,tenant_id,fact_id,event,note)
   SELECT gen_random_uuid()::text,tenant_id,id,'source_replaced','A newer source version requires a fresh review' FROM document_facts WHERE document_id=NEW.id AND tenant_id=NEW.tenant_id AND NOT source_stale;
  UPDATE document_facts SET source_stale=true,revision=revision+1 WHERE document_id=NEW.id AND tenant_id=NEW.tenant_id AND document_version<>NEW.current_version AND NOT source_stale;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ocr_source_replaced AFTER UPDATE OF current_version ON documents FOR EACH ROW EXECUTE FUNCTION humeto_ocr_source_replaced();
