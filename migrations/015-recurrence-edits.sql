CREATE TABLE task_recurrence_events (
 id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES task_recurrences(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 event TEXT NOT NULL CHECK(event IN ('edited','skipped','state_changed')),
 previous_day TEXT NOT NULL,next_day TEXT NOT NULL,details JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recurrence_event_member ON task_recurrence_events(tenant_id,user_id,created_at);
