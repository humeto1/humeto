"use client";
import { useState, useEffect } from "react";
type Event = {
  id: string;
  from_status: string;
  to_status: string;
  note: string;
  source_url: string;
  document_id: string;
  document_version: number;
  created_at: string;
};
export default function ApplicationEvidence({
  applicationId,
}: {
  applicationId: string;
}) {
  const [events, setEvents] = useState<Event[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workspace/applications/" + applicationId, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load status history.");
        setEvents((await r.json()).events || []);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [applicationId]);
  return (
    <details className="application-evidence">
      <summary>Status history & evidence · {events.length}</summary>
      {error && <p>{error}</p>}
      {!events.length && (
        <p>
          Future stage changes appear here. External application submission
          remains in its own portal.
        </p>
      )}
      {events.map((e) => (
        <article key={e.id}>
          <strong>
            {e.from_status} → {e.to_status}
          </strong>
          <small>{e.created_at} UTC</small>
          {e.note && <p>{e.note}</p>}
          {e.source_url && (
            <a href={e.source_url} target="_blank" rel="noreferrer">
              Open source link ↗
            </a>
          )}
          {e.document_id && (
            <a
              href={`/api/workspace/documents/${e.document_id}/download?version=${e.document_version}`}
              target="_blank"
              rel="noreferrer"
            >
              Supporting file · v{e.document_version}
            </a>
          )}
        </article>
      ))}
    </details>
  );
}
