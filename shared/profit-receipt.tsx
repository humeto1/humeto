"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { webApi, type Transport } from "./transport";
import { worldCurrencies } from "./currencies";
export type ProfitPrompt = {
  taskId: string;
  sessionId?: string;
  title?: string;
};
export function ProfitReceipt({
  prompt,
  request = webApi,
  onClose,
}: {
  prompt: ProfitPrompt;
  request?: Transport;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    receipt = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [currency, setCurrency] = useState("PKR");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="plan-action-dialog"
      aria-label="Actual profit received"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h3>Actual profit received</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await request("/api/work-profit", {
              id: receipt.current,
              taskId: prompt.taskId,
              ...(prompt.sessionId ? { sessionId: prompt.sessionId } : {}),
              amount: f.get("amount"),
              currency,
              day: f.get("day"),
              note: f.get("note") || "",
            });
            window.dispatchEvent(new Event("humeto-profit"));
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Amount received
          <input
            name="amount"
            type="number"
            min="0.01"
            max="999999999"
            step="0.01"
            required
            autoFocus
          />
        </label>
        <label>
          Currency
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {worldCurrencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Received date
          <input
            name="day"
            type="date"
            defaultValue={new Date().toLocaleDateString("en-CA")}
            required
          />
        </label>
        <label>
          Note
          <input name="note" maxLength={500} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Record received amount"}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Nothing received / Skip
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </dialog>,
    document.body,
  );
}
export function ProfitReceiptLauncher() {
  const [prompt, setPrompt] = useState<ProfitPrompt | null>(null);
  useEffect(() => {
    const on = (e: Event) => setPrompt((e as CustomEvent<ProfitPrompt>).detail);
    window.addEventListener("humeto-profit-prompt", on);
    return () => window.removeEventListener("humeto-profit-prompt", on);
  }, []);
  return prompt ? (
    <ProfitReceipt prompt={prompt} onClose={() => setPrompt(null)} />
  ) : null;
}
