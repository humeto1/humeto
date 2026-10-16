"use client";
import { useEffect, useState } from "react";
import { FolderOpen, ChevronRight } from "lucide-react";
type Run = {
  id: string;
  name: string;
  status: string;
  expected_count: number;
  processed_count: number;
  created_at: string;
};
export default function ImportHistory({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<Run[]>([]),
    [items, setItems] = useState<
      Record<string, { source_path: string; status: string }[]>
    >({});
  useEffect(() => {
    fetch("/api/workspace/imports")
      .then((r) => r.json())
      .then((d) => setRuns(d.runs || []))
      .catch(() => {});
  }, [refreshKey]);
  if (!runs.length) return null;
  return (
    <section className="import-history panel">
      <div className="panel-title">
        <h3>Recent selected-file imports</h3>
        <span>Original folder paths preserved</span>
      </div>
      {runs.map((run) => (
        <details
          key={run.id}
          onToggle={(e) => {
            if (e.currentTarget.open && !items[run.id])
              fetch("/api/workspace/imports/" + run.id)
                .then((r) => r.json())
                .then((d) =>
                  setItems((old) => ({ ...old, [run.id]: d.items || [] })),
                )
                .catch(() => {});
          }}
        >
          <summary>
            <FolderOpen size={16} />
            <span>
              <strong>{run.name}</strong>
              <small>
                {run.processed_count} / {run.expected_count} processed ·{" "}
                {run.status} · {run.created_at}
              </small>
            </span>
            <ChevronRight size={14} />
          </summary>
          <div>
            {items[run.id]?.map((item, i) => (
              <p key={item.source_path + i}>
                <span>{item.source_path}</span>
                <small>{item.status}</small>
              </p>
            )) || <p>Loading import records…</p>}
          </div>
        </details>
      ))}
    </section>
  );
}
