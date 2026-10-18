import pg from "pg";
import { runTaskScheduler } from "../src/lib/task-scheduler.mjs";
const lock = new pg.Client({ connectionString: process.env.DATABASE_URL });
await lock.connect();
lock.on("error", () => process.exit(1));
if (
  !(await lock.query("SELECT pg_try_advisory_lock(781340121) AS acquired"))
    .rows[0].acquired
)
  throw Error("Another task scheduler is already running.");
console.log(
  "Humeto task scheduler started. Recurrences and in-app follow-ups only; no external messages.",
);
while (true) {
  await lock.query("SELECT 1").catch(() => process.exit(1));
  try {
    const result = await runTaskScheduler();
    if (result.created || result.notified)
      console.log(
        `Created ${result.created} task occurrence(s); prepared ${result.notified} in-app follow-up(s).`,
      );
  } catch {
    console.error(
      "Task scheduler cycle failed; check database and schedule configuration.",
    );
  }
  await new Promise((r) => setTimeout(r, 10000));
}
