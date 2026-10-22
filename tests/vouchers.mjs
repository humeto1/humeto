import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { featureAllowed } from "../src/lib/feature-access.mjs";
const contexts = [],
  base = process.env.HUMETO_TEST_URL,
  skip = process.env.HUMETO_ISOLATED_QA !== "true";
async function ctx() {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  return c;
}
async function admin() {
  const c = await ctx();
  await c.post("/api/auth/demo", { data: { userId: "admin" } });
  return c;
}
async function account(
  industry = "consultant",
  email = `voucher-${randomUUID()}@example.com`,
) {
  const c = await ctx(),
    password = randomUUID() + "secret";
  const r = await c.post("/api/auth/register", {
    data: {
      name: "Voucher Tester",
      email,
      password,
      accountType: "company",
      companyName: "Voucher Test Company",
      industry,
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const mails = readdirSync(
    resolve(process.env.HUMETO_DATA_DIR, "email-capture"),
  ).map((f) =>
    JSON.parse(
      readFileSync(
        resolve(process.env.HUMETO_DATA_DIR, "email-capture", f),
        "utf8",
      ),
    ),
  );
  const mail = mails.find(
    (m) => m.to === email && m.subject.includes("Verify"),
  );
  const token = new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
    "token",
  );
  assert.equal(
    (await c.post("/api/auth/verify-email", { data: { token } })).status(),
    200,
  );
  assert.equal(
    (await c.post("/api/auth/login", { data: { email, password } })).status(),
    200,
  );
  const u = await database()
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email);
  const m = await database()
    .prepare("SELECT * FROM memberships WHERE user_id=?")
    .get(u.id);
  return { c, email, tenant: m.tenant_id, user: u.id };
}
const defaults = () => ({
  action: "create",
  label: "QA Voucher " + randomUUID(),
  audience: "any",
  features: ["crm", "tasks", "forms"],
  seats: 5,
  caseLimit: 100,
  storageMb: 1024,
  durationDays: 30,
  startsAt: Date.now() - 1000,
  expiresAt: Date.now() + 86400000,
  maxUses: 1,
});
async function create(c, overrides = {}) {
  const r = await c.post("/api/workspace/vouchers", {
    data: { ...defaults(), ...overrides },
  });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
after(async () => {
  for (const c of contexts) await c.dispose();
  await database().close();
});
test("Feature permissions fail closed and share applicant access only with CRM or forms", () => {
  assert.equal(featureAllowed({ features_json: '["tasks"]' }, "crm"), false);
  assert.equal(featureAllowed({ features_json: '["tasks"]' }, "shared"), false);
  assert.equal(featureAllowed({ features_json: '["forms"]' }, "shared"), true);
  assert.equal(featureAllowed({ features_json: "broken" }, "tasks"), false);
});
test(
  "Audience-bound vouchers activate expired access and enforce included features",
  { skip },
  async () => {
    const a = await admin(),
      owner = await account("lawyer"),
      wrong = await account("consultant"),
      d = database();
    const v = await create(a, {
      audience: "lawyer",
      features: ["tasks"],
      recipientEmail: owner.email,
    });
    assert.equal(
      (
        await owner.c.post("/api/workspace/vouchers", { data: defaults() })
      ).status(),
      403,
    );
    assert.equal(
      (
        await wrong.c.post("/api/workspace/vouchers", {
          data: { action: "redeem", code: v.code },
        })
      ).status(),
      400,
    );
    await d
      .prepare("UPDATE subscriptions SET expires_at=? WHERE tenant_id=?")
      .run(new Date(Date.now() - 5000).toISOString(), owner.tenant);
    const r = await owner.c.post("/api/workspace/vouchers", {
      data: { action: "redeem", code: v.code },
    });
    assert.equal(r.status(), 200, await r.text());
    assert.equal(
      (
        await owner.c.post("/api/workspace/tasks", {
          data: {
            title: "Voucher access",
            important: false,
            urgent: false,
            dueDate: "",
            assignee: "",
          },
        })
      ).status(),
      200,
    );
    assert.equal((await owner.c.get("/api/crm-agent")).status(), 403);
    assert.equal((await owner.c.get("/api/workspace/reading")).status(), 403);
    assert.equal((await owner.c.get("/workspace/leads")).status(), 404);
    const b = await (await owner.c.get("/api/workspace/bootstrap")).json();
    assert.deepEqual(b.people, []);
    assert.deepEqual(b.leads, []);
    assert.deepEqual(b.documents, []);
    assert.equal(
      (await d.prepare("SELECT uses FROM access_vouchers WHERE id=?").get(v.id))
        .uses,
      1,
    );
    assert.notEqual(
      (
        await d
          .prepare("SELECT code_hash FROM access_vouchers WHERE id=?")
          .get(v.id)
      ).code_hash,
      v.code,
    );
    const list = await (await a.get("/api/workspace/vouchers")).json();
    assert.ok(!JSON.stringify(list).includes(v.code));
    assert.ok(!("code_hash" in list.vouchers.find((x) => x.id === v.id)));
    assert.notEqual(
      (
        await owner.c.post("/api/workspace/vouchers", {
          data: { action: "redeem", code: v.code },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await a.post("/api/workspace/vouchers", {
          data: { action: "revoke", id: v.id },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await d
          .prepare("SELECT status FROM subscriptions WHERE tenant_id=?")
          .get(owner.tenant)
      ).status,
      "active",
    );
    const manual = await a.patch("/api/workspace/platform/" + owner.tenant, {
      data: {
        plan: "Institute",
        status: "active",
        seats: 5,
        caseLimit: 100,
        storageMb: 1024,
        expiresAt: "",
        features: ["crm"],
        industry: "agency",
      },
    });
    assert.equal(manual.status(), 200, await manual.text());
    assert.equal((await owner.c.get("/api/agent")).status(), 403);
    assert.equal(
      (
        await d
          .prepare("SELECT industry FROM tenants WHERE id=?")
          .get(owner.tenant)
      ).industry,
      "agency",
    );
  },
);
test(
  "Concurrent redemption respects the global usage cap and rejects scheduled/revoked codes",
  { skip },
  async () => {
    const a = await admin(),
      one = await account(),
      two = await account(),
      v = await create(a);
    const results = await Promise.all(
      [one, two].map((o) =>
        o.c.post("/api/workspace/vouchers", {
          data: { action: "redeem", code: v.code },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status() === 200).length, 1);
    assert.equal(
      (
        await database()
          .prepare("SELECT uses FROM access_vouchers WHERE id=?")
          .get(v.id)
      ).uses,
      1,
    );
    const future = await create(a, { startsAt: Date.now() + 3600000 });
    assert.equal(
      (
        await one.c.post("/api/workspace/vouchers", {
          data: { action: "redeem", code: future.code },
        })
      ).status(),
      400,
    );
    const revoked = await create(a);
    await a.post("/api/workspace/vouchers", {
      data: { action: "revoke", id: revoked.id },
    });
    assert.equal(
      (
        await one.c.post("/api/workspace/vouchers", {
          data: { action: "redeem", code: revoked.code },
        })
      ).status(),
      400,
    );
    assert.equal(
      (
        await a.post("/api/workspace/vouchers", {
          data: defaults(),
          headers: { Origin: "https://foreign.example" },
        })
      ).status(),
      403,
    );
  },
);
test(
  "Only the designated verified signup obtains platform-admin access",
  { skip },
  async () => {
    const designated = await account(
      "consultant",
      "designated-admin@example.com",
    );
    const roles = await database()
      .prepare("SELECT role FROM memberships WHERE user_id=?")
      .all(designated.user);
    assert.equal(roles[0].role, "platform_admin");
    assert.equal(
      (await designated.c.get("/api/workspace/platform")).status(),
      200,
    );
    const ordinary = await account();
    assert.equal(
      (
        await database()
          .prepare("SELECT role FROM memberships WHERE user_id=?")
          .get(ordinary.user)
      ).role,
      "owner",
    );
    assert.ok(
      [403, 404].includes(
        (await ordinary.c.get("/api/workspace/platform")).status(),
      ),
    );
  },
);

test(
  "Voucher email is explicit, recipient-bound, idempotent and respects unsubscribe",
  { skip },
  async () => {
    const a = await admin(),
      d = database(),
      email = `voucher-email-${randomUUID()}@example.com`;
    const bad = await a.post("/api/workspace/vouchers", {
      data: { ...defaults(), emailVoucher: true },
    });
    assert.equal(bad.status(), 400);
    const v = await create(a, { recipientEmail: email, emailVoucher: true });
    assert.equal(v.emailStatus, "accepted");
    const read = () =>
      readdirSync(resolve(process.env.HUMETO_DATA_DIR, "email-capture")).map(
        (f) =>
          JSON.parse(
            readFileSync(
              resolve(process.env.HUMETO_DATA_DIR, "email-capture", f),
              "utf8",
            ),
          ),
      );
    const messages = read().filter(
      (m) => m.to === email && m.subject === "Your Humeto access voucher",
    );
    assert.equal(messages.length, 1);
    assert.ok(messages[0].text.includes(v.code));
    assert.ok(messages[0].text.includes("/workspace/settings"));
    assert.ok(messages[0].headers["List-Unsubscribe"]);
    const repeat = await a.post("/api/workspace/vouchers", {
      data: { action: "email", id: v.id, code: v.code },
    });
    assert.equal(repeat.status(), 200);
    assert.equal((await repeat.json()).emailStatus, "accepted");
    assert.equal(
      read().filter(
        (m) => m.to === email && m.subject === "Your Humeto access voucher",
      ).length,
      1,
    );
    const list = await (await a.get("/api/workspace/vouchers")).json();
    const row = list.vouchers.find((x) => x.id === v.id);
    assert.equal(row.email_status, "accepted");
    assert.ok(row.emailed_at > 0);
    assert.ok(!JSON.stringify(list).includes(v.code));
    await d
      .prepare(
        "INSERT INTO email_preferences(email,optional_notifications,marketing,updated_at) VALUES(?,0,0,?) ON CONFLICT(email) DO UPDATE SET optional_notifications=0",
      )
      .run(email, Date.now());
    const suppressed = await create(a, {
      recipientEmail: email,
      emailVoucher: true,
    });
    assert.equal(suppressed.emailStatus, "suppressed");
    assert.ok(!read().some((m) => m.text.includes(suppressed.code)));
    const noEmail = await create(a, {
      recipientEmail: `no-email-${randomUUID()}@example.com`,
    });
    assert.equal(noEmail.emailStatus, "not_requested");
    assert.ok(!read().some((m) => m.text.includes(noEmail.code)));
    const wrong = await a.post("/api/workspace/vouchers", {
      data: { action: "email", id: noEmail.id, code: randomUUID() },
    });
    assert.equal((await wrong.json()).emailStatus, "unavailable");
    const saved = await a.post("/api/workspace/vouchers", {
      data: { action: "email", id: noEmail.id, code: noEmail.code },
    });
    assert.equal(saved.status(), 200);
    assert.equal((await saved.json()).emailStatus, "accepted");
    assert.ok(read().some((m) => m.text.includes(noEmail.code)));

    const owner = await account();
    assert.equal(
      (
        await owner.c.post("/api/workspace/vouchers", {
          data: { action: "email", id: noEmail.id, code: noEmail.code },
        })
      ).status(),
      403,
    );
  },
);
