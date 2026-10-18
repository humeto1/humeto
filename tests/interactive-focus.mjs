import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
import { interpretFocus } from "../src/lib/focus-coach.ts";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  tasks = [],
  d = database();
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
    200,
  );
  return c;
}
async function create(c, title = "Interactive focus QA ") {
  const r = await c.post("/api/workspace/tasks", {
    data: {
      title: title + randomUUID(),
      important: true,
      urgent: false,
      dueDate: "",
      assignee: "",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  tasks.push(id);
  return (await (await c.get("/api/workspace/bootstrap")).json()).tasks.find(
    (t) => t.id === id,
  );
}
const read = async (c) => (await c.get("/api/workspace/focus")).json();
async function action(c, action, extra = {}) {
  const a = (await read(c)).active;
  return c.post("/api/workspace/focus", {
    data: {
      action,
      sessionId: a?.id,
      revision: a?.revision,
      taskRevision: a?.task_revision,
      ...extra,
    },
  });
}
after(async () => {
  for (const c of contexts) await c.dispose();
  for (const id of tasks) {
    await d.prepare("DELETE FROM focus_sessions WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
  }
  await d.close();
});
test("focus interpreter keeps questions, negated completion and 100% reports away from automatic completion", () => {
  assert.equal(interpretFocus("I am not done", "running").proposal, null);
  assert.equal(
    interpretFocus("Can you finish this?", "running").proposal,
    null,
  );
  assert.equal(
    interpretFocus("100% done", "running").proposal.action,
    "progress",
  );
  assert.equal(
    interpretFocus("finished", "running").proposal.action,
    "complete",
  );
  assert.equal(
    interpretFocus("50% done, need 15 more minutes", "running").proposal.action,
    "extend",
  );
  // Both natural phrasings are supported; a bounded parser never guesses unsupported time formats.
  assert.equal(
    interpretFocus("50% done, need 15 minutes", "running").proposal.minutes,
    15,
  );
  assert.equal(
    interpretFocus("I am blocked waiting for approval", "running").proposal
      .blocker,
    "waiting",
  );
  assert.equal(
    interpretFocus("Need 10 minutes", "paused").proposal.action,
    "resume",
  );
  assert.equal(
    interpretFocus("My next step is: check passport", "running").proposal
      .action,
    "progress",
  );
  assert.equal(interpretFocus("hello", null).proposal, null);
  assert.equal(interpretFocus("Am I blocked?", "running").proposal, null);
  assert.equal(interpretFocus("I am not blocked", "running").proposal, null);
  assert.equal(interpretFocus("Need -5 minutes", "running").proposal, null);
  assert.equal(interpretFocus("Need 1.5 minutes", "running").proposal, null);
});
test("progress and conversation persist without postponing a due check-in, and complete stays explicit", async () => {
  const c = await ctx("ayesha"),
    t = await create(c);
  assert.equal(
    (
      await action(c, "start", {
        taskId: t.id,
        taskRevision: t.revision,
        minutes: 5,
      })
    ).status(),
    200,
  );
  const before = (await read(c)).active;
  await d
    .prepare(
      "UPDATE focus_sessions SET check_in_at=clock_timestamp()-interval '1 minute' WHERE id=?",
    )
    .run(before.id);
  const due = (await read(c)).active;
  const interpretation = await (
    await c.post("/api/workspace/focus/interpret", {
      data: { message: "50% done, need 15 minutes" },
    })
  ).json();
  assert.equal(interpretation.proposal.action, "extend");
  assert.equal(
    (await read(c)).active.revision,
    due.revision,
    "preview is read-only",
  );
  assert.equal(
    (
      await action(c, "progress", {
        progress: 50,
        nextStep: "Read the offer conditions",
        note: "Halfway there",
      })
    ).status(),
    200,
  );
  let a = (await read(c)).active;
  assert.equal(a.progress, 50);
  assert.equal(a.next_step, "Read the offer conditions");
  assert.equal(a.check_in_at, due.check_in_at);
  assert.equal(a.state, "running");
  let snapshot = await read(c);
  assert.ok(
    snapshot.events.some(
      (e) => e.note === "Halfway there" && e.assistant_reply.includes("50%"),
    ),
  );
  assert.equal((await action(c, "progress", { progress: 101 })).status(), 400);
  assert.equal((await action(c, "progress", { progress: 100 })).status(), 200);
  assert.notEqual(
    (await read(c)).active,
    null,
    "100% report does not complete task",
  );
  assert.equal(
    (
      await action(c, "extend", {
        minutes: 15,
        progress: 100,
        note: "Finishing review",
      })
    ).status(),
    200,
  );
  a = (await read(c)).active;
  assert.ok(Date.parse(a.check_in_at) > Date.now() + 14 * 60000);
  assert.equal((await action(c, "complete")).status(), 200);
  snapshot = await read(c);
  assert.equal(snapshot.active, null);
  assert.equal(snapshot.history.find((s) => s.id === before.id).progress, 100);
  assert.ok(
    snapshot.events.some(
      (e) => e.event === "completed" && e.assistant_reply.includes("completed"),
    ),
  );
});
test("atomic switching preserves blocked work and rejects stale or foreign targets before ending it", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    a = await create(c),
    b = await create(c),
    foreign = await create(other);
  assert.equal(
    (
      await action(c, "start", {
        taskId: a.id,
        taskRevision: a.revision,
        minutes: 2,
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await action(c, "progress", {
        progress: 35,
        nextStep: "Ask for approval",
        note: "Waiting on evidence",
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await action(c, "blocked", {
        blocker: "waiting",
        note: "Waiting for a reply",
      })
    ).status(),
    200,
  );
  const old = (await read(c)).active;
  assert.equal(old.state, "blocked");
  assert.equal(
    (
      await action(c, "switch", {
        taskId: foreign.id,
        nextTaskRevision: foreign.revision,
      })
    ).status(),
    404,
  );
  assert.equal((await read(c)).active.id, old.id);
  assert.equal(
    (
      await action(c, "switch", {
        taskId: b.id,
        nextTaskRevision: b.revision + 1,
      })
    ).status(),
    409,
  );
  assert.equal((await read(c)).active.state, "blocked");
  const results = await Promise.all(
    [1, 2].map(() =>
      c.post("/api/workspace/focus", {
        data: {
          action: "switch",
          sessionId: old.id,
          revision: old.revision,
          taskId: b.id,
          nextTaskRevision: b.revision,
          minutes: 10,
        },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status()).sort(), [200, 409]);
  const snapshot = await read(c);
  assert.equal(snapshot.active.task_id, b.id);
  assert.equal(snapshot.active.progress, null);
  assert.equal(snapshot.active.next_step, "");
  assert.equal(snapshot.active.note, "");
  const previous = snapshot.history.find((s) => s.id === old.id);
  assert.equal(previous.progress, 35);
  assert.equal(previous.next_step, "Ask for approval");
  assert.equal(previous.task_stage, "In progress");
  assert.equal(previous.state, "stopped");
  const refreshed = (
    await (await c.get("/api/workspace/bootstrap")).json()
  ).tasks.find((t) => t.id === a.id);
  assert.equal(
    (
      await action(c, "switch", {
        taskId: a.id,
        nextTaskRevision: refreshed.revision,
        minutes: 5,
      })
    ).status(),
    200,
  );
  const returned = (await read(c)).active;
  assert.equal(returned.progress, 35);
  assert.equal(returned.next_step, "Ask for approval");
  assert.equal(returned.note, "Waiting for a reply");
  assert.equal((await action(c, "stop")).status(), 200);
  const student = await ctx("amira");
  assert.equal(
    (
      await student.post("/api/workspace/focus/interpret", {
        data: { message: "finished" },
      })
    ).status(),
    403,
  );
});
test("interactive focus UI reviews conversation, checks in, switches tasks and keeps conversation after reload", async () => {
  const browser = await chromium.launch(),
    context = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      viewport: { width: 1280, height: 900 },
    });
  try {
    await context.request.post("/api/auth/demo", {
      data: { userId: "ayesha" },
    });
    const a = await create(context.request, "Interactive UI A "),
      b = await create(context.request, "Interactive UI B ");
    const page = await context.newPage();
    // Browser notifications are stubbed: this test never displays an OS notification.
    await page.addInitScript(() => {
      class FakeNotification {
        static permission = "default";
        static async requestPermission() {
          this.permission = "granted";
          sessionStorage.setItem("qa-alert-permission", "granted");
          return "granted";
        }
        constructor() {
          sessionStorage.setItem(
            "qa-alert-count",
            String(Number(sessionStorage.getItem("qa-alert-count") || 0) + 1),
          );
        }
      }
      if (sessionStorage.getItem("qa-alert-permission") === "granted")
        FakeNotification.permission = "granted";
      Object.defineProperty(window, "Notification", {
        value: FakeNotification,
        configurable: true,
      });
    });
    await page.goto(base + "/workspace/tasks");
    await page.getByLabel("Focus task", { exact: true }).selectOption(a.id);
    await page
      .getByRole("button", { name: "Let’s begin", exact: true })
      .click();
    await page.getByText("Tracking time", { exact: true }).waitFor();
    await page
      .getByLabel("Tell your task companion", { exact: true })
      .fill("50% done, need 15 minutes");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page
      .getByRole("button", { name: "Apply this update", exact: true })
      .waitFor();
    assert.equal((await read(context.request)).active.progress, null);
    await page
      .getByRole("button", { name: "Apply this update", exact: true })
      .click();
    await page
      .getByRole("progressbar", { name: "Reported task progress" })
      .waitFor();
    assert.equal(
      await page.getByRole("progressbar").getAttribute("aria-valuenow"),
      "50",
    );
    await page.reload();
    await page
      .getByText("50% done, need 15 minutes", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Enable check-in alerts", exact: true })
      .click();
    const current = (await read(context.request)).active;
    await d
      .prepare(
        "UPDATE focus_sessions SET check_in_at=clock_timestamp()-interval '1 minute' WHERE id=?",
      )
      .run(current.id);
    await page.reload();
    await page.getByText("How is it going?", { exact: true }).waitFor();
    await page.waitForFunction(
      () => sessionStorage.getItem("qa-alert-count") === "1",
    );
    await page.reload();
    await page.getByText("How is it going?", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("qa-alert-count")),
      "1",
      "refresh does not repeat the same alert",
    );
    await page
      .getByRole("button", { name: "Waiting for someone", exact: true })
      .click();
    await page.getByText("Blocked · timer stopped", { exact: true }).waitFor();
    await page
      .getByLabel("Switch focus task", { exact: true })
      .selectOption(b.id);
    await page
      .getByRole("button", { name: "Save & switch task", exact: true })
      .click();
    await page.getByRole("heading", { name: b.title, exact: true }).waitFor();
    assert.equal(await page.locator(".kanban-board").isVisible(), false);
    await page.getByRole("button", { name: "Finished", exact: true }).click();
    await page
      .getByRole("heading", {
        name: "What would you like to move forward first?",
        exact: true,
      })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByLabel("Focus task", { exact: true }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "mobile layout must not overflow",
    );
  } finally {
    await context.close();
    await browser.close();
  }
});
