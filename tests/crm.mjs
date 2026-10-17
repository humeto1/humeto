import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
import { resolve } from "node:path";
import { parseLeadCSV } from "../src/lib/lead-csv.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  personIds = [],
  leadEmails = [],
  linkIds = [];
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  if (user)
    assert.equal(
      (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
      200,
    );
  return c;
}
const ep = "/api/workspace/";
async function boot(c) {
  return (await c.get(ep + "bootstrap")).json();
}
function email() {
  const e = "test-" + randomUUID() + "@example.com";
  leadEmails.push(e);
  return e;
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const pid of personIds) {
    await d.prepare("DELETE FROM payments WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM case_finance WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM leads WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM people WHERE id=?").run(pid);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(pid);
  }
  for (const e of leadEmails) {
    const l = await d.prepare("SELECT id FROM leads WHERE email=?").get(e);
    if (l) await d.prepare("DELETE FROM audit WHERE entity_id=?").run(l.id);
    await d.prepare("DELETE FROM leads WHERE email=?").run(e);
  }
  for (const id of linkIds) {
    await d.prepare("DELETE FROM inquiry_limits WHERE link_id=?").run(id);
    await d.prepare("DELETE FROM inquiry_links WHERE id=?").run(id);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(id);
  }
  await d.close();
});
test("quoted lead CSV retains custom fields and rejects malformed amounts", () => {
  const rows = parseLeadCSV(
    'name,email,notes,expected_fee,custom\r\n"Noor, Ahmed",noor@example.com,"Line 1\nLine 2",100000,"Intake, 2027"',
  );
  assert.equal(rows[0].name, "Noor, Ahmed");
  assert.equal(rows[0].extras.custom, "Intake, 2027");
  assert.equal(rows[0].expected_fee, 100000);
  assert.throws(() =>
    parseLeadCSV("name,email,expected_fee\nNoor,noor@example.com,50k"),
  );
  assert.throws(() => parseLeadCSV("name,name,email\nN,N,n@example.com"));
});
test("lead import previews, deduplicates, registers exactly once and carries fees", async () => {
  const c = await ctx("ayesha"),
    em = email();
  const row = {
    name: "CRM Test Applicant",
    email: em,
    expected_fee: 100000,
    upfront_fee: 50000,
    incentive: 25000,
    extras: { preferredIntake: "2027" },
    source: "CSV",
  };
  let r = await c.post(ep + "leads/bulk", {
    data: { rows: [row, row], preview: true },
  });
  assert.equal(r.status(), 200, await r.text());
  assert.equal((await r.json()).accepted, 1);
  assert.equal(
    (await boot(c)).leads.some((l) => l.email === em),
    false,
  );
  r = await c.post(ep + "leads/bulk", {
    data: { rows: [row, row], preview: false },
  });
  assert.equal((await r.json()).created, 1);
  let l = (await boot(c)).leads.find((l) => l.email === em);
  assert.equal(l.extras.preferredIntake, "2027");
  r = await c.patch(ep + "leads/" + l.id, {
    data: { stage: "Qualified", revision: l.revision },
  });
  assert.equal(r.status(), 200);
  assert.equal(
    (
      await c.patch(ep + "leads/" + l.id, {
        data: { stage: "Lost", revision: l.revision },
      })
    ).status(),
    409,
  );
  l = (await boot(c)).leads.find((l) => l.email === em);
  r = await c.post(ep + "leads/" + l.id + "/register", {
    data: { revision: l.revision },
  });
  assert.equal(r.status(), 200, await r.text());
  const pid = (await r.json()).personId;
  personIds.push(pid);
  assert.equal(
    (
      await (
        await c.post(ep + "leads/" + l.id + "/register", {
          data: { revision: l.revision },
        })
      ).json()
    ).personId,
    pid,
  );
  assert.equal(
    (
      await c.post(ep + "students", {
        data: { name: "Duplicate applicant", email: em.toUpperCase() },
      })
    ).status(),
    409,
  );
  const data = await boot(c);
  assert.equal(data.people.filter((p) => p.id === pid).length, 1);
  const f = data.finance.find((f) => f.person_id === pid);
  assert.equal(f.pending, 100000);
  assert.equal(f.paid, 0);
  assert.equal(f.incentive, 25000);
  const receipt = {
    amount: 25000,
    reference: "TEST receipt",
    clientKey: randomUUID(),
  };
  assert.equal(
    (
      await c.post(ep + "case-finance/" + pid + "/payment", { data: receipt })
    ).status(),
    200,
  );
  await c.post(ep + "case-finance/" + pid + "/payment", { data: receipt });
  const paid = (await boot(c)).finance.find((f) => f.person_id === pid);
  assert.equal(paid.paid, 25000);
  assert.equal(paid.pending, 75000);
  assert.equal(
    (
      await c.post(ep + "case-finance/" + pid + "/payment", {
        data: { ...receipt, amount: 999 },
      })
    ).status(),
    409,
  );
  assert.equal(
    (
      await c.patch(ep + "leads/" + l.id, {
        data: { stage: "New", revision: l.revision + 1 },
      })
    ).status(),
    409,
  );
  const p = (await boot(c)).people.find((p) => p.id === pid);
  assert.equal(
    (
      await c.patch(ep + "applicant-stage/" + pid, {
        data: { stage: "Visa", revision: p.revision },
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await c.patch(ep + "applicant-stage/" + pid, {
        data: { stage: "Closed", revision: p.revision },
      })
    ).status(),
    409,
  );
});
test("CRM roles and tenant boundaries protect leads, fees and stages", async () => {
  const c = await ctx("ayesha"),
    em = email();
  const made = await c.post(ep + "leads", {
    data: { name: "Privacy test lead", email: em },
  });
  const lid = (await made.json()).id;
  for (const user of ["amira", "admin"]) {
    const x = await ctx(user);
    const b = await boot(x);
    assert.deepEqual(b.leads, []);
    assert.deepEqual(b.finance, []);
    assert.equal(
      (
        await x.post(ep + "leads", { data: { name: "Denied lead", email: em } })
      ).status(),
      403,
    );
    assert.equal(
      (
        await x.patch(ep + "applicant-stage/amira", {
          data: { stage: "Closed", revision: 1 },
        })
      ).status(),
      403,
    );
  }
  const other = await ctx("bright-owner");
  assert.equal(
    (
      await other.patch(ep + "leads/" + lid, {
        data: { stage: "Lost", revision: 1 },
      })
    ).status(),
    404,
  );
  assert.equal(
    (
      await other.post(ep + "case-finance/amira/payment", {
        data: { amount: 1, reference: "Denied", clientKey: randomUUID() },
      })
    ).status(),
    404,
  );
});
test("application outcomes and applicant journeys stay independent", async () => {
  const c = await ctx("ayesha");
  let data = await boot(c);
  const a = data.applications.find((a) => a.id === "demo-usa-refused");
  assert.ok(a);
  const p = data.people.find((p) => p.id === a.person_id);
  const original = a.status;
  try {
    const r = await c.patch(ep + "applications/" + a.id, {
      data: {
        status: "Withdrawn",
        revision: a.revision,
        note: "Local evidence check",
        sourceUrl: "https://example.com/application/test",
      },
    });
    assert.equal(r.status(), 200, await r.text());
    const history = await (await c.get(ep + "applications/" + a.id)).json();
    assert.equal(history.events[0].note, "Local evidence check");
    assert.equal(history.events[0].from_status, original);
    assert.equal(history.events[0].to_status, "Withdrawn");
    assert.equal(
      history.events[0].source_url,
      "https://example.com/application/test",
    );
    data = await boot(c);
    assert.equal(
      data.people.find((x) => x.id === p.id).journey_stage,
      p.journey_stage,
    );
    assert.equal(
      data.applications.find((x) => x.id === "demo-uk-offer").status,
      "Offer received",
    );
    assert.equal(
      (
        await c.patch(ep + "applications/" + a.id, {
          data: { status: "Submitted", revision: a.revision + 1 },
        })
      ).status(),
      400,
    );
  } finally {
    const fresh = (await boot(c)).applications.find((x) => x.id === a.id);
    await c.patch(ep + "applications/" + a.id, {
      data: { status: original, revision: fresh.revision },
    });
  }
});
test("public inquiry creates one lead without exposing duplicates; expired links and cross-origin blocked", async () => {
  const c = await ctx("ayesha");
  const r = await c.post(ep + "inquiry-links", { data: {} });
  assert.equal(r.status(), 200, await r.text());
  const { path } = await r.json();
  const token = path.split("/").pop();
  const d = database();
  const link = await d
    .prepare("SELECT id FROM inquiry_links ORDER BY _rowid DESC LIMIT 1")
    .get();
  linkIds.push(link.id);
  const pub = await ctx();
  const em = email();
  const details = { token, name: "Inquiry test", email: em, consent: true };
  assert.equal(
    (await pub.post("/api/inquiry", { data: details })).status(),
    200,
  );
  assert.deepEqual(
    await (await pub.post("/api/inquiry", { data: details })).json(),
    { ok: true },
  );
  const l = (await boot(c)).leads.filter((l) => l.email === em);
  assert.equal(l.length, 1);
  assert.equal(l[0].source, "Inquiry");
  assert.equal(
    (
      await pub.post("/api/inquiry", {
        data: details,
        headers: { Origin: "https://bad.example" },
      })
    ).status(),
    403,
  );
  await d
    .prepare("UPDATE inquiry_links SET expires_at=0 WHERE id=?")
    .run(link.id);
  assert.equal(
    (await pub.post("/api/inquiry", { data: details })).status(),
    404,
  );
  await d.close();
});
