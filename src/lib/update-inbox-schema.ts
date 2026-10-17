import type { DatabaseSync } from "node:sqlite";
export function initializeUpdateInbox(d: DatabaseSync) {
  d.exec(`CREATE TABLE IF NOT EXISTS update_inbox(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,sender TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,source_at TEXT NOT NULL,source_message_id TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '',fingerprint TEXT NOT NULL,client_key TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Pending',revision INTEGER NOT NULL DEFAULT 1,review TEXT NOT NULL DEFAULT '{}',review_expires_at INTEGER NOT NULL DEFAULT 0,decision_note TEXT NOT NULL DEFAULT '',applied_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(tenant_id,user_id,client_key),UNIQUE(tenant_id,user_id,fingerprint));
CREATE INDEX IF NOT EXISTS idx_update_inbox_scope ON update_inbox(tenant_id,user_id,created_at);`);
}
export function seedUpdateInbox(d: DatabaseSync) {
  if (
    !d
      .prepare(
        "SELECT id FROM people WHERE id='amira' AND tenant_id='northstar'",
      )
      .get() ||
    d
      .prepare("SELECT name FROM demo_migrations WHERE name='update-inbox-v1'")
      .get()
  )
    return;
  d.prepare(
    "INSERT OR IGNORE INTO update_inbox(id,tenant_id,user_id,sender,subject,body,source_at,fingerprint,client_key,payload_hash) VALUES('demo-offer-message','northstar','ayesha','admissions@example.edu','Conditional offer — app-amira','FICTIONAL DEMO EMAIL\nApplicant: amira.shah@example.com\nApplication reference: app-amira\nWe are pleased to make a conditional offer. Please review the conditions in the university portal. This sample message does not represent an actual university decision.',?,'demo-offer-message','demo-offer-message','demo-offer-message')",
  ).run(new Date().toISOString());
  d.prepare(
    "INSERT INTO demo_migrations(name) VALUES('update-inbox-v1')",
  ).run();
}
