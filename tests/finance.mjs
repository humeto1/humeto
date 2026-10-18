import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  keys = [],
  ids = [],
  paymentIds = [],
  allocationIds = [];
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
async function send(c, action, body = {}, key = randomUUID()) {
  keys.push(key);
  const r = await c.post("/api/workspace/finance", {
    data: { action, clientKey: key, ...body },
  });
  if (r.ok()) {
    const j = await r.json();
    ids.push(j.id);
  }
  return r;
}
const read = async (c) => (await c.get("/api/workspace/finance")).json();
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const key of keys)
    await d.prepare("DELETE FROM finance_commands WHERE client_key=?").run(key);
  for (const key of ids) {
    await d
      .prepare("DELETE FROM finance_payment_allocations WHERE id=?")
      .run(key);
    await d.prepare("DELETE FROM finance_adjustments WHERE id=?").run(key);
    await d
      .prepare("DELETE FROM finance_commission_receipts WHERE id=?")
      .run(key);
    await d.prepare("DELETE FROM finance_entries WHERE source_id=?").run(key);
    await d.prepare("DELETE FROM employee_allocations WHERE id=?").run(key);
  }
  for (const key of ids) {
    await d.prepare("DELETE FROM finance_invoices WHERE id=?").run(key);
    await d.prepare("DELETE FROM finance_commissions WHERE id=?").run(key);
  }
  for (const key of paymentIds) {
    await d
      .prepare(
        "DELETE FROM finance_entries WHERE source_kind='payment' AND source_id=?",
      )
      .run(key);
    await d.prepare("DELETE FROM payments WHERE id=?").run(key);
  }
  await d.close();
});
test("invoices recognize income once, matching receipts does not double income, refunds and credits reconcile", async () => {
  const c = await ctx("ayesha"),
    before = await read(c),
    key = randomUUID(),
    invoiceBody = {
      personId: "amira",
      number: "QA-" + randomUUID(),
      title: "QA application service",
      date: "2026-10-18",
      installments: [
        { date: "2026-10-20", amount: 5000 },
        { date: "2026-11-20", amount: 5000 },
      ],
    };
  let r = await send(c, "invoice", invoiceBody, key);
  assert.equal(r.status(), 200, await r.text());
  const invoice = (await r.json()).id;
  assert.equal((await send(c, "invoice", invoiceBody, key)).status(), 200);
  assert.equal(
    (
      await send(c, "invoice", { ...invoiceBody, title: "Changed" }, key)
    ).status(),
    409,
  );
  const d = database(),
    payment = randomUUID();
  paymentIds.push(payment);
  await d
    .prepare(
      "INSERT INTO payments(id,tenant_id,person_id,amount,reference,client_key,created_by) VALUES(?,'northstar','amira',10000,'QA finance payment',?,'ayesha')",
    )
    .run(payment, randomUUID());
  r = await send(c, "allocate-payment", {
    invoiceId: invoice,
    paymentId: payment,
    amount: 7000,
  });
  assert.equal(r.status(), 200, await r.text());
  const matched = (await r.json()).id;
  assert.equal(
    (
      await send(c, "refund", {
        sourceId: payment,
        amount: 4000,
        date: "2026-10-18",
        reason: "Too much",
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await send(c, "credit", {
        sourceId: invoice,
        amount: 4000,
        date: "2026-10-18",
        reason: "Too much",
      })
    ).status(),
    400,
  );
  assert.equal(
    (await send(c, "unallocate-payment", { allocationId: matched })).status(),
    200,
  );
  assert.equal(
    (
      await send(c, "credit", {
        sourceId: invoice,
        amount: 2000,
        date: "2026-10-18",
        reason: "Service reduction",
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await send(c, "refund", {
        sourceId: payment,
        amount: 2000,
        date: "2026-10-18",
        reason: "Refund of reduction",
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await send(c, "expense", {
        amount: 1000,
        date: "2026-10-18",
        description: "QA courier cost",
        personId: "amira",
      })
    ).status(),
    200,
  );
  const data = await read(c);
  assert.equal(data.summary.serviceIncome - before.summary.serviceIncome, 8000);
  assert.equal(data.summary.expenses - before.summary.expenses, 1000);
  assert.equal(data.summary.profit - before.summary.profit, 7000);
  assert.equal(data.summary.cash - before.summary.cash, 7000);
  assert.equal(data.summary.clientBalance, before.summary.clientBalance);
  assert.equal(data.invoices.find((i) => i.id === invoice).credited, 2000);
  assert.equal(
    data.installments.filter((i) => i.invoice_id === invoice).length,
    2,
  );
  const month = await (
    await c.get("/api/workspace/finance?month=2026-10")
  ).json();
  assert.ok(month.entries.some((e) => e.source_id === invoice));
  assert.ok(month.entries.every((e) => e.entry_date.startsWith("2026-10")));
});
test("earned commission and partial receipts keep P&L separate from cash; fixed allocations do not double expenses", async () => {
  const c = await ctx("ayesha"),
    before = await read(c),
    apps = (await (await c.get("/api/workspace/bootstrap")).json())
      .applications;
  let r = await send(c, "commission", {
    applicationId: apps[0].id,
    institution: "QA University",
    reference: "QA-" + randomUUID(),
    amount: 20000,
    date: "2026-10-18",
    expectedDate: "2026-11-18",
  });
  assert.equal(r.status(), 200, await r.text());
  const commission = (await r.json()).id;
  r = await send(c, "commission-receipt", {
    commissionId: commission,
    amount: 5000,
    date: "2026-10-18",
    reference: "QA bank receipt",
  });
  assert.equal(r.status(), 200, await r.text());
  assert.equal(
    (
      await send(c, "commission-receipt", {
        commissionId: commission,
        amount: 16000,
        date: "2026-10-18",
        reference: "Over limit",
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await send(c, "employee-allocation", {
        userId: "consultant",
        type: "applicant",
        entityId: "amira",
        date: "2026-10-18",
        cost: 1000,
        revenue: 3000,
        note: "Fixed service allocation",
      })
    ).status(),
    200,
  );
  const data = await read(c);
  assert.equal(
    data.summary.commissionIncome - before.summary.commissionIncome,
    20000,
  );
  assert.equal(
    data.summary.commissionDue - before.summary.commissionDue,
    15000,
  );
  assert.equal(data.summary.cash - before.summary.cash, 5000);
  assert.equal(data.summary.expenses, before.summary.expenses);
  assert.equal(
    (
      await send(c, "employee-allocation", {
        userId: "bright-owner",
        type: "applicant",
        entityId: "amira",
        date: "2026-10-18",
        cost: 1000,
        revenue: 3000,
        note: "Not our employee",
      })
    ).status(),
    404,
  );
});
test("finance is owner-only and tenant-private; concurrent retries post one invoice", async () => {
  const c = await ctx("ayesha"),
    staff = await ctx("consultant"),
    other = await ctx("bright-owner");
  assert.equal((await staff.get("/api/workspace/finance")).status(), 403);
  assert.equal(
    (
      await send(staff, "expense", {
        amount: 1,
        date: "2026-10-18",
        description: "No access",
      })
    ).status(),
    403,
  );
  const key = randomUUID(),
    body = {
      personId: "amira",
      number: "QA-" + randomUUID(),
      title: "Concurrent invoice",
      date: "2026-10-18",
      installments: [{ date: "2026-10-18", amount: 999 }],
    };
  const rr = await Promise.all([
    send(c, "invoice", body, key),
    send(c, "invoice", body, key),
  ]);
  assert.deepEqual(
    rr.map((r) => r.status()),
    [200, 200],
  );
  const first = (await rr[0].json()).id,
    second = (await rr[1].json()).id;
  assert.equal(first, second);
  assert.ok(!(await read(other)).invoices.some((i) => i.id === first));
  assert.equal(
    (
      await send(other, "credit", {
        sourceId: first,
        amount: 1,
        date: "2026-10-18",
        reason: "Wrong tenant",
      })
    ).status(),
    404,
  );
});
