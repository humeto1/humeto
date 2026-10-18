"use client";
import { useState, useEffect } from "react";
import { Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
type Stage = { key: string; title: string };
type Config = { revision: number; stages: Stage[] };
export default function PipelineSettings({
  settings,
  writable,
  onChange,
}: {
  settings: Record<string, Config>;
  writable: boolean;
  onChange: () => Promise<void>;
}) {
  const [kind, setKind] = useState("leads"),
    [draft, setDraft] = useState<Stage[]>([]),
    [replacements, setReplacements] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setDraft(settings[kind]?.stages || []);
    setReplacements({});
    setNotice("");
  }, [settings, kind]);
  const removed = (settings[kind]?.stages || []).filter(
    (s) => !draft.some((d) => d.key === s.key),
  );
  function reorder(index: number, delta: number) {
    setDraft((old) => {
      const v = [...old];
      [v[index], v[index + delta]] = [v[index + delta], v[index]];
      return v;
    });
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/workspace/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          revision: settings[kind]?.revision || 0,
          stages: draft,
          replacements,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      await onChange();
      setNotice(
        "Pipeline saved. Removed-stage cards were moved to your chosen destinations.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" style={{ padding: 24, marginBottom: 24 }}>
      <h2>Your stages, your workflow</h2>
      <p className="subtle">
        Rename, reorder, add or remove stages. Existing milestone behavior stays
        attached to its stage, even when you change the title.
      </p>
      <label>
        Pipeline
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          disabled={busy}
        >
          <option value="leads">Leads</option>
          <option value="applicants">Applicants</option>
          <option value="applications">Applications</option>
        </select>
      </label>
      <div style={{ display: "grid", gap: 8, margin: "16px 0" }}>
        {draft.map((s, i) => (
          <div
            key={s.key}
            style={{ display: "flex", gap: 7, alignItems: "center" }}
          >
            <input
              aria-label={`Stage title ${i + 1}`}
              value={s.title}
              maxLength={60}
              style={{ flex: 1, minWidth: 80 }}
              disabled={!writable || busy}
              onChange={(e) =>
                setDraft(
                  draft.map((d) =>
                    d.key === s.key ? { ...d, title: e.target.value } : d,
                  ),
                )
              }
            />
            <button
              className="btn secondary small"
              aria-label={`Move ${s.title} up`}
              disabled={!writable || busy || i === 0}
              onClick={() => reorder(i, -1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="btn secondary small"
              aria-label={`Move ${s.title} down`}
              disabled={!writable || busy || i === draft.length - 1}
              onClick={() => reorder(i, 1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="btn secondary small"
              aria-label={`Remove ${s.title}`}
              disabled={!writable || busy || draft.length === 1}
              onClick={() => setDraft(draft.filter((d) => d.key !== s.key))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {removed.map((s) => (
        <label key={s.key} style={{ display: "block", margin: "10px 0" }}>
          Move “{s.title}” cards to
          <select
            value={replacements[s.key] || ""}
            onChange={(e) =>
              setReplacements({ ...replacements, [s.key]: e.target.value })
            }
          >
            <option value="">Choose a destination</option>
            {draft.map((d) => (
              <option key={d.key} value={d.key}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="btn secondary small"
          disabled={!writable || busy || draft.length >= 30}
          onClick={() =>
            setDraft([
              ...draft,
              {
                key: "custom-" + crypto.randomUUID(),
                title: "New stage " + (draft.length + 1),
              },
            ])
          }
        >
          <Plus size={14} />
          Add stage
        </button>
        <button
          className="btn primary small"
          disabled={!writable || busy || !draft.length}
          onClick={() => void save()}
        >
          Save pipeline
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
