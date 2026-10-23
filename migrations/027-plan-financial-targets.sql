CREATE TABLE plan_financial_targets (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),entity_type TEXT NOT NULL CHECK(entity_type IN ('project','goal','routine')),entity_id TEXT NOT NULL,
 currency TEXT NOT NULL,upfront BIGINT NOT NULL DEFAULT 0 CHECK(upfront>=0),completion BIGINT NOT NULL DEFAULT 0 CHECK(completion>=0),conditional BIGINT NOT NULL DEFAULT 0 CHECK(conditional>=0),
 upfront_date TEXT NOT NULL DEFAULT '',completion_date TEXT NOT NULL DEFAULT '',conditional_date TEXT NOT NULL DEFAULT '',condition TEXT NOT NULL DEFAULT '',basis TEXT NOT NULL DEFAULT 'project' CHECK(basis IN ('project','occurrence','month','year')),revision BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,entity_type,entity_id)
);
