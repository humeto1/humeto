import "server-only";
import { db, id, withTransaction } from "./db";
export async function seedFinanceDemo() {
  if (process.env.HUMETO_LOCAL_DEMO !== "true") return;
  const d = db();
  if (
    !(await d
      .prepare(
        "SELECT id FROM people WHERE id='fatima' AND tenant_id='northstar'",
      )
      .get())
  )
    return;
  await withTransaction(async () => {
    await d
      .prepare("SELECT id FROM tenants WHERE id='northstar' FOR UPDATE")
      .get();
    if (
      await d
        .prepare("SELECT name FROM demo_migrations WHERE name='finance-v1'")
        .get()
    )
      return;
    await d
      .prepare(
        "INSERT INTO finance_invoices(id,tenant_id,person_id,number,title,issue_date,amount,created_by) VALUES('demo-finance-invoice','northstar','fatima','DEMO-2026-001','Illustrative admission support package','2026-10-18',100000,'ayesha')",
      )
      .run();
    for (const [date, amount] of [
      ["2026-10-18", 50000],
      ["2026-11-18", 50000],
    ])
      await d
        .prepare(
          "INSERT INTO finance_installments(id,invoice_id,tenant_id,due_date,amount) VALUES(?,'demo-finance-invoice','northstar',?,?)",
        )
        .run(id(), date, amount);
    if (
      await d
        .prepare(
          "SELECT id FROM payments WHERE id='demo-payment-fatima' AND tenant_id='northstar'",
        )
        .get()
    )
      await d
        .prepare(
          "INSERT INTO finance_payment_allocations(id,tenant_id,invoice_id,payment_id,amount,created_by) VALUES(?,'northstar','demo-finance-invoice','demo-payment-fatima',25000,'ayesha')",
        )
        .run(id());
    for (const [kind, source, description, person, debit, credit, amount] of [
      [
        "invoice",
        "demo-finance-invoice",
        "DEMO-2026-001 · Illustrative admission support",
        "fatima",
        "Client receivable",
        "Service income",
        100000,
      ],
      [
        "expense",
        "demo-finance-expense",
        "DEMO · illustrative operating expense",
        "",
        "Operating expense",
        "Cash",
        5000,
      ],
    ])
      await d
        .prepare(
          "INSERT INTO finance_entries(id,tenant_id,source_kind,source_id,entry_date,description,person_id,debit_account,credit_account,amount,created_by) VALUES(?,'northstar',?,?,'2026-10-18',?,?,?,?,?,'ayesha')",
        )
        .run(id(), kind, source, description, person, debit, credit, amount);
    await d
      .prepare(
        "INSERT INTO employee_cost_profiles(tenant_id,user_id,monthly_salary,monthly_overhead) VALUES('northstar','consultant',50000,10000) ON CONFLICT DO NOTHING",
      )
      .run();
    await d
      .prepare(
        "INSERT INTO employee_allocations(id,tenant_id,user_id,entity_type,entity_id,entry_date,cost,revenue,note,created_by) VALUES(?,'northstar','consultant','applicant','fatima','2026-10-18',10000,25000,'DEMO · fixed case allocation, illustrative only','ayesha')",
      )
      .run(id());
    await d
      .prepare("INSERT INTO demo_migrations(name) VALUES('finance-v1')")
      .run();
  });
}
