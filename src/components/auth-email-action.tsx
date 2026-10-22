"use client";
import { useState } from "react";
export default function AuthEmailAction({
  action,
  token = "",
}: {
  action: "verify-email" | "reset-password" | "forgot-password";
  token?: string;
}) {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const title =
    action === "verify-email"
      ? "Verify your email"
      : action === "reset-password"
        ? "Choose a new password"
        : "Reset your password";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    if (
      action === "reset-password" &&
      f.get("password") !== f.get("confirmation")
    ) {
      setError("Your passwords do not match.");
      setBusy(false);
      return;
    }
    try {
      const r = await fetch("/api/auth/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "forgot-password"
            ? { email: f.get("email") }
            : { token, password: f.get("password") || undefined },
        ),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setMessage(v.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="email-action-page">
      <a className="app-logo" href="/">
        humeto.
      </a>
      <section className="panel settings-panel">
        <h1>{title}</h1>
        {message ? (
          <p role="status">{message}</p>
        ) : (
          <form onSubmit={submit}>
            {action === "forgot-password" ? (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </label>
            ) : action === "verify-email" ? (
              <p>Confirm your email address to start your 15-day free trial.</p>
            ) : (
              <>
                <label>
                  New password
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    type="password"
                    name="confirmation"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            {error && <p role="alert">{error}</p>}
            <button
              className="btn primary"
              disabled={busy || (action !== "forgot-password" && !token)}
            >
              {busy
                ? "Please wait…"
                : action === "verify-email"
                  ? "Verify email"
                  : action === "reset-password"
                    ? "Save password"
                    : "Send reset link"}
            </button>
          </form>
        )}
        <p>
          <a href="/login">Back to sign in</a>
        </p>
        {action === "verify-email" && (
          <p>
            <a href="/signup">
              Need a new verification email? Return to signup or sign in to
              resend.
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
