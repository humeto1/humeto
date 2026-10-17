import type { Database } from "./postgres.mjs";
import { withTransaction } from "./db";
export async function seedUpdateInbox(d: Database) {
  if (
    !(await d
      .prepare(
        "SELECT id FROM people WHERE id='amira' AND tenant_id='northstar'",
      )
      .get()) ||
    (await d
      .prepare("SELECT name FROM demo_migrations WHERE name='update-inbox-v1'")
      .get())
  )
    return;
  await d
    .prepare(
      "INSERT INTO update_inbox(id,tenant_id,user_id,sender,subject,body,source_at,fingerprint,client_key,payload_hash) VALUES('demo-offer-message','northstar','ayesha','admissions@example.edu','Conditional offer \u2014 app-amira','FICTIONAL DEMO EMAIL\nApplicant: amira.shah@example.com\nApplication reference: app-amira\nWe are pleased to make a conditional offer. Please review the conditions in the university portal. This sample message does not represent an actual university decision.',?,'demo-offer-message','demo-offer-message','demo-offer-message') ON CONFLICT DO NOTHING",
    )
    .run(new Date().toISOString());
  await d
    .prepare("INSERT INTO demo_migrations(name) VALUES('update-inbox-v1')")
    .run();
}
