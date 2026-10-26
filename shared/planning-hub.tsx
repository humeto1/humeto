"use client";
import { TaskDetailGroup } from "./task-detail-group";
import { PlanFinancial } from "./plan-financial";
import { PlanTeam } from "./plan-team";
import { nextDay } from "../src/lib/scheduling-clock.mjs";
import { TaskValueFields, valuePayload } from "./task-value";
import RoutineWording from "./routine-wording";
import React, { useState, useEffect, useCallback, useRef } from "react";
import "./planning.css";
import { webApi, type Transport } from "./transport";
export { webApi, type Transport } from "./transport";
const day = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (s: string, n: number) => {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return day(d);
};
export const categories = [
  "Personal",
  "Work",
  "Social",
  "Relationship",
  "Family",
  "Health",
  "Learning",
  "Hobby",
  "Financial",
];
type Plan = {
  id: string;
  title: string;
  target_date: string;
  status: string;
  revision: number;
  description: string;
  category?: string;
  success_metric?: string;
  goal_id?: string;
};
export default function PlanningHub({
  tasks,
  projects,
  goals,
  writable,
  refresh,
  request = webApi,
  view = "calendar",
  createRoutineToken = 0,
  onOpenTask,
}: {
  tasks: any[];
  projects: Plan[];
  goals: Plan[];
  writable: boolean;
  refresh: () => Promise<void>;
  request?: Transport;
  view?: "calendar" | "routines" | "deadlines";
  createRoutineToken?: number;
  onOpenTask?: (id: string) => void;
}) {
  const routineForm = useRef<HTMLFormElement>(null);
  const tab = view;
  const [month, setMonth] = useState(day().slice(0, 7)),
    [selected, setSelected] = useState(day()),
    [week, setWeek] = useState(day()),
    [kind, setKind] = useState("all"),
    [statusFilter, setStatusFilter] = useState("all"),
    [report, setReport] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [routineKind, setRoutineKind] = useState("operations"),
    [edit, setEdit] = useState<{ kind: string; item: Plan } | null>(null),
    [notice, setNotice] = useState("");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const load = useCallback(async () => {
    if (view === "deadlines") return;
    try {
      setReport(
        await request(
          "/api/workspace/planning?week=" +
            week +
            "&timezone=" +
            encodeURIComponent(zone),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [request, week, zone, view]);
  useEffect(() => {
    setKind("all");
  }, [view]);
  useEffect(() => {
    void load();
  }, [load, tasks]);
  useEffect(() => {
    if (createRoutineToken) setOpen(true);
  }, [createRoutineToken]);
  useEffect(() => {
    if (open && view === "routines")
      routineForm.current
        ?.querySelector<HTMLInputElement>('input[name="title"]')
        ?.focus();
  }, [open, view]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const projected: any[] = [];
  for (const r of report?.routines || []) {
    if (r.status !== "active") continue;
    let at = r.next_day;
    for (let i = 0; i < 5000 && at.slice(0, 7) <= month; i++) {
      if (r.end_day && at > r.end_day) break;
      if (
        at.slice(0, 7) === month &&
        !(report?.occurrences || []).some(
          (o: any) => o.series_id === r.id && o.day === at,
        )
      )
        projected.push({
          id: r.id + at,
          title: r.title,
          type: "Task",
          date: at,
          category: r.category,
          status: "Upcoming",
          target_date: at,
        });
      at = nextDay(
        at,
        r.frequency,
        r.interval_count,
        Number(r.first_day.slice(8)),
      );
    }
  }
  const events = [
    ...projected,
    ...goals.map((p) => ({ ...p, type: "Goal", date: p.target_date })),
    ...projects.map((p) => ({ ...p, type: "Project", date: p.target_date })),
    ...(report?.occurrences || [])
      .filter((o: any) => !tasks.some((t) => t.id === o.task_id && t.due_date))
      .map((o: any) => ({
        id: o.series_id + o.day,
        taskId: o.task_id,
        title: o.title,
        type: "Task",
        date: o.day,
        status:
          o.state === "done"
            ? "Done"
            : o.state === "missed"
              ? "Missed"
              : o.state === "upcoming"
                ? "Upcoming"
                : o.state === "skipped"
                  ? "Skipped"
                  : "To do",
      })),
    ...tasks
      .filter((t) => t.due_date)
      .map((t) => ({
        ...t,
        title: t.display_title || t.title,
        type: "Task",
        taskId: t.id,
        status:
          t.stage === "Done"
            ? "Done"
            : t.due_date < day()
              ? "Missed"
              : t.due_date > day()
                ? "Upcoming"
                : "To do",
        date: t.due_date,
      })),
  ]
    .map((e) => ({
      ...e,
      planStatus: e.status,
      status:
        e.type === "Task"
          ? e.status
          : ["Completed", "Done", "Achieved"].includes(e.status)
            ? "Done"
            : e.date < day()
              ? "Missed"
              : e.date > day()
                ? "Upcoming"
                : "To do",
    }))
    .filter(
      (e) =>
        (kind === "all" || e.type.toLowerCase() === kind) &&
        (statusFilter === "all" || e.status === statusFilter),
    );
  const first = new Date(month + "-01T12:00:00"),
    offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) =>
    plus(month + "-01", i - offset),
  );
  const routines = (report?.routines || []).filter(
    (r: any) => kind === "all" || r.routine_kind === kind,
  );
  const occurrences = (report?.occurrences || []).filter(
    (r: any) => kind === "all" || r.routine_kind === kind,
  );
  const counter = (state: string) =>
    occurrences.filter((o: any) => o.state === state).length;
  const deadlines = (
    <>
      <details>
        <summary>
          Plans without a deadline (
          {
            [...goals, ...projects].filter(
              (p) => !p.target_date && p.status !== "Archived",
            ).length
          }
          )
        </summary>
        {[
          ...goals.map((p) => ({ ...p, kind: "goals" })),
          ...projects.map((p) => ({ ...p, kind: "projects" })),
        ]
          .filter((p) => !p.target_date && p.status !== "Archived")
          .map((p) => (
            <div className="planning-row" key={p.id}>
              <span>{p.title}</span>
              <button
                disabled={!writable}
                onClick={() => setEdit({ kind: p.kind, item: p })}
              >
                Set deadline
              </button>
            </div>
          ))}
      </details>
    </>
  );
  return (
    <section
      className={
        "planning-hub " +
        (view === "deadlines" ? "planning-deadlines-only" : "")
      }
    >
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {deadlines}
      {tab === "calendar" ? (
        <>
          <div className="planning-controls">
            <button
              aria-label="Previous month"
              onClick={() => {
                const d = new Date(month + "-01T12:00");
                d.setMonth(d.getMonth() - 1);
                setMonth(day(d).slice(0, 7));
              }}
            >
              ‹
            </button>
            <label>
              Month
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
              />
            </label>
            <button
              aria-label="Next month"
              onClick={() => {
                const d = new Date(month + "-01T12:00");
                d.setMonth(d.getMonth() + 1);
                setMonth(day(d).slice(0, 7));
              }}
            >
              ›
            </button>
            <label>
              Show
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">Everything</option>
                {["Goal", "Project", "Task"].map((k) => (
                  <option key={k} value={k.toLowerCase()}>
                    {k}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="planning-status-filter">
            Status
            <select
              aria-label="Calendar status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {["all", "Upcoming", "To do", "Done", "Missed"].map((v) => (
                <option value={v} key={v}>
                  {v === "all" ? "All work" : v}
                </option>
              ))}
            </select>
          </label>
          <div className="planning-calendar">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => (
              <span className="calendar-weekday" key={n}>
                {n}
              </span>
            ))}
            {days.map((d) => (
              <button
                key={d}
                aria-label={"Calendar " + d}
                aria-pressed={selected === d}
                className={
                  (d.slice(0, 7) !== month ? "outside " : "") +
                  (d === day() ? "today" : "")
                }
                onClick={() => {
                  setSelected(d);
                  setWeek(d);
                }}
              >
                <strong>{Number(d.slice(8))}</strong>
                <small>{events.filter((e) => e.date === d).length || ""}</small>
              </button>
            ))}
          </div>
          <h3>{selected} · work & deadlines</h3>
          {events
            .filter((e) => e.date === selected)
            .map((e) => (
              <div className="planning-row" key={e.type + e.id}>
                <div>
                  {e.type === "Task" && e.taskId && onOpenTask ? (
                    <button
                      type="button"
                      className="planning-event-title"
                      onClick={() => onOpenTask(e.taskId)}
                    >
                      {e.title}
                    </button>
                  ) : (
                    <strong>{e.title}</strong>
                  )}
                  <small>
                    {e.type} · {e.category || "Uncategorized"} ·{" "}
                    {e.status || e.stage}
                  </small>
                </div>
                {["Goal", "Project"].includes(e.type) && (
                  <button
                    disabled={!writable}
                    onClick={() =>
                      setEdit({
                        kind: e.type === "Goal" ? "goals" : "projects",
                        item: { ...e, status: e.planStatus },
                      })
                    }
                  >
                    Edit plan
                  </button>
                )}
              </div>
            ))}
          {!events.some((e) => e.date === selected) && (
            <p>No work on this date.</p>
          )}
        </>
      ) : tab === "routines" ? (
        <>
          <div className="planning-controls">
            <label>
              Routine type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">All routines</option>
                <option value="operations">Operations</option>
                <option value="groceries">Groceries</option>
                <option value="subscription">Subscriptions</option>
              </select>
            </label>
          </div>
          {open && (
            <form
              ref={routineForm}
              className="planning-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await request("/api/workspace/planning", {
                    ...valuePayload(f),
                    action: "routine",
                    title: f.get("title"),
                    category: f.get("category"),
                    kind: routineKind,
                    frequency: f.get("frequency"),
                    interval: Number(f.get("interval")),
                    firstDay: f.get("firstDay"),
                    time: f.get("time"),
                    timezone: zone,
                    projectId: f.get("projectId"),
                    goalIds: f.getAll("goalIds"),
                  });
                  setOpen(false);
                  setNotice(
                    "Routine saved. Each occurrence has its own completion record.",
                  );
                });
              }}
            >
              <label>
                Name
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={200}
                  placeholder="Daily student follow-ups"
                />
              </label>
              <label>
                Repeats
                <select
                  aria-label="Routine frequency"
                  name="frequency"
                  key={routineKind}
                  defaultValue={
                    routineKind === "operations" ? "daily" : "monthly"
                  }
                >
                  {["daily", "weekdays", "weekly", "monthly", "yearly"].map(
                    (f) => (
                      <option key={f}>{f}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                First occurrence
                <input
                  type="date"
                  name="firstDay"
                  min={day()}
                  defaultValue={day()}
                  required
                />
              </label>
              <TaskDetailGroup
                title="More options"
                hint="Reminder time, category, team links & value"
              >
                <label>
                  Routine type
                  <select
                    aria-label="Routine kind"
                    value={routineKind}
                    onChange={(e) => setRoutineKind(e.target.value)}
                  >
                    <option value="operations">
                      Operations / daily routine
                    </option>
                    <option value="groceries">Groceries / replenishment</option>
                    <option value="subscription">Subscription / renewal</option>
                  </select>
                </label>
                <label>
                  Life / work category
                  <input
                    name="category"
                    list="planning-categories"
                    defaultValue={
                      routineKind === "operations" ? "Work" : "Personal"
                    }
                    key={routineKind}
                    maxLength={60}
                  />
                </label>
                <label>
                  Every
                  <input
                    type="number"
                    name="interval"
                    min={1}
                    max={12}
                    defaultValue={1}
                    required
                  />
                </label>
                <label>
                  Reminder time ({zone})
                  <input
                    type="time"
                    name="time"
                    defaultValue="09:00"
                    required
                  />
                </label>
                <label>
                  Project
                  <select name="projectId">
                    <option value="">No project</option>
                    {projects
                      .filter((p) => p.status !== "Archived")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                  </select>
                </label>
                <fieldset>
                  <legend>Supports goals</legend>
                  {goals
                    .filter((g) => g.status !== "Archived")
                    .map((g) => (
                      <label className="planning-check" key={g.id}>
                        <input type="checkbox" name="goalIds" value={g.id} />
                        {g.title}
                      </label>
                    ))}
                </fieldset>
                <TaskValueFields />
              </TaskDetailGroup>
              <button disabled={busy || !writable}>Save routine</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel routine
              </button>
            </form>
          )}
          <div className="planning-controls">
            <button
              aria-label="Previous week"
              onClick={() => setWeek(plus(report?.week || week, -7))}
            >
              ‹
            </button>
            <label>
              Week containing
              <input
                type="date"
                value={week}
                onChange={(e) => e.target.value && setWeek(e.target.value)}
              />
            </label>
            <button
              aria-label="Next week"
              onClick={() => setWeek(plus(report?.week || week, 7))}
            >
              ›
            </button>
          </div>
          <h3>
            Weekly routine review · {report?.week} – {report?.weekEnd}
          </h3>
          <p className="routine-week-summary">
            {counter("done")} done · {counter("missed")} missed
          </p>
          {!routines.length && (
            <p>No routines yet. Add a repeating task to start your week.</p>
          )}
          {routines.map((r: any) => (
            <div className="planning-row routine-plan" key={r.id}>
              <div>
                <strong>{r.title}</strong>
                <small>
                  {r.frequency} ·{" "}
                  {r.status === "active" ? "Next " + r.next_day : r.status}
                </small>
                <div
                  className="routine-week-grid"
                  aria-label={`Weekly tracker for ${r.title}`}
                >
                  {Array.from({ length: 7 }, (_, i) => {
                    const date = plus(report?.week || week, i);
                    const occurrence = occurrences.find(
                      (o: any) => o.series_id === r.id && o.day === date,
                    );
                    const state = occurrence?.state || "unscheduled";
                    const label =
                      state === "done"
                        ? "Done"
                        : state === "missed"
                          ? "Missed"
                          : state === "pending"
                            ? "To do"
                            : state === "upcoming"
                              ? "Next"
                              : state === "skipped"
                                ? "Skipped"
                                : "—";
                    return (
                      <button
                        key={date}
                        type="button"
                        className={"routine-day routine-day-" + state}
                        aria-label={`${r.title}, ${date}: ${label}`}
                        title={date + ": " + label}
                        disabled={
                          busy ||
                          !writable ||
                          !occurrence?.task_id ||
                          ["done", "skipped", "upcoming"].includes(state)
                        }
                        onClick={() =>
                          void run(async () => {
                            await request(
                              "/api/workspace/tasks/" + occurrence.task_id,
                              {
                                stage: "Done",
                                revision: occurrence.task_revision,
                              },
                              "PATCH",
                            );
                          })
                        }
                      >
                        <span>
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}
                        </span>
                        <strong>
                          {state === "done"
                            ? "✓"
                            : state === "missed"
                              ? "×"
                              : state === "pending"
                                ? "○"
                                : "·"}
                        </strong>
                        <small>{label}</small>
                      </button>
                    );
                  })}
                </div>
                <TaskDetailGroup
                  title="Routine settings"
                  hint="Team, reminders & extras"
                >
                  <PlanFinancial
                    type="routine"
                    id={r.id}
                    request={request}
                    writable={writable}
                  />
                  <PlanTeam
                    type="routine"
                    id={r.id}
                    request={request}
                    writable={writable}
                  />
                  {r.routine_kind === "operations" && (
                    <RoutineWording
                      routine={r}
                      request={request}
                      writable={writable}
                      refresh={load}
                      history={report?.occurrences || []}
                    />
                  )}
                  <div className="routine-setting-actions">
                    <button
                      disabled={
                        busy ||
                        !writable ||
                        ["ended", "cancelled"].includes(r.status)
                      }
                      onClick={() =>
                        void run(async () => {
                          await request("/api/workspace/scheduling", {
                            action: "series-state",
                            id: r.id,
                            revision: r.revision,
                            status: r.status === "active" ? "paused" : "active",
                          });
                        })
                      }
                    >
                      {r.status === "active" ? "Pause" : "Resume"}
                    </button>
                    <button
                      disabled={busy || !writable || r.status !== "active"}
                      onClick={() =>
                        void run(async () => {
                          await request("/api/workspace/scheduling", {
                            action: "series-skip",
                            id: r.id,
                            revision: r.revision,
                          });
                        })
                      }
                    >
                      Skip next
                    </button>
                  </div>
                </TaskDetailGroup>
              </div>
            </div>
          ))}
          <p>
            Each scheduled day keeps its own record. Complete today; the next
            occurrence stays scheduled.
          </p>
        </>
      ) : null}
      {edit && (
        <form
          className="planning-form"
          aria-label="Edit calendar plan"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              await request(
                "/api/workspace/" + edit.kind + "/" + edit.item.id,
                {
                  title: f.get("title"),
                  description: f.get("description"),
                  targetDate: f.get("targetDate"),
                  category: f.get("category"),
                  successMetric: f.get("successMetric") || "",
                  goalId: f.get("goalId") || "",
                  status: edit.item.status,
                  revision: edit.item.revision,
                },
                "PATCH",
              );
              setEdit(null);
              setNotice("Plan and deadline saved on all devices.");
            });
          }}
        >
          <h3>Edit {edit.kind === "goals" ? "goal" : "project"}</h3>
          <label>
            Name
            <input
              name="title"
              required
              minLength={2}
              maxLength={160}
              defaultValue={edit.item.title}
            />
          </label>
          <label>
            Category
            <input
              name="category"
              list="planning-categories"
              maxLength={60}
              defaultValue={edit.item.category || "Personal"}
            />
          </label>
          <label>
            Success / delivery description
            <textarea
              name="description"
              defaultValue={edit.item.description}
              maxLength={2000}
            />
          </label>
          {edit.kind === "goals" ? (
            <label>
              Measurable outcome
              <input
                name="successMetric"
                defaultValue={edit.item.success_metric}
                maxLength={500}
                placeholder="Save PKR 100,000"
              />
            </label>
          ) : (
            <label>
              Supports goal
              <select name="goalId" defaultValue={edit.item.goal_id || ""}>
                <option value="">No goal</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {edit.kind === "goals" ? "Deadline" : "Deadline (optional)"}
            <input
              name="targetDate"
              type="date"
              required={edit.kind === "goals"}
              defaultValue={edit.item.target_date || ""}
            />
          </label>
          <button disabled={!writable || busy}>Save calendar plan</button>
          <button type="button" onClick={() => setEdit(null)}>
            Cancel
          </button>
        </form>
      )}
      <datalist id="planning-categories">
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </datalist>
    </section>
  );
}
