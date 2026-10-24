ALTER TABLE tasks ADD COLUMN value_timing TEXT NOT NULL DEFAULT 'prompt' CHECK(value_timing IN ('prompt','deferred'));
ALTER TABLE tasks ADD COLUMN payment_pattern TEXT NOT NULL DEFAULT 'one_time' CHECK(payment_pattern IN ('one_time','monthly','installments'));
CREATE TABLE task_preferences(tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),default_currency TEXT NOT NULL DEFAULT 'PKR',revision BIGINT NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,user_id));
