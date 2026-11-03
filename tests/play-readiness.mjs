import test from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const base = process.env.HUMETO_TEST_URL;
test("public privacy and account-deletion pages work without sign-in and fit phone/desktop", async () => {
  const b = await chromium.launch();
  try {
    for (const width of [390, 1440]) {
      const context = await b.newContext({ viewport: { width, height: 900 } });
      const p = await context.newPage();
      for (const route of ["privacy", "terms", "delete-account"]) {
        const r = await p.goto(base + "/" + route);
        assert.equal(r.status(), 200);
        await p.getByRole("heading", { level: 1 }).waitFor();
        assert.ok(await p.locator('a[href^="mailto:help@humeto.com"]').count());
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        const a = await new AxeBuilder({ page: p }).analyze();
        assert.deepEqual(
          a.violations.map((v) => v.id),
          [],
        );
      }
      await p.goto(base + "/signup");
      assert.ok(await p.locator("input[name=adult][required]").count());
      assert.ok(
        await p.locator("input[name=acceptPolicies][required]").count(),
      );
      const signup = await new AxeBuilder({ page: p })
        .include(".policy-choice")
        .analyze();
      assert.deepEqual(
        signup.violations.map((v) => v.id),
        [],
      );
      if (width === 390) {
        mkdirSync(".data/play-readiness", { recursive: true });
        await p.screenshot({
          path: ".data/play-readiness/signup-phone.png",
          fullPage: true,
        });
      }
      await context.close();
    }
  } finally {
    await b.close();
  }
});
test(
  "new signup rejects absent/false adult or policy affirmation before account creation",
  { skip: process.env.HUMETO_ISOLATED_QA !== "true" },
  async () => {
    const c = await request.newContext({
        baseURL: base,
        extraHTTPHeaders: { Origin: base },
      }),
      d = database();
    const email = `adult-${randomUUID()}@example.test`,
      body = {
        name: "Adult Consent QA",
        email,
        password: randomUUID() + "!secret",
      };
    try {
      for (const flags of [
        {},
        { adult: false, acceptPolicies: true },
        { adult: true, acceptPolicies: false },
      ])
        assert.equal(
          (
            await c.post("/api/auth/register", { data: { ...body, ...flags } })
          ).status(),
          400,
        );
      assert.equal(
        await d.prepare("SELECT id FROM users WHERE email=?").get(email),
        undefined,
      );
      const r = await c.post("/api/auth/register", {
        data: { ...body, adult: true, acceptPolicies: true },
      });
      assert.equal(r.status(), 200, await r.text());
      const u = await d
        .prepare("SELECT id FROM users WHERE email=?")
        .get(email);
      const record = await d
        .prepare(
          "SELECT summary FROM audit WHERE actor_id=? AND action='created' AND entity_type='workspace'",
        )
        .get(u.id);
      assert.match(record.summary, /affirmed age 18\+.*2026-11-03/);
    } finally {
      await c.dispose();
      await d.close();
    }
  },
);
test("Play bundle command refuses missing signing credentials before any build/upload", () => {
  const env = { ...process.env };
  for (const name of [
    "HUMETO_UPLOAD_KEYSTORE",
    "HUMETO_UPLOAD_STORE_PASSWORD",
    "HUMETO_UPLOAD_KEY_ALIAS",
    "HUMETO_UPLOAD_KEY_PASSWORD",
  ])
    delete env[name];
  const r = spawnSync(process.execPath, ["scripts/build-play-bundle.mjs"], {
    env,
    encoding: "utf8",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Set HUMETO_UPLOAD_KEYSTORE/);
});
