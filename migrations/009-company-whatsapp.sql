CREATE TABLE whatsapp_connections (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), desired TEXT NOT NULL DEFAULT 'off',
 status TEXT NOT NULL DEFAULT 'disconnected', phone TEXT UNIQUE, qr TEXT, qr_expires BIGINT,
 heartbeat BIGINT, updated_at BIGINT NOT NULL, error TEXT
);
CREATE TABLE whatsapp_auth (
 tenant_id TEXT NOT NULL REFERENCES whatsapp_connections(tenant_id) ON DELETE CASCADE,
 key TEXT NOT NULL, sealed TEXT NOT NULL, PRIMARY KEY(tenant_id,key)
);
CREATE TABLE whatsapp_messages (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES whatsapp_connections(tenant_id),
 remote TEXT NOT NULL, body TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 status TEXT NOT NULL, created_at BIGINT NOT NULL, author_id TEXT REFERENCES users(id), provider_id TEXT,
 UNIQUE(tenant_id,provider_id)
);
CREATE INDEX whatsapp_messages_company_time ON whatsapp_messages(tenant_id,created_at);
