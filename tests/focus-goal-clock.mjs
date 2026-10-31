import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
async function load(path) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  return import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
}
const { focusNotification } = await load("../mobile/src/focus-notification.ts");
const { computeGoalTiming, addDays, extendGoalTarget } = await load(
  "../shared/goal-clock.ts",
);
test("focus countdown survives clock skew, suspension, extension and pause", () => {
  const device = Date.parse("2026-11-01T11:00:00Z"),
    server = "2026-11-01T10:00:00Z";
  const session = {
    id: "one",
    title: "PDF",
    state: "running",
    target_minutes: 25,
    total_seconds: 900,
    check_in_at: "2026-11-01T10:10:00Z",
  };
  const first = focusNotification(session, server, device, device);
  assert.equal(first.options.remainingSeconds, 600);
  assert.equal(first.options.checkInAt, device + 600000);
  const background = focusNotification(
    session,
    server,
    device,
    device + 60000,
    first.snapshot,
  );
  assert.equal(background.options.remainingSeconds, 540);
  const paused = focusNotification(
    { ...session, state: "paused", check_in_at: null, total_seconds: 965 },
    server,
    device,
    device + 65000,
    background.snapshot,
  );
  assert.equal(paused.options.remainingSeconds, 535);
  const extended = focusNotification(
    { ...session, check_in_at: "2026-11-01T10:20:00Z" },
    server,
    device,
    device,
  );
  assert.equal(extended.options.remainingSeconds, 1200);
  assert.equal(
    focusNotification({ ...session, ended_at: "now" }, server, device, device),
    null,
  );
  const br = focusNotification(
    { ...session, state: "paused", break_until: "2026-11-01T10:05:00Z" },
    server,
    device,
    device,
  );
  assert.equal(br.options.state, "break");
  assert.equal(br.options.breakUntil, device + 300000);
});
test("goal calendar days and cycle extension preserve recorded completion", () => {
  const goal = {
    created_at: "2026-10-01T12:00:00+05:00",
    target_date: "2026-12-30",
    status: "Active",
  };
  const now = new Date("2026-11-01T12:00:00");
  const t = computeGoalTiming(goal, now);
  assert.equal(t.total, 90);
  assert.equal(t.remaining, 59);
  assert.equal(t.elapsed, 31);
  assert.equal(
    computeGoalTiming(
      {
        ...goal,
        status: "Completed",
        completed_at: "2026-10-11T12:00:00+05:00",
      },
      now,
    ).elapsed,
    10,
  );
  assert.equal(
    computeGoalTiming({ ...goal, status: "Completed" }, now).elapsed,
    null,
  );
  assert.equal(extendGoalTarget("2026-12-30", 30, "2026-11-01"), "2027-01-29");
  assert.equal(extendGoalTarget("2026-10-01", 30, "2026-11-01"), "2026-12-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(computeGoalTiming({}, now).hasTarget, false);
});
