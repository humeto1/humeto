import { test } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL;
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
test("admin context is session-scoped, keeps own tenant and never promotes ordinary members", async () => {
  const admin = await ctx("admin"),
    second = await ctx("admin"),
    owner = await ctx("ayesha"),
    student = await ctx("amira"),
    foreign = await ctx("bright-owner");
  const d = database();
  let tid, seriesId;
  try {
    assert.equal(
      (
        await owner.post("/api/admin-context", {
          data: { context: "workspace" },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await student.post("/api/admin-context", {
          data: { context: "platform" },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await admin.post("/api/admin-context", {
          data: { context: "workspace", tenantId: "brightpath" },
        })
      ).status(),
      400,
    );
    assert.equal(
      (
        await admin.post("/api/admin-context", {
          data: { context: "workspace" },
          headers: { Origin: "https://evil.example" },
        })
      ).status(),
      403,
    );
    assert.equal((await admin.get("/api/mobile")).status(), 403);
    assert.equal(
      (
        await admin.post("/api/admin-context", {
          data: { context: "workspace" },
        })
      ).status(),
      200,
    );
    const mine = await (await admin.get("/api/mobile")).json();
    assert.equal(mine.actor.role, "owner");
    assert.equal(mine.actor.platformAdmin, true);
    assert.equal(mine.actor.tenantId, "northstar");
    const membership = await d
      .prepare(
        "SELECT role FROM memberships WHERE user_id='admin' AND tenant_id='northstar'",
      )
      .get();
    assert.equal(membership.role, "platform_admin");
    assert.equal(
      (await second.get("/api/workspace/platform")).status(),
      200,
      "another session remains in platform mode",
    );
    assert.notEqual(
      (await admin.get("/api/workspace/platform")).status(),
      200,
      "workspace mode does not expose global controls through CRM endpoints",
    );
    const customers = await (
        await foreign.get("/api/workspace/bootstrap")
      ).json(),
      own = await (await admin.get("/api/workspace/bootstrap")).json();
    assert.ok(own.people.length);
    assert.ok(
      own.people.every((p) => !customers.people.some((x) => x.id === p.id)),
    );
    const r = await admin.post("/api/workspace/tasks", {
      data: {
        title: "Superadmin own workspace QA",
        important: true,
        urgent: false,
        dueDate: "",
        assignee: "Platform Admin",
      },
    });
    assert.equal(r.status(), 200, await r.text());
    tid = (await r.json()).id;
    assert.equal(
      (await d.prepare("SELECT tenant_id FROM tasks WHERE id=?").get(tid))
        .tenant_id,
      "northstar",
    );
    const task = await d.prepare("SELECT * FROM tasks WHERE id=?").get(tid);
    const edited = await admin.patch("/api/workspace/tasks/" + tid, {
      data: {
        stage: task.stage,
        revision: task.revision,
        assignee: "Platform Admin",
      },
    });
    assert.equal(edited.status(), 200, await edited.text());
    const team = await (
      await admin.get("/api/workspace/assignments?type=task&id=" + tid)
    ).json();
    assert.ok(team.members.some((m) => m.id === "admin"));
    const assigned = await admin.post("/api/workspace/assignments", {
      data: {
        type: "task",
        id: tid,
        revision: 0,
        userIds: ["admin"],
        inherit: false,
      },
    });
    assert.equal(assigned.status(), 200, await assigned.text());
    const routine = await admin.post("/api/workspace/planning", {
      data: {
        action: "routine",
        title: "Admin own daily work",
        kind: "operations",
        frequency: "daily",
        firstDay: new Date().toISOString().slice(0, 10),
        time: "00:00",
        timezone: "UTC",
        assignee: "Platform Admin",
      },
    });
    assert.equal(routine.status(), 200, await routine.text());
    seriesId = (await routine.json()).id;
    const plan = await (
      await admin.get("/api/workspace/planning?timezone=UTC")
    ).json();
    assert.ok(
      plan.occurrences.some((o) => o.series_id === seriesId),
      "admin-owned repeating work is generated",
    );
    assert.equal(
      (
        await admin.post("/api/admin-context", {
          data: { context: "platform" },
        })
      ).status(),
      200,
    );
    assert.equal((await admin.get("/api/mobile")).status(), 403);
    assert.equal((await admin.get("/api/workspace/platform")).status(), 200);
  } finally {
    const clean = new Set(tid ? [tid] : []);
    if (seriesId) {
      const r = await d
        .prepare("SELECT template_task_id FROM task_recurrences WHERE id=?")
        .get(seriesId);
      if (r) clean.add(r.template_task_id);
      for (const o of await d
        .prepare("SELECT task_id FROM task_occurrences WHERE series_id=?")
        .all(seriesId))
        if (o.task_id) clean.add(o.task_id);
      await d.prepare("DELETE FROM task_recurrences WHERE id=?").run(seriesId);
    }
    for (const id of clean) {
      await d
        .prepare(
          "DELETE FROM work_assignments WHERE entity_type='task' AND entity_id=?",
        )
        .run(id);
      await d.prepare("DELETE FROM task_reminders WHERE task_id=?").run(id);
      await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
      await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
    }
    await d.close();
    for (const c of [admin, second, owner, student, foreign]) await c.dispose();
  }
});
test("superadmin portal puts platform controls first, separates vouchers, and opens own CRM on desktop and phone", async () => {
  const c = await ctx("admin"),
    browser = await chromium.launch(),
    reports = [];
  mkdirSync(".data/admin-portal", { recursive: true });
  try {
    const context = await browser.newContext({
      baseURL: base,
      storageState: await c.storageState(),
      extraHTTPHeaders: { Origin: base },
    });
    const page = await context.newPage();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await context.request.post("/api/admin-context", {
        data: { context: "platform" },
      });
      await page.goto("/workspace");
      await page.getByRole("heading", { name: /Your platform/ }).waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "Access vouchers", exact: true })
          .count(),
        0,
      );
      const order = await page.evaluate(() => {
        const admin = document.querySelector(
            '[aria-label="Platform administration"]',
          ),
          workspace = document.querySelector(
            '[aria-label="Workspace navigation"]',
          );
        return !!(
          admin.compareDocumentPosition(workspace) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );
      });
      assert.ok(order);
      const snapshots = [
        ["overview", "/workspace/platform"],
        ["workspaces", "/workspace/platform?section=workspaces"],
        ["vouchers", "/workspace/platform?section=vouchers"],
        ["moderation", "/workspace/platform?section=moderation"],
      ];
      for (const [section, url] of snapshots) {
        await page.goto(url);
        await page.locator("main").waitFor();
        if (section === "overview")
          await page.getByRole("heading", { name: /Your platform/ }).waitFor();
        if (section === "vouchers")
          await page
            .getByRole("button", { name: "Create voucher", exact: true })
            .waitFor();
        if (section === "moderation")
          await page
            .getByRole("heading", { name: /Reports to review/ })
            .waitFor();
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        reports.push({
          width,
          section,
          violations: result.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          section + " must fit",
        );
        await page.screenshot({
          path: `.data/admin-portal/${section}-${width}.png`,
          fullPage: true,
        });
      }
      await page
        .getByRole("button", { name: "Open my workspace", exact: true })
        .click();
      await page.waitForURL("**/workspace");
      await page
        .getByText("My workspace · Northstar Education", { exact: true })
        .waitFor();
      await page
        .getByRole("heading", { name: "Make your time count." })
        .waitFor();
      assert.equal(
        (await (await context.request.get("/api/mobile")).json()).actor.role,
        "owner",
      );
      await page
        .getByRole("button", { name: "Back to platform admin", exact: true })
        .click();
      await page.getByRole("heading", { name: /Your platform/ }).waitFor();
    }
    writeFileSync(
      ".data/admin-portal/audit.json",
      JSON.stringify(reports, null, 2),
    );
    assert.deepEqual(
      reports.filter((r) => r.violations.length),
      [],
    );
    await context.close();
  } finally {
    await c.dispose();
    await browser.close();
  }
});
