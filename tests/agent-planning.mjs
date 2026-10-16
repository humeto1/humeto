import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSchedule, validDay } from "../src/lib/agent/dates.ts";
import { parseLocal } from "../src/lib/agent/parser.ts";
test("reminders resolve tomorrow in the user timezone across daylight saving transitions", () => {
  assert.equal(
    resolveSchedule(
      "tomorrow",
      "Asia/Karachi",
      new Date("2026-10-16T23:30:00Z"),
    ),
    "2026-10-18T04:00:00.000Z",
  );
  assert.equal(
    resolveSchedule(
      "tomorrow",
      "America/New_York",
      new Date("2026-03-07T17:00:00Z"),
    ),
    "2026-03-08T13:00:00.000Z",
  );
  assert.equal(
    resolveSchedule(
      "tomorrow at 9 AM",
      "Europe/London",
      new Date("2026-10-24T14:00:00Z"),
    ),
    "2026-10-25T09:00:00.000Z",
  );
  assert.equal(
    resolveSchedule(
      "in 30 minutes",
      "Asia/Karachi",
      new Date("2026-10-16T12:00:00Z"),
    ),
    "2026-10-16T12:30:00.000Z",
  );
  assert.throws(
    () =>
      resolveSchedule(
        "2026-03-08 at 2:30 AM",
        "America/New_York",
        new Date("2026-03-07T17:00:00Z"),
      ),
    /clock change/,
  );
  assert.equal(validDay("2026-02-30"), false);
  assert.throws(
    () =>
      resolveSchedule(
        "today at 9 AM",
        "Asia/Karachi",
        new Date("2026-10-16T12:00:00Z"),
      ),
    /passed/,
  );
});
test("task identifiers and quoted titles cannot accidentally become creation commands or update modifiers", () => {
  const done = parseLocal('Mark "task-1" done');
  assert.equal(done.kind, "update");
  assert.equal(done.target, "task-1");
  assert.equal(done.stage, "Done");
  const priority = parseLocal('Make "Review important reports" urgent');
  assert.equal(priority.stage, null);
  assert.equal(priority.important, null);
  assert.equal(priority.urgent, true);
  const create = parseLocal(
    "Mark a task to create a group with the new prospect team and remind me tomorrow",
  );
  assert.equal(create.kind, "create");
  assert.equal(create.title, "create a group with the new prospect team");
  assert.equal(create.reminder, "tomorrow");
  const q = parseLocal("Show my not important urgent pending tasks");
  assert.equal(q.important, false);
  assert.equal(q.urgent, true);
  assert.equal(q.filter, "urgent");
  const both = parseLocal("Show important not urgent tasks");
  assert.equal(both.important, true);
  assert.equal(both.urgent, false);
});

test("dates inside a quoted task title do not silently reschedule that task", () => {
  const intent = parseLocal('Make "Review tomorrow staffing" important');
  assert.equal(intent.dueDate, null);
  assert.equal(intent.reminder, null);
  assert.equal(intent.stage, null);
});
