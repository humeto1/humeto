import { test } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { taskGoals } from "../shared/task-relations.ts";
const base = process.env.HUMETO_TEST_URL;
test("project goal flows through task filters, inherited team and immutable completion history without duplicate goals", async () => {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  try {
    await c.post("/api/auth/demo", { data: { userId: "ayesha" } });
    const post = async (path, data) => {
      const r = await c.post("/api/workspace/" + path, { data });
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    const goal = await post("goals", {
      title: "Outcome " + randomUUID(),
      targetDate: "2027-12-31",
    });
    const project = await post("projects", {
      title: "Delivery " + randomUUID(),
      goalId: goal.id,
    });
    const task = await post("tasks", {
      title: "Connected task " + randomUUID(),
      important: false,
      urgent: false,
      dueDate: "",
      assignee: "",
      projectId: project.id,
      goalIds: [],
    });
    let b = await (await c.get("/api/mobile")).json();
    let t = b.tasks.find((t) => t.id === task.id);
    assert.equal(
      t.goals.length,
      0,
      "Inherited goal must not become an explicit editable link",
    );
    assert.deepEqual(
      taskGoals(t, b.projects, b.goals).map((g) => g.id),
      [goal.id],
    );
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      await context.addCookies((await c.storageState()).cookies);
      const page = await context.newPage();
      await page.goto(base + "/workspace/progress");
      await page.getByRole("button", { name: "Goals", exact: true }).click();
      const card = page.locator(".workstream-card").filter({
        has: page.getByRole("heading", {
          name: b.goals.find((g) => g.id === goal.id).title,
          exact: true,
        }),
      });
      await card.getByText("1 pending", { exact: true }).waitFor();
      await card.getByText("View contributing tasks", { exact: true }).click();
      await card.getByRole("button", { name: t.title, exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.goto(base + "/workspace/tasks");
      await page.locator(".task-filter-panel > summary").click();
      await page
        .getByLabel("Task goal filter", { exact: true })
        .selectOption(goal.id);
      await page
        .getByRole("button", { name: "Open task: " + t.title, exact: true })
        .waitFor();
    } finally {
      await browser.close();
    }
    await post("assignments", {
      type: "goal",
      id: goal.id,
      userIds: ["consultant"],
      revision: 0,
    });
    const team = await (
      await c.get("/api/workspace/assignments?type=task&id=" + task.id)
    ).json();
    assert.ok(team.effectiveUserIds.includes("consultant"));
    let r = await c.patch("/api/workspace/task-links/" + task.id, {
      data: { revision: t.revision, projectId: project.id, goalIds: [goal.id] },
    });
    assert.equal(r.status(), 200, await r.text());
    b = await (await c.get("/api/mobile")).json();
    t = b.tasks.find((t) => t.id === task.id);
    assert.equal(taskGoals(t, b.projects, b.goals).length, 1);
    r = await c.patch("/api/workspace/tasks/" + task.id, {
      data: { stage: "Done", revision: t.revision },
    });
    assert.equal(r.status(), 200, await r.text());
    // A second task tests inherited-only history, independently of direct links.
    const inherited = await post("tasks", {
      title: "Inherited-only completion " + randomUUID(),
      important: false,
      urgent: false,
      dueDate: "",
      assignee: "",
      projectId: project.id,
      goalIds: [],
    });
    b = await (await c.get("/api/mobile")).json();
    t = b.tasks.find((t) => t.id === inherited.id);
    r = await c.patch("/api/workspace/tasks/" + t.id, {
      data: { stage: "Done", revision: t.revision },
    });
    assert.equal(r.status(), 200, await r.text());
    let h = await (await c.get("/api/workspace/task-history")).json();
    assert.deepEqual(
      h.events
        .find((e) => e.task_id === inherited.id && e.event === "completed")
        .goals.map((g) => g.id),
      [goal.id],
    );
    b = await (await c.get("/api/mobile")).json();
    const p = b.projects.find((p) => p.id === project.id);
    r = await c.patch("/api/workspace/projects/" + p.id, {
      data: { title: p.title, goalId: "", revision: p.revision },
    });
    assert.equal(r.status(), 200, await r.text());
    b = await (await c.get("/api/mobile")).json();
    t = b.tasks.find((t) => t.id === inherited.id);
    assert.equal(taskGoals(t, b.projects, b.goals).length, 0);
    h = await (await c.get("/api/workspace/task-history")).json();
    assert.deepEqual(
      h.events
        .find((e) => e.task_id === inherited.id && e.event === "completed")
        .goals.map((g) => g.id),
      [goal.id],
    );
  } finally {
    await c.dispose();
  }
});
