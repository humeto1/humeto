import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync } from "node:fs";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
test(
  "mobile uses the shared session, creates synced tasks and reviews assistant actions in a narrow UI",
  { skip: !existsSync("mobile/dist/index.html") },
  async () => {
    const port = await new Promise((r) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => r(p));
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
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
    });
    const title = "Mobile QA " + randomUUID();
    let id = "";
    try {
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(origin)).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal((await context.request.get("/api/mobile")).status(), 401);
      assert.equal(
        (
          await context.request.post("/api/auth/demo", {
            data: { userId: "ayesha" },
          })
        ).status(),
        200,
      );
      const b = await (await context.request.get("/api/mobile")).json();
      assert.equal(b.actor.id, "ayesha");
      assert.ok(!("documents" in b));
      assert.ok(!("leads" in b));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin);
      await page.getByRole("heading", { name: /A little focus/ }).waitFor();
      await page.getByRole("button", { name: "Tasks", exact: true }).click();
      await page.getByRole("button", { name: "Add task", exact: true }).click();
      await page.getByLabel("What needs to happen?").fill(title);
      await page
        .getByRole("button", { name: "Create task", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      let state = await (await context.request.get("/api/mobile")).json();
      const task = state.tasks.find((t) => t.title === title);
      assert.ok(task);
      id = task.id;
      await page
        .getByRole("button", { name: "List view", exact: true })
        .click();
      await page.getByRole("button").filter({ hasText: title }).first().click();
      await page.getByRole("dialog").waitFor();
      await page.getByLabel("Workflow stage").selectOption("Done");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByText("Task updated.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      state = await (await context.request.get("/api/mobile")).json();
      assert.equal(state.tasks.find((t) => t.id === id).stage, "Done");
      await page
        .getByRole("button", { name: "Assistant", exact: true })
        .click();
      await page
        .getByLabel("Message Humeto")
        .fill("Create a task to review mobile testing tomorrow");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page.getByRole("button", { name: "Apply", exact: true }).waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Goals", exact: true }).click();
      await page
        .getByRole("heading", { name: "Projects & goals", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      mkdirSync(".data/mobile-qa", { recursive: true });
      await page.screenshot({ path: ".data/mobile-qa/goals.png" });
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await page.screenshot({ path: ".data/mobile-qa/today.png" });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
      child.kill("SIGTERM");
      if (id) {
        const d = database();
        await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
        await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
        await d.close();
      }
    }
  },
);
