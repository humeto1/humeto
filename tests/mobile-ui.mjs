import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
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
      // Reopen and finish the same task through the focus UI: completion requires
      // both session and task revisions, even after pause/resume.
      const current = state.tasks.find((t) => t.id === id);
      assert.equal(
        (
          await context.request.patch("/api/workspace/tasks/" + id, {
            data: { stage: "To do", revision: current.revision },
          })
        ).status(),
        200,
      );
      await page.reload();
      await page.getByRole("button", { name: "Focus", exact: true }).click();
      await page.getByLabel("Focus task selector").selectOption(id);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      mkdirSync(".data/focus-redesign", { recursive: true });
      await page.screenshot({
        path: ".data/focus-redesign/mobile-active.png",
        fullPage: true,
      });
      const focusAudit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        focusAudit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      await page
        .getByRole("button", { name: "Mark task complete", exact: true })
        .click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await page
        .getByRole("heading", {
          name: "Choose a task",
          exact: true,
        })
        .waitFor();
      assert.equal(
        (await (await context.request.get("/api/mobile")).json()).tasks.find(
          (t) => t.id === id,
        ).stage,
        "Done",
      );
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
      const audits = [];
      for (const tab of ["Today", "Tasks", "Focus", "Goals", "Assistant"]) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        audits.push({
          tab,
          violations: result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        });
        assert.deepEqual(
          result.violations.map((v) => v.id),
          [],
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      writeFileSync(
        ".data/mobile-qa/accessibility.json",
        JSON.stringify(audits, null, 2),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
      child.kill("SIGTERM");
      if (id) {
        const d = database();
        await d.prepare("DELETE FROM focus_sessions WHERE task_id=?").run(id);
        await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
        await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
        await d.close();
      }
    }
  },
);
