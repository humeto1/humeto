ALTER TABLE subscriptions ADD COLUMN trial_started_at BIGINT NOT NULL DEFAULT 0;
UPDATE subscriptions SET trial_started_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
 expires_at=to_char((clock_timestamp()+interval '15 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE status='trial' AND expires_at='';
CREATE TABLE signup_limits(key TEXT PRIMARY KEY,window_start BIGINT NOT NULL,count INTEGER NOT NULL);
CREATE TABLE upgrade_requests(
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
 requested_by TEXT NOT NULL REFERENCES users(id),
 requested_at BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending'
);
