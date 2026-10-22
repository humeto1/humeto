ALTER TABLE users ADD COLUMN email_verified_at BIGINT;
ALTER TABLE users ADD COLUMN verification_required INTEGER NOT NULL DEFAULT 0;
CREATE TABLE auth_email_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),token_hash TEXT NOT NULL UNIQUE,expires_at BIGINT NOT NULL,used_at BIGINT NOT NULL DEFAULT 0);
CREATE INDEX auth_email_tokens_user ON auth_email_tokens(user_id,purpose);
CREATE TABLE auth_email_limits(key TEXT PRIMARY KEY,window_start BIGINT NOT NULL,count INTEGER NOT NULL);
CREATE TABLE email_preferences(email TEXT PRIMARY KEY,optional_notifications INTEGER NOT NULL DEFAULT 1,marketing INTEGER NOT NULL DEFAULT 0,updated_at BIGINT NOT NULL);
CREATE TABLE email_unsubscribe_tokens(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES email_preferences(email),created_at BIGINT NOT NULL);
