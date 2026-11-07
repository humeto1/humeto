import { test, after } from "node:test";
import assert from "node:assert/strict";
import { database } from "../src/lib/postgres.mjs";
const d = database();
after(() => d.close());
test("resuming plan repeats preserves weekday, interval, month-end and leap-year anchors without catch-up", async () => {
  const cases = [
    ["2026-11-02", "weekly", 1, 2, "2026-11-07", "2026-11-09"],
    ["2026-11-01", "daily", 3, 1, "2026-11-07", "2026-11-07"],
    ["2026-11-06", "weekdays", 2, 6, "2026-11-07", "2026-11-10"],
    ["2026-01-31", "monthly", 1, 31, "2026-03-15", "2026-03-31"],
    ["2024-02-29", "yearly", 1, 29, "2026-03-01", "2027-02-28"],
    ["2027-01-01", "monthly", 1, 1, "2026-11-07", "2027-01-01"],
  ];
  for (const [next, freq, interval, anchor, today, expected] of cases) {
    const r = await d
      .prepare("SELECT humeto_plan_resume_day(?,?,?,?,?::date) AS day")
      .get(next, freq, interval, anchor, today);
    assert.equal(r.day, expected);
  }
});
