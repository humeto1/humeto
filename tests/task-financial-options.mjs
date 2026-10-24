import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL;
test("task financial options use grouped amounts, world currencies and a synced personal default without posting payments", async () => {
  const browser = await chromium.launch();
  const d = database();
  try {
    const c = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      viewport: { width: 390, height: 844 },
    });
    await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } });
    const prefs = await (
      await c.request.get("/api/workspace/task-preferences")
    ).json();
    let r = await c.request.post("/api/workspace/task-preferences", {
      data: { currency: "USD", revision: prefs.revision },
    });
    assert.equal(r.status(), 200, await r.text());
    assert.equal(
      (
        await c.request.post("/api/workspace/task-preferences", {
          data: { currency: "EUR", revision: prefs.revision },
        })
      ).status(),
      409,
    );
    const before = (await d.query("SELECT count(*) AS n FROM payments")).rows[0]
      .n;
    const p = await c.newPage();
    await p.goto("/workspace");
    await p.getByRole("button", { name: "Add task from Today" }).click();
    const dialog = p.getByRole("dialog");
    const title = "Payment options " + randomUUID();
    await dialog.getByLabel("Task title", { exact: true }).fill(title);
    await dialog.locator("[name=valueType]").selectOption("profit");
    await p.waitForFunction(
      () => document.querySelector("[name=valueCurrency]")?.value === "USD",
    );
    await dialog.locator("[name=valueAmount]").fill("50000");
    assert.equal(
      await dialog.locator("[name=valueAmount]").inputValue(),
      "50,000",
    );
    assert.ok(
      (await dialog.locator("[name=valueCurrency] option").count()) > 100,
    );
    await dialog.locator("[name=valueCurrency]").selectOption("EUR");
    await dialog
      .getByLabel("Profit timing", { exact: true })
      .selectOption("deferred");
    await dialog
      .getByLabel("Payment", { exact: true })
      .selectOption("installments");
    await dialog
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const b = await (await c.request.get("/api/mobile")).json();
    const t = b.tasks.find((t) => t.title === title);
    assert.equal(t.value_minor, 5000000);
    assert.equal(t.value_currency, "EUR");
    assert.equal(t.value_timing, "deferred");
    assert.equal(t.payment_pattern, "installments");
    assert.equal(
      (await d.query("SELECT count(*) AS n FROM payments")).rows[0].n,
      before,
    );
    assert.equal(
      (await (await c.request.get("/api/workspace/task-preferences")).json())
        .default_currency,
      "USD",
    );
    await p.goto("/workspace/settings");
    await p.getByLabel("Default currency", { exact: true }).selectOption("GBP");
    await p.waitForFunction(
      () =>
        document.querySelector('[aria-label="Default currency"]')?.value ===
        "GBP",
    );
  } finally {
    await browser.close();
    await d.close();
  }
});
test("clear filters works while collapsed and keeps the chosen task view", async () => {
  const browser = await chromium.launch();
  try {
    const c = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
    await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } });
    const p = await c.newPage();
    await p.goto("/workspace/tasks");
    await p
      .getByRole("button", { name: "Priority matrix", exact: true })
      .click();
    const panel = p.locator(".task-filter-panel");
    await panel.locator("summary").click();
    await p
      .getByLabel("Task goal filter", { exact: true })
      .selectOption("none");
    await panel.locator("summary").click();
    await p
      .getByRole("button", { name: "Clear task filters", exact: true })
      .click();
    assert.equal(
      await p.getByLabel("Task goal filter", { exact: true }).inputValue(),
      "all",
    );
    assert.equal(await panel.getAttribute("open"), null);
    assert.equal(
      await p
        .getByRole("button", { name: "Priority matrix", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
  } finally {
    await browser.close();
  }
});
