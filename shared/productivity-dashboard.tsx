"use client";
import { useEffect, useState } from "react";
import { webApi, type Transport } from "./transport";
import "./productivity.css";
const date = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const offset = (s: string, n: number) => {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return date(d);
};
const duration = (n: number) => `${(Number(n || 0) / 3600).toFixed(1)} h`;
export function ProductivityDashboard({
  request = webApi,
  onOpen,
  refreshKey,
  activeTaskIds,
}: {
  request?: Transport;
  onOpen: (id: string) => void;
  refreshKey?: string;
  activeTaskIds?: string[];
}) {
  const today = date(new Date()),
    [period, setPeriod] = useState("yesterday"),
    [start, setStart] = useState(offset(today, -1)),
    [end, setEnd] = useState(offset(today, -1)),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    const load = () =>
      request(
        `/api/productivity?start=${start}&end=${end}&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
      )
        .then((v) => {
          if (live) setData(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 60000);
    window.addEventListener("humeto-reminders", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("humeto-reminders", load);
      live = false;
    };
  }, [request, start, end, refreshKey]);
  const choose = (p: string) => {
    setPeriod(p);
    if (p === "custom") return;
    const last = p === "yesterday" ? offset(today, -1) : today;
    setEnd(last);
    setStart(
      p === "7" ? offset(today, -6) : p === "30" ? offset(today, -29) : last,
    );
  };
  return (
    <section className="productivity" aria-label="Productivity dashboard">
      <div className="productivity-heading">
        <div>
          <span className="eyebrow">YOUR PROGRESS, IN PERSPECTIVE</span>
          <h2>Make your time count.</h2>
          <p>Workspace tasks · your focused work</p>
        </div>
      </div>
      <div
        className="productivity-periods"
        role="group"
        aria-label="Dashboard period"
      >
        {[
          ["yesterday", "Yesterday"],
          ["today", "Today"],
          ["7", "Last 7 days"],
          ["30", "Last 30 days"],
          ["custom", "Custom range"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={period === key}
            onClick={() => choose(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="productivity-dates">
          <label>
            From
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Gathering your progress…</p>}
      {data && (
        <>
          <div className="productivity-stats">
            {[
              [
                "Tracked work",
                duration(
                  data.daily.reduce((s: number, d: any) => s + d.seconds, 0),
                ),
              ],
              [
                "Total focused hours",
                duration(
                  data.timings.reduce((s: number, t: any) => s + t.seconds, 0),
                ),
              ],
              ["Tasks timed", data.timings.length],
              ["Total tasks", data.summary.total],
              ["Done", data.summary.done],
              ["Pending", data.summary.pending],
              ["Repeating tasks 🔁", data.summary.repeating],
              ["Completed in range", data.completed.length],
            ].map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <section className="productivity-chart">
            <h3>Hours worked</h3>
            <p>
              {start} — {end} · {data.timezone}
            </p>
            <div
              className="productivity-bars"
              tabIndex={0}
              role="img"
              aria-label={`Hours worked from ${start} to ${end}: ${duration(data.daily.reduce((s: number, d: any) => s + d.seconds, 0))}`}
            >
              {data.buckets.map((d: any) => (
                <div
                  key={d.day}
                  className="productivity-bar-column"
                  title={`${d.label}: ${duration(d.seconds)}`}
                >
                  <span>{duration(d.seconds)}</span>
                  <div
                    style={{
                      height: Math.max(
                        2,
                        (d.seconds /
                          Math.max(
                            1,
                            ...data.buckets.map((x: any) => x.seconds),
                          )) *
                          130,
                      ),
                    }}
                  />
                  <small>{d.label}</small>
                </div>
              ))}
            </div>
            <details>
              <summary>View hours as a table</summary>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d: any) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td>{duration(d.seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <small>
              Focus time only. Pauses and breaks excluded. Historical slices use
              recorded timer events.
            </small>
          </section>
          <div className="productivity-highlights">
            {[
              ["Most focused time", data.longest],
              ["Fastest completed task", data.fastest],
            ].map(([label, t]: any) => (
              <article key={label}>
                <h3>{label}</h3>
                {t ? (
                  <button
                    type="button"
                    disabled={
                      !!activeTaskIds && !activeTaskIds.includes(t.task_id)
                    }
                    title={
                      activeTaskIds && !activeTaskIds.includes(t.task_id)
                        ? "Historical task"
                        : "Open task"
                    }
                    onClick={() => onOpen(t.task_id)}
                  >
                    {t.title}
                    <strong>{duration(t.seconds)}</strong>
                  </button>
                ) : (
                  <p>No tracked task yet.</p>
                )}
              </article>
            ))}
            {[
              ["Highest-value project", data.projectValues],
              ["High-ticket task", data.taskValues],
            ].map(([label, items]: any) => (
              <article key={label}>
                <h3>{label}</h3>
                <small>
                  Estimated profit · highest per currency and basis · all time.
                  Includes conditional estimates; not payments.
                </small>
                {items.length ? (
                  items.map((v: any) => (
                    <p key={v.currency + ":" + (v.basis || "task")}>
                      {v.title}
                      <strong>
                        {v.currency}{" "}
                        {(Number(v.amount) / 100).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                        {v.basis && v.basis !== "project"
                          ? " / " + v.basis
                          : ""}
                      </strong>
                    </p>
                  ))
                ) : (
                  <p>No profit estimate yet.</p>
                )}
              </article>
            ))}
          </div>
          <section>
            <h3>
              Tasks completed{" "}
              <span className="productivity-count">
                {data.completed.length}
              </span>
            </h3>
            <p>
              Each dated recurring occurrence counts independently. Reopening
              and completing the same task counts once in this range.
            </p>
            {data.completed.length ? (
              <ul className="productivity-completed">
                {data.completed.map((t: any) => (
                  <li key={t.task_id}>
                    <button
                      type="button"
                      disabled={
                        !!activeTaskIds && !activeTaskIds.includes(t.task_id)
                      }
                      title={
                        activeTaskIds && !activeTaskIds.includes(t.task_id)
                          ? "Historical task"
                          : "Open task"
                      }
                      onClick={() => onOpen(t.task_id)}
                    >
                      <span>
                        {t.repeating && (
                          <span aria-label="Repeating task">🔁 </span>
                        )}
                        {t.title}
                        <small>{t.project_title || "No project"}</small>
                      </span>
                      <time>{new Date(t.created_at).toLocaleDateString()}</time>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No completions in this period. Your next win is ahead.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
