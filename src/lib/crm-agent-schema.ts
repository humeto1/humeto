import type { DatabaseSync } from "node:sqlite";
export function initializeCrmAgent(d: DatabaseSync) {
  d.exec(`CREATE TABLE IF NOT EXISTS crm_messages(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,action_id TEXT NOT NULL DEFAULT '',client_key TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(tenant_id,user_id,client_key));
CREATE TABLE IF NOT EXISTS crm_actions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',target_id TEXT NOT NULL DEFAULT '',expires_at INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS email_drafts(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,person_id TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Draft',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_crm_messages_scope ON crm_messages(tenant_id,user_id,created_at);`);
}
