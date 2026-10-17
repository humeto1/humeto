"use client";
import { useState } from "react";
export default function InquiryForm({
  token,
  institute,
}: {
  token: string;
  institute: string;
}) {
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="inquiry-page">
      <a className="app-logo" href="/">
        <span>h</span>humeto.
      </a>
      <section>
        <span className="eyebrow">YOUR NEXT CHAPTER</span>
        <h1>Let’s start with hello.</h1>
        <p>
          Share your interest with {institute}. You can add documents and
          detailed information after registration.
        </p>
        {sent ? (
          <div className="notice" role="status">
            Thank you. Your inquiry has been received. The team will follow up
            using the contact details you shared.
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch("/api/inquiry", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    token,
                    ...Object.fromEntries(f),
                    consent: f.get("consent") === "on",
                  }),
                });
                const result = await r.json();
                if (!r.ok) throw new Error(result.error);
                setSent(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {[
              ["name", "Your full name"],
              ["email", "Email"],
              ["phone", "Phone · optional"],
              ["destination", "Preferred destination · optional"],
              ["course", "Study interest · optional"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  name={key}
                  required={["name", "email"].includes(key)}
                  type={
                    key === "email" ? "email" : key === "phone" ? "tel" : "text"
                  }
                  maxLength={key === "name" ? 100 : key === "email" ? 254 : 200}
                />
              </label>
            ))}
            <label className="inquiry-trap" aria-hidden="true">
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <label className="consent">
              <input name="consent" type="checkbox" required />I agree to share
              these details with {institute} so their team can contact me about
              my inquiry.
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="btn primary full" disabled={busy}>
              {busy ? "Sending…" : "Send my inquiry →"}
            </button>
            <small>No documents or payment are needed here.</small>
          </form>
        )}
      </section>
    </main>
  );
}
