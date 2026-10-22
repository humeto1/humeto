import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import {
  subscriptionAccess,
  trialExpiry,
  trialDaysLeft,
} from "../src/lib/subscription-access.mjs";
const base = process.env.HUMETO_TEST_URL || "http://127.0.0.1:4174";
const contexts = [];
const isolated = process.env.HUMETO_ISOLATED_QA === "true";
async function context() {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  return c;
}
after(async () => {
  for (const c of contexts) await c.dispose();
  await database().close();
});
test("Trial lasts exactly fifteen days, fails closed, and preserves legacy date-only paid access", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const s = { status: "trial", expires_at: trialExpiry(now) };
  assert.equal(Date.parse(s.expires_at) - now, 15 * 86400000);
  assert.equal(trialDaysLeft(s, now), 15);
  assert.equal(subscriptionAccess(s, now + 15 * 86400000 - 1), true);
  assert.equal(subscriptionAccess(s, now + 15 * 86400000), false);
  assert.equal(
    subscriptionAccess({ status: "trial", expires_at: "" }, now),
    false,
  );
  assert.equal(
    subscriptionAccess({ status: "active", expires_at: "" }, now),
    true,
  );
  assert.equal(
    subscriptionAccess({ status: "active", expires_at: "2026-10-22" }, now),
    true,
  );
  assert.equal(
    subscriptionAccess({ status: "trial", expires_at: "bad" }, now),
    false,
  );
});
test(
  "Public signup creates isolated owners, stores hashes, supports signin/logout and expires without erasing data",
  { skip: !isolated },
  async () => {
    const d = database();
    for (const type of ["individual", "company"]) {
      const c = await context(),
        email = `signup-${randomUUID()}@example.com`,
        password = "Signup test " + randomUUID();
      assert.equal((await c.get("/signup")).status(), 200);
      const r = await c.post("/api/auth/register", {
        data: {
          name: "Trial Tester",
          email,
          password,
          accountType: type,
          companyName: type === "company" ? "Trial Test Agency" : "",
          role: "platform_admin",
        },
      });
      assert.equal(r.status(), 200, await r.text());
      assert.equal((await c.get("/api/workspace/bootstrap")).status(), 401);
      assert.equal(
        (
          await c.post("/api/auth/login", { data: { email, password } })
        ).status(),
        403,
      );
      const messages = readdirSync(
        resolve(process.env.HUMETO_DATA_DIR, "email-capture"),
      ).map((f) =>
        JSON.parse(
          readFileSync(
            resolve(process.env.HUMETO_DATA_DIR, "email-capture", f),
            "utf8",
          ),
        ),
      );
      const mail = messages.find(
        (m) => m.to === email && m.subject.includes("Verify"),
      );
      assert.ok(mail);
      const token = new URL(
        mail.text.match(/https?:\/\/\S+/)[0],
      ).searchParams.get("token");
      assert.equal((await c.get("/verify-email?token=" + token)).status(), 200);
      assert.equal(
        (await c.post("/api/auth/verify-email", { data: { token } })).status(),
        200,
      );
      assert.equal(
        (await c.post("/api/auth/verify-email", { data: { token } })).status(),
        400,
      );
      assert.equal(
        (
          await c.post("/api/auth/login", { data: { email, password } })
        ).status(),
        200,
      );
      const b = await (await c.get("/api/workspace/bootstrap")).json();
      const user = await d
        .prepare("SELECT * FROM users WHERE email=?")
        .get(email);
      const m = await d
        .prepare("SELECT * FROM memberships WHERE user_id=?")
        .get(user.id);
      const s = await d
        .prepare("SELECT * FROM subscriptions WHERE tenant_id=?")
        .get(m.tenant_id);
      assert.equal(m.role, "owner");
      assert.equal(s.status, "trial");
      assert.ok(s.trial_started_at > 0);
      assert.ok(
        Math.abs(
          Date.parse(s.expires_at) - s.trial_started_at - 15 * 86400000,
        ) < 2000,
      );
      assert.notEqual(user.password_hash, password);
      assert.equal(b.people.length, type === "individual" ? 1 : 0);
      assert.ok(
        [403, 404].includes((await c.get("/api/workspace/platform")).status()),
      );
      assert.equal(
        (await c.post("/api/auth/logout", { data: {} })).status(),
        200,
      );
      assert.equal((await c.get("/api/workspace/bootstrap")).status(), 401);
      assert.equal(
        (
          await c.post("/api/auth/login", {
            data: { email, password: "incorrect" },
          })
        ).status(),
        401,
      );
      assert.equal(
        (
          await c.post("/api/auth/login", {
            data: { email: email.toUpperCase(), password },
          })
        ).status(),
        200,
      );
      await d
        .prepare("UPDATE subscriptions SET expires_at=? WHERE tenant_id=?")
        .run(new Date(Date.now() - 1000).toISOString(), m.tenant_id);
      assert.equal((await c.get("/api/workspace/bootstrap")).status(), 200);
      assert.equal(
        (
          await c.post("/api/workspace/tasks", {
            data: {
              title: "Expired trial cannot create",
              important: false,
              urgent: false,
              dueDate: "",
              assignee: "",
            },
          })
        ).status(),
        403,
      );
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await c.post("/api/workspace/billing/request", { data: {} })
          ).status(),
          200,
        );
      assert.equal(
        (
          await d
            .prepare(
              "SELECT count(*) AS n FROM upgrade_requests WHERE tenant_id=?",
            )
            .get(m.tenant_id)
        ).n,
        1,
      );
      assert.equal(
        (
          await c.post("/api/auth/register", {
            data: { name: "Repeat", email, password },
          })
        ).status(),
        409,
      );
    }
  },
);
test(
  "Signup rejects foreign origins and company accounts without a company name",
  { skip: !isolated },
  async () => {
    const c = await context();
    const data = {
      name: "Invalid trial",
      email: `invalid-${randomUUID()}@example.com`,
      password: randomUUID(),
      accountType: "company",
    };
    assert.equal(
      (
        await c.post("/api/auth/register", {
          data,
          headers: { Origin: "https://foreign.example" },
        })
      ).status(),
      403,
    );
    assert.equal((await c.post("/api/auth/register", { data })).status(), 400);
  },
);
