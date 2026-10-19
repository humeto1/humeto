"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  NotebookPen,
  Upload,
  RefreshCw,
  CheckCircle2,
  FileSearch,
} from "lucide-react";
import type { Task, Workstream } from "@/lib/types";
import styles from "./task-notebooks.module.css";
type Notebook = {
  id: string;
  original_name: string;
  status: string;
  error: string;
  revision: number;
};
type Line = {
  id: string;
  line_index: number;
  source_text: string;
  title: string;
  box: number[];
  confidence: number | null;
  completion_hint: boolean;
  applied_at: string | null;
  action: string | null;
  reviewed_title: string | null;
  task_id: string | null;
  matches: { id: string; title: string; stage: string; revision: number }[];
};
type Reading = {
  notebook: {
    id: string;
    name: string;
    status: string;
    error: string;
    warnings: string[];
    revision: number;
  };
  page: { width: number; height: number; method: string } | null;
  lines: Line[];
};
type Choice = {
  action: "skip" | "create" | "complete";
  title: string;
  taskId: string;
  allowDuplicate: boolean;
};
export default function TaskNotebooks({
  tasks,
  projects,
  goals,
  writable,
  onChange,
}: {
  tasks: Task[];
  projects: Workstream[];
  goals: Workstream[];
  writable: boolean;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [notebooks, setNotebooks] = useState<Notebook[]>([]),
    [selected, setSelected] = useState(""),
    [reading, setReading] = useState<Reading | null>(null),
    [choices, setChoices] = useState<Record<string, Choice>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [enabled, setEnabled] = useState(true),
    [active, setActive] = useState(""),
    [projectId, setProjectId] = useState(""),
    [goalId, setGoalId] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const load = useCallback(async () => {
    const r = await fetch("/api/task-notebooks");
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    setNotebooks(v.notebooks);
    setSelected((current) => current || v.notebooks[0]?.id || "");
    setEnabled(v.enabled);
  }, []);
  const read = useCallback(async (id: string, reset = false) => {
    const r = await fetch("/api/task-notebooks?id=" + encodeURIComponent(id));
    const v: Reading & { error?: string } = await r.json();
    if (!r.ok) throw Error(v.error);
    if (selectedRef.current !== id) return;
    setReading(v);
    if (reset) setChoices({});
  }, []);
  useEffect(() => {
    if (open) void load().catch((e) => setMessage(e.message));
  }, [open, load]);
  useEffect(() => {
    if (!open || !selected) return;
    void read(selected, true).catch((e) => setMessage(e.message));
  }, [open, selected, read]);
  useEffect(() => {
    if (
      !open ||
      !selected ||
      !reading ||
      !["queued", "running"].includes(reading.notebook.status)
    )
      return;
    const timer = setInterval(
      () =>
        void Promise.all([load(), read(selected)]).catch((e) =>
          setMessage(e.message),
        ),
      3000,
    );
    return () => clearInterval(timer);
  }, [open, selected, reading, read, load]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Unable to complete request.",
      );
    } finally {
      setBusy(false);
    }
  };
  const send = async (body: unknown) => {
    const r = await fetch("/api/task-notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      v = await r.json();
    if (!r.ok) throw Error(v.error);
    return v;
  };
  const choice = (line: Line): Choice =>
    choices[line.id] || {
      action: "skip",
      title: line.title,
      taskId:
        line.matches.length === 1 && line.matches[0].stage !== "Done"
          ? line.matches[0].id
          : "",
      allowDuplicate: false,
    };
  const update = (line: Line, v: Partial<Choice>) =>
    setChoices((old) => ({ ...old, [line.id]: { ...choice(line), ...v } }));
  const chosen =
    reading?.lines.filter(
      (line) => !line.applied_at && choice(line).action !== "skip",
    ) || [];
  return (
    <section className={styles.section} aria-label="Notebook tasks">
      <button
        className={styles.toggle}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>
          <NotebookPen size={19} />
          <strong>From paper to progress</strong>
          <small>Turn a notebook image into reviewed tasks</small>
        </span>
        <span>{open ? "Close" : "Open notebook"}</span>
      </button>
      {open && (
        <div className={styles.body}>
          <p>
            Your image stays private to your account. The local reader suggests
            text; you choose every task change. Printed English works best.
            Handwriting and crossed-out marks may be missed.
          </p>
          <div className={styles.toolbar}>
            <label className="btn secondary">
              <Upload size={15} />
              Upload notebook image
              <input
                aria-label="Upload notebook image"
                type="file"
                accept="image/png,image/jpeg"
                disabled={busy || !writable || !enabled}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void run(async () => {
                      const form = new FormData();
                      form.append("file", file);
                      const r = await fetch("/api/task-notebooks", {
                          method: "POST",
                          body: form,
                        }),
                        v = await r.json();
                      if (!r.ok) throw Error(v.error);
                      await load();
                      setSelected(v.id);
                      setMessage(
                        "Image queued. The local reader will prepare text for review.",
                      );
                    });
                }}
                hidden
              />
            </label>
            <select
              aria-label="Choose notebook"
              value={selected}
              onChange={(e) => {
                setReading(null);
                setSelected(e.target.value);
                setMessage("");
              }}
            >
              <option value="">Choose a previous notebook</option>
              {notebooks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.original_name} · {n.status}
                </option>
              ))}
            </select>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await load();
                  if (selected) await read(selected, true);
                })
              }
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
          {!enabled && (
            <p role="status">
              Local OCR is disabled. Enable the documented reader and worker to
              process images.
            </p>
          )}
          {message && (
            <p className={styles.message} role="status">
              {message}
            </p>
          )}
          {!selected && (
            <div className={styles.empty}>
              <FileSearch size={28} />
              <h3>Keep the page. Reuse the ideas.</h3>
              <p>
                Upload a PNG or JPEG up to 10 MB. Nothing becomes a task until
                you confirm it.
              </p>
            </div>
          )}
          {reading && (
            <>
              <div className={styles.status}>
                <strong>{reading.notebook.name}</strong>
                <span>{reading.notebook.status}</span>
              </div>
              {["queued", "running"].includes(reading.notebook.status) && (
                <p role="status">
                  Reading locally… You can leave this page and return later.
                  Start <code>npm run ocr:worker</code> if the reader is
                  offline.
                </p>
              )}
              {reading.notebook.status === "failed" && (
                <p role="alert">
                  {reading.notebook.error}{" "}
                  <button
                    disabled={busy || !writable}
                    className="btn secondary"
                    onClick={() =>
                      void run(async () => {
                        await send({
                          action: "retry",
                          notebookId: selected,
                          revision: reading.notebook.revision,
                        });
                        await read(selected, true);
                        await load();
                      })
                    }
                  >
                    Retry reading
                  </button>
                </p>
              )}
              {reading.notebook.status === "completed" && (
                <>
                  <div className={styles.grid}>
                    <div className={styles.source}>
                      <a
                        href={
                          "/api/task-notebooks?id=" +
                          encodeURIComponent(selected) +
                          "&source=1"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open original image
                      </a>
                      <div className={styles.image}>
                        <img
                          alt="Your uploaded notebook source"
                          src={
                            "/api/task-notebooks?id=" +
                            encodeURIComponent(selected) +
                            "&source=1"
                          }
                        />
                        {reading.page &&
                          active &&
                          reading.lines
                            .filter((l) => l.id === active)
                            .map((l) => (
                              <span
                                className={styles.region}
                                key={l.id}
                                style={{
                                  left: `${(l.box[0] / reading.page!.width) * 100}%`,
                                  top: `${(l.box[1] / reading.page!.height) * 100}%`,
                                  width: `${(l.box[2] / reading.page!.width) * 100}%`,
                                  height: `${(l.box[3] / reading.page!.height) * 100}%`,
                                }}
                              />
                            ))}
                      </div>
                      <p>
                        Click “Locate source” to highlight the text. Source text
                        is preserved when you correct a task title.
                      </p>
                      {reading.notebook.warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                    </div>
                    <div className={styles.lines}>
                      {!reading.lines.length && (
                        <p>
                          No readable lines found. Try a clearer image, or use
                          Add task to transcribe the page manually.
                        </p>
                      )}
                      {reading.lines.map((line) => {
                        const c = choice(line);
                        return (
                          <article
                            key={line.id}
                            className={active === line.id ? styles.active : ""}
                          >
                            <div className={styles.lineHead}>
                              <small>
                                Source line {line.line_index + 1}
                                {line.confidence !== null
                                  ? ` · OCR ${Math.round(line.confidence)} / 100`
                                  : ""}
                              </small>
                              <button onClick={() => setActive(line.id)}>
                                Locate source
                              </button>
                            </div>
                            <blockquote>{line.source_text}</blockquote>
                            {line.applied_at ? (
                              <p className={styles.applied}>
                                <CheckCircle2 size={15} />
                                {line.action === "created"
                                  ? "Created"
                                  : "Completed"}{" "}
                                · {line.reviewed_title}
                                <small>
                                  {new Date(line.applied_at).toLocaleString()}
                                </small>
                              </p>
                            ) : (
                              <>
                                {line.completion_hint && (
                                  <p className={styles.hint}>
                                    A checked marker may be present. Confirm its
                                    meaning against the image.
                                  </p>
                                )}
                                {!!line.matches.length && (
                                  <p className={styles.hint}>
                                    {line.matches.length} existing task
                                    {line.matches.length === 1 ? "" : "s"} with
                                    the same title
                                    {line.matches.some(
                                      (m) => m.stage === "Done",
                                    )
                                      ? " (including completed work)"
                                      : ""}
                                    . Review before creating a duplicate.
                                  </p>
                                )}
                                <label>
                                  What should happen?
                                  <select
                                    aria-label={
                                      "Action for source line " +
                                      (line.line_index + 1)
                                    }
                                    value={c.action}
                                    disabled={busy || !writable}
                                    onChange={(e) =>
                                      update(line, {
                                        action: e.target
                                          .value as Choice["action"],
                                      })
                                    }
                                  >
                                    <option value="skip">
                                      Leave unchanged
                                    </option>
                                    <option value="create">
                                      Create a new task
                                    </option>
                                    <option value="complete">
                                      Complete an existing task
                                    </option>
                                  </select>
                                </label>
                                {c.action === "create" && (
                                  <>
                                    <label>
                                      Reviewed task title
                                      <input
                                        maxLength={200}
                                        value={c.title}
                                        onChange={(e) =>
                                          update(line, {
                                            title: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className={styles.check}>
                                      <input
                                        type="checkbox"
                                        checked={c.allowDuplicate}
                                        onChange={(e) =>
                                          update(line, {
                                            allowDuplicate: e.target.checked,
                                          })
                                        }
                                      />
                                      Allow another task with the same title
                                    </label>
                                  </>
                                )}
                                {c.action === "complete" && (
                                  <label>
                                    Task to mark Done
                                    <select
                                      aria-label={
                                        "Completion target for source line " +
                                        (line.line_index + 1)
                                      }
                                      value={c.taskId}
                                      onChange={(e) =>
                                        update(line, { taskId: e.target.value })
                                      }
                                    >
                                      <option value="">
                                        Choose an unfinished task
                                      </option>
                                      {tasks
                                        .filter((t) => t.stage !== "Done")
                                        .map((t) => (
                                          <option key={t.id} value={t.id}>
                                            {t.title}
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                )}
                              </>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                  {!!chosen.length && (
                    <div className={styles.review}>
                      <h3>
                        Review {chosen.length} selected change
                        {chosen.length === 1 ? "" : "s"}
                      </h3>
                      <p>
                        {
                          chosen.filter((l) => choice(l).action === "create")
                            .length
                        }{" "}
                        new task
                        {chosen.filter((l) => choice(l).action === "create")
                          .length === 1
                          ? ""
                          : "s"}{" "}
                        ·{" "}
                        {
                          chosen.filter((l) => choice(l).action === "complete")
                            .length
                        }{" "}
                        existing tasks marked Done. Other tasks stay unchanged.
                        Completion is saved in task history.
                      </p>
                      <div className={styles.toolbar}>
                        <label>
                          Project for new tasks
                          <select
                            aria-label="Project for new tasks"
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                          >
                            <option value="">No project</option>
                            {projects.map((p) => (
                              <option value={p.id} key={p.id}>
                                {p.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Goal for new tasks
                          <select
                            aria-label="Goal for new tasks"
                            value={goalId}
                            onChange={(e) => setGoalId(e.target.value)}
                          >
                            <option value="">No goal</option>
                            {goals.map((g) => (
                              <option value={g.id} key={g.id}>
                                {g.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button
                        className="btn primary"
                        disabled={busy || !writable || chosen.length > 50}
                        onClick={() =>
                          void run(async () => {
                            const result = await send({
                              action: "apply",
                              notebookId: selected,
                              revision: reading.notebook.revision,
                              projectId,
                              goalIds: goalId ? [goalId] : [],
                              items: chosen.map((line) => {
                                const c = choice(line),
                                  t = tasks.find((t) => t.id === c.taskId);
                                return {
                                  lineId: line.id,
                                  action: c.action,
                                  title:
                                    c.action === "complete"
                                      ? t?.title || c.title
                                      : c.title,
                                  taskId: c.taskId,
                                  taskRevision: t?.revision,
                                  allowDuplicate: c.allowDuplicate,
                                };
                              }),
                            });
                            await read(selected, true);
                            await load();
                            await onChange();
                            setMessage(
                              `Saved: ${result.created} created, ${result.completed} completed.`,
                            );
                          })
                        }
                      >
                        {busy ? "Saving…" : "Confirm selected task changes"}
                      </button>
                      {chosen.length > 50 && (
                        <p>Review up to 50 lines at a time.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
