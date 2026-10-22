"use client";
import { useState } from "react";
import { Users } from "lucide-react";
export default function WorkAssignment({
  type,
  id,
  writable,
}: {
  type: string;
  id: string;
  writable: boolean;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<{
      userIds: string[];
      revision: number;
      members: { id: string; name: string }[];
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
          `/api/workspace/assignments?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
        ),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      setData(j);
      setSelected(j.userIds);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            id,
            revision: data?.revision,
            userIds: selected,
          }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      await load();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button
        className="btn secondary small"
        type="button"
        disabled={busy}
        onClick={() => (open ? setOpen(false) : void load())}
      >
        <Users size={12} />
        {data?.userIds.length ? `${data.userIds.length} assigned` : "Assign team"}
      </button>
      {open && data && (
        <div
          style={{
            padding: 12,
            border: "1px solid #dde4d7",
            borderRadius: 10,
            marginTop: 7,
            background: "#fbfcf8",
          }}
        >
          <strong style={{ fontSize: 12 }}>Responsible team members</strong>
          {data.members.map((m) => (
            <label
              key={m.id}
              style={{
                display: "flex",
                gap: 7,
                alignItems: "center",
                fontSize: 12,
                margin: "8px 0",
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                disabled={!writable || busy}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, m.id]
                      : selected.filter((id) => id !== m.id),
                  )
                }
              />
              {m.name}
            </label>
          ))}
          <button
            type="button"
            className="btn primary small"
            disabled={!writable || busy}
            onClick={() => void save()}
          >
            Save team
          </button>
        </div>
      )}
      {error && (
        <p role="alert" style={{ fontSize: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
