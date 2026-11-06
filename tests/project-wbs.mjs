import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { database } from "../src/lib/postgres.mjs";
import { runTaskScheduler } from "../src/lib/task-scheduler.mjs";
const base = process.env.HUMETO_TEST_URL;
const d = database();
after(() => d.close());
async function context(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
    200,
  );
  return c;
}
async function body(r) {
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
async function setup(c, title) {
  return (
    await body(
      await c.post("/api/workspace/projects", {
        data: {
          title,
          description: "WBS QA",
          targetDate: "",
          status: "Active",
        },
      }),
    )
  ).id;
}
async function read(c, p) {
  return body(await c.get("/api/project-wbs?projectId=" + p));
}
async function command(c, p, values) {
  const data = await read(c, p);
  return body(
    await c.post("/api/project-wbs", {
      data: { projectId: p, revision: data.revision, ...values },
    }),
  );
}
test("WBS selection preserves identity/history, isolates tenants, and keeps repeat activities alive", async () => {
  const c = await context("ayesha"),
    other = await context("bright-owner"),
    student = await context("amira");
  try {
    const p = await setup(c, "QA WBS project");
    assert.equal(
      (await other.get("/api/project-wbs?projectId=" + p)).status(),
      404,
    );
    assert.equal(
      (await student.get("/api/project-wbs?projectId=" + p)).status(),
      403,
    );
    await command(c, p, { action: "add", titles: ["Outreach", "Product"] });
    let state = await read(c, p);
    const parent = state.nodes.find((n) => n.title === "Outreach");
    await command(c, p, {
      action: "add",
      parentId: parent.id,
      titles: ["Lead qualification", "Make demo"],
    });
    state = await read(c, p);
    let lead = state.nodes.find((n) => n.title === "Lead qualification");
    const demo = state.nodes.find((n) => n.title === "Make demo");
    assert.equal(
      (await body(await c.get("/api/mobile"))).tasks.some(
        (t) => t.id === parent.id || t.id === lead.id,
      ),
      false,
    );
    await command(c, p, {
      action: "select",
      id: parent.id,
      taskRevision: parent.revision,
      selected: true,
    });
    state = await read(c, p);
    assert.equal(
      state.nodes.find((n) => n.id === lead.id).storage_state,
      "planning",
    );
    await command(c, p, {
      action: "select",
      id: demo.id,
      taskRevision: demo.revision,
      selected: true,
    });
    state = await read(c, p);
    const demoActive = state.nodes.find((n) => n.id === demo.id);
    await command(c, p, {
      action: "edit",
      id: demo.id,
      taskRevision: demoActive.revision,
      title: demo.title,
      stage: "Done",
      frequency: "once",
    });
    state = await read(c, p);
    let finished = state.nodes.find((n) => n.id === demo.id);
    assert.equal(finished.stage, "Done");
    await command(c, p, {
      action: "select",
      id: demo.id,
      taskRevision: finished.revision,
      selected: false,
    });
    state = await read(c, p);
    finished = state.nodes.find((n) => n.id === demo.id);
    await command(c, p, {
      action: "select",
      id: demo.id,
      taskRevision: finished.revision,
      selected: true,
    });
    const record = await d
      .prepare("SELECT completed_at,stage FROM tasks WHERE id=?")
      .get(demo.id);
    assert.equal(record.stage, "Done");
    assert.ok(record.completed_at);
    state = await read(c, p);
    const stale = await c.post("/api/project-wbs", {
      data: {
        projectId: p,
        revision: 1,
        action: "add",
        titles: ["Must not duplicate"],
      },
    });
    assert.equal(stale.status(), 409);
    const cycle = await c.post("/api/project-wbs", {
      data: {
        projectId: p,
        revision: state.revision,
        action: "move",
        id: parent.id,
        parentId: lead.id,
      },
    });
    assert.equal(cycle.status(), 400);
    const date = new Date().toISOString().slice(0, 10);
    await command(c, p, {
      action: "edit",
      id: lead.id,
      taskRevision: lead.revision,
      title: lead.title,
      frequency: "daily",
      firstDay: date,
      timezone: "UTC",
    });
    state = await read(c, p);
    lead = state.nodes.find((n) => n.id === lead.id);
    assert.equal(lead.frequency, "daily");
    assert.equal(lead.storage_state, "planning");
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      routineOnly: true,
      heartbeat: false,
    });
    assert.equal(
      (
        await d
          .prepare(
            "SELECT count(*)::int AS n FROM task_occurrences WHERE series_id=?",
          )
          .get(lead.series_id)
      ).n,
      0,
    );
    await command(c, p, {
      action: "select",
      id: lead.id,
      taskRevision: lead.revision,
      selected: true,
    });
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      routineOnly: true,
      heartbeat: false,
    });
    const occurrence = await d
      .prepare("SELECT task_id FROM task_occurrences WHERE series_id=?")
      .get(lead.series_id);
    assert.ok(occurrence.task_id);
    state = await read(c, p);
    lead = state.nodes.find((n) => n.id === lead.id);
    await command(c, p, {
      action: "select",
      id: lead.id,
      taskRevision: lead.revision,
      selected: false,
    });
    assert.equal(
      (
        await d
          .prepare("SELECT storage_state FROM tasks WHERE id=?")
          .get(occurrence.task_id)
      ).storage_state,
      "planning",
    );
    state = await read(c, p);
    lead = state.nodes.find((n) => n.id === lead.id);
    assert.equal(lead.frequency, "daily");
    assert.equal(
      (
        await d
          .prepare("SELECT wbs_suspended FROM task_recurrences WHERE id=?")
          .get(lead.series_id)
      ).wbs_suspended,
      true,
    );
    const storage = await body(await c.get("/api/workspace/task-storage"));
    assert.equal(
      storage.items.some((t) => t.id === lead.id),
      false,
    );
  } finally {
    await c.dispose();
    await other.dispose();
    await student.dispose();
  }
});
test("mobile project map supports brainstorming, independent selection, outline, and readable completed boxes", async () => {
  const reserve = createServer();
  await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: "mobile",
      env: { ...process.env, HUMETO_MOBILE_DEV_API: base },
      stdio: "ignore",
    },
  );
  const url = "http://127.0.0.1:" + port;
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      baseURL: url,
    });
    assert.equal(
      (
        await ctx.request.post("/api/auth/demo", { data: { userId: "ayesha" } })
      ).status(),
      200,
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Plans", exact: true }).click();
    await page
      .getByRole("button", { name: /Project map/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog
      .getByRole("button", { name: "Add ideas", exact: true })
      .click();
    await dialog
      .getByLabel("Activities or categories")
      .fill("Mobile research\nMobile outreach");
    await dialog
      .getByRole("button", { name: "Add 2 ideas", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Edit Mobile research", exact: true })
      .waitFor();
    await dialog
      .getByRole("switch", {
        name: "Show Mobile research in Tasks",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Show Mobile research in Tasks"]')
          ?.getAttribute("aria-checked") === "true",
    );
    assert.equal(
      await dialog
        .getByRole("switch", {
          name: "Show Mobile outreach in Tasks",
          exact: true,
        })
        .getAttribute("aria-checked"),
      "false",
    );
    await dialog.getByRole("button", { name: "Outline", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Edit Mobile research", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption("Done");
    await dialog
      .getByRole("button", { name: "Save activity", exact: true })
      .click();
    await dialog
      .locator(".wbs-done")
      .filter({ hasText: "Mobile research" })
      .waitFor();
    await dialog.getByRole("button", { name: "Map", exact: true }).click();
    mkdirSync("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/project-wbs-mobile.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Fit project to screen", exact: true })
      .click();
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      "Project map fits a narrow phone",
    );
    await dialog
      .getByRole("button", { name: "Edit Mobile outreach", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Activity name", exact: true })
      .waitFor();
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      "Activity sheet fits a narrow phone",
    );
    await page.keyboard.press("Escape");
    await dialog
      .getByRole("button", { name: "Edit Mobile outreach", exact: true })
      .waitFor();
    const accessibility = await new AxeBuilder({ page })
      .include(".wbs-dialog")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    assert.deepEqual(
      accessibility.violations.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      [],
    );
    await page.setViewportSize({ width: 393, height: 852 });
    await dialog
      .getByRole("button", { name: "Edit Outreach", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Focus branch", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".wbs-zoom button:nth-child(2)")
            ?.textContent?.split("%")[0],
        ) > 50,
    );
    await page.screenshot({ path: "artifacts/project-wbs-mobile-branch.png" });

    await dialog
      .getByRole("button", { name: "Close project map", exact: true })
      .click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser?.close();
    const done = new Promise((r) => vite.once("exit", r));
    vite.kill("SIGTERM");
    await done;
  }
});
