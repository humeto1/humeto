import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL;
test("goal UI selects a bounded duration, extends it and creates an independent new cycle", async () => {
  const browser = await chromium.launch(),
    c = await browser.newContext({
      baseURL: base,
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { Origin: base },
    });
  const title = "Fitness cycle " + randomUUID(),
    next = "Fitness next " + randomUUID();
  try {
    await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } });
    const page = await c.newPage();
    await page.goto("/workspace/progress");
    await page
      .getByRole("combobox", { name: "Add plan", exact: true })
      .selectOption("goals");
    const form = page
      .locator("form")
      .filter({ has: page.locator("input[name=title]") })
      .last();
    await form.locator("input[name=title]").fill(title);
    await form.getByRole("button", { name: "90 days", exact: true }).click();
    assert.match(
      await form.locator("input[name=targetDate]").inputValue(),
      /^\d{4}-\d{2}-\d{2}$/,
    );
    await form.getByRole("button", { name: /Save/ }).click();
    const card = page
      .locator(".workstream-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await card.waitFor();
    await card.getByRole("tab", { name: "Settings", exact: true }).click();
    await card
      .getByText("Days, duration & milestones", { exact: true })
      .click();
    await card.getByRole("button", { name: "+30 days", exact: true }).click();
    await page.waitForFunction(
      (t) =>
        [...document.querySelectorAll(".workstream-card")]
          .find((e) => e.textContent.includes(t))
          ?.textContent.includes("120 day timeframe"),
      title,
    );
    await card
      .getByRole("button", { name: "New goal cycle", exact: true })
      .click();
    await card.locator("input[name=title]").fill(next);
    const date = await card.locator("input[name=targetDate]").inputValue();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/workspace/goals") &&
        r.request().method() === "POST",
    );
    await card
      .getByRole("button", { name: "Create goal cycle", exact: true })
      .click();
    assert.equal((await response).status(), 200);
    await page.getByRole("heading", { name: next, exact: true }).waitFor();
    const d = database();
    const rows = await d
      .prepare(
        "SELECT title,target_date,status FROM goals WHERE title IN (?,?)",
      )
      .all(title, next);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.title === next).target_date, date);
    assert.equal(rows.find((r) => r.title === title).status, "Active");
    await d.close();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    const a11y = await new AxeBuilder({ page })
      .include(".goal-timer-widget")
      .analyze();
    assert.deepEqual(
      a11y.violations.map((v) => v.id),
      [],
    );
    mkdirSync(".data/focus-goals", { recursive: true });
    await page.screenshot({
      path: ".data/focus-goals/goal-timeframes-phone.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
    const d = database();
    await d.prepare("DELETE FROM goals WHERE title IN (?,?)").run(title, next);
    await d.close();
  }
});
