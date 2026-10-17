"use client";
import { useState, useEffect } from "react";
import { Calendar, ArrowUpRight } from "lucide-react";
import type { Lead } from "@/lib/pipeline";
export default function LeadFollowups({
  leads,
  refresh,
  writable,
}: {
  leads: Lead[];
  refresh: () => Promise<void>;
  writable: boolean;
}) {
  const [today, setToday] = useState(""),
    [zone, setZone] = useState(""),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setZone(tz);
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    setToday(
      ["year", "month", "day"]
        .map((k) => p.find((x) => x.type === k)?.value)
        .join("-"),
    );
  }, []);
  const open = leads.filter((l) => !l.person_id && l.stage !== "Lost");
  const due = open
    .filter((l) => l.follow_up && l.follow_up <= today)
    .sort((a, b) => a.follow_up.localeCompare(b.follow_up));
  const upcoming = open
    .filter((l) => l.follow_up > today)
    .sort((a, b) => a.follow_up.localeCompare(b.follow_up));
  const unset = open.filter((l) => !l.follow_up);
  async function schedule(l: Lead) {
    setBusy(l.id);
    setNotice("");
    try {
      const r = await fetch("/api/workspace/leads/" + l.id + "/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: l.revision }),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      await refresh();
      setNotice(
        v.replayed
          ? "This date already has a follow-up task. Find it in Tasks to-do."
          : "Follow-up task created. It is assigned to you; no email or WhatsApp message was sent.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <details className="lead-followups">
      <summary>
        <Calendar size={15} />
        Follow-up queue <b>{due.length} due</b>
        <span>
          {upcoming.length} upcoming · {unset.length} without dates
        </span>
      </summary>
      <p>
        Dates use {zone || "your browser timezone"}. Create a task to track the
        next conversation. Changing a lead’s date later does not silently
        reschedule an existing task.
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {[
        ["Due now", due],
        ["Upcoming", upcoming],
        ["Needs a date", unset],
      ].map(([title, items]) => (
        <section key={String(title)}>
          <h3>{String(title)}</h3>
          {(items as Lead[]).slice(0, 30).map((l) => (
            <div className="followup-row" key={l.id}>
              <div>
                <strong>{l.name}</strong>
                <small>
                  {l.email} · {l.stage}
                </small>
              </div>
              <span>{l.follow_up || "Set in lead details"}</span>
              {l.follow_up && (
                <button
                  className="btn secondary small"
                  disabled={!writable || !!busy}
                  onClick={() => void schedule(l)}
                >
                  {busy === l.id ? "Creating…" : "Create follow-up task"}
                </button>
              )}
            </div>
          ))}
          {!(items as Lead[]).length && <p>No leads in this group.</p>}
          {(items as Lead[]).length > 30 && (
            <p>
              Showing the first 30; all leads remain available on the board.
            </p>
          )}
        </section>
      ))}
      <a href="/workspace/tasks">
        Open Tasks to-do <ArrowUpRight size={13} />
      </a>
    </details>
  );
}
