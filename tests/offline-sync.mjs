import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL;
test("mobile sync is account scoped, idempotent, conflict-safe, and preserves offline focus times", async () => {
  const browser = await chromium.launch();
  const d = database();
  try {
    const c = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
    assert.equal(
      (
        await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } })
      ).status(),
      200,
    );
    let boot = await (await c.request.get("/api/mobile")).json();
    const owner = boot.actor.tenantId + ":" + boot.actor.id;
    const title = "Offline sync " + randomUUID();
    const initialAt = new Date(Date.now() - 600000).toISOString();
    const command = {
      id: randomUUID(),
      owner,
      path: "/api/workspace/tasks",
      method: "POST",
      at: initialAt,
      body: { title, important: true, urgent: false },
    };
    const send = async (op) => {
      const r = await c.request.post("/api/mobile-sync", { data: op });
      return { status: r.status(), body: await r.json() };
    };
    const created = await send(command);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const taskId = created.body.id;
    assert.ok(taskId);
    const retry = await send(command);
    assert.deepEqual(retry, created);
    const changed = await send({
      ...command,
      body: { ...command.body, title: "Changed payload" },
    });
    assert.equal(changed.status, 409);
    const rows = (
      await d.query("SELECT id FROM tasks WHERE tenant_id=$1 AND title=$2", [
        boot.actor.tenantId,
        title,
      ])
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(
      (await send({ ...command, id: randomUUID(), owner: "another:account" }))
        .status,
      403,
    );
    assert.equal(
      (
        await send({
          ...command,
          id: randomUUID(),
          path: "/api/workspace/subscriptions",
        })
      ).status,
      400,
    );
    let at = Date.now() - 540000;
    const focusStart = {
      id: randomUUID(),
      owner,
      path: "/api/workspace/focus",
      method: "POST",
      at: new Date(at).toISOString(),
      body: { action: "start", taskId, taskRevision: 1, minutes: 25 },
    };
    const started = await send(focusStart);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const pause = {
      id: randomUUID(),
      owner,
      path: "/api/workspace/focus",
      method: "POST",
      at: new Date(at + 90000).toISOString(),
      body: { action: "pause", sessionId: started.body.id, revision: 1 },
    };
    assert.equal((await send(pause)).status, 200);
    assert.equal((await send(pause)).status, 200);
    const row = (
      await d.query("SELECT * FROM focus_sessions WHERE id=$1", [
        started.body.id,
      ])
    ).rows[0];
    assert.equal(row.elapsed_seconds, 90);
    assert.equal(row.state, "paused");
    const interval = (
      await d.query(
        "SELECT extract(epoch FROM ended_at-started_at)::int seconds FROM focus_work_intervals WHERE session_id=$1",
        [started.body.id],
      )
    ).rows[0];
    assert.equal(interval.seconds, 90);
    const stop = {
      id: randomUUID(),
      owner,
      path: "/api/workspace/focus",
      method: "POST",
      at: new Date(at + 120000).toISOString(),
      body: { action: "stop", sessionId: started.body.id, revision: 2 },
    };
    assert.equal((await send(stop)).status, 200);
    const stale = {
      id: randomUUID(),
      owner,
      path: "/api/workspace/tasks/" + taskId,
      method: "PATCH",
      at: new Date(at + 130000).toISOString(),
      body: { stage: "Done", revision: 1 },
    };
    assert.equal((await send(stale)).status, 409);
    assert.equal(
      (
        await d.query(
          "SELECT count(*)::int n FROM mobile_sync_commands WHERE command_id=$1",
          [stale.id],
        )
      ).rows[0].n,
      0,
    );
    const completed = await send({
      ...stale,
      id: randomUUID(),
      body: { stage: "Done", revision: 2 },
    });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    const finished = (
      await d.query("SELECT completed_at FROM tasks WHERE id=$1", [taskId])
    ).rows[0];
    assert.equal(Date.parse(finished.completed_at), Date.parse(stale.at));
    const normal = await c.request.post("/api/workspace/tasks", {
      data: {
        title: "Normal after replay " + randomUUID(),
        important: false,
        urgent: false,
      },
    });
    assert.equal(normal.status(), 200);
    const normalId = (await normal.json()).id;
    const normalRow = (
      await d.query("SELECT created_at FROM tasks WHERE id=$1", [normalId])
    ).rows[0];
    assert.ok(
      Date.now() - Date.parse(normalRow.created_at + "Z") < 15000,
      "replay clock must not leak to normal writes",
    );
    await c.close();
  } finally {
    await browser.close();
    await d.close();
  }
});

test("saved native login is long-lived, renews on use, and cannot renew a revoked session", async () => {
  const { scryptSync, createHash } = await import("node:crypto");
  const browser = await chromium.launch();
  const d = database();
  try {
    const c = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
    await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } });
    const boot = await (await c.request.get("/api/mobile")).json();
    const password = "Offline login " + randomUUID();
    const salt = randomUUID();
    const passwordHash =
      salt + ":" + scryptSync(password, salt, 64).toString("hex");
    await d.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      passwordHash,
      boot.actor.id,
    ]);
    const login = await c.request.post("/api/auth/login", {
      data: {
        email: boot.actor.email,
        password,
        remember: true,
        nativeSession: true,
      },
    });
    assert.equal(login.status(), 200, await login.text());
    const { token } = await login.json();
    assert.equal(token.length, 43);
    const hash = createHash("sha256").update(token).digest("hex");
    const first = (
      await d.query("SELECT expires_at FROM sessions WHERE token_hash=$1", [
        hash,
      ])
    ).rows[0];
    assert.ok(first.expires_at - Date.now() > 360 * 86400000);
    await d.query("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", [
      Date.now() + 3600000,
      hash,
    ]);
    assert.equal(
      (
        await c.request.get("/api/mobile", {
          headers: { "x-humeto-session": token },
        })
      ).status(),
      200,
    );
    const renewed = (
      await d.query("SELECT expires_at FROM sessions WHERE token_hash=$1", [
        hash,
      ])
    ).rows[0];
    assert.ok(renewed.expires_at - Date.now() > 360 * 86400000);
    await d.query("DELETE FROM sessions WHERE token_hash=$1", [hash]);
    assert.equal(
      (
        await c.request.get("/api/mobile", {
          headers: { "x-humeto-session": token },
        })
      ).status(),
      401,
    );
    assert.equal(
      (
        await d.query(
          "SELECT count(*)::int n FROM sessions WHERE token_hash=$1",
          [hash],
        )
      ).rows[0].n,
      0,
    );
    await c.close();
  } finally {
    await browser.close();
    await d.close();
  }
});
