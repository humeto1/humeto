import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  d = database();
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
    200,
  );
  return c;
}
after(async () => {
  for (const c of contexts) await c.dispose();
  await d.close();
});
test("WhatsApp isolates company messages, owner pairing and reviewed outbox", async () => {
  const owner = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    student = await ctx("amira");
  assert.equal((await student.get("/api/whatsapp")).status(), 403);
  assert.equal(
    (
      await owner.post("/api/whatsapp", { data: { action: "connect" } })
    ).status(),
    200,
  );
  assert.equal(
    (
      await owner.post("/api/whatsapp", {
        data: {
          action: "draft",
          remote: "+923001234567",
          body: "Fictional QA message. Do not send.",
        },
      })
    ).status(),
    200,
  );
  const own = await (await owner.get("/api/whatsapp")).json();
  const draft = own.messages.find(
    (m) => m.body === "Fictional QA message. Do not send.",
  );
  assert.ok(draft);
  assert.equal(draft.status, "draft");
  const foreign = await (await other.get("/api/whatsapp")).json();
  assert.ok(!foreign.messages.some((m) => m.id === draft.id));
  assert.equal(
    (
      await owner.post("/api/whatsapp", {
        data: { action: "send", id: draft.id },
      })
    ).status(),
    409,
  );
  assert.equal(
    (
      await student.post("/api/whatsapp", { data: { action: "connect" } })
    ).status(),
    403,
  );
  assert.equal(
    (
      await owner.post("/api/whatsapp", {
        data: { action: "draft", remote: "bad", body: "test" },
      })
    ).status(),
    400,
  );
  await owner.post("/api/whatsapp", { data: { action: "disconnect" } });
  await d.prepare("DELETE FROM whatsapp_messages WHERE id=?").run(draft.id);
});
