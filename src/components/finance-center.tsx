"use client";
import { useEffect, useState, useCallback } from "react";
import { Download, Plus, Wallet, RefreshCw } from "lucide-react";
import type { Person, Application, Workstream } from "@/lib/types";
import { money } from "@/lib/pipeline";
import styles from "./finance-center.module.css";
type Row = Record<string, any>;
type Data = {
  summary: Record<string, number>;
  entries: Row[];
  invoices: Row[];
  payments: Row[];
  commissions: Row[];
  employees: Row[];
  allocations: Row[];
  installments: Row[];
  adjustments: Row[];
  paymentAllocations: Row[];
};
const today = () => new Date().toLocaleDateString("en-CA");
const moneyLabel = (n: number) => "PKR " + money(n);
const actions = [
  ["invoice", "Invoice & installments"],
  ["allocate-payment", "Match a receipt"],
  ["refund", "Refund"],
  ["credit", "Credit note"],
  ["expense", "Expense / salary paid"],
  ["commission", "Earned commission"],
  ["commission-receipt", "Commission received"],
  ["employee-profile", "Employee cost profile"],
  ["employee-allocation", "Fixed case/project allocation"],
] as const;
export default function FinanceCenter({
  people,
  applications,
  projects,
  writable,
  onChange,
}: {
  people: Person[];
  applications: Application[];
  projects: Workstream[];
  writable: boolean;
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [month, setMonth] = useState(""),
    [tab, setTab] = useState("overview"),
    [action, setAction] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [employee, setEmployee] = useState(""),
    [entityType, setEntityType] = useState("applicant"),
    [installments, setInstallments] = useState([{ date: today(), amount: "" }]),
    [clientKey, setClientKey] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/workspace/finance?month=" + month, {
        cache: "no-store",
      }),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    setData(j);
  }, [month]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  function begin(value: string) {
    setAction(value);
    setError("");
    setNotice("");
    setClientKey(crypto.randomUUID());
    setInstallments([{ date: today(), amount: "" }]);
    setEmployee("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget),
      payload: Row = { action, clientKey };
    for (const [key, value] of form) payload[key] = String(value);
    for (const key of [
      "amount",
      "cost",
      "revenue",
      "monthlySalary",
      "monthlyOverhead",
    ])
      if (key in payload) payload[key] = Number(payload[key]);
    if (action === "invoice")
      payload.installments = installments.map((i) => ({
        date: i.date,
        amount: Number(i.amount),
      }));
    if (action === "employee-profile")
      payload.revision =
        data?.employees.find((e) => e.id === employee)?.revision || 0;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace/finance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      await load();
      await onChange();
      setAction("");
      setNotice("Saved to your financial records.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download(name: string, content: string, type = "text/csv") {
    const url = URL.createObjectURL(new Blob([content], { type })),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportLedger() {
    if (!data) return;
    const rows = [
      ["Date", "Description", "Debit account", "Credit account", "Amount PKR"],
      ...data.entries.map((e) => [
        e.entry_date,
        e.description,
        e.debit_account,
        e.credit_account,
        e.amount,
      ]),
    ];
    download(
      "humeto-ledger.csv",
      rows
        .map((r) =>
          r
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/"/g, '""')
                  .replace(/^[=+@-]/, "'$&") +
                '"',
            )
            .join(","),
        )
        .join("\r\n"),
    );
  }
  function invoiceDownload(i: Row) {
    const esc = (s: unknown) =>
      String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      );
    const schedule = data!.installments.filter((s) => s.invoice_id === i.id);
    download(
      `invoice-${i.number.replace(/[^a-z0-9-]/gi, "_")}.html`,
      `<!doctype html><meta charset="utf-8"><title>Invoice ${esc(i.number)}</title><style>body{font:16px system-ui;max-width:760px;margin:60px auto;color:#243b30}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}small{color:#666}@media print{button{display:none}}</style><h1>Invoice ${esc(i.number)}</h1><p>${esc(i.person_name)} · Issued ${esc(i.issue_date)}</p><h2>${esc(i.title)}</h2><h2>${moneyLabel(i.amount)}</h2><table><tr><th>Installment due</th><th>Amount</th></tr>${schedule.map((s) => `<tr><td>${esc(s.due_date)}</td><td>${moneyLabel(s.amount)}</td></tr>`).join("")}</table><p>Matched payments: ${moneyLabel(i.paid)} · Credits: ${moneyLabel(i.credited)} · Balance: ${moneyLabel(Math.max(0, i.amount - i.paid - i.credited))}</p><small>PKR · Exported from Humeto. Use your browser’s Print → Save as PDF.</small>`,
      "text/html",
    );
  }
  async function unmatch(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace/finance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "unallocate-payment",
            clientKey: crypto.randomUUID(),
            allocationId: id,
          }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const select = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
    required = true,
  ) => (
    <label>
      {label}
      <select name={name} required={required}>
        <option value="">{required ? "Choose…" : "None / general"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const input = (
    name: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={type === "date" ? today() : undefined}
        min={type === "number" ? 1 : undefined}
        max={type === "number" ? 100000000 : undefined}
      />
    </label>
  );
  const personOptions = people.map((p) => ({ value: p.id, label: p.name })),
    employeeOptions = (data?.employees || []).map((e) => ({
      value: e.id,
      label: e.name,
    })),
    projectOptions = projects.map((p) => ({ value: p.id, label: p.title }));
  if (!data)
    return (
      <section className="panel" style={{ padding: 30 }}>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">Loading financials…</p>
        )}
      </section>
    );
  const s = data.summary;
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className="eyebrow">THE BUSINESS BEHIND THE PROGRESS</span>
          <h1>Know where you stand.</h1>
          <p>
            Invoices, client balances, commissions and team contribution in one
            place.
          </p>
        </div>
        <div className={styles.actions}>
          <label>
            Report month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <button className="btn secondary small" onClick={() => setMonth("")}>
            All time
          </button>
          <button className="btn secondary small" onClick={exportLedger}>
            <Download size={14} />
            Export ledger
          </button>
        </div>
      </header>
      <div className={styles.cards}>
        {[
          ["Service income", s.serviceIncome],
          ["Commission income", s.commissionIncome],
          ["Recorded expenses", s.expenses],
          ["Net profit / loss", s.profit],
        ].map(([label, value]) => (
          <section key={label}>
            <small>{label}</small>
            <strong>{moneyLabel(Number(value))}</strong>
          </section>
        ))}
      </div>
      <p className={styles.note}>
        P&L recognizes issued invoices and explicitly earned commissions, less
        credit notes and recorded expenses. Receipts and refunds affect cash and
        client balances. Salary profiles and fixed allocations are management
        estimates; record salary payments as expenses once.
      </p>
      <nav className="segmented" aria-label="Finance views">
        {[
          ["overview", "Balances"],
          ["invoices", "Invoices"],
          ["receipts", "Receipts & refunds"],
          ["commissions", "Commissions"],
          ["team", "Team profitability"],
          ["ledger", "Debit / credit ledger"],
        ].map(([key, title]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={tab === key ? "active" : ""}
          >
            {title}
          </button>
        ))}
      </nav>
      <div className={styles.toolbar}>
        <select
          aria-label="New financial record"
          value={action}
          onChange={(e) => begin(e.target.value)}
          disabled={!writable || busy}
        >
          <option value="">Add a financial record…</option>
          {actions.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="btn secondary small"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {action && (
        <form className={styles.form} onSubmit={submit}>
          <h2>{actions.find((a) => a[0] === action)?.[1]}</h2>
          <div className={styles.fields}>
            {action === "invoice" && (
              <>
                {select("personId", "Applicant / client", personOptions)}
                {select("projectId", "Project", projectOptions, false)}
                {input("number", "Invoice number")}
                {input("title", "Service description")}
                {input("date", "Invoice date", "date")}
                <div className={styles.schedule}>
                  <h3>Installments</h3>
                  {installments.map((i, index) => (
                    <div key={index}>
                      <input
                        aria-label={`Installment ${index + 1} due date`}
                        type="date"
                        required
                        value={i.date}
                        onChange={(e) =>
                          setInstallments((old) =>
                            old.map((x, n) =>
                              n === index ? { ...x, date: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`Installment ${index + 1} amount`}
                        type="number"
                        required
                        min="1"
                        max="100000000"
                        placeholder="PKR"
                        value={i.amount}
                        onChange={(e) =>
                          setInstallments((old) =>
                            old.map((x, n) =>
                              n === index
                                ? { ...x, amount: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="btn secondary small"
                        disabled={installments.length === 1}
                        onClick={() =>
                          setInstallments((old) =>
                            old.filter((_, n) => n !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn secondary small"
                    disabled={installments.length >= 36}
                    onClick={() =>
                      setInstallments([
                        ...installments,
                        { date: today(), amount: "" },
                      ])
                    }
                  >
                    <Plus size={13} />
                    Add installment
                  </button>
                </div>
              </>
            )}
            {action === "allocate-payment" && (
              <>
                {select(
                  "invoiceId",
                  "Invoice",
                  data.invoices.map((i) => ({
                    value: i.id,
                    label: `${i.number} · ${i.person_name} · remaining ${moneyLabel(i.amount - i.paid - i.credited)}`,
                  })),
                )}
                {select(
                  "paymentId",
                  "Receipt",
                  data.payments.map((p) => ({
                    value: p.id,
                    label: `${p.reference} · ${p.person_name} · available ${moneyLabel(p.amount - p.allocated - p.refunded)}`,
                  })),
                )}
                {input("amount", "Amount to match (PKR)", "number")}
              </>
            )}
            {["refund", "credit"].includes(action) && (
              <>
                {select(
                  "sourceId",
                  action === "refund" ? "Original receipt" : "Invoice",
                  action === "refund"
                    ? data.payments.map((p) => ({
                        value: p.id,
                        label: `${p.person_name} · ${p.reference} · available ${moneyLabel(p.amount - p.refunded - p.allocated)}`,
                      }))
                    : data.invoices.map((i) => ({
                        value: i.id,
                        label: `${i.number} · ${i.person_name} · available ${moneyLabel(i.amount - i.paid - i.credited)}`,
                      })),
                )}
                {input("amount", "Amount (PKR)", "number")}
                {input("date", "Adjustment date", "date")}
                {input("reason", "Reason / reference")}
                <p className={styles.note}>
                  Unmatch any receipt allocation first if you need to credit a
                  paid invoice and refund it. A refund records money returned; a
                  credit note reduces invoiced income.
                </p>
              </>
            )}
            {action === "expense" && (
              <>
                {input("description", "Description / salary month / reference")}
                {input("amount", "Amount paid (PKR)", "number")}
                {input("date", "Payment date", "date")}
                {select("personId", "Related client", personOptions, false)}
                {select("projectId", "Related project", projectOptions, false)}
                {select("employeeId", "Employee", employeeOptions, false)}
              </>
            )}
            {action === "commission" && (
              <>
                {select(
                  "applicationId",
                  "Application",
                  applications.map((a) => ({
                    value: a.id,
                    label: `${a.person_name} · ${a.institution || a.country} · ${a.program}`,
                  })),
                )}
                {input("institution", "Paying institution / partner")}
                {input("reference", "Agreement / earned commission reference")}
                {input("amount", "Earned amount (PKR)", "number")}
                {input("date", "Earned date", "date")}
                {input("expectedDate", "Expected payment date", "date")}
                <p className={styles.note}>
                  Record only a confirmed earned entitlement here. Tentative
                  incentives remain on the applicant’s fee agreement.
                </p>
              </>
            )}
            {action === "commission-receipt" && (
              <>
                {select(
                  "commissionId",
                  "Earned commission",
                  data.commissions.map((c) => ({
                    value: c.id,
                    label: `${c.institution} · ${c.person_name} · due ${moneyLabel(c.amount - c.received)}`,
                  })),
                )}
                {input("amount", "Amount received (PKR)", "number")}
                {input("date", "Received date", "date")}
                {input("reference", "Bank / receipt reference")}
              </>
            )}
            {action === "employee-profile" && (
              <>
                <label>
                  Employee
                  <select
                    name="userId"
                    required
                    value={employee}
                    onChange={(e) => setEmployee(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {employeeOptions.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Monthly salary budget (PKR)
                  <input
                    key={employee + "salary"}
                    type="number"
                    min="0"
                    max="100000000"
                    required
                    name="monthlySalary"
                    defaultValue={
                      data.employees.find((e) => e.id === employee)
                        ?.monthly_salary || 0
                    }
                  />
                </label>
                <label>
                  Monthly overhead budget (PKR)
                  <input
                    key={employee + "overhead"}
                    type="number"
                    min="0"
                    max="100000000"
                    required
                    name="monthlyOverhead"
                    defaultValue={
                      data.employees.find((e) => e.id === employee)
                        ?.monthly_overhead || 0
                    }
                  />
                </label>
              </>
            )}
            {action === "employee-allocation" && (
              <>
                {select("userId", "Employee", employeeOptions)}
                <label>
                  Allocate to
                  <select
                    name="type"
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value)}
                  >
                    <option value="applicant">Case / applicant</option>
                    <option value="project">Project</option>
                  </select>
                </label>
                {select(
                  "entityId",
                  entityType === "applicant" ? "Case" : "Project",
                  entityType === "applicant" ? personOptions : projectOptions,
                )}
                <label>
                  Fixed cost allocation (PKR)
                  <input
                    type="number"
                    name="cost"
                    min="0"
                    max="100000000"
                    defaultValue="0"
                    required
                  />
                </label>
                <label>
                  Fixed attributed revenue (PKR)
                  <input
                    type="number"
                    name="revenue"
                    min="0"
                    max="100000000"
                    defaultValue="0"
                    required
                  />
                </label>
                {input("date", "Allocation date", "date")}
                {input("note", "Allocation basis / note")}
                <p className={styles.note}>
                  Management allocation only. This does not create a second
                  expense or additional company revenue. Use fixed agreed
                  amounts, not timer hours.
                </p>
              </>
            )}
          </div>
          <div className={styles.actions}>
            <button className="btn primary" disabled={busy || !writable}>
              Save record
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => setAction("")}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {tab === "overview" && (
        <>
          <div className={styles.cards}>
            {[
              ["Tracked cash movement", s.cash],
              ["Net client receivable / credit", s.clientBalance],
              ["Commission still due", s.commissionDue],
            ].map(([label, value]) => (
              <section key={label}>
                <Wallet size={19} />
                <small>{label}</small>
                <strong>{moneyLabel(Number(value))}</strong>
              </section>
            ))}
          </div>
          <section className={styles.panel}>
            <h2>Client balances</h2>
            <p className={styles.note}>
              All-time balances from recorded transactions. A negative balance
              is a client credit. This is tracked movement, not your bank’s
              opening or reconciled closing balance.
            </p>
            {people.map((p) => {
              const earned = data.invoices
                  .filter((i) => i.person_id === p.id)
                  .reduce((s, i) => s + i.amount - i.credited, 0),
                paid = data.payments
                  .filter((r) => r.person_id === p.id)
                  .reduce((s, r) => s + r.amount - r.refunded, 0);
              return (
                <div className={styles.row} key={p.id}>
                  <strong>{p.name}</strong>
                  <span>Invoiced {moneyLabel(earned)}</span>
                  <span>Net received {moneyLabel(paid)}</span>
                  <b>{moneyLabel(earned - paid)}</b>
                </div>
              );
            })}
          </section>
        </>
      )}
      {tab === "invoices" && (
        <section className={styles.panel}>
          <h2>Invoices & installment schedules</h2>
          {data.invoices.length ? (
            data.invoices.map((i) => (
              <article key={i.id} className={styles.record}>
                <div className={styles.row}>
                  <strong>
                    {i.number} · {i.person_name}
                  </strong>
                  <b>{moneyLabel(i.amount)}</b>
                </div>
                <p>
                  {i.title} · issued {i.issue_date}
                </p>
                <p>
                  Matched {moneyLabel(i.paid)} · Credits{" "}
                  {moneyLabel(i.credited)} · Balance{" "}
                  {moneyLabel(Math.max(0, i.amount - i.paid - i.credited))}
                </p>
                {(() => {
                  let applied = i.paid + i.credited;
                  return data.installments
                    .filter((s) => s.invoice_id === i.id)
                    .map((s) => {
                      const remaining = Math.max(0, s.amount - applied);
                      applied = Math.max(0, applied - s.amount);
                      return (
                        <p
                          key={s.id}
                          className={
                            remaining && s.due_date < today()
                              ? styles.overdue
                              : styles.note
                          }
                        >
                          Due {s.due_date} · {moneyLabel(s.amount)} ·{" "}
                          {remaining
                            ? `${moneyLabel(remaining)} remaining`
                            : "Covered"}
                        </p>
                      );
                    });
                })()}
                <button
                  className="btn secondary small"
                  onClick={() => invoiceDownload(i)}
                >
                  <Download size={13} />
                  Download printable invoice
                </button>
              </article>
            ))
          ) : (
            <p>
              Create an invoice above to begin. Existing fee agreements remain
              estimates until invoiced.
            </p>
          )}
        </section>
      )}
      {tab === "receipts" && (
        <section className={styles.panel}>
          <h2>Client receipts</h2>
          <p className={styles.note}>
            Add receipts from an applicant’s fee card. Match them here to an
            invoice.
          </p>
          {data.payments.map((p) => (
            <article className={styles.record} key={p.id}>
              <div className={styles.row}>
                <strong>
                  {p.person_name} · {p.reference}
                </strong>
                <b>{moneyLabel(p.amount)}</b>
              </div>
              <p>
                Matched {moneyLabel(p.allocated)} · Refunded{" "}
                {moneyLabel(p.refunded)} · Available{" "}
                {moneyLabel(p.amount - p.allocated - p.refunded)}
              </p>
              {data.paymentAllocations
                .filter((a) => a.payment_id === p.id)
                .map((a) => (
                  <div className={styles.row} key={a.id}>
                    <span>
                      {data.invoices.find((i) => i.id === a.invoice_id)?.number}{" "}
                      · {moneyLabel(a.amount)}
                    </span>
                    <button
                      className="btn secondary small"
                      disabled={!writable || busy}
                      onClick={() => void unmatch(a.id)}
                    >
                      Unmatch receipt
                    </button>
                  </div>
                ))}
            </article>
          ))}
          <h3>Refunds & credit notes</h3>
          {data.adjustments.length ? (
            data.adjustments.map((a) => (
              <div className={styles.row} key={a.id}>
                <span>
                  {a.entry_date} · {a.kind} · {a.reason}
                </span>
                <b>{moneyLabel(a.amount)}</b>
              </div>
            ))
          ) : (
            <p>No adjustments recorded.</p>
          )}
        </section>
      )}
      {tab === "commissions" && (
        <section className={styles.panel}>
          <h2>Earned, due and received</h2>
          {data.commissions.length ? (
            data.commissions.map((c) => (
              <article className={styles.record} key={c.id}>
                <div className={styles.row}>
                  <strong>
                    {c.institution} · {c.person_name}
                  </strong>
                  <b>{moneyLabel(c.amount)}</b>
                </div>
                <p>
                  {c.reference} · Earned {c.earned_date} · Expected{" "}
                  {c.expected_date}
                </p>
                <p>
                  Received {moneyLabel(c.received)} · Due{" "}
                  {moneyLabel(c.amount - c.received)}
                </p>
              </article>
            ))
          ) : (
            <p>
              Record an earned commission above when its conditions have been
              met.
            </p>
          )}
        </section>
      )}
      {tab === "team" && (
        <>
          <section className={styles.panel}>
            <h2>Fixed allocations · employee contribution</h2>
            <p className={styles.note}>
              These are manually attributed management figures for the selected
              period, not an automatic allocation of company profit. Monthly
              budget is shown separately.
            </p>
            {data.employees.map((e) => {
              const rows = data.allocations.filter((a) => a.user_id === e.id),
                cost = rows.reduce((s, a) => s + a.cost, 0),
                revenue = rows.reduce((s, a) => s + a.revenue, 0);
              return (
                <article className={styles.record} key={e.id}>
                  <div className={styles.row}>
                    <strong>{e.name}</strong>
                    <b>Attributed margin {moneyLabel(revenue - cost)}</b>
                  </div>
                  <p>
                    Monthly salary {moneyLabel(e.monthly_salary)} + overhead{" "}
                    {moneyLabel(e.monthly_overhead)}
                  </p>
                  <p>
                    Fixed cost {moneyLabel(cost)} · Attributed revenue{" "}
                    {moneyLabel(revenue)}
                  </p>
                  {rows.map((a) => (
                    <p key={a.id} className={styles.note}>
                      {a.entry_date} · {a.entity_name} · cost{" "}
                      {moneyLabel(a.cost)} / revenue {moneyLabel(a.revenue)} ·{" "}
                      {a.note}
                    </p>
                  ))}
                </article>
              );
            })}
          </section>
        </>
      )}
      {tab === "ledger" && (
        <section className={styles.panel}>
          <h2>Balanced debit / credit entries</h2>
          <div className={styles.table}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>PKR</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.entry_date}</td>
                    <td>{e.description}</td>
                    <td>{e.debit_account}</td>
                    <td>{e.credit_account}</td>
                    <td>{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.entries.length && <p>No entries in this period.</p>}
        </section>
      )}
    </div>
  );
}
