import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
const ok = async (r) => {
  assert.equal(r.status(), 200, await r.text());
  return r.json();
};
test("adding returns to the map immediately, retains failed text and retries exactly once", async () => {
  const b = await chromium.launch();
  try {
    const c = await b.newContext({
      baseURL: process.env.HUMETO_TEST_URL,
      extraHTTPHeaders: { Origin: process.env.HUMETO_TEST_URL },
      viewport: { width: 393, height: 852 },
    });
    await ok(
      await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } }),
    );
    const p = await ok(
      await c.request.post("/api/workspace/projects", {
        data: {
          title: "Responsive map audit",
          targetDate: "2027-12-31",
          status: "Active",
        },
      }),
    );
    const page = await c.newPage();
    await page.goto("/workspace/progress");
    const card = page.locator(".workstream-card").filter({
      has: page.getByRole("heading", {
        name: "Responsive map audit",
        exact: true,
      }),
    });
    await card.getByRole("button", { name: /Project map/ }).click();
    const map = page.getByRole("dialog").first();
    let release;
    const wait = new Promise((r) => (release = r));
    await page.route("**/api/project-wbs", async (route) => {
      if (route.request().method() === "POST") {
        await wait;
        await route.continue();
      } else await route.continue();
    });
    await map
      .getByRole("button", { name: "Add Category", exact: true })
      .last()
      .click();
    await map.getByLabel("Activities or categories").fill("Instant activity");
    await map
      .getByRole("button", { name: "Add 1 activity", exact: true })
      .click();
    await map
      .getByLabel("Activities or categories")
      .waitFor({ state: "hidden", timeout: 800 });
    await map
      .locator(".wbs-pending")
      .filter({ hasText: "Instant activity" })
      .waitFor({ timeout: 800 });
    release();
    await map.locator(".wbs-pending").waitFor({ state: "hidden" });
    await map
      .getByRole("button", { name: "Edit Instant activity", exact: true })
      .waitFor();
    const key = randomUUID();
    let tree = await ok(
      await c.request.get("/api/project-wbs?projectId=" + p.id),
    );
    const command = {
      projectId: p.id,
      revision: tree.revision,
      commandId: key,
      action: "add",
      titles: ["Idempotent activity"],
    };
    await ok(await c.request.post("/api/project-wbs", { data: command }));
    await ok(await c.request.post("/api/project-wbs", { data: command }));
    tree = await ok(await c.request.get("/api/project-wbs?projectId=" + p.id));
    assert.equal(
      tree.nodes.filter((n) => n.title === "Idempotent activity").length,
      1,
    );
    await c.close();
  } finally {
    await b.close();
  }
});
