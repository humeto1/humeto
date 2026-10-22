ALTER TABLE subscriptions ADD COLUMN features_json TEXT NOT NULL DEFAULT '["crm","tasks","forms"]';
ALTER TABLE tenants ADD COLUMN industry TEXT NOT NULL DEFAULT 'consultant';
UPDATE tenants SET industry='individual' WHERE type='individual';
CREATE TABLE access_vouchers(
 id TEXT PRIMARY KEY,code_hash TEXT NOT NULL UNIQUE,code_hint TEXT NOT NULL,label TEXT NOT NULL,
 audience TEXT NOT NULL CHECK(audience IN ('any','consultant','lawyer','agency','individual')),
 recipient_email TEXT NOT NULL DEFAULT '',features_json TEXT NOT NULL,
 seats INTEGER NOT NULL CHECK(seats>0),case_limit INTEGER NOT NULL CHECK(case_limit>0),storage_mb INTEGER NOT NULL CHECK(storage_mb>0),
 duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 730),
 starts_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,max_uses INTEGER NOT NULL CHECK(max_uses>0),uses INTEGER NOT NULL DEFAULT 0,
 revoked INTEGER NOT NULL DEFAULT 0,created_by TEXT NOT NULL REFERENCES users(id),created_at BIGINT NOT NULL
);
CREATE TABLE voucher_redemptions(id TEXT PRIMARY KEY,voucher_id TEXT NOT NULL REFERENCES access_vouchers(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),redeemed_at BIGINT NOT NULL,access_until TEXT NOT NULL,UNIQUE(voucher_id,tenant_id));
CREATE TABLE voucher_attempts(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),window_start BIGINT NOT NULL,count INTEGER NOT NULL);
