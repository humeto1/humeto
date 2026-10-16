"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, Plus, History, LoaderCircle } from "lucide-react";
import { sections } from "@/lib/sections";
type Requirement = {
  id: string;
  label: string;
  required: number;
  status: string;
  note: string;
  section_key: string;
};
export default function ApplicationChecklist({
  applicationId,
  staff,
  writable,
  onChange,
}: {
  applicationId: string;
  staff: boolean;
  writable: boolean;
  onChange: () => void;
}) {
  const [items, setItems] = useState<Requirement[]>([]),
    [snapshots, setSnapshots] = useState<{ id: string; created_at: string }[]>(
      [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [adding, setAdding] = useState(false);
  async function load() {
    const r = await fetch("/api/workspace/applications/" + applicationId);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setItems(d.requirements);
    setSnapshots(d.snapshots);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [applicationId]);
  async function save(item: Requirement, status: string) {
    let note = item.note;
    if (status === "Waived") {
      note =
        window.prompt(
          "Why is this working-checklist item waived?",
          item.note,
        ) || "";
      if (!note.trim()) return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace/requirements/" + item.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const reviewed = items.filter((i) =>
    ["Reviewed", "Waived"].includes(i.status),
  ).length;
  return (
    <section className="application-checklist">
      <div className="checklist-title">
        <h3>
          <CheckCircle2 size={17} />
          Working checklist
        </h3>
        <span>
          {reviewed} / {items.length} reviewed or waived
        </span>
      </div>
      <p>
        Agency preparation items, not a verified official country checklist.
        Required items must be reviewed or explicitly waived before staff mark
        the case Ready.
      </p>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {items.map((item) => (
        <div className="checklist-item" key={item.id}>
          <div>
            <strong>{item.label}</strong>
            <small>
              {item.required ? "Required working item" : "Optional"} ·{" "}
              {sections.find((s) => s.key === item.section_key)?.title ||
                "General"}
              {item.note ? " · " + item.note : ""}
            </small>
          </div>
          <select
            aria-label={"Review state for " + item.label}
            disabled={busy || !writable}
            value={item.status}
            onChange={(e) => void save(item, e.target.value)}
          >
            {(staff
              ? ["Pending", "Provided", "Reviewed", "Waived"]
              : ["Pending", "Provided"]
            ).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      ))}
      {staff && writable && (
        <button className="btn ghost small" onClick={() => setAdding(!adding)}>
          <Plus size={13} />
          Add a checklist item
        </button>
      )}
      {adding && (
        <form
          className="checklist-add"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            try {
              const r = await fetch("/api/workspace/requirements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  applicationId,
                  label: f.get("label"),
                  sectionKey: f.get("sectionKey"),
                  required: f.get("required") === "on",
                }),
              });
              const d = await r.json();
              if (!r.ok) throw new Error(d.error);
              await load();
              setAdding(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            What needs preparing?
            <input name="label" required minLength={2} />
          </label>
          <label>
            Related group
            <select name="sectionKey">
              <option value="">General</option>
              {sections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-check">
            <input type="checkbox" name="required" defaultChecked />
            Required for this working checklist
          </label>
          <button className="btn secondary small" disabled={busy}>
            Add item
          </button>
        </form>
      )}
      {snapshots.length > 0 && (
        <div className="snapshot-list">
          <strong>
            <History size={13} />
            Saved preparation snapshots
          </strong>
          {snapshots.slice(0, 4).map((s) => (
            <small key={s.id}>
              {s.created_at} · {s.id.slice(0, 8)}
            </small>
          ))}
        </div>
      )}
    </section>
  );
}
