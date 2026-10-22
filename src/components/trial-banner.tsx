"use client";
import { useState } from "react";
import {
  subscriptionAccess,
  trialDaysLeft,
} from "@/lib/subscription-access.mjs";
export default function TrialBanner({
  subscription: s,
  owner,
  now,
}: {
  subscription: { status: string; expires_at: string };
  owner: boolean;
  now: number;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const writable = subscriptionAccess(s, now),
    days = trialDaysLeft(s, now);
  if (s.status !== "trial" && writable) return null;
  async function request() {
    setBusy(true);
    try {
      const r = await fetch("/api/workspace/billing/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const v = await r.json();
      setMessage(v.message || v.error);
    } catch {
      setMessage("Unable to send the request. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="trial-banner"
      aria-label="Subscription status"
      role="status"
    >
      <div>
        <strong>
          {writable
            ? `Your free trial · ${days} ${days === 1 ? "day" : "days"} left`
            : "Upgrade to continue working"}
        </strong>
        <p>
          {writable
            ? `Explore Humeto until ${new Date(s.expires_at).toLocaleString()}. No automatic charges.`
            : "Your workspace is read-only. You can still view your information. Payment checkout is coming soon; request activation from your administrator."}
        </p>
        {message && <p>{message}</p>}
      </div>
      {owner && (
        <button
          className="btn secondary small"
          disabled={busy || !!message}
          onClick={request}
        >
          {busy
            ? "Sending…"
            : message
              ? "Request recorded"
              : "Request activation"}
        </button>
      )}
    </section>
  );
}
