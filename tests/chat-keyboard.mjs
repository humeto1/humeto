import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
test("web chat keeps its composer inside the visible keyboard viewport and retains drafts", async () => {
  const browser = await chromium.launch();
  try {
    const c = await browser.newContext({
      baseURL: process.env.HUMETO_TEST_URL,
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { Origin: process.env.HUMETO_TEST_URL },
    });
    assert.equal(
      (
        await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } })
      ).status(),
      200,
    );
    const p = await c.newPage();
    await p.goto("/workspace/assistant");
    const input = p.getByLabel("Message Humeto assistant", { exact: true });
    await input.fill("Keep this draft");
    await p.setViewportSize({ width: 390, height: 430 });
    await p.waitForFunction(
      () => document.documentElement.dataset.chatKeyboard === "true",
    );
    const bounds = await input.boundingBox();
    const send = await p
      .getByRole("button", { name: "Send message", exact: true })
      .boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 430);
    assert.ok(send.y >= 0 && send.y + send.height <= 430);
    await p.setViewportSize({ width: 390, height: 844 });
    await input.blur();
    assert.equal(await input.inputValue(), "Keep this draft");
  } finally {
    await browser.close();
  }
});
