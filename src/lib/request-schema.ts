import type { Database } from "./postgres.mjs";
import { withTransaction } from "./db";
export async function seedRequestWorkflow(d: Database) {
  if (
    !(await d
      .prepare(
        "SELECT id FROM people WHERE id='amira' AND tenant_id='northstar'",
      )
      .get())
  )
    return;
  if (
    await d
      .prepare(
        "SELECT name FROM demo_migrations WHERE name='request-workflow-v1'",
      )
      .get()
  )
    return;
  await d
    .prepare(
      "INSERT INTO requests(id,tenant_id,person_id,section_key,title,message,created_by,requires_document) VALUES('demo-passport-request','northstar','amira','passports','Share your current passport','Upload a clear copy when it is available. If you are waiting for it, tell us the expected date so we can follow up at the right time.','ayesha',1) ON CONFLICT DO NOTHING",
    )
    .run();
  await d
    .prepare("INSERT INTO demo_migrations(name) VALUES('request-workflow-v1')")
    .run();
}
