"use client";
import { useEffect, useState } from "react";
export default function EmailPreferences() {
  const [p, setP] = useState<{
      optionalNotifications: boolean;
      marketing: boolean;
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/email/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then(setP)
      .catch(() => setMessage("Email preferences could not be loaded."));
  }, []);
  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/email/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      setMessage(
        r.ok ? "Email preferences saved." : "Unable to save. Please retry.",
      );
    } catch {
      setMessage("Unable to save. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <h2>Email preferences</h2>
      <p>Choose which optional emails you receive from Humeto.</p>
      {p && (
        <>
          <label>
            <input
              type="checkbox"
              checked={p.optionalNotifications}
              onChange={(e) =>
                setP({ ...p, optionalNotifications: e.target.checked })
              }
            />{" "}
            Optional reminders and notifications
          </label>
          <label>
            <input
              type="checkbox"
              checked={p.marketing}
              onChange={(e) => setP({ ...p, marketing: e.target.checked })}
            />{" "}
            Product news and offers
          </label>
          <p className="tiny">
            Verification, password recovery and essential account security
            emails remain available.
          </p>
          <button
            className="btn secondary small"
            disabled={busy}
            onClick={save}
          >
            {busy ? "Saving…" : "Save preferences"}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
