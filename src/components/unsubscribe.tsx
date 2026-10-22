"use client";
import { useState } from "react";
export default function Unsubscribe({ token }: { token: string }) {
  const [done, setDone] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await fetch(
        "/api/email/unsubscribe?token=" + encodeURIComponent(token),
        { method: "POST" },
      );
      if (!r.ok)
        throw Error(
          "This unsubscribe link is invalid. Sign in to manage your email preferences.",
        );
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="email-action-page">
      <a href="/" className="app-logo">
        humeto.
      </a>
      <section className="panel settings-panel">
        <h1>{done ? "You’re unsubscribed" : "Manage Humeto emails"}</h1>
        <p>
          {done
            ? "You will no longer receive marketing or optional notification emails."
            : "Unsubscribe from marketing and optional notifications. You can change your preferences anytime in Settings."}
        </p>
        <p>
          Verification and password recovery emails remain available when you
          request them.
        </p>
        {error && <p role="alert">{error}</p>}
        {!done && (
          <button
            className="btn primary"
            disabled={busy || !token}
            onClick={submit}
          >
            {busy ? "Updating…" : "Unsubscribe"}
          </button>
        )}
        <p>
          <a href="/login">Sign in to Humeto</a>
        </p>
      </section>
    </main>
  );
}
