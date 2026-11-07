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
      .getByRole("button", { name: "Add Category", exact: true })
      .click();
    await dialog
      .getByLabel("Activities or categories")
      .fill("Mobile research\nMobile outreach");
    await dialog
      .getByRole("button", { name: "Add 2 activities", exact: true })
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
    await dialog
      .getByRole("button", {
        name: "Activity options for Mobile outreach",
        exact: true,
      })
      .click();
    const deletion = page.getByRole("dialog", {
      name: "Remove block or delete task",
      exact: true,
    });
    await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog
      .getByRole("button", {
        name: "Add Activity under Mobile research",
        exact: true,
      })
      .click();
    await dialog
      .getByLabel("Activities or categories")
      .fill("Promoted child A\nPromoted child B");
    await dialog
      .getByRole("button", { name: "Add 2 activities", exact: true })
      .click();
    await dialog
      .getByRole("button", {
        name: "Activity options for Mobile research",
        exact: true,
      })
      .click();
    await deletion
      .getByRole("button", { name: "Remove from map", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Edit Mobile research"]'),
    );
    await dialog
      .getByRole("button", { name: "Edit Promoted child A", exact: true })
      .waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "Edit Mobile research", exact: true })
        .count(),
      0,
    );
    await dialog.getByRole("button", { name: "Map", exact: true }).click();
    const pool = dialog.getByRole("complementary", {
      name: "Available tasks outside the map",
    });
    await pool
      .getByRole("button", { name: "Add Mobile research to map", exact: true })
      .waitFor();
    await page.screenshot({
      path: "artifacts/project-wbs-available-tasks.png",
    });
    const boot = await body(await ctx.request.get("/api/mobile"));
    const projectId = boot.projects.find(
      (p) => p.title === "QA WBS project",
    ).id;
    const tree = async () =>
      body(await ctx.request.get("/api/project-wbs?projectId=" + projectId));
    const box = (title) =>
      dialog.locator(".wbs-position").filter({
        has: page.getByRole("button", { name: "Edit " + title, exact: true }),
      });
    async function dragTo(source, destination, fraction = 0.5, touch = false) {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const start = await source.boundingBox();
      const touchSession = touch ? await ctx.newCDPSession(page) : null;
      if (touchSession)
        await touchSession.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { x: start.x + start.width / 2, y: start.y + start.height / 2 },
          ],
        });
      else {
        await page.mouse.move(
          start.x + start.width / 2,
          start.y + start.height / 2,
        );
        await page.mouse.down();
      }
      await page.locator(".wbs-drag-ghost").waitFor();
      const end = await destination.boundingBox();
      if (touchSession) {
        await touchSession.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: end.x + end.width / 2, y: end.y + end.height * fraction },
          ],
        });
        await touchSession.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await touchSession.detach();
      } else {
        await page.mouse.move(
          end.x + end.width / 2,
          end.y + end.height * fraction,
          { steps: 5 },
        );
        await page.mouse.up();
      }
      await page.locator(".wbs-drag-ghost").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".wbs-announcement")
            ?.textContent?.includes("Saving"),
      );
    }
    await dragTo(
      pool.getByRole("button", {
        name: "Add Mobile research to map",
        exact: true,
      }),
      box("Mobile outreach"),
    );
    let graph = await tree();
    const researchId = graph.nodes.find(
      (n) => n.title === "Mobile research",
    ).id;
    const outreachId = graph.nodes.find(
      (n) => n.title === "Mobile outreach",
    ).id;
    assert.equal(
      graph.nodes.find((n) => n.id === researchId).parent_id,
      outreachId,
    );
    await dragTo(
      box("Mobile research"),
      dialog.locator('[data-node-id="__project__"]'),
      0.5,
      true,
    );
    graph = await tree();
    assert.equal(graph.nodes.find((n) => n.id === researchId).parent_id, null);
    await dragTo(box("Mobile research"), box("Mobile outreach"), 0.1);
    graph = await tree();
    const roots = graph.nodes
      .filter((n) => n.parent_id === null)
      .sort((a, b) => a.position - b.position);
    assert.equal(
      roots[roots.findIndex((n) => n.id === outreachId) - 1].id,
      researchId,
    );
    await dialog
      .getByRole("button", { name: "Edit Mobile research", exact: true })
      .waitFor();
    assert.equal(
      await pool
        .getByRole("button", {
          name: "Add Mobile research to map",
          exact: true,
        })
        .count(),
      0,
    );
    await dialog.getByRole("button", { name: "Outline", exact: true }).click();
    const promoted = dialog.locator(".wbs-box").filter({
      has: page.getByRole("button", {
        name: "Edit Promoted child A",
        exact: true,
      }),
    });
    const switchBox = await promoted.getByRole("switch").boundingBox(),
      titleBox = await promoted
        .getByRole("button", { name: "Edit Promoted child A", exact: true })
        .boundingBox();
    assert.ok(switchBox.y < titleBox.y, "Task control sits above the title");
    await dialog
      .getByRole("button", {
        name: "Add Activity under Promoted child A",
        exact: true,
      })
      .click();
    await dialog.getByLabel("Activities or categories").fill("Nested leaf");
    await dialog
      .getByRole("button", { name: "Add 1 activity", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Map", exact: true }).click();
    await dragTo(box("Promoted child A"), box("Mobile outreach"));
    graph = await tree();
    const childA = graph.nodes.find((n) => n.title === "Promoted child A");
    assert.equal(childA.parent_id, outreachId);
    assert.equal(
      graph.nodes.find((n) => n.title === "Nested leaf").parent_id,
      childA.id,
    );
    await dragTo(box("Mobile outreach"), box("Promoted child A"));
    graph = await tree();
    assert.equal(
      graph.nodes.find((n) => n.id === outreachId).parent_id,
      null,
      "Cannot nest a parent in its descendant",
    );
    await dialog.getByRole("button", { name: "Outline", exact: true }).click();
    await dialog
      .getByRole("button", {
        name: "Activity options for Promoted child A",
        exact: true,
      })
      .click();
    await deletion.getByRole("radio", { name: /Whole branch/ }).check();
    await deletion
      .getByRole("button", { name: "Remove from map", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[aria-label="Activity options for Promoted child A"]',
        ),
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "Edit Nested leaf", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "Edit Promoted child B", exact: true })
        .isVisible(),
      true,
    );
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
      .getByRole("button", { name: "Add Category", exact: true })
      .click();
    await dialog
      .getByLabel("Activities or categories")
      .fill("Category added from focus");
    await dialog
      .getByRole("button", { name: "Add 1 activity", exact: true })
      .click();
    await dialog
      .getByRole("button", {
        name: "Edit Category added from focus",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "Whole project", exact: true })
        .count(),
      0,
    );

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

test("deleting a box promotes children in order; whole-branch deletion archives tasks and repeating history", async () => {
  const c = await context("ayesha");
  try {
    const p = await setup(c, "QA deletion graph");
    await command(c, p, {
      action: "add",
      titles: ["Before", "Parent", "After"],
    });
    let state = await read(c, p),
      parent = state.nodes.find((n) => n.title === "Parent");
    await command(c, p, {
      action: "add",
      parentId: parent.id,
      titles: ["Child A", "Child B"],
    });
    state = await read(c, p);
    const child = state.nodes.find((n) => n.title === "Child A"),
      other = state.nodes.find((n) => n.title === "Child B");
    await command(c, p, {
      action: "add",
      parentId: child.id,
      titles: ["Grandchild"],
    });
    await command(c, p, {
      action: "select",
      id: parent.id,
      taskRevision: parent.revision,
      selected: true,
    });
    state = await read(c, p);
    parent = state.nodes.find((n) => n.id === parent.id);
    await command(c, p, {
      action: "edit",
      id: parent.id,
      taskRevision: parent.revision,
      title: parent.title,
      stage: "Done",
      isCsf: true,
      frequency: "once",
    });
    const completed = await d
      .prepare("SELECT completed_at FROM tasks WHERE id=?")
      .get(parent.id);
    state = await read(c, p);
    parent = state.nodes.find((n) => n.id === parent.id);
    await command(c, p, {
      action: "remove",
      id: parent.id,
      taskRevision: parent.revision,
      removeMode: "box",
    });
    state = await read(c, p);
    assert.deepEqual(
      state.nodes
        .filter((n) => n.parent_id === null)
        .sort((a, b) => a.position - b.position)
        .map((n) => n.title),
      ["Before", "Child A", "Child B", "After"],
    );
    assert.equal(
      state.nodes.find((n) => n.title === "Grandchild").parent_id,
      child.id,
    );
    const archived = await d
      .prepare(
        "SELECT storage_state,stage,completed_at,is_csf FROM tasks WHERE id=?",
      )
      .get(parent.id);
    assert.equal(archived.storage_state, "archive");
    assert.equal(archived.stage, "Done");
    assert.equal(archived.completed_at, completed.completed_at);
    assert.equal(archived.is_csf, true);
    const current = state.nodes.find((n) => n.id === child.id);
    await command(c, p, {
      action: "remove",
      id: child.id,
      taskRevision: current.revision,
      removeMode: "branch",
    });
    state = await read(c, p);
    assert.equal(
      state.nodes.some((n) => n.id === child.id || n.title === "Grandchild"),
      false,
    );
    assert.equal(state.nodes.find((n) => n.id === other.id).parent_id, null);
    assert.equal(
      (
        await d
          .prepare("SELECT storage_state FROM tasks WHERE id=?")
          .get(child.id)
      ).storage_state,
      "archive",
    );
    await command(c, p, { action: "add", titles: ["Repeating branch"] });
    state = await read(c, p);
    let repeat = state.nodes.find((n) => n.title === "Repeating branch");
    await command(c, p, {
      action: "edit",
      id: repeat.id,
      taskRevision: repeat.revision,
      title: repeat.title,
      frequency: "daily",
      firstDay: new Date().toISOString().slice(0, 10),
      timezone: "UTC",
    });
    state = await read(c, p);
    repeat = state.nodes.find((n) => n.id === repeat.id);
    await command(c, p, {
      action: "select",
      id: repeat.id,
      taskRevision: repeat.revision,
      selected: true,
    });
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      routineOnly: true,
      heartbeat: false,
    });
    state = await read(c, p);
    repeat = state.nodes.find((n) => n.id === repeat.id);
    const occurrence = await d
      .prepare("SELECT task_id FROM task_occurrences WHERE series_id=? LIMIT 1")
      .get(repeat.series_id);
    assert.ok(occurrence.task_id);
    await command(c, p, {
      action: "remove",
      id: repeat.id,
      taskRevision: repeat.revision,
      removeMode: "branch",
    });
    assert.equal(
      (
        await d
          .prepare("SELECT storage_state FROM tasks WHERE id=?")
          .get(occurrence.task_id)
      ).storage_state,
      "archive",
    );
    assert.equal(
      (
        await d
          .prepare(
            "SELECT task_id FROM task_occurrences WHERE series_id=? LIMIT 1",
          )
          .get(repeat.series_id)
      ).task_id,
      occurrence.task_id,
    );
    const planning = await body(
      await c.get("/api/workspace/planning?timezone=UTC"),
    );
    assert.equal(
      planning.routines.some((r) => r.id === repeat.series_id),
      false,
      "Deleted recurring branch does not project new calendar tasks",
    );
  } finally {
    await c.dispose();
  }
});

test("removing map blocks preserves tasks and schedules; deleting uses Bin; available tasks can be relinked", async () => {
  const c = await context("ayesha");
  try {
    const p = await setup(c, "QA remove versus delete");
    await command(c, p, {
      action: "add",
      titles: ["Keep recurring task", "Planning only", "Branch"],
    });
    let state = await read(c, p);
    let task = state.nodes.find((n) => n.title === "Keep recurring task");
    const planning = state.nodes.find((n) => n.title === "Planning only");
    const branch = state.nodes.find((n) => n.title === "Branch");
    await command(c, p, {
      action: "edit",
      id: task.id,
      taskRevision: task.revision,
      title: task.title,
      frequency: "daily",
      firstDay: new Date().toISOString().slice(0, 10),
      timezone: "UTC",
    });
    state = await read(c, p);
    task = state.nodes.find((n) => n.id === task.id);
    await command(c, p, {
      action: "select",
      id: task.id,
      taskRevision: task.revision,
      selected: true,
    });
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      routineOnly: true,
      heartbeat: false,
    });
    state = await read(c, p);
    task = state.nodes.find((n) => n.id === task.id);
    const occurrence = await d
      .prepare("SELECT task_id FROM task_occurrences WHERE series_id=? LIMIT 1")
      .get(task.series_id);
    await command(c, p, {
      action: "detach",
      id: task.id,
      taskRevision: task.revision,
      removeMode: "box",
    });
    state = await read(c, p);
    assert.equal(
      state.nodes.some((n) => n.id === task.id),
      false,
    );
    assert.equal(
      state.available.some((n) => n.id === task.id),
      true,
    );
    assert.equal(
      (
        await d
          .prepare("SELECT storage_state FROM tasks WHERE id=?")
          .get(task.id)
      ).storage_state,
      "active",
    );
    assert.equal(
      (
        await d
          .prepare("SELECT storage_state FROM tasks WHERE id=?")
          .get(occurrence.task_id)
      ).storage_state,
      "active",
    );
    assert.equal(
      (
        await d
          .prepare("SELECT wbs_suspended FROM task_recurrences WHERE id=?")
          .get(task.series_id)
      ).wbs_suspended,
      false,
    );
    await command(c, p, {
      action: "detach",
      id: planning.id,
      taskRevision: planning.revision,
    });
    state = await read(c, p);
    assert.equal(
      state.available.some((n) => n.id === planning.id),
      false,
    );
    assert.equal(
      (
        await d
          .prepare("SELECT storage_state FROM tasks WHERE id=?")
          .get(planning.id)
      ).storage_state,
      "archive",
    );
    await command(c, p, { action: "link", id: task.id, parentId: branch.id });
    state = await read(c, p);
    assert.equal(
      state.available.some((n) => n.id === task.id),
      false,
    );
    await command(c, p, {
      action: "detach",
      id: branch.id,
      taskRevision: branch.revision,
      removeMode: "branch",
    });
    state = await read(c, p);
    assert.equal(state.nodes.length, 0);
    assert.equal(
      state.available.some((n) => n.id === task.id),
      true,
    );
    await command(c, p, { action: "link", id: task.id, parentId: null });
    state = await read(c, p);
    task = state.nodes.find((n) => n.id === task.id);
    await command(c, p, {
      action: "delete",
      id: task.id,
      taskRevision: task.revision,
    });
    state = await read(c, p);
    assert.equal(
      state.available.some((n) => n.id === task.id),
      false,
    );
    for (const tid of [task.id, occurrence.task_id]) {
      const row = await d
        .prepare("SELECT storage_state,purge_after FROM tasks WHERE id=?")
        .get(tid);
      assert.equal(row.storage_state, "bin");
      assert.ok(row.purge_after);
    }
    assert.ok(
      await d
        .prepare("SELECT task_id FROM task_occurrences WHERE task_id=?")
        .get(occurrence.task_id),
    );
    // Keep this fixture out of the separate global Bin-expiry test.
    await d
      .prepare(
        "UPDATE tasks SET storage_state='archive',purge_after=NULL WHERE id=ANY(?::text[])",
      )
      .run([task.id, occurrence.task_id]);
    const goal = await body(
      await c.post("/api/workspace/goals", {
        data: {
          title: "QA inherited available tasks",
          description: "QA",
          targetDate: "2027-06-30",
          status: "Active",
        },
      }),
    );
    await d.prepare("UPDATE projects SET goal_id=? WHERE id=?").run(goal.id, p);
    await command(c, p, { action: "add", titles: ["Inherited project task"] });
    state = await read(c, p);
    const inherited = state.nodes.find(
      (n) => n.title === "Inherited project task",
    );
    await command(c, p, {
      action: "select",
      id: inherited.id,
      taskRevision: inherited.revision,
      selected: true,
    });
    state = await read(c, p);
    await command(c, p, {
      action: "detach",
      id: inherited.id,
      taskRevision: state.nodes.find((n) => n.id === inherited.id).revision,
    });
    const goalPath = "/api/project-wbs?type=goal&projectId=" + goal.id;
    let goalMap = await body(await c.get(goalPath));
    assert.equal(
      goalMap.available.some((t) => t.id === inherited.id),
      true,
    );
    await body(
      await c.post("/api/project-wbs", {
        data: {
          type: "goal",
          projectId: goal.id,
          revision: goalMap.revision,
          action: "link",
          id: inherited.id,
          parentId: null,
        },
      }),
    );
    goalMap = await body(await c.get(goalPath));
    assert.equal(
      goalMap.nodes.find((n) => n.id === inherited.id).parent_id,
      null,
    );
    assert.equal(
      (
        await d
          .prepare("SELECT project_id FROM tasks WHERE id=?")
          .get(inherited.id)
      ).project_id,
      p,
    );
  } finally {
    await c.dispose();
  }
});
