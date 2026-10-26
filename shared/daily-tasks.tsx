"use client";
import { useEffect, useState } from "react";
import { webApi, type Transport } from "./planning-hub";
import "./daily-tasks.css";
const localDate = () => new Date().toLocaleDateString("en-CA");
const shift = (date: string, n: number) => {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};
export function DailyTasks({
  tasks,
  writable,
  refresh,
  request = webApi,
  onOpen,
  onAdd,
}: {
  tasks: any[];
  writable: boolean;
  refresh: () => Promise<void>;
  request?: Transport;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const [date, setDate] = useState(localDate),
    [report, setReport] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const zone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
  useEffect(() => {
    let live = true;
    setReport(null);
    void request(
      "/api/workspace/planning?week=" +
        date +
        "&timezone=" +
        encodeURIComponent(zone),
    )
      .then((r) => {
        if (live) {
          setReport(r);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [date, zone, request, tasks]);
  const today = localDate();
  const occurrences = (report?.occurrences || []).filter(
    (o: any) => o.day === date,
  );
  const ids = new Set(occurrences.map((o: any) => o.task_id));
  const rows = [
    ...occurrences.map((o: any) => ({
      id: o.task_id,
      key: o.series_id + o.day,
      repeating: true,
      title: o.title,
      revision: o.task_revision,
      state: o.state,
    })),
    ...tasks
      .filter(
        (t) =>
          !ids.has(t.id) &&
          !t.routine_template &&
          (t.due_date === date ||
            (date === today &&
              !t.due_date &&
              t.stage !== "Done" &&
              t.work_kind !== "routine")),
      )
      .map((t) => ({
        id: t.id,
        key: t.id,
        repeating: !!t.routine_id,
        title: t.display_title || t.title,
        revision: t.revision,
        state:
          t.stage === "Done"
            ? "done"
            : date < today
              ? "missed"
              : date > today
                ? "upcoming"
                : "pending",
      })),
  ];
  async function done(row: any) {
    setBusy(row.key);
    setError("");
    try {
      await request(
        "/api/workspace/tasks/" + row.id,
        { stage: "Done", revision: row.revision },
        "PATCH",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="daily-tasks" aria-label="Daily task tracking">
      <header>
        <div>
          <h2>{date === today ? "Today’s tasks" : "Daily tasks"}</h2>
          <small>
            {rows.filter((r) => r.state === "done").length} done ·{" "}
            {rows.filter((r) => r.state === "missed").length} missed
          </small>
        </div>
        <button
          type="button"
          className="daily-action"
          aria-label="Add task from Today"
          onClick={onAdd}
          disabled={!writable}
        >
          + Task
        </button>
      </header>
      <div className="daily-date">
        <button
          type="button"
          aria-label="Previous task day"
          onClick={() => setDate(shift(date, -1))}
        >
          ‹
        </button>
        <label>
          <span className="sr-only">Daily task date</span>
          <input
            aria-label="Daily task date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          aria-label="Next task day"
          onClick={() => setDate(shift(date, 1))}
        >
          ›
        </button>
        {date !== today && (
          <button type="button" onClick={() => setDate(today)}>
            Today
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!report && !error && <p className="daily-empty">Loading tasks…</p>}
      {report && rows.length === 0 && (
        <p className="daily-empty">No tasks for this day.</p>
      )}
      <div
        className="daily-task-list"
        role="list"
        aria-label="Tasks for selected day"
        tabIndex={rows.length ? 0 : -1}
      >
        {rows.map((row) => (
          <div
            role="listitem"
            className={"daily-task daily-" + row.state}
            key={row.key}
          >
            <button
              type="button"
              className="daily-check"
              aria-label={"Mark " + row.title + " done"}
              disabled={
                !writable ||
                !!busy ||
                !row.id ||
                ["done", "skipped", "upcoming"].includes(row.state)
              }
              onClick={() => void done(row)}
            >
              {row.state === "done" ? "✓" : row.state === "missed" ? "×" : "○"}
            </button>
            <button
              type="button"
              className="daily-title"
              disabled={!row.id}
              onClick={() => void refresh().then(() => onOpen(row.id))}
            >
              {row.repeating && <span aria-label="Repeating task">🔁 </span>}
              {row.title}
              <small>
                {row.state === "done"
                  ? "Done"
                  : row.state === "missed"
                    ? "Missed"
                    : row.state === "upcoming"
                      ? "Upcoming"
                      : row.state === "skipped"
                        ? "Skipped"
                        : "To do"}
              </small>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
