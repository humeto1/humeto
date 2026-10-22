import test, { after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { database } from "../src/lib/postgres.mjs";
import {
  sendEmail,
  tokenHash,
  publicAppUrl,
} from "../src/lib/email-delivery.mjs";
const isolated = process.env.HUMETO_ISOLATED_QA === "true",
  base = process.env.HUMETO_TEST_URL,
  contexts = [];
const mails = () =>
  readdirSync(resolve(process.env.HUMETO_DATA_DIR, "email-capture")).map((f) =>
    JSON.parse(
      readFileSync(
        resolve(process.env.HUMETO_DATA_DIR, "email-capture", f),
        "utf8",
      ),
    ),
  );
async function ctx() {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  return c;
}
const token = (m) =>
  new URL(m.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
after(async () => {
  for (const c of contexts) await c.dispose();
  await database().close();
});
test("Public email links reject unsafe origins and credentials", () => {
  assert.throws(() =>
    publicAppUrl({ HUMETO_PUBLIC_APP_URL: "http://evil.test" }),
  );
  assert.throws(() =>
    publicAppUrl({ HUMETO_PUBLIC_APP_URL: "https://user:pass@example.com" }),
  );
  assert.equal(
    publicAppUrl({ HUMETO_PUBLIC_APP_URL: "https://www.humeto.com" }),
    "https://www.humeto.com",
  );
});
test(
  "Verification expires, recovery is single-use, and password reset revokes other sessions",
  { skip: !isolated },
  async () => {
    const c = await ctx(),
      other = await ctx(),
      d = database(),
      email = `recover-${randomUUID()}@example.com`,
      password = randomUUID() + "secret";
    assert.equal(
      (
        await c.post("/api/auth/register", {
          data: { name: "Recover Test", email, password },
        })
      ).status(),
      200,
    );
    const mail = mails().find(
        (m) => m.to === email && m.subject.includes("Verify"),
      ),
      vtoken = token(mail);
    await d
      .prepare("UPDATE auth_email_tokens SET expires_at=? WHERE token_hash=?")
      .run(Date.now() - 1, tokenHash(vtoken));
    assert.equal(
      (
        await c.post("/api/auth/verify-email", { data: { token: vtoken } })
      ).status(),
      400,
    );
    assert.equal(
      (
        await c.post("/api/auth/resend-verification", { data: { email } })
      ).status(),
      200,
    );
    const fresh = mails().find(
      (m) =>
        m.to === email && m.subject.includes("Verify") && token(m) !== vtoken,
    );
    assert.equal(
      (
        await c.post("/api/auth/verify-email", {
          data: { token: token(fresh) },
        })
      ).status(),
      200,
    );
    for (const client of [c, other])
      assert.equal(
        (
          await client.post("/api/auth/login", { data: { email, password } })
        ).status(),
        200,
      );
    assert.equal(
      (await c.post("/api/auth/forgot-password", { data: { email } })).status(),
      200,
    );
    const reset = token(
        mails().find((m) => m.to === email && m.subject.includes("Reset")),
      ),
      next = randomUUID() + "new-secret";
    const saved = await d
      .prepare("SELECT * FROM auth_email_tokens WHERE token_hash=?")
      .get(tokenHash(reset));
    assert.ok(saved);
    assert.notEqual(saved.token_hash, reset);
    assert.equal(
      (
        await c.post("/api/auth/reset-password", {
          data: { token: reset, password: next },
          headers: { Origin: "https://foreign.test" },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await c.post("/api/auth/reset-password", {
          data: { token: reset, password: next },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await c.post("/api/auth/reset-password", {
          data: { token: reset, password: next },
        })
      ).status(),
      400,
    );
    assert.equal((await other.get("/api/workspace/bootstrap")).status(), 401);
    assert.equal(
      (await c.post("/api/auth/login", { data: { email, password } })).status(),
      401,
    );
    assert.equal(
      (
        await c.post("/api/auth/login", { data: { email, password: next } })
      ).status(),
      200,
    );
    const known = await (
        await c.post("/api/auth/forgot-password", { data: { email } })
      ).json(),
      unknown = await (
        await c.post("/api/auth/forgot-password", {
          data: { email: `unknown-${randomUUID()}@example.com` },
        })
      ).json();
    assert.deepEqual(known, unknown);
  },
);
test(
  "Optional email unsubscribe is scanner-safe, idempotent and cannot suppress account security mail",
  { skip: !isolated },
  async () => {
    const d = database(),
      email = `unsub-${randomUUID()}@example.com`,
      c = await ctx();
    assert.equal(
      (
        await sendEmail(
          {
            to: email,
            subject: "Marketing",
            text: "News",
            category: "marketing",
          },
          d,
        )
      ).suppressed,
      true,
    );
    await sendEmail(
      {
        to: email,
        subject: "Optional test",
        text: "A reminder",
        category: "optional",
      },
      d,
    );
    const mail = mails().find((m) => m.to === email),
      oneClick = mail.headers["List-Unsubscribe"].slice(1, -1),
      url = new URL(oneClick);
    assert.equal(
      mail.headers["List-Unsubscribe-Post"],
      "List-Unsubscribe=One-Click",
    );
    assert.equal(
      (
        await c.get("/unsubscribe?token=" + url.searchParams.get("token"))
      ).status(),
      200,
    );
    assert.equal(
      (
        await d
          .prepare(
            "SELECT optional_notifications FROM email_preferences WHERE email=?",
          )
          .get(email)
      ).optional_notifications,
      1,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await c.post(url.pathname + url.search, {
            form: { "List-Unsubscribe": "One-Click" },
          })
        ).status(),
        200,
      );
    assert.equal(
      (
        await sendEmail(
          {
            to: email,
            subject: "Suppressed",
            text: "Not sent",
            category: "optional",
          },
          d,
        )
      ).suppressed,
      true,
    );
    assert.equal(
      (
        await sendEmail(
          {
            to: email,
            subject: "Security",
            text: "Account only",
            category: "account",
          },
          d,
        )
      ).captured,
      true,
    );
    assert.equal(
      (await c.post("/api/email/unsubscribe?token=" + randomUUID())).status(),
      400,
    );
    assert.equal((await c.get("/api/email/preferences")).status(), 401);
    await c.post("/api/auth/demo", { data: { userId: "ayesha" } });
    assert.equal(
      (
        await c.post("/api/email/preferences", {
          data: { optionalNotifications: false, marketing: false },
        })
      ).status(),
      200,
    );
    assert.deepEqual(await (await c.get("/api/email/preferences")).json(), {
      optionalNotifications: false,
      marketing: false,
    });
  },
);

test(
  "Optional email retries retain the same unsubscribe payload for provider idempotency",
  { skip: !isolated },
  async () => {
    const email = `retry-${randomUUID()}@example.com`,
      key = randomUUID();
    for (let i = 0; i < 2; i++)
      await sendEmail({
        to: email,
        subject: "Retry stability",
        text: "Same message",
        category: "optional",
        key,
      });
    const messages = mails().filter((m) => m.to === email);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].text, messages[1].text);
    assert.deepEqual(messages[0].headers, messages[1].headers);
  },
);
