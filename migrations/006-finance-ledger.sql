CREATE TABLE finance_entries (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),
 source_kind TEXT NOT NULL,source_id TEXT NOT NULL,
 entry_date DATE NOT NULL,description TEXT NOT NULL,
 person_id TEXT NOT NULL DEFAULT '',project_id TEXT NOT NULL DEFAULT '',employee_id TEXT NOT NULL DEFAULT '',
 debit_account TEXT NOT NULL CHECK(debit_account IN ('Cash','Client receivable','Commission receivable','Service income','Commission income','Operating expense')),
 credit_account TEXT NOT NULL CHECK(credit_account IN ('Cash','Client receivable','Commission receivable','Service income','Commission income','Operating expense')),
 amount BIGINT NOT NULL CHECK(amount>0),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),
 created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,source_kind,source_id),CHECK(debit_account<>credit_account)
);
CREATE INDEX finance_period ON finance_entries(tenant_id,entry_date);
CREATE TABLE finance_invoices (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL REFERENCES people(id),
 project_id TEXT NOT NULL DEFAULT '',number TEXT NOT NULL,title TEXT NOT NULL,issue_date DATE NOT NULL,
 amount BIGINT NOT NULL CHECK(amount>0),created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,number)
);
CREATE TABLE finance_installments (
 id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,tenant_id TEXT NOT NULL REFERENCES tenants(id),
 due_date DATE NOT NULL,amount BIGINT NOT NULL CHECK(amount>0)
);
CREATE TABLE finance_payment_allocations (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),invoice_id TEXT NOT NULL REFERENCES finance_invoices(id),
 payment_id TEXT NOT NULL REFERENCES payments(id),amount BIGINT NOT NULL CHECK(amount>0),created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE finance_adjustments (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),kind TEXT NOT NULL CHECK(kind IN ('refund','credit')),
 source_id TEXT NOT NULL,amount BIGINT NOT NULL CHECK(amount>0),entry_date DATE NOT NULL,reason TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE finance_commissions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),application_id TEXT NOT NULL REFERENCES applications(id),
 institution TEXT NOT NULL,reference TEXT NOT NULL,amount BIGINT NOT NULL CHECK(amount>0),earned_date DATE NOT NULL,expected_date DATE NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(tenant_id,reference)
);
CREATE TABLE finance_commission_receipts (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),commission_id TEXT NOT NULL REFERENCES finance_commissions(id),
 amount BIGINT NOT NULL CHECK(amount>0),entry_date DATE NOT NULL,reference TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE employee_cost_profiles (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),monthly_salary BIGINT NOT NULL CHECK(monthly_salary>=0),monthly_overhead BIGINT NOT NULL CHECK(monthly_overhead>=0),revision BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE employee_allocations (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 entity_type TEXT NOT NULL CHECK(entity_type IN ('applicant','project')),entity_id TEXT NOT NULL,entry_date DATE NOT NULL,
 cost BIGINT NOT NULL CHECK(cost>=0),revenue BIGINT NOT NULL CHECK(revenue>=0),note TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),
 CHECK(cost>0 OR revenue>0)
);
CREATE TABLE finance_commands (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),client_key TEXT NOT NULL,payload TEXT NOT NULL,result_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,client_key)
);
-- Historical receipts are client credits until invoices recognize the related income.
INSERT INTO finance_entries(id,tenant_id,source_kind,source_id,entry_date,description,person_id,debit_account,credit_account,amount,created_by)
 SELECT gen_random_uuid()::text,tenant_id,'payment',id,created_at::date,reference,person_id,'Cash','Client receivable',amount,created_by FROM payments;
CREATE FUNCTION humeto_payment_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO finance_entries(id,tenant_id,source_kind,source_id,entry_date,description,person_id,debit_account,credit_account,amount,created_by)
 VALUES(gen_random_uuid()::text,NEW.tenant_id,'payment',NEW.id,NEW.created_at::date,NEW.reference,NEW.person_id,'Cash','Client receivable',NEW.amount,NEW.created_by);
 RETURN NEW;
END $$;
CREATE TRIGGER payment_ledger AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION humeto_payment_ledger();
