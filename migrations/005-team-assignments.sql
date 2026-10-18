CREATE TABLE work_assignments (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 entity_type TEXT NOT NULL CHECK(entity_type IN ('task','application','applicant','project')),
 entity_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 assigned_by TEXT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,entity_type,entity_id,user_id)
);
CREATE TABLE assignment_revisions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,revision BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,entity_type,entity_id)
);
