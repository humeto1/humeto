"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Check,
  Timer,
  Sparkles,
  ArrowRight,
  Flag,
  Square,
  RotateCcw,
} from "lucide-react";
import type { Task } from "@/lib/types";
import styles from "./task-focus.module.css";
type Session = {
  id: string;
  task_id: string;
  title: string;
  state: string;
  total_seconds: number;
  target_minutes: number;
  revision: number;
  task_revision: number;
  check_in_at: string | null;
  started_at: string;
  ended_at: string | null;
  project_title: string;
  note: string;
};
type Snapshot = {
  active: Session | null;
  history: Session[];
  serverNow: string;
};
const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(
      2,
      "0",
    )}:${Math.floor(s / 60) % 60 < 10 ? "0" : ""}${Math.floor(s / 60) % 60}:${(s % 60).toString().padStart(2, "0")}`;
};
export default function TaskFocus({
  tasks,
  writable,
  onChange,
  onFocusChange,
}: {
  tasks: Task[];
  writable: boolean;
  onChange: () => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [received, setReceived] = useState(0),
    [now, setNow] = useState(Date.now()),
    [selected, setSelected] = useState(""),
    [minutes, setMinutes] = useState(25),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showAll, setShowAll] = useState(false),
    [history, setHistory] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/workspace/focus", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not load focus.");
      setData(j);
      setReceived(Date.now());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    const wake = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const active = data?.active || null;
  useEffect(() => {
    onFocusChange(!!active && !showAll);
    return () => onFocusChange(false);
  }, [active?.id, showAll, onFocusChange]);
  const candidates = [...tasks]
    .filter((t) => t.stage !== "Done" && t.id !== active?.task_id)
    .sort(
      (a, b) =>
        Number(b.important) - Number(a.important) ||
        Number(b.urgent) - Number(a.urgent) ||
        (a.due_date || "9999").localeCompare(b.due_date || "9999"),
    );
  const chosen = candidates.find((t) => t.id === selected) || candidates[0];
  const elapsed =
    (active?.total_seconds || 0) +
    (active?.state === "running" ? Math.max(0, (now - received) / 1000) : 0);
  const serverTime = data
    ? Date.parse(data.serverNow) + Math.max(0, now - received)
    : now;
  const checkDue =
    !!active &&
    active.state === "running" &&
    !!active.check_in_at &&
    serverTime >= Date.parse(active.check_in_at);
  async function act(action: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          taskId: chosen?.id,
          taskRevision: active ? active.task_revision : chosen?.revision,
          sessionId: active?.id,
          revision: active?.revision,
          minutes,
          note,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not update focus.");
      if (action === "start") setShowAll(false);
      setNote("");
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
      await load();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.shell} aria-label="Task focus companion">
      <div className={styles.top}>
        <span>
          <Sparkles size={16} /> Task AI · Focus companion
        </span>
        <button
          type="button"
          onClick={() => setHistory(!history)}
          className={styles.textButton}
        >
          {history ? "Hide history" : "Time history"}
        </button>
      </div>
      {!data && !error ? (
        <p role="status">Preparing your focus space…</p>
      ) : active ? (
        <>
          <div className={styles.grid}>
            <div>
              <p className={styles.eyebrow}>ONE THING AT A TIME</p>
              <h2>{active.title}</h2>
              <p className={styles.message} role="status">
                {active.state === "blocked"
                  ? "What’s getting in the way? Leave a note, then take a smaller step or switch to something you can move forward."
                  : active.state === "paused"
                    ? "Take your time. Your progress is saved. Resume when you’re ready."
                    : checkDue
                      ? "Time for a check-in. Is this finished, do you need more time, or is something blocking you?"
                      : "You’ve made space for this. Everything else can wait until your next check-in."}
              </p>
              {active.project_title && (
                <span className={styles.pill}>{active.project_title}</span>
              )}
            </div>
            <div className={styles.timer}>
              <Timer size={21} />
              <strong aria-label="Elapsed focus time">{clock(elapsed)}</strong>
              <span>
                {active.state === "running"
                  ? "Tracking time"
                  : active.state === "blocked"
                    ? "Blocked · timer stopped"
                    : "Paused · timer stopped"}
              </span>
              <small>
                Initial estimate {active.target_minutes} min
                {active.state === "running" && active.check_in_at
                  ? ` · Check-in ${checkDue ? "due now" : `in ${Math.max(1, Math.ceil((Date.parse(active.check_in_at) - serverTime) / 60000))} min`}`
                  : ""}
              </small>
            </div>
          </div>
          {active.note && (
            <p className={styles.savedNote}>Last note: {active.note}</p>
          )}
          <label className={styles.note}>
            What’s happening?{" "}
            <input
              placeholder="Waiting for a reply, making progress, need help…"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              disabled={!writable || busy}
            />
          </label>
          <div className={styles.controls}>
            <label>
              Next check-in{" "}
              <input
                type="number"
                aria-label="Check-in minutes"
                min="1"
                max="720"
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />{" "}
              min
            </label>
            <button
              type="button"
              disabled={!writable || busy}
              onClick={() =>
                act(active.state === "running" ? "extend" : "resume")
              }
              className={styles.primary}
            >
              <Play size={14} />
              {active.state === "running" ? "Keep going" : "Resume"}
            </button>
            {active.state === "running" && (
              <button
                type="button"
                disabled={!writable || busy}
                onClick={() => act("pause")}
              >
                <Pause size={14} />
                Pause
              </button>
            )}
            <button
              type="button"
              disabled={!writable || busy}
              onClick={() => act("complete")}
            >
              <Check size={14} />
              Finished
            </button>
            <button
              type="button"
              disabled={!writable || busy}
              onClick={() => act("blocked")}
            >
              <Flag size={14} />
              I’m blocked
            </button>
            <button
              type="button"
              disabled={!writable || busy}
              onClick={() => act("stop")}
            >
              <Square size={14} />
              Stop & choose another
            </button>
          </div>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Return to focus" : "Show the rest of my tasks"}{" "}
            <ArrowRight size={13} />
          </button>
        </>
      ) : (
        <>
          <p className={styles.eyebrow}>LET’S MAKE TODAY FEEL LIGHTER</p>
          <h2>What would you like to move forward first?</h2>
          <p className={styles.message}>
            Choose one task and a comfortable amount of time. I’ll check in here
            when it’s time to review your progress.
          </p>
          {chosen ? (
            <>
              <div className={styles.pick}>
                <label>
                  Your first task
                  <select
                    aria-label="Focus task"
                    value={chosen.id}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {candidates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.important ? "★ " : ""}
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Expected time
                  <input
                    aria-label="Expected focus minutes"
                    type="number"
                    min="1"
                    max="720"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                  <small>minutes · you can change this later</small>
                </label>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={
                    !data ||
                    !writable ||
                    busy ||
                    !Number.isInteger(minutes) ||
                    minutes < 1 ||
                    minutes > 720
                  }
                  onClick={() => act("start")}
                >
                  <Play size={15} />
                  Let’s begin
                </button>
              </div>
              <p className={styles.hint}>
                Important tasks are suggested first. You choose what matters
                today.
              </p>
            </>
          ) : (
            <p>No unfinished tasks. Add a task above when you’re ready.</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            <RotateCcw size={12} />
            Retry
          </button>
        </p>
      )}
      {history && (
        <div className={styles.history}>
          <h3>Recent focus sessions</h3>
          {data?.history.length ? (
            data.history.slice(0, 12).map((s) => (
              <article key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  <small>
                    {new Date(s.started_at).toLocaleString()} · {s.state}
                    {s.note ? ` · ${s.note}` : ""}
                  </small>
                </div>
                <span>{clock(s.total_seconds)}</span>
              </article>
            ))
          ) : (
            <p>Your completed and stopped sessions will appear here.</p>
          )}
        </div>
      )}
      <p className={styles.hint}>
        Local companion · check-ins appear while this app is open. Time is saved
        across refreshes.
      </p>
    </section>
  );
}
