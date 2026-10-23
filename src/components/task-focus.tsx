"use client";
import { playTone } from "../../shared/alert-controls";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Play,
  Pause,
  Check,
  Timer,
  Sparkles,
  ArrowRight,
  Flag,
  RotateCcw,
  Send,
  Bell,
  MessageCircle,
  Target,
} from "lucide-react";
import type { Task } from "@/lib/types";
import { focusGuidance, type FocusProposal } from "@/lib/focus-coach";
import { RandomTaskPicker, FocusTransition } from "../../shared/focus-play";
import { FocusRest } from "../../shared/focus-rest";
import styles from "./task-focus.module.css";
type Session = {
  id: string;
  task_id: string;
  title: string;
  state: string;
  total_seconds: number;
  target_minutes: number;
  display_title?: string;
  revision: number;
  task_revision: number;
  check_in_at: string | null;
  break_until?: string;
  break_kind?: string;
  started_at: string;
  ended_at: string | null;
  project_title: string;
  note: string;
  progress: number | null;
  next_step: string;
  blocker: string;
};
type Event = {
  id: string;
  session_id: string;
  title: string;
  event: string;
  note: string;
  assistant_reply: string;
  created_at: string;
  progress: number | null;
  next_step: string;
};
type Snapshot = {
  active: Session | null;
  history: Session[];
  events: Event[];
  taskTotals?: { task_id: string; seconds: number; sessions: number }[];
  serverNow: string;
};
type Preview = {
  reply: string;
  proposal: FocusProposal | null;
  sessionId: string | null;
  revision: number | null;
};
const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(Math.floor(s / 60) % 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
};
function reason(t: Task) {
  return (
    [
      t.important ? "Important" : "",
      t.urgent ? "Urgent" : "",
      t.due_date ? `Due ${t.due_date}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "A little progress counts"
  );
}
export default function TaskFocus({
  tasks,
  writable,
  onChange,
  onFocusChange,
  memberKey,
}: {
  tasks: Task[];
  writable: boolean;
  onChange: () => void;
  onFocusChange: (focused: boolean) => void;
  memberKey: string;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [received, setReceived] = useState(0),
    [now, setNow] = useState(Date.now()),
    [selected, setSelected] = useState(""),
    [minutes, setMinutes] = useState(25),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showAll, setShowAll] = useState(false),
    [history, setHistory] = useState(false),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [progress, setProgress] = useState(""),
    [nextStep, setNextStep] = useState(""),
    [switching, setSwitching] = useState(false),
    [alerts, setAlerts] = useState(false),
    [alertStatus, setAlertStatus] = useState(""),
    [canNotify, setCanNotify] = useState(false);
  const sentAlert = useRef("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/workspace/focus", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not load focus.");
      setData(j);
      setReceived(Date.now());
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
  useEffect(() => {
    setProgress(active?.progress == null ? "" : String(active.progress));
    setNextStep(active?.next_step || "");
    setMinutes(active?.target_minutes || 25);
    setPreview(null);
    setMessage("");
    setSwitching(false);
    setShowAll(location.hash === "#task-followups");
  }, [active?.id]);
  useEffect(() => {
    const revealInbox = () => {
      if (location.hash === "#task-followups") setShowAll(true);
    };
    window.addEventListener("hashchange", revealInbox);
    return () => window.removeEventListener("hashchange", revealInbox);
  }, []);
  useEffect(() => {
    setCanNotify("Notification" in window);
    try {
      setAlerts(
        localStorage.getItem("humeto-focus-alerts:" + memberKey) === "on" &&
          "Notification" in window &&
          Notification.permission === "granted",
      );
    } catch {}
  }, [memberKey]);
  const candidates = [...tasks]
    .filter((t) => t.stage !== "Done" && t.id !== active?.task_id)
    .sort(
      (a, b) =>
        Number(b.important) - Number(a.important) ||
        Number(b.urgent) - Number(a.urgent) ||
        (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
        a.title.localeCompare(b.title),
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
  const validMinutes =
    Number.isInteger(minutes) && minutes >= 1 && minutes <= 720;
  const breakDue =
    !!active?.break_until &&
    active.state !== "running" &&
    Date.parse(active.break_until) <= serverTime;
  useEffect(() => {
    if (
      (!checkDue && !breakDue) ||
      !active ||
      !alerts ||
      !canNotify ||
      Notification.permission !== "granted"
    )
      return;
    const key = breakDue
        ? `${active.id}:break:${active.break_until}`
        : `${active.id}:${active.check_in_at}`,
      store = "humeto-focus-last-alert:" + memberKey;
    if (sentAlert.current === key) return;
    sentAlert.current = key;
    try {
      if (localStorage.getItem(store) === key) return;
      localStorage.setItem(store, key);
      void fetch("/api/workspace/scheduling")
        .then((r) => r.json())
        .then((s) => {
          if (!s.preferences?.enabled || s.quietUntil) return;
          new Notification(
            breakDue
              ? "Humeto · Break finished"
              : "Humeto · Time for a check-in",
            {
              body: breakDue
                ? "Ready to return? Your work clock stays paused until you resume."
                : "How is your task going? Come back to finish, continue or change your plan.",
              tag: "humeto-focus-" + memberKey,
              silent: true,
            },
          );
          if (s.preferences.vibration && "vibrate" in navigator)
            navigator.vibrate([200, 100, 200]);
          void playTone(s.preferences.tone || "chime").catch(() =>
            setAlertStatus(
              "Sound is blocked by browser settings. Your check-in is shown here.",
            ),
          );
        })
        .catch(() =>
          setAlertStatus(
            "Unable to check alert preferences. Your check-in is still shown here.",
          ),
        );
    } catch {
      setAlertStatus(
        "Browser alerts are unavailable. Your check-in is still shown here.",
      );
    }
  }, [
    checkDue,
    breakDue,
    active?.id,
    active?.check_in_at,
    active?.break_until,
    alerts,
    canNotify,
    memberKey,
  ]);
  async function toggleAlerts() {
    if (alerts) {
      setAlerts(false);
      try {
        localStorage.setItem("humeto-focus-alerts:" + memberKey, "off");
      } catch {}
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        setAlerts(true);
        localStorage.setItem("humeto-focus-alerts:" + memberKey, "on");
        setAlertStatus("Alerts enabled while Humeto remains open.");
      } else
        setAlertStatus(
          "Browser alerts were not enabled. Check-ins still appear in this app.",
        );
    } catch {
      setAlertStatus("Your browser does not support these alerts.");
    }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
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
          nextTaskRevision: chosen?.revision,
          sessionId: active?.id,
          revision: active?.revision,
          minutes,
          ...extra,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not update focus.");
      setPreview(null);
      setMessage("");
      if (["start", "switch"].includes(action)) {
        setShowAll(false);
        if (location.hash === "#task-followups")
          window.history.replaceState(
            null,
            "",
            location.pathname + location.search,
          );
      }
      await load();
      onChange();
    } catch (e) {
      await load();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function interpret(text = message) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace/focus/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not prepare that update.");
      setMessage(text);
      setPreview(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const events = (data?.events || [])
    .filter((e) => e.session_id === active?.id && (e.note || e.assistant_reply))
    .slice(0, 8)
    .reverse();
  const lastFinished = data?.history[0];
  const progressValid =
    progress === "" ||
    (Number.isInteger(Number(progress)) &&
      Number(progress) >= 0 &&
      Number(progress) <= 100);
  const stalePreview =
    !!preview &&
    (preview.sessionId !== active?.id || preview.revision !== active?.revision);
  const taskPicker = (switchTask = false) => (
    <div className={styles.pick}>
      <RandomTaskPicker tasks={candidates} onChoose={setSelected} />
      <label>
        {switchTask ? "What can you move forward instead?" : "Your first task"}
        <select
          aria-label={switchTask ? "Switch focus task" : "Focus task"}
          value={chosen?.id || ""}
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
        {switchTask ? "Time for this task" : "Expected time"}
        <input
          aria-label={
            switchTask ? "Switch focus minutes" : "Expected focus minutes"
          }
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
        disabled={!data || !writable || busy || !validMinutes || !chosen}
        onClick={() => act(switchTask ? "switch" : "start")}
      >
        <Play size={15} />
        {switchTask ? "Save & switch task" : "Let’s begin"}
      </button>
    </div>
  );
  return (
    <section
      className={`${styles.shell} ${checkDue ? styles.checkDue : ""}`}
      aria-label="Task focus companion"
    >
      <div className={styles.top}>
        <span>
          <Sparkles size={16} /> Task AI · Focus companion{" "}
          <small className={styles.mode}>Local command mode</small>
        </span>
        <div className={styles.topActions}>
          {canNotify && (
            <button
              type="button"
              onClick={() => void toggleAlerts()}
              aria-pressed={alerts}
              className={styles.textButton}
            >
              <Bell size={14} />
              {alerts ? "Check-in alerts on" : "Enable check-in alerts"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setHistory(!history)}
            className={styles.textButton}
          >
            {history ? "Hide history" : "Time history"}
          </button>
        </div>
      </div>
      {alertStatus && (
        <p className={styles.hint} role="status">
          {alertStatus}
        </p>
      )}
      {!data && !error ? (
        <p role="status">Preparing your focus space…</p>
      ) : active ? (
        <>
          <div className={styles.grid}>
            <div>
              <p className={styles.eyebrow}>ONE THING AT A TIME</p>
              <h2>{active.display_title || active.title}</h2>
              {active.display_title && <small>Original: {active.title}</small>}
              <p className={styles.message} role="status">
                {active.state === "blocked"
                  ? focusGuidance(active.blocker, active.next_step)
                  : active.state === "paused"
                    ? "Take your time. Your progress is saved. Resume when you’re ready."
                    : checkDue
                      ? "Time for a check-in. Is this finished, do you need more time, or is something blocking you?"
                      : "You’ve made space for this. Everything else can wait until your next check-in."}
              </p>
              {active.project_title && (
                <span className={styles.pill}>
                  <Target size={12} /> {active.project_title}
                </span>
              )}
              {active.progress !== null && (
                <div className={styles.progressTrack}>
                  <div
                    role="progressbar"
                    aria-label="Reported task progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={active.progress}
                  >
                    <span style={{ width: `${active.progress}%` }} />
                  </div>
                  <small>
                    {active.progress}% reported ·{" "}
                    {active.progress === 100
                      ? "mark Finished when you’re ready"
                      : "the task stays open"}
                  </small>
                </div>
              )}
              {active.next_step && (
                <p className={styles.savedNote}>
                  <strong>Next small step</strong>
                  <br />
                  {active.next_step}
                </p>
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
                Initial estimate {active.target_minutes} min ·{" "}
                {Math.max(
                  0,
                  Math.ceil((active.target_minutes * 60 - elapsed) / 60),
                )}{" "}
                min left in estimate
              </small>
              {active.state === "running" && active.check_in_at && (
                <span className={checkDue ? styles.dueLabel : ""}>
                  {checkDue
                    ? "Check-in ready"
                    : `Check-in in ${Math.max(1, Math.ceil((Date.parse(active.check_in_at) - serverTime) / 60000))} min`}
                </span>
              )}
            </div>
          </div>
          {checkDue && (
            <div className={styles.checkIn} role="status">
              <Sparkles size={20} />
              <div>
                <strong>How is it going?</strong>
                <p>
                  You don’t have to finish on the estimate. Tell me what changed
                  and choose your next step.
                </p>
              </div>
            </div>
          )}
          <FocusRest
            key={active.id}
            active={active}
            now={serverTime}
            totalSeconds={
              Number(
                data?.taskTotals?.find((t) => t.task_id === active.task_id)
                  ?.seconds || 0,
              ) + Math.max(0, elapsed - Number(active.total_seconds))
            }
            sessions={
              data?.taskTotals?.find((t) => t.task_id === active.task_id)
                ?.sessions || 1
            }
            onAction={(action, extra) => void act(action, extra)}
            busy={busy || !writable}
          />
          <FocusTransition onReady={() => setSwitching(true)} />
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
              disabled={!writable || busy || !validMinutes}
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
              Mark task complete
            </button>
            <button
              type="button"
              disabled={!writable || busy}
              onClick={() => setSwitching(!switching)}
            >
              <ArrowRight size={14} />
              Choose another task
            </button>
          </div>
          <div className={styles.interactiveGrid}>
            <div className={styles.conversation}>
              <h3>
                <MessageCircle size={16} /> Talk through your task
              </h3>
              <p className={styles.hint}>
                Tell me how it’s going. I’ll propose a small update for you to
                review.
              </p>
              <div
                className={styles.transcript}
                aria-label="Saved focus conversation"
              >
                {events.length ? (
                  events.map((e) => (
                    <div key={e.id}>
                      {e.note && (
                        <div className={styles.userBubble}>
                          <span>
                            You ·{" "}
                            {new Date(e.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <p>{e.note}</p>
                        </div>
                      )}
                      {e.assistant_reply && (
                        <div className={styles.coachBubble}>
                          <span>
                            Humeto ·{" "}
                            {e.event === "started"
                              ? "focus started"
                              : e.event === "progress"
                                ? "progress saved"
                                : e.event}
                          </span>
                          <p>{e.assistant_reply}</p>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className={styles.coachBubble}>
                    <span>Humeto</span>
                    <p>
                      What would help you move this task forward? You can save a
                      note, report progress, or ask for a different pace.
                    </p>
                  </div>
                )}
              </div>
              <div className={styles.quickReplies}>
                {[
                  "50% done, need 15 more minutes",
                  "I’m blocked waiting for a reply",
                  "What should I do next?",
                ].map((text) => (
                  <button
                    type="button"
                    key={text}
                    disabled={busy || !writable}
                    onClick={() => void interpret(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void interpret();
                }}
                className={styles.composer}
              >
                <label className={styles.srOnly} htmlFor="focus-message">
                  Tell your task companion
                </label>
                <textarea
                  id="focus-message"
                  placeholder="e.g. 50% done, need 15 more minutes…"
                  value={message}
                  maxLength={2000}
                  disabled={!writable || busy}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setPreview(null);
                  }}
                />
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={busy || !writable || !message.trim()}
                >
                  <Send size={15} />
                  Review
                </button>
              </form>
              {preview && (
                <div
                  className={styles.proposal}
                  aria-label="Review focus update"
                >
                  <strong>Humeto suggests</strong>
                  <p>{preview.reply}</p>
                  {preview.proposal && (
                    <>
                      <small>
                        {preview.proposal.action === "complete"
                          ? "Marks this task Done and ends the timer."
                          : preview.proposal.action === "progress"
                            ? "Saves progress without changing the timer."
                            : preview.proposal.action === "blocked" ||
                                preview.proposal.action === "pause"
                              ? "Stops the timer; the task stays open."
                              : `Runs the timer and sets a check-in in ${preview.proposal.minutes || minutes} minutes.`}
                      </small>
                      {stalePreview && (
                        <p role="status">
                          Your focus changed. Review your message again before
                          applying.
                        </p>
                      )}
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={
                          busy || !writable || stalePreview || !validMinutes
                        }
                        onClick={() => {
                          const { action, ...fields } = preview.proposal!;
                          void act(action, {
                            ...fields,
                            sessionId: preview.sessionId,
                            revision: preview.revision,
                          });
                        }}
                      >
                        {preview.proposal.action === "complete"
                          ? "Confirm task complete"
                          : "Apply this update"}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => setPreview(null)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
            <div className={styles.progressPanel}>
              <h3>
                <Target size={16} /> Make the next step smaller
              </h3>
              <label>
                Progress (%)
                <input
                  aria-label="Task progress percent"
                  type="number"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={(e) => setProgress(e.target.value)}
                  placeholder="Optional"
                  disabled={!writable || busy}
                />
              </label>
              <label>
                One small next step
                <textarea
                  aria-label="Next small step"
                  value={nextStep}
                  maxLength={500}
                  onChange={(e) => setNextStep(e.target.value)}
                  placeholder="e.g. Check the passport expiry date"
                  disabled={!writable || busy}
                />
              </label>
              <button
                type="button"
                disabled={
                  !writable ||
                  busy ||
                  !progressValid ||
                  (progress === "" && !nextStep.trim())
                }
                onClick={() =>
                  act("progress", {
                    progress: progress === "" ? undefined : Number(progress),
                    nextStep: nextStep.trim(),
                    note: nextStep.trim()
                      ? `Next step: ${nextStep.trim()}`
                      : `Progress: ${progress}%`,
                  })
                }
              >
                Save progress
              </button>
              <h3>
                <Flag size={15} /> What’s getting in the way?
              </h3>
              <div className={styles.blockers}>
                {[
                  ["waiting", "Waiting for someone"],
                  ["unclear", "Not sure where to start"],
                  ["overwhelmed", "Too much at once"],
                  ["other", "Something else"],
                ].map(([blocker, label]) => (
                  <button
                    type="button"
                    key={blocker}
                    disabled={!writable || busy}
                    onClick={() => act("blocked", { blocker, note: label })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className={styles.hint}>
                A blocker pauses your time. It never marks the task finished.
              </p>
            </div>
          </div>
          {(switching || active.state === "blocked") && (
            <div className={styles.switchPanel}>
              <p className={styles.eyebrow}>KEEP YOUR MOMENTUM</p>
              <h3>Want to work on something you can move forward?</h3>
              <p className={styles.message}>
                Your current task, time and notes will be saved. Switching keeps
                it open and starts one new timer.
              </p>
              {chosen ? (
                taskPicker(true)
              ) : (
                <p>
                  No other unfinished tasks. You can pause here or add another
                  task.
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              if (showAll && location.hash === "#task-followups")
                window.history.replaceState(
                  null,
                  "",
                  location.pathname + location.search,
                );
              setShowAll(!showAll);
            }}
          >
            {showAll ? "Return to focus" : "Show the rest of my tasks"}{" "}
            <ArrowRight size={13} />
          </button>
        </>
      ) : (
        <>
          {lastFinished && lastFinished.state === "completed" && (
            <div className={styles.celebration}>
              <Check size={20} />
              <div>
                <strong>One more thing moved forward.</strong>
                <p>
                  {lastFinished.title} · {clock(lastFinished.total_seconds)}{" "}
                  saved
                  {lastFinished.project_title
                    ? ` toward ${lastFinished.project_title}`
                    : ""}
                  .
                </p>
              </div>
            </div>
          )}
          <p className={styles.eyebrow}>LET’S MAKE TODAY FEEL LIGHTER</p>
          <h2>What would you like to move forward first?</h2>
          <p className={styles.message}>
            Choose one task and a comfortable amount of time. I’ll check in here
            when it’s time to review your progress.
          </p>
          {chosen ? (
            <>
              <div className={styles.suggestions}>
                {candidates.slice(0, 3).map((t, i) => (
                  <button
                    type="button"
                    key={t.id}
                    aria-pressed={chosen.id === t.id}
                    onClick={() => setSelected(t.id)}
                  >
                    <span>
                      {i === 0 ? "Suggested first" : `Another option`}{" "}
                      <ArrowRight size={13} />
                    </span>
                    <strong>{t.title}</strong>
                    <small>{reason(t)}</small>
                    {t.project_title && (
                      <small>
                        <Target size={11} /> {t.project_title}
                      </small>
                    )}
                  </button>
                ))}
              </div>
              {taskPicker()}
              <p className={styles.hint}>
                Suggested by importance, urgency and deadline. You choose what
                matters today.
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
          <button
            type="button"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            <RotateCcw size={12} />
            Retry
          </button>
        </p>
      )}
      {history && (
        <div className={styles.history}>
          <h3>Your recent focus journey</h3>
          <p className={styles.hint}>
            Your last 50 sessions. Completed tasks and time toward projects are
            also available in Projects & progress.
          </p>
          {data?.history.length ? (
            data.history.map((s) => (
              <details key={s.id}>
                <summary>
                  <span>
                    <strong>{s.title}</strong>
                    <small>
                      {new Date(s.started_at).toLocaleString()} · {s.state}
                      {s.project_title ? ` · ${s.project_title}` : ""}
                    </small>
                  </span>
                  <span>{clock(s.total_seconds)}</span>
                </summary>
                <p>
                  Started working: {new Date(s.started_at).toLocaleString()}
                  <br />
                  Finished working:{" "}
                  {s.ended_at
                    ? new Date(s.ended_at).toLocaleString()
                    : "Still open"}
                </p>
                {s.note && <p>{s.note}</p>}
                {s.next_step && <p>Next step: {s.next_step}</p>}
                {(data.events || [])
                  .filter((e) => e.session_id === s.id)
                  .reverse()
                  .map((e) => (
                    <p key={e.id} className={styles.historyEvent}>
                      <strong>{e.event}</strong>
                      {e.note ? ` · ${e.note}` : ""}
                      {e.assistant_reply && <span>{e.assistant_reply}</span>}
                    </p>
                  ))}
              </details>
            ))
          ) : (
            <p>Your completed and stopped sessions will appear here.</p>
          )}
        </div>
      )}
      <p className={styles.hint}>
        Local companion · saved progress and conversations survive refresh.
        Check-ins and optional browser alerts work while Humeto remains open;
        closed-app push comes later.
      </p>
    </section>
  );
}
