import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import { canMutate } from "./auth";
import type { Actor } from "./types";
const error = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });
const amount = z.number().int().positive().max(100000000),
  nonnegative = z.number().int().min(0).max(100000000),
  date = z.iso.date(),
  text = z.string().trim().min(1).max(500),
  ref = z.string().max(100).default("");
export async function financeRead(a: Actor, month = "") {
  if (a.role !== "owner")
    return error(
      "Financial reports are restricted to the workspace owner.",
      403,
    );
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return error("Choose a valid month.");
  const d = db();
  const entries = await d
    .prepare(
      "SELECT * FROM finance_entries WHERE tenant_id=? ORDER BY entry_date DESC,created_at DESC",
    )
    .all(a.tenantId);
  const selected = month
    ? entries.filter((e) => String(e.entry_date).startsWith(month))
    : entries;
  const balance = (account: string, rows = entries) =>
    rows.reduce(
      (sum, e) =>
        sum +
        (e.debit_account === account ? e.amount : 0) -
        (e.credit_account === account ? e.amount : 0),
      0,
    );
  const invoices = await d
    .prepare(
      `SELECT i.*,p.name AS person_name,COALESCE((SELECT SUM(a.amount) FROM finance_payment_allocations a WHERE a.invoice_id=i.id AND a.tenant_id=i.tenant_id),0) AS paid,COALESCE((SELECT SUM(a.amount) FROM finance_adjustments a WHERE a.source_id=i.id AND a.tenant_id=i.tenant_id AND a.kind='credit'),0) AS credited FROM finance_invoices i JOIN people p ON p.id=i.person_id AND p.tenant_id=i.tenant_id WHERE i.tenant_id=? ORDER BY i.issue_date DESC`,
    )
    .all(a.tenantId);
  const payments = await d
    .prepare(
      `SELECT p.*,u.name AS person_name,COALESCE((SELECT SUM(a.amount) FROM finance_payment_allocations a WHERE a.payment_id=p.id AND a.tenant_id=p.tenant_id),0) AS allocated,COALESCE((SELECT SUM(a.amount) FROM finance_adjustments a WHERE a.source_id=p.id AND a.tenant_id=p.tenant_id AND a.kind='refund'),0) AS refunded FROM payments p JOIN people u ON u.id=p.person_id AND u.tenant_id=p.tenant_id WHERE p.tenant_id=? ORDER BY p.created_at DESC`,
    )
    .all(a.tenantId);
  const commissions = await d
    .prepare(
      `SELECT c.*,p.name AS person_name,COALESCE((SELECT SUM(r.amount) FROM finance_commission_receipts r WHERE r.commission_id=c.id AND r.tenant_id=c.tenant_id),0) AS received FROM finance_commissions c JOIN applications a ON a.id=c.application_id AND a.tenant_id=c.tenant_id JOIN people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id WHERE c.tenant_id=? ORDER BY c.earned_date DESC`,
    )
    .all(a.tenantId);
  const employees = await d
    .prepare(
      `SELECT u.id,u.name,COALESCE(c.monthly_salary,0) AS monthly_salary,COALESCE(c.monthly_overhead,0) AS monthly_overhead,COALESCE(c.revision,0) AS revision FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN employee_cost_profiles c ON c.user_id=u.id AND c.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.role IN ('owner','consultant','platform_admin') ORDER BY u.name`,
    )
    .all(a.tenantId);
  const allocations = await d
    .prepare(
      `SELECT e.*,u.name AS employee_name,CASE WHEN e.entity_type='applicant' THEN p.name ELSE j.title END AS entity_name FROM employee_allocations e JOIN users u ON u.id=e.user_id LEFT JOIN people p ON p.id=e.entity_id AND p.tenant_id=e.tenant_id LEFT JOIN projects j ON j.id=e.entity_id AND j.tenant_id=e.tenant_id WHERE e.tenant_id=? ORDER BY e.entry_date DESC`,
    )
    .all(a.tenantId);
  const paymentAllocations = await d
    .prepare("SELECT * FROM finance_payment_allocations WHERE tenant_id=?")
    .all(a.tenantId);
  const installments = await d
    .prepare(
      "SELECT * FROM finance_installments WHERE tenant_id=? ORDER BY due_date",
    )
    .all(a.tenantId);
  const adjustments = await d
    .prepare(
      "SELECT * FROM finance_adjustments WHERE tenant_id=? ORDER BY entry_date DESC",
    )
    .all(a.tenantId);
  return NextResponse.json({
    currency: "PKR",
    month,
    entries: selected,
    invoices,
    payments,
    commissions,
    employees,
    allocations: month
      ? allocations.filter((e) => String(e.entry_date).startsWith(month))
      : allocations,
    installments,
    adjustments,
    paymentAllocations,
    summary: {
      serviceIncome: -balance("Service income", selected),
      commissionIncome: -balance("Commission income", selected),
      expenses: balance("Operating expense", selected),
      profit:
        -balance("Service income", selected) -
        balance("Commission income", selected) -
        balance("Operating expense", selected),
      cash: balance("Cash"),
      clientBalance: balance("Client receivable"),
      commissionDue: balance("Commission receivable"),
    },
  });
}
async function entity(a: Actor, table: string, key: string) {
  return db()
    .prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=? FOR UPDATE`)
    .get(key, a.tenantId);
}
export async function financeWrite(a: Actor, body: unknown) {
  if (a.role !== "owner" || !(await canMutate(a)))
    return error("Only an active workspace owner can record financials.", 403);
  const base = z
    .object({
      action: z.enum([
        "invoice",
        "allocate-payment",
        "unallocate-payment",
        "refund",
        "credit",
        "expense",
        "commission",
        "commission-receipt",
        "employee-profile",
        "employee-allocation",
      ]),
      clientKey: z.uuid(),
    })
    .parse(body);
  // Full request payload is compared for safe retries; no request is executed twice.
  const payload = JSON.stringify(body);
  return withTransaction(async () => {
    await db()
      .prepare("SELECT id FROM tenants WHERE id=? FOR UPDATE")
      .get(a.tenantId);
    const previous = await db()
      .prepare(
        "SELECT * FROM finance_commands WHERE tenant_id=? AND client_key=?",
      )
      .get(a.tenantId, base.clientKey);
    if (previous)
      return previous.payload === payload
        ? NextResponse.json({
            ok: true,
            id: previous.result_id,
            replayed: true,
          })
        : error("This retry key already belongs to a different entry.", 409);
    const key = id();
    async function ledger(
      kind: string,
      source: string,
      entryDate: string,
      description: string,
      debit: string,
      credit: string,
      value: number,
      personId = "",
      projectId = "",
      employeeId = "",
    ) {
      await db()
        .prepare(
          "INSERT INTO finance_entries(id,tenant_id,source_kind,source_id,entry_date,description,person_id,project_id,employee_id,debit_account,credit_account,amount,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          a.tenantId,
          kind,
          source,
          entryDate,
          description,
          personId,
          projectId,
          employeeId,
          debit,
          credit,
          value,
          a.id,
        );
    }
    if (base.action === "invoice") {
      const v = z
        .object({
          personId: text,
          projectId: ref,
          number: text,
          title: text,
          date,
          installments: z.array(z.object({ date, amount })).min(1).max(36),
        })
        .parse(body);
      if (!(await entity(a, "people", v.personId)))
        return error("Applicant not found.", 404);
      if (v.projectId && !(await entity(a, "projects", v.projectId)))
        return error("Project not found.", 404);
      if (v.installments.some((i) => i.date < v.date))
        return error("An installment cannot be due before the invoice date.");
      const total = v.installments.reduce((s, i) => s + i.amount, 0);
      if (total > 100000000)
        return error("Invoice total exceeds the permitted amount.");
      if (
        await db()
          .prepare(
            "SELECT id FROM finance_invoices WHERE tenant_id=? AND number=?",
          )
          .get(a.tenantId, v.number)
      )
        return error("This invoice number already exists.", 409);
      await db()
        .prepare(
          "INSERT INTO finance_invoices(id,tenant_id,person_id,project_id,number,title,issue_date,amount,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          key,
          a.tenantId,
          v.personId,
          v.projectId,
          v.number,
          v.title,
          v.date,
          total,
          a.id,
        );
      for (const i of v.installments)
        await db()
          .prepare(
            "INSERT INTO finance_installments(id,invoice_id,tenant_id,due_date,amount) VALUES(?,?,?,?,?)",
          )
          .run(id(), key, a.tenantId, i.date, i.amount);
      await ledger(
        "invoice",
        key,
        v.date,
        v.number + " · " + v.title,
        "Client receivable",
        "Service income",
        total,
        v.personId,
        v.projectId,
      );
    } else if (base.action === "allocate-payment") {
      const v = z
          .object({ invoiceId: text, paymentId: text, amount })
          .parse(body),
        invoice = await entity(a, "finance_invoices", v.invoiceId),
        payment = await entity(a, "payments", v.paymentId);
      if (!invoice || !payment || invoice.person_id !== payment.person_id)
        return error("Invoice and receipt must belong to the same applicant.");
      const used = await db()
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS n FROM finance_payment_allocations WHERE tenant_id=? AND payment_id=?",
          )
          .get(a.tenantId, payment.id),
        refunds = await db()
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS n FROM finance_adjustments WHERE tenant_id=? AND source_id=? AND kind='refund'",
          )
          .get(a.tenantId, payment.id),
        allocated = await db()
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS n FROM finance_payment_allocations WHERE tenant_id=? AND invoice_id=?",
          )
          .get(a.tenantId, invoice.id),
        credits = await db()
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS n FROM finance_adjustments WHERE tenant_id=? AND source_id=? AND kind='credit'",
          )
          .get(a.tenantId, invoice.id);
      if (
        v.amount > payment.amount - used!.n - refunds!.n ||
        v.amount > invoice.amount - allocated!.n - credits!.n
      )
        return error(
          "Allocation exceeds the unallocated receipt or invoice balance.",
        );
      await db()
        .prepare(
          "INSERT INTO finance_payment_allocations(id,tenant_id,invoice_id,payment_id,amount,created_by) VALUES(?,?,?,?,?,?)",
        )
        .run(key, a.tenantId, invoice.id, payment.id, v.amount, a.id);
    } else if (base.action === "unallocate-payment") {
      const v = z.object({ allocationId: text }).parse(body),
        allocation = await entity(
          a,
          "finance_payment_allocations",
          v.allocationId,
        );
      if (!allocation) return error("Payment match not found.", 404);
      await db()
        .prepare(
          "DELETE FROM finance_payment_allocations WHERE id=? AND tenant_id=?",
        )
        .run(v.allocationId, a.tenantId);
    } else if (base.action === "refund" || base.action === "credit") {
      const v = z
          .object({ sourceId: text, amount, date, reason: text })
          .parse(body),
        source = await entity(
          a,
          base.action === "refund" ? "payments" : "finance_invoices",
          v.sourceId,
        );
      if (!source) return error("Source record not found.", 404);
      const used = await db()
        .prepare(
          "SELECT COALESCE(SUM(amount),0) AS n FROM finance_adjustments WHERE tenant_id=? AND source_id=? AND kind=?",
        )
        .get(a.tenantId, v.sourceId, base.action);
      const allocation = await db()
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS n FROM finance_payment_allocations WHERE tenant_id=? AND ${base.action === "refund" ? "payment_id" : "invoice_id"}=?`,
        )
        .get(a.tenantId, v.sourceId);
      if (v.amount > source.amount - used!.n - allocation!.n)
        return error(
          "Adjustment exceeds the unallocated balance. Paid invoices need payment allocation released before a credit/refund.",
        );
      await db()
        .prepare(
          "INSERT INTO finance_adjustments(id,tenant_id,kind,source_id,amount,entry_date,reason,created_by) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          key,
          a.tenantId,
          base.action,
          v.sourceId,
          v.amount,
          v.date,
          v.reason,
          a.id,
        );
      await ledger(
        base.action,
        key,
        v.date,
        v.reason,
        base.action === "refund" ? "Client receivable" : "Service income",
        base.action === "refund" ? "Cash" : "Client receivable",
        v.amount,
        source.person_id,
        source.project_id || "",
      );
    } else if (base.action === "expense") {
      const v = z
        .object({
          amount,
          date,
          description: text,
          personId: ref,
          projectId: ref,
          employeeId: ref,
        })
        .parse(body);
      if (v.personId && !(await entity(a, "people", v.personId)))
        return error("Applicant not found.", 404);
      if (v.projectId && !(await entity(a, "projects", v.projectId)))
        return error("Project not found.", 404);
      if (
        v.employeeId &&
        !(await db()
          .prepare(
            "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? AND role IN ('owner','consultant','platform_admin')",
          )
          .get(a.tenantId, v.employeeId))
      )
        return error("Employee not found.", 404);
      await ledger(
        "expense",
        key,
        v.date,
        v.description,
        "Operating expense",
        "Cash",
        v.amount,
        v.personId,
        v.projectId,
        v.employeeId,
      );
    } else if (base.action === "commission") {
      const v = z
          .object({
            applicationId: text,
            institution: text,
            reference: text,
            amount,
            date,
            expectedDate: date,
          })
          .parse(body),
        app = await entity(a, "applications", v.applicationId);
      if (!app) return error("Application not found.", 404);
      if (v.expectedDate < v.date)
        return error("Expected payment cannot be before the earned date.");
      if (
        await db()
          .prepare(
            "SELECT id FROM finance_commissions WHERE tenant_id=? AND reference=?",
          )
          .get(a.tenantId, v.reference)
      )
        return error("Commission reference already exists.", 409);
      await db()
        .prepare(
          "INSERT INTO finance_commissions(id,tenant_id,application_id,institution,reference,amount,earned_date,expected_date,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          key,
          a.tenantId,
          app.id,
          v.institution,
          v.reference,
          v.amount,
          v.date,
          v.expectedDate,
          a.id,
        );
      await ledger(
        "commission",
        key,
        v.date,
        v.institution + " · " + v.reference,
        "Commission receivable",
        "Commission income",
        v.amount,
        app.person_id,
      );
    } else if (base.action === "commission-receipt") {
      const v = z
          .object({ commissionId: text, amount, date, reference: text })
          .parse(body),
        c = await entity(a, "finance_commissions", v.commissionId);
      if (!c) return error("Commission not found.", 404);
      const used = await db()
        .prepare(
          "SELECT COALESCE(SUM(amount),0) AS n FROM finance_commission_receipts WHERE tenant_id=? AND commission_id=?",
        )
        .get(a.tenantId, c.id);
      if (v.amount > c.amount - used!.n)
        return error("Receipt exceeds commission due.");
      await db()
        .prepare(
          "INSERT INTO finance_commission_receipts(id,tenant_id,commission_id,amount,entry_date,reference,created_by) VALUES(?,?,?,?,?,?,?)",
        )
        .run(key, a.tenantId, c.id, v.amount, v.date, v.reference, a.id);
      const app = await entity(a, "applications", c.application_id);
      await ledger(
        "commission-receipt",
        key,
        v.date,
        v.reference,
        "Cash",
        "Commission receivable",
        v.amount,
        app!.person_id,
      );
    } else if (base.action === "employee-profile") {
      const v = z
        .object({
          userId: text,
          monthlySalary: nonnegative,
          monthlyOverhead: nonnegative,
          revision: z.number().int().nonnegative(),
        })
        .parse(body);
      if (
        !(await db()
          .prepare(
            "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? AND role IN ('owner','consultant','platform_admin')",
          )
          .get(a.tenantId, v.userId))
      )
        return error("Employee not found.", 404);
      const current = await db()
        .prepare(
          "SELECT revision FROM employee_cost_profiles WHERE tenant_id=? AND user_id=?",
        )
        .get(a.tenantId, v.userId);
      if ((current?.revision || 0) !== v.revision)
        return error("Employee costs changed. Refresh first.", 409);
      await db()
        .prepare(
          "INSERT INTO employee_cost_profiles(tenant_id,user_id,monthly_salary,monthly_overhead) VALUES(?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET monthly_salary=excluded.monthly_salary,monthly_overhead=excluded.monthly_overhead,revision=employee_cost_profiles.revision+1",
        )
        .run(a.tenantId, v.userId, v.monthlySalary, v.monthlyOverhead);
    } else {
      const v = z
        .object({
          userId: text,
          type: z.enum(["applicant", "project"]),
          entityId: text,
          cost: nonnegative,
          revenue: nonnegative,
          date,
          note: text,
        })
        .refine((v) => v.cost > 0 || v.revenue > 0)
        .parse(body);
      if (
        !(await entity(
          a,
          v.type === "applicant" ? "people" : "projects",
          v.entityId,
        ))
      )
        return error("Case or project not found.", 404);
      if (
        !(await db()
          .prepare(
            "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? AND role IN ('owner','consultant','platform_admin')",
          )
          .get(a.tenantId, v.userId))
      )
        return error("Employee not found.", 404);
      await db()
        .prepare(
          "INSERT INTO employee_allocations(id,tenant_id,user_id,entity_type,entity_id,entry_date,cost,revenue,note,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          key,
          a.tenantId,
          v.userId,
          v.type,
          v.entityId,
          v.date,
          v.cost,
          v.revenue,
          v.note,
          a.id,
        );
    }
    await db()
      .prepare(
        "INSERT INTO finance_commands(tenant_id,client_key,payload,result_id) VALUES(?,?,?,?)",
      )
      .run(a.tenantId, base.clientKey, payload, key);
    await audit(
      a.tenantId,
      a.id,
      "recorded",
      "finance",
      key,
      "Recorded " + base.action,
    );
    return NextResponse.json({ ok: true, id: key });
  });
}
