import test from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { randomUUID, randomBytes, scryptSync, createHash } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL;
test(
  "saved native login lasts a year, browser login 30 days, and logout revokes its token",
  { skip: process.env.HUMETO_ISOLATED_QA !== "true" },
  async () => {
    const d = database(),
      uid = randomUUID(),
      email = `saved-${uid}@example.test`,
      password = randomUUID() + "!secret",
      salt = randomBytes(16).toString("hex");
    const clients = [];
    const client = async (headers = {}) => {
      const c = await request.newContext({
        baseURL: base,
        extraHTTPHeaders: { Origin: base, ...headers },
      });
      clients.push(c);
      return c;
    };
    try {
      await d
        .prepare(
          "INSERT INTO users(id,name,email,password_hash,email_verified_at) VALUES(?,?,?,?,?)",
        )
        .run(
          uid,
          "Saved login QA",
          email,
          salt + ":" + scryptSync(password, salt, 64).toString("hex"),
          Date.now(),
        );
      await d
        .prepare(
          "INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,'northstar','consultant')",
        )
        .run(uid);
      const c = await client();
      const short = await c.post("/api/auth/login", {
        data: { email, password },
      });
      assert.equal(short.status(), 200, await short.text());
      assert.equal((await short.json()).token, undefined);
      assert.match(short.headers()["set-cookie"], /Max-Age=43200/);
      const r = await c.post("/api/auth/login", {
        data: { email, password, remember: true, nativeSession: true },
      });
      assert.equal(r.status(), 200);
      assert.match(r.headers()["set-cookie"], /Max-Age=31536000/);
      const token = (await r.json()).token;
      assert.equal(typeof token, "string");
      const hash = createHash("sha256").update(token).digest("hex");
      const row = await d
        .prepare("SELECT expires_at FROM sessions WHERE token_hash=?")
        .get(hash);
      assert.ok(Number(row.expires_at) - Date.now() > 360 * 86400000);
      const native = await client({ "x-humeto-session": token });
      assert.equal((await native.get("/api/mobile")).status(), 200);
      const foreign = await request.newContext({
        baseURL: base,
        extraHTTPHeaders: {
          Origin: "https://foreign.invalid",
          "x-humeto-session": token,
        },
      });
      clients.push(foreign);
      assert.equal(
        (await foreign.post("/api/auth/logout", { data: {} })).status(),
        403,
      );
      assert.equal(
        (await native.post("/api/auth/logout", { data: {} })).status(),
        200,
      );
      assert.equal((await native.get("/api/mobile")).status(), 401);
      assert.equal(
        await d
          .prepare("SELECT token_hash FROM sessions WHERE token_hash=?")
          .get(hash),
        undefined,
      );

      // Native superadmin login opens only its own original workspace.
      await d
        .prepare("UPDATE memberships SET role='platform_admin' WHERE user_id=?")
        .run(uid);
      const adminLogin = await c.post("/api/auth/login", {
        data: { email, password, remember: true, nativeSession: true },
      });
      assert.equal(adminLogin.status(), 200);
      const own = await client({
        "x-humeto-session": (await adminLogin.json()).token,
      });
      const workspace = await own.get("/api/mobile");
      assert.equal(workspace.status(), 200);
      const ownActor = (await workspace.json()).actor;
      assert.equal(ownActor.tenantId, "northstar");
      assert.equal(ownActor.role, "owner");
      assert.equal(ownActor.platformAdmin, true);
      assert.equal(
        (
          await d
            .prepare("SELECT role FROM memberships WHERE user_id=?")
            .get(uid)
        ).role,
        "platform_admin",
      );
      const webLogin = await c.post("/api/auth/login", {
        data: { email, password, remember: true },
      });
      assert.match(webLogin.headers()["set-cookie"], /Max-Age=2592000/);
      assert.equal((await webLogin.json()).token, undefined);
      assert.equal((await c.get("/api/mobile")).status(), 403);
    } finally {
      for (const c of clients) await c.dispose();
      await d.prepare("DELETE FROM sessions WHERE user_id=?").run(uid);
      await d.prepare("DELETE FROM memberships WHERE user_id=?").run(uid);
      await d.prepare("DELETE FROM users WHERE id=?").run(uid);
      await d.close();
    }
  },
);
