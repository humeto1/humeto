ALTER TABLE access_vouchers ADD COLUMN email_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE access_vouchers ADD COLUMN email_attempt_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE access_vouchers ADD COLUMN emailed_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE access_vouchers ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0;
