import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
import { resolve } from "node:path";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  personIds = [],
  appIds = [],
  messageIds = new Set(),
  actionIds = new Set();
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
async function state(c) {
  return (await c.get("/api/crm-agent")).json();
}
async function message(c, text, key = randomUUID()) {
  const r = await c.post("/api/crm-agent", {
    data: { operation: "message", message: text, clientKey: key },
  });
  assert.equal(r.status(), 200, await r.text());
  const data = await r.json();
  const index = data.messages.findLastIndex(
    (m) => m.role === "user" && m.content === text,
  );
  if (index >= 0) {
    messageIds.add(data.messages[index].id);
    const reply = data.messages[index + 1];
    if (reply) {
      messageIds.add(reply.id);
      if (reply.action) actionIds.add(reply.action.id);
    }
  }
  return data;
}
function action(s) {
  return s.messages.findLast((m) => m.action)?.action;
}
async function decide(c, id, decision = "apply") {
  return c.post("/api/crm-agent", {
    data: { operation: "action", actionId: id, decision },
  });
}
async function applicant(c) {
  const email = "crm-agent-" + randomUUID() + "@example.com";
  const r = await c.post("/api/workspace/students", {
    data: { name: "QA CRM Agent", email },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  personIds.push(id);
  return { id, email };
}
async function boot(c) {
  return (await c.get("/api/workspace/bootstrap")).json();
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const mid of messageIds)
    await d.prepare("DELETE FROM crm_messages WHERE id=?").run(mid);
  for (const aid of actionIds)
    await d.prepare("DELETE FROM crm_actions WHERE id=?").run(aid);
  for (const pid of personIds) {
    await d.prepare("DELETE FROM email_drafts WHERE person_id=?").run(pid);
    for (const a of await d
      .prepare("SELECT id FROM applications WHERE person_id=?")
      .all(pid)) {
      await d
        .prepare("DELETE FROM requirements WHERE application_id=?")
        .run(a.id);
      await d
        .prepare("DELETE FROM application_events WHERE application_id=?")
        .run(a.id);
      await d.prepare("DELETE FROM audit WHERE entity_id=?").run(a.id);
    }
    await d.prepare("DELETE FROM applications WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM payments WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM case_finance WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM requests WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM people WHERE id=?").run(pid);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(pid);
  }
  await d.close();
});
test("CRM commands propose before applying and create a replay-safe external tracking case", async () => {
  const c = await ctx("ayesha"),
    p = await applicant(c),
    key = randomUUID();
  let s = await message(c, `Open admission case for ${p.email} in Canada`, key);
  assert.equal(s.engine, "Local command testing");
  let a = action(s);
  assert.ok(a);
  assert.equal(
    (await boot(c)).applications.filter((x) => x.person_id === p.id).length,
    0,
  );
  let replay = await message(
    c,
    `Open admission case for ${p.email} in Canada`,
    key,
  );
  assert.equal(action(replay).id, a.id);
  let r = await decide(c, a.id);
  assert.equal(r.status(), 200, await r.text());
  s = await r.json();
  a = action(s);
  assert.equal(a.status, "applied");
  assert.ok(a.targetId);
  appIds.push(a.targetId);
  await decide(c, a.id);
  let apps = (await boot(c)).applications.filter((x) => x.person_id === p.id);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].status, "Draft");
  const metadata = await c.patch(
    "/api/workspace/applications/" + a.targetId + "/details",
    {
      data: {
        institution: "QA Example University",
        program: "QA MSc",
        intake: "September 2027",
        revision: apps[0].revision,
      },
    },
  );
  assert.equal(metadata.status(), 200, await metadata.text());
  assert.equal(
    (await boot(c)).applications.find((x) => x.id === a.targetId).institution,
    "QA Example University",
  );
  const info = await (
    await c.get("/api/workspace/applications/" + a.targetId)
  ).json();
  assert.ok(info.requirements.length);
  s = await message(c, `Move application ${a.targetId} to Offer received`);
  const move = action(s);
  assert.equal((await decide(c, move.id)).status(), 200);
  apps = (await boot(c)).applications.filter((x) => x.person_id === p.id);
  assert.equal(apps[0].status, "Offer received");
  assert.equal(
    (await boot(c)).people.find((x) => x.id === p.id).journey_stage,
    "Planning",
  );
  const history = await (
    await c.get("/api/workspace/applications/" + a.targetId)
  ).json();
  assert.equal(history.events[0].note, "Reviewed local CRM command");
  s = await message(c, `Move application ${a.targetId} to Submitted`);
  assert.equal(s.messages.at(-1).action, null);
  assert.match(s.messages.at(-1).content, /portal reference/);
  const current = (await boot(c)).applications.find((x) => x.id === a.targetId);
  await c.patch("/api/workspace/applications/" + a.targetId, {
    data: { status: "Failed", revision: current.revision },
  });
  s = await message(c, `Close application ${a.targetId}`);
  assert.equal(s.messages.at(-1).action, null);
  assert.match(s.messages.at(-1).content, /preserve/);
  assert.equal(
    (await boot(c)).applications.find((x) => x.id === a.targetId).status,
    "Failed",
  );
});
test("CRM reviews enforce ownership, stale revisions, cancellation and expiry", async () => {
  const c = await ctx("ayesha"),
    p = await applicant(c);
  let s = await message(c, `Close applicant ${p.email}`),
    a = action(s);
  const consultant = await ctx("consultant");
  assert.equal((await decide(consultant, a.id)).status(), 404);
  assert.ok(
    !(await state(consultant)).messages.some(
      (m) => m.id === s.messages.at(-1).id,
    ),
  );
  await c.patch("/api/workspace/applicant-stage/" + p.id, {
    data: { stage: "Visa", revision: 1 },
  });
  assert.equal((await decide(c, a.id)).status(), 409);
  s = await message(c, `Close applicant ${p.email}`);
  a = action(s);
  await decide(c, a.id, "cancel");
  await decide(c, a.id);
  assert.equal(
    (await boot(c)).people.find((x) => x.id === p.id).journey_stage,
    "Visa",
  );
  s = await message(c, `Close applicant ${p.email}`);
  a = action(s);
  const d = database();
  await d.prepare("UPDATE crm_actions SET expires_at=0 WHERE id=?").run(a.id);
  await d.close();
  assert.equal((await decide(c, a.id)).status(), 409);
  s = await message(c, `Close applicant ${p.email}`);
  a = action(s);
  assert.equal((await decide(c, a.id)).status(), 200);
  assert.equal(
    (await boot(c)).people.find((x) => x.id === p.id).journey_stage,
    "Closed",
  );
});
test("CRM email reminders remain local drafts and refuse stale fee data", async () => {
  const c = await ctx("ayesha"),
    p = await applicant(c);
  await c.patch("/api/workspace/case-finance/" + p.id, {
    data: {
      revision: 0,
      expected_fee: 100000,
      upfront_fee: 50000,
      incentive: 25000,
      timeline: "",
    },
  });
  let s = await message(c, `Send fee reminder for ${p.email}`),
    a = action(s);
  assert.match(a.payload.body, /100,000/);
  assert.match(s.messages.at(-1).content, /will not send/);
  await c.post("/api/workspace/case-finance/" + p.id + "/payment", {
    data: { amount: 25000, reference: "QA receipt", clientKey: randomUUID() },
  });
  assert.equal((await decide(c, a.id)).status(), 409);
  s = await message(c, `Draft fee reminder for ${p.email}`);
  a = action(s);
  assert.match(a.payload.body, /75,000/);
  let r = await decide(c, a.id);
  assert.equal(r.status(), 200);
  s = await r.json();
  const draft = s.drafts.find((d) => d.person_id === p.id);
  assert.ok(draft);
  assert.equal(draft.status, "Draft");
  assert.equal(draft.recipient, p.email);
  await decide(c, a.id);
  assert.equal(
    (await state(c)).drafts.filter((d) => d.person_id === p.id).length,
    1,
  );
  const d = database();
  await d
    .prepare(
      "INSERT INTO requests(id,tenant_id,person_id,section_key,title,message,created_by) VALUES(?,'northstar',?,'passports','Share your passport','Please upload your passport','ayesha')",
    )
    .run(randomUUID(), p.id);
  await d.close();
  s = await message(c, `Draft document reminder for ${p.email}`);
  a = action(s);
  assert.match(a.payload.body, /Share your passport/);
  assert.equal((await decide(c, a.id)).status(), 200);
  // A confirmed future date or a received file must suppress repeat upload drafts.
  const fixture = database();
  await fixture
    .prepare(
      "UPDATE requests SET status='Waiting for document',follow_up_at='2099-01-01T04:00:00.000Z' WHERE person_id=?",
    )
    .run(p.id);
  s = await message(c, `Draft document reminder for ${p.email}`);
  assert.match(
    s.messages.at(-1).content,
    /No information\/document requests need an upload reminder/,
  );
  await fixture
    .prepare(
      "UPDATE requests SET status='File received',follow_up_at='' WHERE person_id=?",
    )
    .run(p.id);
  s = await message(c, `Draft document reminder for ${p.email}`);
  assert.match(s.messages.at(-1).content, /files waiting for review/);
  await fixture
    .prepare("UPDATE requests SET status='Changes requested' WHERE person_id=?")
    .run(p.id);
  s = await message(c, `Draft document reminder for ${p.email}`);
  assert.match(action(s).payload.body, /Share your passport/);
  await fixture.close();
});
test("CRM access rejects students/platform/cross-origin and does not expose another tenant", async () => {
  const owner = await ctx("ayesha"),
    p = await applicant(owner);
  for (const user of ["amira", "admin"]) {
    const c = await ctx(user);
    assert.equal((await c.get("/api/crm-agent")).status(), 403);
    assert.equal(
      (
        await c.post("/api/crm-agent", {
          data: {
            operation: "message",
            message: "hello",
            clientKey: randomUUID(),
          },
        })
      ).status(),
      403,
    );
  }
  const other = await ctx("bright-owner");
  const s = await message(other, `Show cases for ${p.email}`);
  assert.match(s.messages.at(-1).content, /No registered applicant/);
  assert.equal(
    (
      await owner.post("/api/crm-agent", {
        data: {
          operation: "message",
          message: "hello",
          clientKey: randomUUID(),
        },
        headers: { Origin: "https://bad.example" },
      })
    ).status(),
    403,
  );
});
