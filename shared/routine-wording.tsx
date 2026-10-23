"use client";
import React, { useState } from "react";
import type { Transport } from "./planning-hub";
export default function RoutineWording({
  routine: r,
  request,
  refresh,
  writable,
  history,
}: {
  routine: any;
  request: Transport;
  refresh: () => Promise<void>;
  writable: boolean;
  history: any[];
}) {
  const [text, setText] = useState<string>(
      (r.wording_variants || []).join("\n"),
    ),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="routine-wording">
      <summary>Fresh wording · {r.wording_enabled ? "on" : "off"}</summary>
      <p>
        <b>Permanent task:</b> {r.title}. Only the displayed wording changes;
        identity, meaning, schedule and tracking stay attached to this routine.
      </p>
      {r.wording_canonical && r.wording_canonical !== r.title && (
        <p role="alert">
          The permanent task name changed. Approve a new wording set before
          rotation resumes.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        disabled={busy || !writable}
        onClick={() =>
          void run(async () => {
            const v = await request("/api/workspace/planning", {
              action: "wording-generate",
              id: r.id,
            });
            setText(v.variants.join("\n"));
            setChecked(false);
            setNotice(
              "AI suggestions only. Review each line for the same meaning.",
            );
          })
        }
      >
        Suggest wording with AI
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await request("/api/workspace/planning", {
              action: "wording-approve",
              id: r.id,
              revision: r.wording_revision,
              canonicalTitle: r.title,
              variants: text
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
              reviewed: checked,
            });
            setNotice(
              "Approved. Future occurrences rotate these wordings; previous names remain in history.",
            );
          });
        }}
      >
        <label>
          Approved alternatives · one per line
          <textarea
            rows={5}
            maxLength={3000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setChecked(false);
            }}
            placeholder="Review pending enquiries\nCheck the enquiries waiting for review"
          />
        </label>
        <label className="planning-check">
          <input
            type="checkbox"
            required
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          I checked that every line preserves the original meaning and details.
        </label>
        <button disabled={busy || !writable || !checked}>
          Approve wording rotation
        </button>
      </form>
      {r.wording_revision > 0 && (
        <button
          disabled={busy || !writable}
          onClick={() =>
            void run(async () => {
              await request("/api/workspace/planning", {
                action: "wording-state",
                id: r.id,
                revision: r.wording_revision,
                enabled: !r.wording_enabled,
              });
            })
          }
        >
          {r.wording_enabled ? "Turn rotation off" : "Turn rotation on"}
        </button>
      )}
      <h4>Names used this week</h4>
      {history
        .filter((o) => o.series_id === r.id)
        .map((o) => (
          <p key={o.day}>
            {o.day}: {o.display_title || o.canonical_title || r.title}
            <small> · same routine · {o.state}</small>
          </p>
        ))}
    </details>
  );
}
