import { test } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
  let extension = resolve("extension");
  if (process.env.HUMETO_ISOLATED_QA === "true") {
    // Test-only port shim. Keep the distributed extension's permissions unchanged.
    extension = join(profile, "extension-fixture");
    cpSync(resolve("extension"), extension, { recursive: true });
    const manifestPath = join(extension, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.host_permissions.push(new URL(base).origin + "/*");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const htmlPath = join(extension, "sidepanel.html");
    writeFileSync(
      htmlPath,
      readFileSync(htmlPath, "utf8").replace(
        '<select id="base">',
        '<select id="base"><option>' + base + "</option>",
      ),
    );
  }
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
    // A page can change a control after review. Never fill a newly sensitive or replaced node.
    await page.locator("[name=given]").fill("");
    const rescan = () =>
      worker.evaluate(
        (tabId) => chrome.tabs.sendMessage(tabId, { type: "HUMETO_SCAN" }),
        tab.id,
      );
    const sendFill = (field, value) =>
      worker.evaluate(
        ({ tabId, url, item }) =>
          chrome.tabs.sendMessage(tabId, {
            type: "HUMETO_FILL",
            url,
            items: [item],
          }),
        {
          tabId: tab.id,
          url: scan.url,
          item: { id: field.id, label: field.label, value },
        },
      );
    let fresh = await rescan();
    let reviewed = fresh.fields.find((f) => f.name === "given");
    await page.locator("[name=given]").evaluate((el) => (el.type = "password"));
    assert.equal(
      (await sendFill(reviewed, "Must stay empty")).results[0].ok,
      false,
    );
    await page.locator("[name=given]").evaluate((el) => (el.type = "text"));
    fresh = await rescan();
    reviewed = fresh.fields.find((f) => f.name === "given");
    await page
      .locator("[name=given]")
      .evaluate((el) => el.replaceWith(el.cloneNode(true)));
    assert.equal(
      (await sendFill(reviewed, "Must stay empty")).results[0].ok,
      false,
    );
    assert.equal(await page.locator("[name=given]").inputValue(), "");
    await page.reload();
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 380, height: 1100 });
    await panel.route(base + "/api/assist", (route) =>
      route.fulfill({
        json: {
          applicant: { id: "fixture", name: "Amira Shah · sample" },
          facts: [
            { key: "givenNames", label: "First name", value: "Amira" },
            { key: "familyName", label: "Surname", value: "Shah" },
          ],
          expiresAt: Date.now() + 3600000,
        },
      }),
    );
    await panel.goto(
      `chrome-extension://${worker.url().split("/")[2]}/sidepanel.html`,
    );
    await panel.locator("#base").selectOption(base);
    await panel
      .locator("#token")
      .fill("fixture-token-not-a-real-account-token");
    await panel.locator("#connect").click();
    await panel.locator("#connected").waitFor({ state: "visible" });
    await worker.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      tab.id,
    );
    await panel.locator("#scan").click();
    await panel.locator("#review-tools").waitFor({ state: "visible" });
    assert.equal(await panel.locator("#suggested-count").textContent(), "2");
    assert.equal(await panel.locator("#preserved-count").textContent(), "1");
    assert.equal(await panel.locator("#attention-count").textContent(), "3");
    await panel.locator("#clear-selection").click();
    assert.equal(await panel.locator("#fill").isDisabled(), true);
    await panel.locator("#select-suggestions").click();
    assert.equal(await panel.locator("#fill").isEnabled(), true);
    mkdirSync("artifacts", { recursive: true });
    await panel.screenshot({
      path: "artifacts/extension-review.jpg",
      type: "jpeg",
      fullPage: true,
    });
    await panel.locator('[data-view="attention"]').click();
    assert.equal(await panel.locator(".match:not([hidden])").count(), 3);
    await panel.locator("#fill").click();
    await panel
      .locator("#status")
      .filter({ hasText: "2 field(s) filled" })
      .waitFor();
    assert.equal(await page.locator("[name=given]").inputValue(), "Amira");
    assert.equal(await page.locator("[name=surname]").inputValue(), "Shah");
    assert.equal(await page.locator("[name=parentFirstName]").inputValue(), "");
    assert.equal(
      await page.locator("[name=email]").inputValue(),
      "existing@example.com",
    );
    assert.equal(await panel.locator("#fill").isDisabled(), true);
    assert.equal(await panel.locator("#suggested-count").textContent(), "0");
    assert.equal(await panel.locator("#preserved-count").textContent(), "3");
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
