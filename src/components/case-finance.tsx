"use client";
import { useState, useRef } from "react";
import type { Finance } from "@/lib/pipeline";
import { money } from "@/lib/pipeline";
export default function CaseFinance({
  personId,
  finance,
  refresh,
  writable,
}: {
  personId: string;
  finance?: Finance;
  refresh: () => Promise<void>;
  writable: boolean;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const paymentKey = useRef(crypto.randomUUID());
  async function save(path: string, body: unknown, method: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace/case-finance/" + personId + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (path) paymentKey.current = crypto.randomUUID();
      await refresh();
      setNotice(
        path ? "Payment recorded in the ledger." : "Agreed fees updated.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="case-finance">
      <summary>
        Fees & university incentive{" "}
        <span className="paid">+{money(finance?.paid || 0)}</span>{" "}
        <span className="pending">−{money(finance?.pending || 0)}</span> PKR
      </summary>
      <p>
        Receipts contribute to paid totals. The university incentive is
        contingent and is kept separate from student fees.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form
        key={finance?.revision || 0}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save(
            "",
            {
              expected_fee: Number(f.get("total")),
              upfront_fee: Number(f.get("upfront")),
              incentive: Number(f.get("incentive")),
              timeline: f.get("timeline"),
              revision: finance?.revision || 0,
            },
            "PATCH",
          );
        }}
      >
        <div className="crm-fields">
          <label>
            Total agreed fee · PKR
            <input
              name="total"
              type="number"
              min="0"
              required
              defaultValue={finance?.expected_fee || 0}
            />
          </label>
          <label>
            Upfront target · PKR
            <input
              name="upfront"
              type="number"
              min="0"
              required
              defaultValue={finance?.upfront_fee || 0}
            />
          </label>
          <label>
            University incentive · PKR
            <input
              name="incentive"
              type="number"
              min="0"
              required
              defaultValue={finance?.incentive || 0}
            />
          </label>
          <label>
            Tentative timeline
            <input
              name="timeline"
              defaultValue={finance?.timeline || ""}
              maxLength={500}
            />
          </label>
        </div>
        <button className="btn secondary" disabled={busy || !writable}>
          Save agreed fees
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save(
            "/payment",
            {
              amount: Number(f.get("amount")),
              reference: f.get("reference"),
              clientKey: paymentKey.current,
            },
            "POST",
          );
        }}
      >
        <h3>Record a payment received</h3>
        <div className="crm-fields">
          <label>
            Amount · PKR
            <input name="amount" type="number" min="1" required />
          </label>
          <label>
            Receipt / transaction reference
            <input name="reference" required minLength={2} maxLength={200} />
          </label>
        </div>
        <button className="btn primary" disabled={busy || !writable}>
          Record receipt
        </button>
      </form>
    </details>
  );
}
