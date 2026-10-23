"use client";
import { ParentControls } from "../../shared/parent-controls";
import PlanningHub, { categories } from "../../shared/planning-hub";
import { useState, useEffect } from "react";
import {
  Target,
  FolderOpen,
  CheckCircle2,
  ArrowUpRight,
  Plus,
  History,
} from "lucide-react";
import type { Task, Workstream, TaskEvent } from "@/lib/types";
import TaskLinks from "./task-links";
type Report = {
  events: TaskEvent[];
  completions: TaskEvent[];
  uniqueCompleted: number;
  completionEvents: number;
  reopenedEvents: number;
  projects: { id: string; title: string; count: number; taskIds: string[] }[];
  goals: { id: string; title: string; count: number; taskIds: string[] }[];
};
export default function TaskProgress({
  tasks,
  projects,
  goals,
  refresh,
  writable,
}: {
  tasks: Task[];
  projects: Workstream[];
  goals: Workstream[];
  refresh: () => Promise<void>;
  writable: boolean;
}) {
  const [tab, setTab] = useState("projects"),
    [routineCreate, setRoutineCreate] = useState(0),
    [edit, setEdit] = useState<{
      kind: "projects" | "goals";
      item?: Workstream;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [month, setMonth] = useState(""),
    [timezone, setTimezone] = useState("Asia/Karachi"),
    [detectedTimezone, setDetectedTimezone] = useState("Asia/Karachi"),
    [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState(""),
    [historyType, setHistoryType] = useState("completed"),
    [page, setPage] = useState(1);
  useEffect(() => {
    const zone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
    setTimezone(zone);
    setDetectedTimezone(zone);
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    setMonth(
      p.find((x) => x.type === "year")!.value +
        "-" +
        p.find((x) => x.type === "month")!.value,
    );
  }, []);
  useEffect(() => {
    if (!month || !["monthly", "history"].includes(tab)) return;
    const controller = new AbortController();
    setLoading(true);
    setReport(null);
    setError("");
    fetch(
      "/api/workspace/task-history?timezone=" +
        encodeURIComponent(timezone) +
        (tab === "history" ? "" : "&month=" + month),
      { signal: controller.signal },
    )
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw new Error(v.error);
        setReport(v);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month, timezone, tab, tasks]);
  useEffect(() => {
    setFilter("");
    setSearch("");
    setPage(1);
  }, [tab, month]);
  useEffect(() => {
    if (edit)
      document
        .querySelector(".plan-editor")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [edit]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/workspace/" + edit.kind + (edit.item ? "/" + edit.item.id : ""),
        {
          method: edit.item ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: f.get("title"),
            description: f.get("description"),
            category: f.get("category"),
            successMetric: f.get("successMetric") || undefined,
            goalId: f.get("goalId") || undefined,
            status: f.get("status"),
            targetDate: f.get("targetDate"),
            ...(edit.item ? { revision: edit.item.revision } : {}),
          }),
        },
      );
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      await refresh();
      setEdit(null);
      setNotice("Plan saved. Completed-task history remains intact.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const list = tab === "goals" ? goals : projects;
  const selected =
    report?.completions.filter(
      (e) =>
        !filter ||
        (filter.startsWith("p:")
          ? e.project_id === filter.slice(2)
          : e.goals.some((g) => g.id === filter.slice(2))),
    ) || [];
  const history =
    report?.events.filter(
      (e) =>
        (historyType === "all" || e.event === historyType) &&
        (e.title + " " + e.project_title)
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  return (
    <div className="task-progress">
      <div className="plans-page-heading">
        <h1>Plans</h1>
        <div className="plans-page-actions">
          <a className="btn secondary" href="/workspace/tasks">
            Tasks <ArrowUpRight size={14} />
          </a>
          <label className="plan-add">
            <span className="sr-only">Add plan</span>
            <select
              aria-label="Add plan"
              value=""
              disabled={!writable}
              onChange={(e) => {
                const kind = e.target.value;
                if (kind === "routines") {
                  setTab(kind);
                  setEdit(null);
                  setRoutineCreate((n) => n + 1);
                } else if (kind === "projects" || kind === "goals") {
                  setTab(kind);
                  setEdit({ kind });
                  setError("");
                }
              }}
            >
              <option value="" disabled>
                Add…
              </option>
              <option value="projects">Project</option>
              <option value="goals">Goal</option>
              <option value="routines">Routine</option>
            </select>
          </label>
        </div>
      </div>
      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="Plan sections">
          {[
            ["projects", "Projects"],
            ["goals", "Goals"],
            ["routines", "Routines"],
            ["calendar", "Calendar"],
            ["monthly", "Monthly review"],
            ["history", "Task history"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="subtle">Shared with your workspace team</span>
      </div>
      <PlanningHub
        tasks={tasks}
        projects={projects}
        goals={goals}
        writable={writable}
        refresh={refresh}
        view={
          tab === "routines"
            ? "routines"
            : tab === "calendar"
              ? "calendar"
              : "deadlines"
        }
        createRoutineToken={routineCreate}
      />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {["projects", "goals"].includes(tab) && (
        <>
          <div className="progress-intro">
            <div>
              {tab === "projects" ? (
                <FolderOpen size={23} />
              ) : (
                <Target size={23} />
              )}
              <p>
                {tab === "projects"
                  ? "A project brings related work together."
                  : "A goal names the outcome you are working toward. Task counts show activity; you choose the outcome status."}
              </p>
            </div>
          </div>
          <div className="workstream-grid">
            {list.map((item) => {
              const related = tasks.filter((t) =>
                tab === "projects"
                  ? t.project_id === item.id
                  : t.goals?.some((g) => g.id === item.id),
              );
              const done = related.filter((t) => t.stage === "Done").length;
              return (
                <article className="workstream-card" key={item.id}>
                  <div>
                    <span
                      className={"stream-status " + item.status.toLowerCase()}
                    >
                      {item.status}
                    </span>
                    <button
                      className="subtle-link"
                      onClick={() => {
                        setEdit({ kind: tab as "projects" | "goals", item });
                        setError("");
                      }}
                    >
                      Edit
                    </button>
                  </div>
                  <h2>{item.title}</h2>
                  <small>
                    {item.category || "Uncategorized"}
                    {item.goal_id
                      ? " · Supports " +
                        (goals.find((g) => g.id === item.goal_id)?.title ||
                          "a goal")
                      : ""}
                  </small>
                  {item.success_metric && <p>Outcome: {item.success_metric}</p>}
                  <p>
                    {item.description ||
                      "Add a short description when you are ready."}
                  </p>
                  <div className="workstream-count">
                    <strong>
                      {done}
                      <small> / {related.length}</small>
                    </strong>
                    <span>currently completed tasks</span>
                  </div>
                  <div className="stream-meter">
                    <i
                      style={{
                        width: related.length
                          ? `${(done / related.length) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <footer>
                    <span>
                      {item.target_date
                        ? "Target " + item.target_date
                        : "No target date"}
                    </span>
                    <span>{related.length - done} pending</span>
                  </footer>
                  <ParentControls
                    type={tab === "projects" ? "project" : "goal"}
                    id={item.id}
                    writable={writable}
                  />
                  <details>
                    <summary>View contributing tasks</summary>
                    {related.map((t) => (
                      <div className="stream-task" key={t.id}>
                        <span>
                          {t.title}
                          <small>{t.stage}</small>
                        </span>
                        <TaskLinks
                          task={t}
                          projects={projects}
                          goals={goals}
                          onChange={refresh}
                          writable={writable}
                        />
                      </div>
                    ))}
                    {!related.length && (
                      <p>Link a task below or from the task board.</p>
                    )}
                  </details>
                </article>
              );
            })}
            {!list.length && (
              <div className="progress-empty">
                <Target size={28} />
                <h2>A little direction goes a long way.</h2>
                <p>
                  Create your first {tab === "projects" ? "project" : "goal"},
                  then connect tasks to it.
                </p>
              </div>
            )}
          </div>
          <details className="progress-linker">
            <summary>Connect existing tasks to projects & goals</summary>
            {tasks.map((t) => (
              <div className="stream-task" key={t.id}>
                <span>
                  {t.title}
                  <small>{t.stage}</small>
                </span>
                <TaskLinks
                  task={t}
                  projects={projects}
                  goals={goals}
                  onChange={refresh}
                  writable={writable}
                />
              </div>
            ))}
          </details>
        </>
      )}
      {tab === "monthly" && (
        <>
          <div className="review-controls">
            <label>
              Month
              <input
                type="month"
                value={month}
                onChange={(e) => {
                  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
                    setMonth(e.target.value);
                }}
              />
            </label>
            <label>
              Report timezone
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {[
                  ...new Set([
                    timezone,
                    detectedTimezone,
                    "Asia/Karachi",
                    "Europe/London",
                    "America/New_York",
                    "Pacific/Auckland",
                    "UTC",
                  ]),
                ].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <p role="status">Gathering your progress…</p>
          ) : (
            report && (
              <>
                <div className="progress-stats">
                  <div>
                    <CheckCircle2 size={20} />
                    <strong>{report.uniqueCompleted}</strong>
                    <span>unique tasks completed</span>
                  </div>
                  <div>
                    <History size={20} />
                    <strong>{report.completionEvents}</strong>
                    <span>completion events</span>
                  </div>
                  <div>
                    <Target size={20} />
                    <strong>{report.reopenedEvents}</strong>
                    <span>reopened events</span>
                  </div>
                </div>
                <p className="report-explanation">
                  A repeated completion counts once in the month’s task total.
                  Reopened tasks remain in history. Attribution uses the project
                  and goals saved at the latest completion in that month, rather
                  than today’s links.
                </p>
                <div className="progress-breakdowns">
                  {(["projects", "goals"] as const).map((kind) => (
                    <section key={kind}>
                      <h2>{kind === "projects" ? "By project" : "By goal"}</h2>
                      {report[kind].map((g) => (
                        <button
                          key={g.id}
                          className={
                            "breakdown-row " +
                            (filter ===
                            (kind === "projects" ? "p:" : "g:") + g.id
                              ? "active"
                              : "")
                          }
                          onClick={() =>
                            setFilter(
                              (kind === "projects" ? "p:" : "g:") + g.id,
                            )
                          }
                        >
                          <span>{g.title}</span>
                          <strong>{g.count}</strong>
                        </button>
                      ))}
                      {!report[kind].length && (
                        <p>No attributed completions this month.</p>
                      )}
                    </section>
                  ))}
                </div>
                <div className="filter-bar">
                  <h2>
                    {filter
                      ? "Contributing completed tasks"
                      : "Completed tasks this month"}
                  </h2>
                  {filter && (
                    <button
                      className="subtle-link"
                      onClick={() => setFilter("")}
                    >
                      Show all
                    </button>
                  )}
                </div>
                {selected.map((e) => (
                  <article className="completion-row" key={e.id}>
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>{e.title}</strong>
                      <p>
                        {e.project_title || "No project at completion"} ·{" "}
                        {e.goals.map((g) => g.title).join(", ") ||
                          "No goal at completion"}
                      </p>
                      <small>
                        {new Date(e.created_at).toLocaleString("en-GB", {
                          timeZone: timezone,
                        })}{" "}
                        · {timezone}
                      </small>
                    </div>
                    <span>
                      {e.current_stage === "Done"
                        ? "Done"
                        : "Now " + e.current_stage}
                    </span>
                  </article>
                ))}
                {!selected.length && (
                  <p className="notice">
                    No recorded completions for this selection. Older Done tasks
                    without a completion timestamp are not assigned an invented
                    date.
                  </p>
                )}
              </>
            )
          )}
        </>
      )}
      {tab === "history" && (
        <>
          <div className="review-controls">
            <input
              aria-label="Search task history"
              placeholder="Find a completed task or project…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="History event type"
              value={historyType}
              onChange={(e) => {
                setHistoryType(e.target.value);
                setPage(1);
              }}
            >
              <option value="completed">Completions</option>
              <option value="reopened">Reopened</option>
              <option value="all">All events</option>
            </select>
          </div>
          <p className="report-explanation">
            Completions and reopenings stay in history. Dates shown in{" "}
            {timezone}. Earlier Done tasks may have no recorded completion date.
          </p>
          {loading ? (
            <p>Loading history…</p>
          ) : (
            history.slice((page - 1) * 30, page * 30).map((e) => (
              <article className="completion-row" key={e.id}>
                <History size={18} />
                <div>
                  <strong>{e.title}</strong>
                  <p>
                    {e.from_stage || "New"} → {e.to_stage} · {e.actor_name}
                  </p>
                  <small>
                    {new Date(e.created_at).toLocaleString("en-GB", {
                      timeZone: timezone,
                    })}{" "}
                    · {e.project_title || "No project"}
                  </small>
                </div>
                <span>{e.event.replace("_", " ")}</span>
              </article>
            ))
          )}
          {!loading && !history.length && (
            <p className="notice">No matching events yet.</p>
          )}
          <div className="crm-actions">
            <button
              className="btn secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} · {history.length} events
            </span>
            <button
              className="btn secondary"
              disabled={page * 30 >= history.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {edit && (
        <section className="plan-editor" aria-label="Plan editor">
          <div className="filter-bar">
            <h2>
              {edit.item ? "Update" : "New"}{" "}
              {edit.kind === "projects" ? "project" : "goal"}
            </h2>
            <button
              className="subtle-link"
              disabled={busy}
              onClick={() => setEdit(null)}
            >
              Cancel
            </button>
          </div>
          <form key={edit.kind + (edit.item?.id || "new")} onSubmit={save}>
            <label>
              Title
              <input
                autoFocus
                name="title"
                required
                minLength={2}
                maxLength={160}
                defaultValue={edit.item?.title}
              />
            </label>
            <label>
              What does success look like?
              <textarea
                name="description"
                maxLength={2000}
                defaultValue={edit.item?.description}
              />
            </label>
            <label>
              Category
              <input
                name="category"
                list="planning-categories"
                maxLength={60}
                defaultValue={
                  edit.item?.category ||
                  (edit.kind === "goals" ? "Personal" : "Work")
                }
              />
            </label>
            {edit.kind === "goals" ? (
              <label>
                Measurable outcome
                <input
                  name="successMetric"
                  maxLength={500}
                  defaultValue={edit.item?.success_metric}
                  placeholder="Save PKR 100,000"
                />
              </label>
            ) : (
              <label>
                Supports goal
                <select name="goalId" defaultValue={edit.item?.goal_id || ""}>
                  <option value="">No goal</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="crm-fields">
              <label>
                Deadline
                <input
                  required
                  name="targetDate"
                  type="date"
                  defaultValue={edit.item?.target_date}
                />
              </label>
              <label>
                Status
                <select
                  name="status"
                  defaultValue={edit.item?.status || "Active"}
                >
                  {["Active", "Paused", "Completed", "Archived"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              Plans and linked tasks are shared within this workspace. Archived
              plans and previous completion snapshots are retained.
            </p>
            <button className="btn primary" disabled={busy || !writable}>
              {busy
                ? "Saving…"
                : "Save " + (edit.kind === "projects" ? "project" : "goal")}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
