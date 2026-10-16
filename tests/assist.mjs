import { test } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
async function account(user) {
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
test("assistant tokens are scoped, expire/revoke and exclude declarations", async () => {
  const c = await account("ayesha");
  const other = await account("bright-owner");
  try {
    assert.equal(
      (
        await other.post("/api/workspace/assist-tokens", {
          data: { personId: "amira", sectionKeys: ["identity"] },
        })
      ).status(),
      404,
    );
    assert.equal(
      (
        await c.post("/api/workspace/assist-tokens", {
          data: { personId: "amira", sectionKeys: ["declarations"] },
        })
      ).status(),
      400,
    );
    const created = await c.post("/api/workspace/assist-tokens", {
      data: { personId: "amira", sectionKeys: ["identity", "contact"] },
    });
    assert.equal(created.status(), 200, await created.text());
    const pair = await created.json();
    const values = await c.get("/api/assist", {
      headers: { Authorization: "Bearer " + pair.token },
    });
    assert.equal(values.status(), 200);
    const data = await values.json();
    assert.equal(data.applicant.id, "amira");
    assert.ok(data.facts.some((f) => f.key === "givenNames"));
    assert.ok(
      data.facts.every((f) =>
        ["About you", "Contact & addresses"].includes(f.section),
      ),
    );
    assert.ok(pair.expiresAt - Date.now() <= 3600000);
    assert.equal(
      (
        await other.patch("/api/workspace/assist-tokens/" + pair.id, {
          data: {},
        })
      ).status(),
      404,
    );
    assert.equal(
      (
        await c.patch("/api/workspace/assist-tokens/" + pair.id, { data: {} })
      ).status(),
      200,
    );
    assert.equal(
      (
        await c.get("/api/assist", {
          headers: { Authorization: "Bearer " + pair.token },
        })
      ).status(),
      401,
    );
  } finally {
    await c.dispose();
    await other.dispose();
  }
});
test("packaged extension scans and fills a real Chromium fixture without overwriting", async () => {
  const profile = mkdtempSync(join(tmpdir(), "humeto-extension-"));
  const extension = resolve("extension");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    timeout: 20000,
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker)
      worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const page = await context.newPage();
    await page.goto(base + "/test-application.html");
    const tab = await worker.evaluate(async (base) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url === base + "/test-application.html");
    }, base);
    assert.ok(tab?.id);
    const scan = await worker.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      return chrome.tabs.sendMessage(tabId, { type: "HUMETO_SCAN" });
    }, tab.id);
    assert.ok(scan.fields.length >= 5);
    assert.ok(
      scan.fields.every(
        (f) => !["password", "file", "checkbox"].includes(f.type),
      ),
    );
    const first = scan.fields.find((f) => f.name === "given");
    const email = scan.fields.find((f) => f.name === "email");
    const results = await worker.evaluate(
      async ({ tabId, url, items }) =>
        chrome.tabs.sendMessage(tabId, { type: "HUMETO_FILL", url, items }),
      {
        tabId: tab.id,
        url: scan.url,
        items: [
          { id: first.id, label: first.label, value: "Amira" },
          {
            id: email.id,
            label: email.label,
            value: "should-not-overwrite@example.com",
          },
        ],
      },
    );
    assert.equal(results.results[0].ok, true);
    assert.equal(results.results[1].ok, false);
    assert.equal(await page.locator("[name=given]").inputValue(), "Amira");
    assert.equal(
      await page.locator("[name=email]").inputValue(),
      "existing@example.com",
    );
    assert.equal(await page.locator("[name=parentFirstName]").inputValue(), "");
    const wrongPage = await worker.evaluate(
      async ({ tabId, items }) =>
        chrome.tabs.sendMessage(tabId, {
          type: "HUMETO_FILL",
          url: "https://changed.example/",
          items,
        }),
      { tabId: tab.id, items: [] },
    );
    assert.ok(wrongPage.error);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
