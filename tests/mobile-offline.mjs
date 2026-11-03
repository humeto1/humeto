import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
const base = process.env.HUMETO_TEST_URL;
test("mobile survives an offline restart, saves tasks and focus, then syncs once without losing login", async () => {
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const child = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: "mobile",
      env: { ...process.env, HUMETO_MOBILE_DEV_API: base },
      stdio: "ignore",
    },
  );
  const origin = "http://127.0.0.1:" + port;
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(origin)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const c = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
    });
    await c.addInitScript(() =>
      Object.defineProperty(navigator, "onLine", {
        get: () => localStorage.getItem("offline-test") !== "1",
        configurable: true,
      }),
    );
    await c.route("**/api/**", async (route) => {
      const down = await route
        .request()
        .frame()
        .evaluate(() => localStorage.getItem("offline-test") === "1")
        .catch(() => false);
      if (down) await route.abort("internetdisconnected");
      else await route.continue();
    });
    assert.equal(
      (
        await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } })
      ).status(),
      200,
    );
    const p = await c.newPage();
    await p.goto(origin);
    await p.getByRole("button", { name: "Tasks", exact: true }).click();
    await p.getByRole("button", { name: "Add task", exact: true }).waitFor();
    await p.waitForTimeout(400); // allow the initial optional cached panels to finish their first download
    await p.evaluate(() => {
      localStorage.setItem("offline-test", "1");
      window.dispatchEvent(new Event("offline"));
    });
    await p.getByText(/Offline — changes are saved/).waitFor();
    const title = "Offline telescope " + randomUUID().slice(0, 8);
    await p.getByRole("button", { name: "Plans", exact: true }).click();
    await p.getByLabel("Add plan", { exact: true }).selectOption("projects");
    await p
      .getByRole("dialog")
      .getByLabel("Name", { exact: true })
      .fill(title + " project");
    await p.getByRole("button", { name: "Create", exact: true }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await p.getByRole("button", { name: "Tasks", exact: true }).click();
    await p.getByRole("button", { name: "Add task", exact: true }).click();
    await p.getByLabel("What needs to happen?").fill(title);
    const projectOption = await p
      .locator("select[name=projectId] option")
      .filter({ hasText: title + " project" })
      .getAttribute("value");
    await p.locator("select[name=projectId]").selectOption(projectOption);
    await p.getByRole("button", { name: "Create task", exact: true }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await p.getByText(/changes waiting to sync/).waitFor();
    assert.ok(
      !(await (await c.request.get("/api/mobile")).json()).tasks.some(
        (t) => t.title === title,
      ),
      "must not reach server offline",
    );
    await p.reload();
    await p.getByRole("button", { name: "Tasks", exact: true }).click();
    await p.getByRole("button", { name: "Focus", exact: true }).click();
    await p.getByLabel("Search focus tasks", { exact: true }).fill(title);
    await p.getByRole("button", { name: "Start", exact: true }).click();
    await p.getByText("● Focusing", { exact: true }).waitFor();
    await p.waitForTimeout(1200);
    await p.getByRole("button", { name: "Pause", exact: true }).click();
    await p.getByText("Paused", { exact: true }).waitFor();
    await p.reload();
    await p.getByRole("button", { name: "Focus", exact: true }).click();
    await p.getByText("Paused", { exact: true }).waitFor();
    await p.getByRole("button", { name: "Stop", exact: true }).click();
    await p
      .getByRole("heading", { name: "Choose a task", exact: true })
      .waitFor();
    await p.getByRole("button", { name: "Tasks", exact: true }).click();
    await p.getByRole("button", { name: "List view", exact: true }).click();
    await p
      .getByRole("button", { name: "Open task: " + title, exact: true })
      .click();
    const dialog = p.getByRole("dialog");
    await dialog.getByLabel("Workflow stage").selectOption("Done");
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await p.getByRole("button", { name: "Close", exact: true }).click();
    await p.getByText("6 changes waiting to sync.").waitFor();
    mkdirSync(".data/offline", { recursive: true });
    await p.screenshot({
      path: ".data/offline/saved-phone.png",
      fullPage: true,
    });
    // Reconnect; two operations must create one task and then complete the mapped server record.
    await p.evaluate(() => {
      localStorage.removeItem("offline-test");
      window.dispatchEvent(new Event("online"));
    });
    await p.waitForFunction(
      () =>
        !document.body.textContent.includes("waiting to sync") &&
        !document.body.textContent.includes("Sync needs review"),
      { timeout: 15000 },
    );
    let boot = await (await c.request.get("/api/mobile")).json();
    let matches = boot.tasks.filter((t) => t.title === title);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].stage, "Done");
    const project = boot.projects.find(
      (item) => item.title === title + " project",
    );
    assert.ok(project);
    assert.equal(matches[0].project_id, project.id);
    const focused = await (await c.request.get("/api/workspace/focus")).json();
    const session = focused.history.find(
      (item) => item.task_id === matches[0].id,
    );
    assert.ok(
      session && session.elapsed_seconds >= 1,
      "offline focus duration must sync",
    );
    await p.reload();
    await p.getByRole("button", { name: "Tasks", exact: true }).waitFor();
    await p.getByRole("button", { name: "Tasks", exact: true }).click();
    await p.getByLabel("Task filter", { exact: true }).selectOption("all");
    await p.getByRole("button", { name: "List view", exact: true }).click();
    await p.evaluate(() => {
      localStorage.setItem("offline-test", "1");
      window.dispatchEvent(new Event("offline"));
    });
    await p
      .getByRole("button", { name: "Open task: " + title, exact: true })
      .click();
    await p
      .getByRole("dialog")
      .locator("input[name=title]")
      .fill(title + " local edit");
    await p.getByRole("button", { name: "Save changes", exact: true }).click();
    await p.getByRole("button", { name: "Close", exact: true }).click();
    const serverEdit = await c.request.patch(
      "/api/workspace/tasks/" + matches[0].id,
      {
        data: {
          stage: "Done",
          title: title + " teammate edit",
          revision: matches[0].revision,
        },
      },
    );
    assert.equal(serverEdit.status(), 200);
    await p.evaluate(() => {
      localStorage.removeItem("offline-test");
      window.dispatchEvent(new Event("online"));
    });
    await p
      .getByText("Sync needs review. Your offline changes are kept.", {
        exact: false,
      })
      .waitFor();
    const conflicted = await (await c.request.get("/api/mobile")).json();
    assert.equal(
      conflicted.tasks.find((t) => t.id === matches[0].id).title,
      title + " teammate edit",
    );
    await p.getByRole("button", { name: "Review sync", exact: true }).click();
    await p
      .getByRole("button", { name: "Keep my edit and retry sync", exact: true })
      .click();
    await p.waitForFunction(
      () => !document.body.textContent.includes("Sync needs review"),
    );
    const resolved = await (await c.request.get("/api/mobile")).json();
    assert.equal(
      resolved.tasks.find((t) => t.id === matches[0].id).title,
      title + " local edit",
    );
    await p.getByRole("button", { name: "Close", exact: true }).click();
    // A connection/DNS failure without the browser offline flag must also fall back safely.
    await c.route("**/api/**", (route) => route.abort("namenotresolved"));
    await p.reload();
    await p.getByRole("button", { name: "Tasks", exact: true }).waitFor();
    await p.getByText(/Offline — changes are saved/).waitFor();
    assert.equal(
      await p.getByRole("button", { name: "Sign in", exact: true }).count(),
      0,
    );
    await c.close();
  } finally {
    await browser.close();
    child.kill("SIGTERM");
  }
});
