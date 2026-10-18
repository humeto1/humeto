import { seedFinanceDemo } from "../src/lib/finance-demo";
import { db, seed, seedCRM, initializeChecklists } from "../src/lib/db";
import { seedTaskProgress } from "../src/lib/task-schema";
import { seedRequestWorkflow } from "../src/lib/request-schema";
import { seedUpdateInbox } from "../src/lib/update-inbox-schema";
if (process.env.HUMETO_LOCAL_DEMO !== "true")
  throw new Error("Fictional seeding requires HUMETO_LOCAL_DEMO=true.");
const d = db();
try {
  await seed(d);
  await seedCRM(d);
  await seedTaskProgress(d);
  await seedRequestWorkflow(d);
  await seedUpdateInbox(d);
  await initializeChecklists(d);
  await seedFinanceDemo();
  console.log("Fictional PostgreSQL demo records initialized.");
} finally {
  await d.close();
}
