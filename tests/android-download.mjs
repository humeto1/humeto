import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const base = process.env.HUMETO_TEST_URL;
test("website APK download matches the current signed release and stays usable on desktop and phone", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: base });
    const manifest = await (
      await context.request.get("/downloads/android-release.json")
    ).json();
    assert.equal(
      manifest.version,
      JSON.parse(readFileSync("mobile/package.json", "utf8")).version,
    );
    assert.equal(manifest.packageId, "com.humeto.tasks");
    const response = await context.request.get(manifest.url);
    assert.equal(response.status(), 200);
    assert.match(
      response.headers()["content-type"],
      /application\/vnd.android.package-archive/,
    );
    assert.match(response.headers()["content-disposition"], /attachment/);
    assert.match(response.headers()["cache-control"], /must-revalidate/);
    const bytes = await response.body();
    assert.equal(bytes.length, manifest.size);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      manifest.sha256,
    );
    mkdirSync(".data/android-download", { recursive: true });
    for (const width of [1440, 390]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const section = page.locator("#download-app");
      await section.scrollIntoViewIfNeeded();
      const button = section.getByRole("link", {
        name: "Download Android app",
      });
      await button.waitFor();
      assert.ok((await button.boundingBox()).height >= 44);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const audit = await new AxeBuilder({ page })
        .include("#download-app")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      const downloaded = page.waitForEvent("download");
      await button.click();
      const file = await downloaded;
      assert.equal(await file.failure(), null);
      assert.equal(
        createHash("sha256")
          .update(readFileSync(await file.path()))
          .digest("hex"),
        manifest.sha256,
      );
      await section.screenshot({
        path: ".data/android-download/download-" + width + ".png",
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
