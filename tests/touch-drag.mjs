import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
assert.equal(
  process.env.HUMETO_ISOLATED_QA,
  "true",
  "Touch QA requires the disposable release harness",
);
const base = process.env.HUMETO_TEST_URL;
test("phone touch gestures persist stages and priority, reach off-screen destinations and cancel safely", async () => {
  const browser = await chromium.launch(),
    context = await browser.newContext({
      baseURL: base,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { Origin: base },
    });
  let id = "";
  try {
    await context.request.post("/api/auth/demo", {
      data: { userId: "ayesha" },
    });
    const title = "Touch QA " + randomUUID();
    const created = await context.request.post("/api/workspace/tasks", {
      data: { title, important: true, urgent: true, dueDate: "", assignee: "" },
    });
    assert.equal(created.status(), 200);
    id = (await created.json()).id;
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    const touch = async (type, x = 0, y = 0) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel"
            ? []
            : [{ x, y, id: 1, radiusX: 3, radiusY: 3 }],
      });
    const read = async () =>
      (
        await (await context.request.get("/api/workspace/bootstrap")).json()
      ).tasks.find((t) => t.id === id);
    const hold = async () => {
      const grip = page.getByRole("button", {
        name: "Open task: " + title,
        exact: true,
      });
      await grip.scrollIntoViewIfNeeded();
      const b = await grip.boundingBox();
      await touch("touchStart", b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(470);
      await page.locator(".touch-drag-ghost").waitFor();
      return b;
    };
    await page.goto(base + "/workspace/tasks");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    const before = await read();
    await hold();
    const target = page.locator(
      '.touch-drop-tray [data-touch-drop="stage:In progress"]',
    );
    const b = await target.boundingBox();
    await touch("touchMove", b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(70);
    await touch("touchEnd");
    await page.waitForFunction(
      () => !document.querySelector(".touch-drag-ghost"),
    );
    for (let i = 0; i < 40 && (await read()).stage !== "In progress"; i++)
      await page.waitForTimeout(100);
    assert.equal((await read()).stage, "In progress");
    assert.equal((await read()).important, before.important);
    await page
      .locator('.kanban-column[data-touch-drop="stage:In progress"]')
      .getByRole("button", { name: "Open task: " + title, exact: true })
      .waitFor();
    await hold();
    await touch("touchCancel");
    await page.locator(".touch-drag-ghost").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".touch-drag-ghost").count(), 0);
    assert.equal((await read()).stage, "In progress");
    await hold();
    await touch("touchMove", 20, 25);
    await touch("touchEnd");
    assert.equal(
      (await read()).stage,
      "In progress",
      "Outside release does not change stage",
    );
    await page
      .getByRole("button", { name: "Priority matrix", exact: true })
      .click();
    const grip = await hold();
    const schedule = page.locator(
      '.touch-drop-tray [data-touch-drop="priority:Schedule"]',
    );
    const s = await schedule.boundingBox();
    await touch("touchMove", s.x + s.width / 2, s.y + s.height / 2);
    await page.waitForTimeout(70);
    await touch("touchEnd");
    for (let i = 0; i < 40 && (await read()).urgent; i++)
      await page.waitForTimeout(100);
    const after = await read();
    assert.equal(after.stage, "In progress");
    assert.equal(after.important, 1);
    assert.equal(after.urgent, 0);
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "Dragging never opens task details",
    );
  } finally {
    await context.close();
    await browser.close();
    const d = database();
    if (id) {
      await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
      await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
    }
    await d.close();
  }
});

test("touch CRM cards move independently across lead, applicant and application columns", async () => {
  const browser = await chromium.launch(),
    context = await browser.newContext({
      baseURL: base,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { Origin: base },
    });
  const restore = [];
  try {
    await context.request.post("/api/auth/demo", {
      data: { userId: "ayesha" },
    });
    const boot = async () =>
      (await context.request.get("/api/workspace/bootstrap")).json();
    const data = await boot(),
      lead = data.leads.find((l) => !l.person_id && l.stage === "New"),
      person = data.people.find((p) => p.journey_stage === "Planning"),
      application = data.applications.find((a) => a.status === "Draft");
    assert.ok(lead && person && application, "Fictional CRM fixtures exist");
    const cases = [
      {
        route: "leads",
        item: lead,
        endpoint: "leads/",
        collection: "leads",
        field: "stage",
        target: "Contacted",
      },
      {
        route: "students",
        item: person,
        endpoint: "applicant-stage/",
        collection: "people",
        field: "journey_stage",
        target: "Documents",
      },
      {
        route: "applications",
        item: application,
        endpoint: "applications/",
        collection: "applications",
        field: "status",
        target: "Collecting",
      },
    ];
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    const touch = async (type, x = 0, y = 0) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 3, radiusY: 3 }],
      });
    for (const c of cases) {
      restore.push(c);
      await page.goto(base + "/workspace/" + c.route);
      const item = page.locator(".pipeline-item").filter({
        has: page.getByRole("combobox", {
          name: "Stage for " + c.item.id,
          exact: true,
        }),
      });
      const grip = item.locator(".touch-drag-handle");
      await grip.scrollIntoViewIfNeeded();
      const b = await grip.boundingBox();
      await touch("touchStart", b.x + b.width / 2, b.y + b.height / 2);
      await page.locator(".touch-drag-ghost").waitFor();
      const zone = page.locator(
        '.pipeline-column[data-touch-drop="' + c.target + '"]',
      );
      await zone.scrollIntoViewIfNeeded();
      const r = await zone.boundingBox();
      await touch(
        "touchMove",
        Math.max(30, Math.min(345, r.x + r.width / 2)),
        Math.max(140, Math.min(650, r.y + 70)),
      );
      await page.waitForTimeout(70);
      await touch("touchEnd");
      for (
        let i = 0;
        i < 40 &&
        (await boot())[c.collection].find((x) => x.id === c.item.id)[
          c.field
        ] !== c.target;
        i++
      )
        await page.waitForTimeout(100);
      assert.equal(
        (await boot())[c.collection].find((x) => x.id === c.item.id)[c.field],
        c.target,
        c.route + " persists touch drop",
      );
    }
  } finally {
    for (const c of restore) {
      const b = await (
        await context.request.get("/api/workspace/bootstrap")
      ).json();
      const row = b[c.collection].find((x) => x.id === c.item.id);
      if (row && row[c.field] !== c.item[c.field])
        await context.request.patch("/api/workspace/" + c.endpoint + row.id, {
          data: {
            [c.field === "journey_stage" ? "stage" : c.field]: c.item[c.field],
            revision: row.revision,
          },
        });
    }
    await context.close();
    await browser.close();
  }
});
