import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL;
test("Goal dropdown creates linked tasks and preserves existing extra goal links on edit", async () => {
  const browser = await chromium.launch();
  try {
    const c = await browser.newContext({
      baseURL: base,
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { Origin: base },
    });
    await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } });
    const post = async (path, data) => {
      const r = await c.request.post("/api/workspace/" + path, { data });
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    const goals = [];
    for (let i = 0; i < 3; i++)
      goals.push(
        await post("goals", {
          title: "Dropdown goal " + i + " " + randomUUID(),
          targetDate: "2027-12-31",
        }),
      );
    const project = await post("projects", {
      title: "Dropdown project " + randomUUID(),
    });
    const p = await c.newPage();
    await p.goto("/workspace/tasks");
    await p.getByText("Daily tasks & plan calendar", { exact: true }).click();
    await p.getByRole("button", { name: "Add task from Today" }).click();
    const title = "Dropdown task " + randomUUID();
    const dialog = p.getByRole("dialog");
    await dialog.getByLabel("Task title", { exact: true }).fill(title);
    await dialog.locator("select[name=projectId]").selectOption(project.id);
    await dialog.getByLabel("Goal", { exact: true }).selectOption(goals[0].id);
    await dialog.screenshot({ path: ".data/goal-dropdown-create.png" });
    assert.equal(
      await dialog.locator(".goal-field input[type=checkbox]").count(),
      0,
    );
    await dialog
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    let state = await (await c.request.get("/api/mobile")).json();
    let task = state.tasks.find((t) => t.title === title);
    assert.equal(task.project_id, project.id);
    assert.deepEqual(
      task.goals.map((g) => g.id),
      [goals[0].id],
    );
    let r = await c.request.patch("/api/workspace/task-links/" + task.id, {
      data: {
        revision: task.revision,
        projectId: project.id,
        goalIds: [goals[0].id, goals[1].id],
      },
    });
    assert.equal(r.status(), 200);
    const linked = (
      await (await c.request.get("/api/mobile")).json()
    ).tasks.find((t) => t.id === task.id);
    const preservedGoal = linked.goals[1].id;
    await p.goto("/workspace/progress");
    await p.locator(".progress-linker > summary").click();
    const row = p
      .locator(".progress-linker .stream-task")
      .filter({ hasText: title });
    await row.locator(".task-links > summary").click();
    await row.getByLabel("Goal", { exact: true }).selectOption(goals[2].id);
    const changed = p.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" && r.url().includes("/task-links/"),
    );
    await row.getByRole("button", { name: "Save links", exact: true }).click();
    assert.equal((await changed).status(), 200);
    await row.locator(".goal-field-existing").waitFor();
    state = await (await c.request.get("/api/mobile")).json();
    task = state.tasks.find((t) => t.title === title);
    assert.deepEqual(
      new Set(task.goals.map((g) => g.id)),
      new Set([preservedGoal, goals[2].id]),
    );
    await row.getByLabel("Goal", { exact: true }).selectOption("");
    const saved = p.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" && r.url().includes("/task-links/"),
    );
    await row.getByRole("button", { name: "Save links", exact: true }).click();
    assert.equal((await saved).status(), 200);
    state = await (await c.request.get("/api/mobile")).json();
    assert.equal(state.tasks.find((t) => t.id === task.id).goals.length, 0);
    assert.equal(
      state.tasks.find((t) => t.id === task.id).project_id,
      project.id,
    );
  } finally {
    await browser.close();
  }
});
