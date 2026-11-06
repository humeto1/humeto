CREATE TABLE plan_success_factors (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 entity_type TEXT NOT NULL CHECK(entity_type IN ('project','goal')),
 entity_id TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','attention','archived')),
 revision BIGINT NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plan_success_parent ON plan_success_factors(tenant_id,entity_type,entity_id);
CREATE TABLE plan_kpis (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 factor_id TEXT NOT NULL REFERENCES plan_success_factors(id) ON DELETE CASCADE,
 title TEXT NOT NULL,unit TEXT NOT NULL DEFAULT '',
 target NUMERIC NOT NULL CHECK(target>0 AND target<=1000000000000),
 cadence TEXT NOT NULL CHECK(cadence IN ('once','daily','weekly','monthly','yearly')),
 direction TEXT NOT NULL DEFAULT 'at_least' CHECK(direction IN ('at_least','at_most')),
 timezone TEXT NOT NULL,
 archived BOOLEAN NOT NULL DEFAULT FALSE,
 revision BIGINT NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plan_kpi_factor ON plan_kpis(factor_id);
CREATE TABLE plan_kpi_results (
 kpi_id TEXT NOT NULL REFERENCES plan_kpis(id) ON DELETE CASCADE,
 period_start DATE NOT NULL,period_end DATE NOT NULL,
 actual NUMERIC NOT NULL CHECK(actual>=0 AND actual<=1000000000000),
 target_snapshot NUMERIC NOT NULL,unit_snapshot TEXT NOT NULL,
 cadence_snapshot TEXT NOT NULL,direction_snapshot TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 recorded_by TEXT NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 revision BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY(kpi_id,period_start,cadence_snapshot)
);
