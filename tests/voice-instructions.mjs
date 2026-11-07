import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
test("dictation inserts directly into editable draft without a confirmation layer", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: process.env.HUMETO_TEST_URL,
      extraHTTPHeaders: { Origin: process.env.HUMETO_TEST_URL },
    });
    await context.addInitScript(() => {
      window.SpeechRecognition = window.webkitSpeechRecognition = class {
        start() {
          window.testRecognition = this;
        }
        stop() {
          this.onend?.();
        }
        abort() {
          window.dictationAborted = true;
        }
      };
    });
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    const page = await context.newPage();
    await page.goto("/workspace/assistant");
    const input = page.getByLabel("Message Humeto assistant", { exact: true });
    await input.fill("Existing draft");
    await page
      .getByRole("button", { name: "Dictate instruction", exact: true })
      .click();
    await page.evaluate(() =>
      window.testRecognition.onresult({
        results: [[{ transcript: "Create a task tomorrow" }]],
      }),
    );
    assert.equal(await input.inputValue(), "Existing draft");
    await page
      .getByRole("button", { name: "Stop dictation", exact: true })
      .click();
    assert.equal(
      await page.getByText("About dictation", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Use dictated text", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "Discard", exact: true }).count(),
      0,
    );
    assert.equal(
      await input.inputValue(),
      "Existing draft Create a task tomorrow",
    );
    await page
      .getByRole("button", { name: "Dictate instruction", exact: true })
      .click();
    await page.evaluate(() =>
      window.testRecognition.onerror({ error: "not-allowed" }),
    );
    await page
      .getByRole("alert")
      .filter({ hasText: "Microphone access" })
      .waitFor();
    await page.goto("/workspace/tasks");
    // A full navigation releases the document and browser-owned recognition.
    await context.close();
  } finally {
    await browser.close();
  }
});
test("unsupported browser keeps typed instructions available", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: process.env.HUMETO_TEST_URL,
      extraHTTPHeaders: { Origin: process.env.HUMETO_TEST_URL },
    });
    await context.addInitScript(() => {
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
    });
    await context.request.post("/api/auth/demo", {
      data: { userId: "ayesha" },
    });
    const page = await context.newPage();
    await page.goto("/workspace/assistant");

    await page
      .getByLabel("Message Humeto assistant", { exact: true })
      .fill("Typed instruction");
    assert.equal(
      await page
        .getByRole("button", { name: "Dictate instruction", exact: true })
        .count(),
      0,
    );
  } finally {
    await browser.close();
  }
});
