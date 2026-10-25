ALTER TABLE task_reminders ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','automatic'));
ALTER TABLE task_reminders ADD COLUMN source_key TEXT NOT NULL DEFAULT '';
ALTER TABLE task_followup_preferences ADD COLUMN focus_alerts BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE task_followup_preferences ALTER COLUMN daily_limit SET DEFAULT 3;
UPDATE task_followup_preferences SET daily_limit=LEAST(daily_limit,3),followup_minutes=0,revision=revision+1;
CREATE TABLE notification_dispatches(tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('automatic','manual','focus','project')),day TEXT NOT NULL,at TIMESTAMPTZ NOT NULL,tier TEXT NOT NULL CHECK(tier IN ('audible','gentle','silent')),payload JSONB NOT NULL,device_id TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,user_id,key));
CREATE INDEX notification_dispatch_member_day ON notification_dispatches(tenant_id,user_id,day);
CREATE TABLE project_chat_preferences(tenant_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),muted BOOLEAN NOT NULL DEFAULT true,last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_alerted_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),PRIMARY KEY(tenant_id,project_id,user_id));
