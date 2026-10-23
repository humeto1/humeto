import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
test("workspace UX audit checks desktop/mobile layout, keyboard access, crashes and accessibility across ten views", async () => {
  const browser = await chromium.launch(),
    context = await browser.newContext({ baseURL: base }),
    reports = [];
  const directory = ".data/ui-ux-audit";
  mkdirSync(directory, { recursive: true });
  try {
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
          headers: { Origin: base },
        })
      ).status(),
      200,
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of [
        "overview",
        "tasks",
        "progress",
        "assistant",
        "finance",
        "settings",
        "leads",
        "students",
        "applications",
        "reading",
      ]) {
        await page.goto(
          base + (view === "overview" ? "/workspace" : "/workspace/" + view),
        );
        await page.locator("main").waitFor();
        await page.waitForTimeout(250);
        assert.ok(
          !(await page.locator("body").innerText()).includes(
            "This page couldn’t load",
          ),
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        await page.keyboard.press("Tab");
        const keyboard = await page.evaluate(
          () => document.activeElement !== document.body,
        );
        const report = {
          view,
          width,
          overflow,
          keyboard,
          violations: axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        };
        reports.push(report);
        await page.screenshot({
          path: `${directory}/${view}-${width}.png`,
          fullPage: false,
        });
        assert.equal(overflow, false, view + " global overflow at " + width);
        assert.ok(keyboard, view + " keyboard access");
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(
      reports
        .filter((r) => r.violations.length)
        .map((r) => ({
          view: r.view,
          width: r.width,
          violations: r.violations,
        })),
      [],
      "Accessibility findings across all audited views",
    );
  } finally {
    writeFileSync(directory + "/report.json", JSON.stringify(reports, null, 2));
    console.log(
      "UX audit:",
      reports.length,
      "viewports;",
      reports.reduce((n, r) => n + r.violations.length, 0),
      "accessibility rule findings recorded.",
    );
    await context.close();
    await browser.close();
  }
});
