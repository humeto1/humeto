import type { DatabaseSync } from "node:sqlite";
export function initializeRequestWorkflow(d: DatabaseSync) {
  const cols = d
    .prepare("PRAGMA table_info(requests)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("revision"))
    d.exec(
      "ALTER TABLE requests ADD COLUMN revision INTEGER NOT NULL DEFAULT 1; ALTER TABLE requests ADD COLUMN requires_document INTEGER NOT NULL DEFAULT 0; ALTER TABLE requests ADD COLUMN follow_up_at TEXT NOT NULL DEFAULT ''; ALTER TABLE requests ADD COLUMN follow_up_timezone TEXT NOT NULL DEFAULT ''; ALTER TABLE requests ADD COLUMN follow_up_task_id TEXT NOT NULL DEFAULT ''; ALTER TABLE requests ADD COLUMN document_id TEXT NOT NULL DEFAULT ''; ALTER TABLE requests ADD COLUMN document_version INTEGER NOT NULL DEFAULT 0; ALTER TABLE requests ADD COLUMN review_note TEXT NOT NULL DEFAULT ''",
    );
  d.exec(`CREATE TABLE IF NOT EXISTS request_replies(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,request_id TEXT NOT NULL,actor_id TEXT NOT NULL,channel TEXT NOT NULL,message TEXT NOT NULL,client_key TEXT NOT NULL,payload_hash TEXT NOT NULL,timezone TEXT NOT NULL,proposal TEXT NOT NULL DEFAULT '{}',proposal_state TEXT NOT NULL DEFAULT 'None',request_revision INTEGER NOT NULL,document_id TEXT NOT NULL DEFAULT '',document_version INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(tenant_id,actor_id,client_key));
 CREATE TABLE IF NOT EXISTS request_events(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,request_id TEXT NOT NULL,actor_id TEXT NOT NULL,event TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',document_id TEXT NOT NULL DEFAULT '',document_version INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE INDEX IF NOT EXISTS idx_request_replies_scope ON request_replies(tenant_id,request_id,created_at);`);
}
export function seedRequestWorkflow(d: DatabaseSync) {
  if (
    !d
      .prepare(
        "SELECT id FROM people WHERE id='amira' AND tenant_id='northstar'",
      )
      .get()
  )
    return;
  if (
    d
      .prepare(
        "SELECT name FROM demo_migrations WHERE name='request-workflow-v1'",
      )
      .get()
  )
    return;
  d.prepare(
    "INSERT OR IGNORE INTO requests(id,tenant_id,person_id,section_key,title,message,created_by,requires_document) VALUES('demo-passport-request','northstar','amira','passports','Share your current passport','Upload a clear copy when it is available. If you are waiting for it, tell us the expected date so we can follow up at the right time.','ayesha',1)",
  ).run();
  d.prepare(
    "INSERT INTO demo_migrations(name) VALUES('request-workflow-v1')",
  ).run();
}
