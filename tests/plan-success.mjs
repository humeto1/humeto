import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runTaskScheduler } from "../src/lib/task-scheduler.mjs";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL,
  d = database();
let projectId, goalId, adId;
after(() => d.close());
async function ctx(user) {
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
async function ok(r) {
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
test("one activity can be a WBS category, task, done CSF and KPI without duplication; targets preserve history", async () => {
  const c = await ctx("ayesha"),
    foreign = await ctx("bright-owner"),
    student = await ctx("amira");
  try {
    projectId = (
      await ok(
        await c.post("/api/workspace/projects", {
          data: {
            title: "IELTSPro institute onboarding",
            description: "Unified activities QA",
            targetDate: "2027-06-30",
            status: "Active",
          },
        }),
      )
    ).id;
    goalId = (
      await ok(
        await c.post("/api/workspace/goals", {
          data: {
            title: "Grow institute partnerships",
            description: "QA",
            targetDate: "2027-06-30",
            status: "Active",
          },
        }),
      )
    ).id;
    const scope = { type: "project", parentId: projectId };
    const post = async (v) =>
      ok(await c.post("/api/plan-success", { data: { ...scope, ...v } }));
    const path = "/api/plan-success?type=project&parentId=" + projectId;
    assert.equal((await foreign.get(path)).status(), 404);
    assert.equal((await student.get(path)).status(), 403);
    adId = (
      await post({
        action: "activity",
        revision: 0,
        title: "Run ad",
        isCsf: true,
        isKpi: true,
        note: "A running ad remains critical after launch.",
      })
    ).id;
    let data = await ok(await c.get(path)),
      ad = data.activities.find((a) => a.id === adId);
    assert.equal(ad.storage_state, "planning");
    let tree = await ok(await c.get("/api/project-wbs?projectId=" + projectId));
    assert.equal(tree.nodes.filter((n) => n.id === adId).length, 1);
    assert.equal(tree.nodes.find((n) => n.id === adId).is_csf, true);
    assert.equal(
      (await ok(await c.get("/api/mobile"))).tasks.some((t) => t.id === adId),
      false,
    );
    await ok(
      await c.post("/api/project-wbs", {
        data: {
          projectId,
          revision: tree.revision,
          action: "select",
          id: adId,
          taskRevision: ad.revision,
          selected: true,
        },
      }),
    );
    tree = await ok(await c.get("/api/project-wbs?projectId=" + projectId));
    ad = tree.nodes.find((n) => n.id === adId);
    await ok(
      await c.post("/api/project-wbs", {
        data: {
          projectId,
          revision: tree.revision,
          action: "edit",
          id: adId,
          taskRevision: ad.revision,
          title: "Run ad",
          stage: "Done",
          frequency: "once",
          isCsf: true,
          isKpi: true,
        },
      }),
    );
    data = await ok(await c.get(path));
    ad = data.activities.find((a) => a.id === adId);
    assert.equal(ad.stage, "Done");
    assert.equal(ad.is_csf, true);
    const metric = await post({
      action: "kpi",
      revision: 0,
      activityId: adId,
      title: "Qualified leads",
      target: 3,
      unit: "leads",
      cadence: "daily",
      direction: "at_least",
      timezone: "Asia/Karachi",
    });
    data = await ok(await c.get(path));
    let k = data.kpis.find((k) => k.id === metric.id);
    assert.equal(k.activity_id, adId);
    assert.equal(k.current, null);
    await post({
      action: "result",
      id: k.id,
      activityId: adId,
      kpiRevision: k.revision,
      revision: 0,
      day: k.day,
      actual: 3,
    });
    assert.equal(
      (
        await c.post("/api/plan-success", {
          data: {
            ...scope,
            action: "result",
            id: k.id,
            activityId: adId,
            kpiRevision: k.revision,
            revision: 0,
            day: k.day,
            actual: 4,
          },
        })
      ).status(),
      409,
    );
    await post({
      action: "kpi",
      id: k.id,
      activityId: adId,
      revision: k.revision,
      title: k.title,
      target: 5,
      unit: "leads",
      cadence: "daily",
      direction: "at_least",
      timezone: k.timezone,
    });
    data = await ok(await c.get(path));
    k = data.kpis.find((k) => k.id === metric.id);
    assert.equal(k.target, 5);
    assert.equal(Number(k.current.target_snapshot), 3);
    await post({
      action: "kpi",
      revision: 0,
      activityId: adId,
      title: "Meetings and demos",
      target: 1,
      unit: "demos",
      cadence: "daily",
      direction: "at_least",
      timezone: "Asia/Karachi",
    });
    tree = await ok(await c.get("/api/project-wbs?projectId=" + projectId));
    ad = tree.nodes.find((n) => n.id === adId);
    await ok(
      await c.post("/api/project-wbs", {
        data: {
          projectId,
          revision: tree.revision,
          action: "select",
          id: adId,
          taskRevision: ad.revision,
          selected: false,
        },
      }),
    );
    data = await ok(await c.get(path));
    ad = data.activities.find((a) => a.id === adId);
    assert.equal(ad.storage_state, "planning");
    assert.equal(ad.stage, "Done");
    assert.equal(ad.is_csf, true);
    assert.equal(data.kpis.filter((k) => k.activity_id === adId).length, 2);
    const gf = await ok(
      await c.post("/api/plan-success", {
        data: {
          type: "goal",
          parentId: goalId,
          action: "activity",
          revision: 0,
          title: "Daily protein",
          isKpi: true,
          isCsf: false,
        },
      }),
    );
    const goalTree = await ok(
      await c.get("/api/project-wbs?type=goal&projectId=" + goalId),
    );
    assert.equal(
      goalTree.nodes.some((n) => n.id === gf.id),
      true,
    );
    const target = {
      revision: 0,
      currency: "PKR",
      upfront: "0",
      completion: "150000",
      conditional: "0",
      upfront_date: "",
      completion_date: "",
      conditional_date: "",
      condition: "",
      basis: "month",
    };
    await ok(
      await c.post("/api/plan-targets?type=project&id=" + projectId, {
        data: target,
      }),
    );
    const mobile = await ok(await c.get("/api/mobile"));
    assert.equal(
      mobile.projects.find((p) => p.id === projectId).financial_target.basis,
      "month",
    );
    assert.equal(
      (
        await d
          .prepare("SELECT count(*)::int AS n FROM tasks WHERE id=?")
          .get(adId)
      ).n,
      1,
    );
  } finally {
    await c.dispose();
    await foreign.dispose();
    await student.dispose();
  }
});
test("compact mobile tabs edit indicators on the same box, show profit frequency, and fit the financial form", async () => {
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
    const context = await browser.newContext({
      baseURL: url,
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
    });
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Plans", exact: true }).click();
    const card = page
      .locator(".mobile-plan-card")
      .filter({ hasText: "IELTSPro institute onboarding" });
    await card.waitFor();
    assert.deepEqual(await card.getByRole("tab").allTextContents(), [
      "WBS",
      "Settings",
      "CSFs & KPIs",
    ]);
    assert.equal(
      await card
        .locator(".work-totals")
        .getByText("PKR 150,000 / monthly", { exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await card
        .locator(".plan-summary")
        .getByText("Deadline", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await card
        .locator(".plan-summary")
        .getByText("monthly", { exact: true })
        .isVisible(),
      true,
    );
    await card.getByRole("tab", { name: "CSFs & KPIs", exact: true }).click();
    const activity = card
      .locator(".success-factor")
      .filter({ hasText: "Run ad" });
    await activity.getByText("CSF", { exact: true }).waitFor();
    assert.equal(
      await activity
        .getByText("Completed · WBS only", { exact: true })
        .isVisible(),
      true,
    );
    await activity
      .getByRole("button", { name: "Edit indicators for Run ad", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Activity indicators and measurements",
      exact: true,
    });
    await dialog
      .getByLabel("CSF · Critical success factor", { exact: true })
      .uncheck();
    await dialog
      .getByRole("button", { name: "Save indicators", exact: true })
      .click();
    await page.waitForFunction(() => !document.querySelector(".success-modal"));
    assert.equal(await activity.getByText("CSF", { exact: true }).count(), 0);
    await activity
      .getByRole("button", { name: "Edit indicators for Run ad", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Activity indicators and measurements",
      exact: true,
    });
    await dialog.getByRole("button", { name: "None", exact: true }).click();
    assert.equal(
      await dialog
        .getByLabel("KPI · Measure this activity", { exact: true })
        .isChecked(),
      false,
    );
    await dialog
      .getByLabel("KPI · Measure this activity", { exact: true })
      .check();
    await dialog
      .getByLabel("CSF · Critical success factor", { exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Save indicators", exact: true })
      .click();
    await activity.getByText("CSF", { exact: true }).waitFor();
    await activity
      .getByRole("region", { name: "Meetings and demos", exact: true })
      .getByRole("button", { name: "Log result", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Activity indicators and measurements",
      exact: true,
    });
    await dialog
      .getByLabel("Measured total for this period", { exact: true })
      .fill("1");
    await dialog
      .getByRole("button", { name: "Save result", exact: true })
      .click();
    await activity
      .getByRole("region", { name: "Meetings and demos", exact: true })
      .getByText("Target met", { exact: true })
      .waitFor();
    mkdirSync("artifacts", { recursive: true });
    await card.evaluate((el) =>
      window.scrollTo({
        top: window.scrollY + el.getBoundingClientRect().top - 85,
        behavior: "instant",
      }),
    );
    await page.screenshot({
      path: "artifacts/project-tools-success-mobile.png",
    });
    await card.getByRole("tab", { name: "WBS", exact: true }).click();
    await card.getByRole("button", { name: /Project map/ }).click();
    dialog = page.getByRole("dialog");
    const box = dialog.locator(".wbs-done").filter({ hasText: "Run ad" });
    await box.getByText("CSF", { exact: true }).waitFor();
    await box
      .getByRole("switch", { name: "Show Run ad in Tasks", exact: true })
      .waitFor();
    assert.equal(
      await box.getByRole("switch").getAttribute("aria-checked"),
      "false",
    );
    await dialog
      .getByRole("button", { name: "Close project map", exact: true })
      .click();
    await card.getByRole("tab", { name: "Settings", exact: true }).click();
    await card
      .getByRole("button", { name: "Financial target", exact: true })
      .click();
    const form = card.locator(".compact-financial-form");
    await form.waitFor();
    assert.ok(
      (await form.evaluate((el) => el.getBoundingClientRect().height)) < 600,
      "Financial form is compact",
    );
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await form.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await form.locator("[name=basis]").selectOption("half_year");
    await form
      .getByRole("button", { name: "Save financial target", exact: true })
      .click();
    await card
      .locator(".plan-summary")
      .getByText("every 6 months", { exact: true })
      .waitFor();
    await page.setViewportSize({ width: 393, height: 852 });
    await card.evaluate((el) =>
      window.scrollTo({
        top: window.scrollY + el.getBoundingClientRect().top - 85,
        behavior: "instant",
      }),
    );
    await page.screenshot({
      path: "artifacts/project-tools-financial-mobile.png",
    });
    const accessibility = await new AxeBuilder({ page })
      .include(".mobile-plan-card")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    assert.deepEqual(
      accessibility.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
      [],
    );
    await page.getByRole("button", { name: "Goals", exact: true }).click();
    const goal = page
      .locator(".mobile-plan-card")
      .filter({ hasText: "Grow institute partnerships" });
    await goal.getByRole("button", { name: /Goal map/ }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Edit Daily protein", exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "Close project map", exact: true })
      .click();
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    const done = new Promise((r) => vite.once("exit", r));
    vite.kill("SIGTERM");
    await done;
  }
});
test("web uses the same compact tabs and unified activities", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { Origin: base },
    });
    await context.request.post("/api/auth/demo", {
      data: { userId: "ayesha" },
    });
    const page = await context.newPage();
    await page.goto("/workspace/progress");
    const card = page.locator(".workstream-card").filter({
      has: page.getByRole("heading", {
        name: "IELTSPro institute onboarding",
        exact: true,
      }),
    });
    await card.getByRole("tab", { name: "CSFs & KPIs", exact: true }).click();
    await card.getByRole("heading", { name: "Run ad", exact: true }).waitFor();
    const accessibility = await new AxeBuilder({ page })
      .include(".success-measures")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    assert.deepEqual(
      accessibility.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
      [],
    );
    await context.close();
  } finally {
    await browser.close();
  }
});

test("ordinary tasks support queued tags, and repeating occurrences share them without changing completion", async () => {
  const c = await ctx("ayesha");
  try {
    const boot = await ok(await c.get("/api/mobile"));
    const made = await ok(
      await c.post("/api/workspace/tasks", {
        data: {
          title: "Standalone gym activity",
          important: false,
          urgent: false,
        },
      }),
    );
    const op = {
      id: randomUUID(),
      owner: boot.actor.tenantId + ":" + boot.actor.id,
      path: "/api/workspace/tasks/" + made.id,
      method: "PATCH",
      at: new Date().toISOString(),
      body: { stage: "To do", revision: 1, isCsf: true, isKpi: false },
    };
    const saved = await ok(await c.post("/api/mobile-sync", { data: op }));
    assert.deepEqual(
      await ok(await c.post("/api/mobile-sync", { data: op })),
      saved,
    );
    let task = await d.prepare("SELECT * FROM tasks WHERE id=?").get(made.id);
    assert.equal(task.is_csf, true);
    assert.equal(task.stage, "To do");
    const series = await ok(
      await c.post("/api/workspace/scheduling", {
        data: {
          action: "series",
          taskId: task.id,
          taskRevision: task.revision,
          frequency: "daily",
          interval: 1,
          firstDay: new Date().toISOString().slice(0, 10),
          time: "00:00",
          timezone: "UTC",
        },
      }),
    );
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      heartbeat: false,
    });
    const occurrence = await d
      .prepare(
        "SELECT t.* FROM task_occurrences o JOIN tasks t ON t.id=o.task_id JOIN task_recurrences r ON r.id=o.series_id WHERE r.template_task_id=? ORDER BY o.day DESC LIMIT 1",
      )
      .get(made.id);
    assert.ok(occurrence);
    assert.equal(occurrence.is_csf, true);
    await ok(
      await c.patch("/api/workspace/tasks/" + occurrence.id, {
        data: {
          stage: "Done",
          revision: occurrence.revision,
          isCsf: false,
          isKpi: true,
        },
      }),
    );
    task = await d.prepare("SELECT * FROM tasks WHERE id=?").get(made.id);
    assert.equal(task.is_csf, false);
    assert.equal(task.is_kpi, true);
    const done = await d
      .prepare("SELECT * FROM tasks WHERE id=?")
      .get(occurrence.id);
    assert.equal(done.stage, "Done");
    assert.equal(done.is_kpi, true);
  } finally {
    await c.dispose();
  }
});
