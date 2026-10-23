import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  CheckCircle2,
  Timer,
  Sparkles,
  Flag,
  Home,
  ChevronRight,
  X,
  RefreshCw,
  LogOut,
  Bell,
  Play,
  Pause,
  Target,
  Calendar,
  Users,
  WifiOff,
  Folder,
  Send,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { api, ApiError, SERVER, timezone } from "./api";
import type { Bootstrap, Task, Workstream } from "./types";
import {
  enableNotifications,
  syncNotifications,
  clearNotifications,
} from "./notifications";
import "./style.css";
const priorities = [
  ["Do now", "Important & urgent"],
  ["Schedule", "Important, not urgent"],
  ["Delegate", "Urgent, not important"],
  ["Later", "Neither urgent nor important"],
];
const priority = (t: Task) =>
  t.important ? (t.urgent ? 0 : 1) : t.urgent ? 2 : 3;
const formatDate = (s: string) =>
  s
    ? new Date(s + "T12:00:00").toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : "No due date";
async function openWeb(path: string) {
  if (Capacitor.isNativePlatform()) await Browser.open({ url: SERVER + path });
  else window.open(SERVER + path, "_blank", "noopener");
}
function Sheet({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select,textarea,a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="shade"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={close} aria-label="Close">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Auth({ ready }: { ready: () => Promise<void> }) {
  const [mode, setMode] = useState("login"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [type, setType] = useState("individual");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = Object.fromEntries(f);
      await api(
        "/api/auth/" +
          (mode === "signup"
            ? "register"
            : mode === "reset"
              ? "forgot-password"
              : "login"),
        body,
      );
      if (mode === "login") await ready();
      else {
        setMessage(
          mode === "signup"
            ? "Check your email to verify your account, then sign in here."
            : "Check your email for the password reset link.",
        );
        setMode("login");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <div className="brand">
        <b>h</b> humeto.
      </div>
      <span className="eyebrow">MAKE SPACE FOR WHAT MATTERS</span>
      <h1>
        Big ambitions.
        <br />
        <em>One next step.</em>
      </h1>
      <p>Your tasks, your goals and a little help moving forward.</p>
      <div className="auth-card">
        <h2>
          {mode === "signup"
            ? "Make a fresh start."
            : mode === "reset"
              ? "Reset your password."
              : "Welcome back."}
        </h2>
        <p>
          {mode === "signup"
            ? "Same Humeto account. Free 15-day trial."
            : "Use your existing Humeto email and password."}
        </p>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <>
              <label>
                Your name
                <input name="name" minLength={2} required autoComplete="name" />
              </label>
              <label>
                Account type
                <select
                  name="accountType"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="individual">Individual</option>
                  <option value="company">Company / team</option>
                </select>
              </label>
              {type === "company" && (
                <>
                  <label>
                    Company name
                    <input name="companyName" required minLength={2} />
                  </label>
                  <label>
                    Business type
                    <select name="industry">
                      <option value="education">Education consultant</option>
                      <option value="immigration">
                        Immigration consultant
                      </option>
                      <option value="lawyer">Law firm</option>
                      <option value="travel">Travel agency</option>
                      <option value="custom">Custom CRM</option>
                    </select>
                  </label>
                </>
              )}
            </>
          )}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          {mode !== "reset" && (
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={mode === "signup" ? 12 : 1}
                maxLength={128}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                required
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="success" role="status">
              {message}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy
              ? "One moment…"
              : mode === "login"
                ? "Sign in"
                : mode === "signup"
                  ? "Start free trial"
                  : "Send reset link"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <button
          className="text"
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError("");
          }}
        >
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "New to Humeto? Create an account"}
        </button>
        <button
          className="text muted"
          onClick={() => {
            setMode(mode === "reset" ? "login" : "reset");
            setError("");
          }}
        >
          {mode === "reset" ? "Back to sign in" : "Forgot password?"}
        </button>
      </div>
      <small>
        One account across mobile and web · Your information stays in your
        workspace.
      </small>
    </main>
  );
}
function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("today"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [busy, setBusy] = useState(false),
    [sheet, setSheet] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [view, setView] = useState("priority"),
    [filter, setFilter] = useState("pending"),
    [focus, setFocus] = useState<any>(null),
    [schedule, setSchedule] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [agent, setAgent] = useState<any>(null),
    [draft, setDraft] = useState(""),
    [minutes, setMinutes] = useState(25),
    [tick, setTick] = useState(Date.now());
  const dataRef = useRef(data);
  dataRef.current = data;
  async function refresh() {
    const d = await api<Bootstrap>("/api/mobile");
    setData(d);
    const [f, s, h] = await Promise.all([
      api("/api/workspace/focus"),
      api("/api/workspace/scheduling"),
      api(
        "/api/workspace/task-history?timezone=" + encodeURIComponent(timezone),
      ),
    ]);
    setFocus(f);
    setSchedule(s);
    setHistory(h);
    await syncNotifications(s.reminders, f.active);
  }
  async function load() {
    setError("");
    try {
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && dataRef.current)
        void load();
    }, 30000);
    const network = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && dataRef.current) void load();
    };
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    const listener = NativeApp.addListener("appStateChange", (s) => {
      if (s.isActive && dataRef.current) void load();
    });
    return () => {
      clearInterval(t);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      void listener.then((l) => l.remove());
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () => {
      if (sheet) {
        setSheet(null);
        setSelected(null);
      } else if (tab !== "today") setTab("today");
      else void NativeApp.exitApp();
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, [sheet, tab]);
  useEffect(() => {
    if (tab === "assistant" && data)
      void api("/api/agent?timezone=" + encodeURIComponent(timezone))
        .then(setAgent)
        .catch((e) => setError(e.message));
  }, [tab]);
  async function run(
    fn: () => Promise<void>,
    msg = "Saved.",
    refreshAfter = true,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (refreshAfter) await refresh();
      setNotice(msg);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  if (loading)
    return (
      <div className="loading">
        <div className="brand">
          <b>h</b> humeto.
        </div>
        <p>Making room for your next step…</p>
      </div>
    );
  if (!data)
    return (
      <>
        {error && <div className="banner error">{error}</div>}
        <Auth ready={refresh} />
      </>
    );
  const writable = data.writable && online && !busy,
    active = focus?.active,
    pending = data.tasks.filter((t) => t.stage !== "Done"),
    completed = data.tasks.filter((t) => t.stage === "Done");
  const task = data.tasks.find((t) => t.id === selected);
  const label = (stage: string) =>
    data.stages.stages.find((s) => s.key === stage)?.title || stage;
  const filtered = data.tasks.filter(
    (t) =>
      (filter === "all" ||
        (filter === "done" ? t.stage === "Done" : t.stage !== "Done")) &&
      [t.title, t.project_title, t.assignee]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const card = (t: Task) => (
    <button
      className="task"
      key={t.id}
      onClick={() => {
        setSelected(t.id);
        setSheet("task");
      }}
    >
      <span className={"task-mark p" + priority(t)}>
        {t.stage === "Done" ? <Check size={15} /> : <span />}
      </span>
      <span className="task-copy">
        <strong>{t.title}</strong>
        <small>
          {t.project_title || "No project"} · {formatDate(t.due_date)}
        </small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
  async function patch(t: Task, body: unknown) {
    await api(
      "/api/workspace/tasks/" + t.id,
      { stage: t.stage, revision: t.revision, ...(body as object) },
      "PATCH",
    );
  }
  async function focusAction(action: string, extras: object = {}) {
    await run(
      async () => {
        await api("/api/workspace/focus", {
          action,
          sessionId: active?.id,
          revision: active?.revision,
          minutes,
          ...extras,
        });
      },
      action === "complete"
        ? "Task completed. A step forward."
        : "Focus updated.",
    );
  }
  const elapsed = active
    ? Number(active.total_seconds) +
      (active.state === "running" && focus.serverNow
        ? Math.max(
            0,
            Math.floor((tick - new Date(focus.serverNow).getTime()) / 1000),
          )
        : 0)
    : 0;
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <b>h</b> humeto.
        </div>
        <div>
          <button
            className="icon"
            onClick={() => setSheet("reminders")}
            aria-label="Reminders"
          >
            <Bell size={21} />
            {schedule?.reminders?.length > 0 && <i />}
          </button>
          <button
            className="avatar"
            aria-label="Account settings"
            onClick={() => setSheet("settings")}
          >
            {data.actor.name
              .split(" ")
              .map((x) => x[0])
              .slice(0, 2)
              .join("")}
          </button>
        </div>
      </header>
      {!online && (
        <div className="banner">
          <WifiOff size={16} /> You're offline. Reconnect to save changes.
        </div>
      )}
      {!data.writable && (
        <div className="banner">
          Your workspace is read-only.{" "}
          <button className="text" onClick={() => setSheet("settings")}>
            Manage access
          </button>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      )}
      <main className="content">
        {tab === "today" && (
          <>
            <div className="page-intro">
              <span className="eyebrow">
                {new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
              <h1>
                A little focus.
                <br />
                <em>A lot more flow.</em>
              </h1>
              <p>Hello, {data.actor.name.split(" ")[0]}. What matters today?</p>
            </div>
            <section className="focus-hero">
              <span className="eyebrow">YOUR NEXT SMALL WIN</span>
              <h2>
                {active ? active.title : "One task. Your full attention."}
              </h2>
              <p>
                {active
                  ? "Your focus session is waiting for you."
                  : "Choose something meaningful. We’ll help you stay with it."}
              </p>
              <button className="primary" onClick={() => setTab("focus")}>
                {active ? "Return to focus" : "Find my focus"}
                <ArrowUpRight size={18} />
              </button>
              <div className="orbit">
                <Target />
              </div>
            </section>
            <div className="stats">
              <button
                onClick={() => {
                  setFilter("pending");
                  setTab("tasks");
                }}
              >
                <strong>{pending.length}</strong>
                <small>To move forward</small>
              </button>
              <button
                onClick={() => {
                  setFilter("done");
                  setTab("tasks");
                }}
              >
                <strong>{completed.length}</strong>
                <small>Completed</small>
              </button>
            </div>
            <div className="section-title">
              <h2>Important, right now</h2>
              <button className="text" onClick={() => setTab("tasks")}>
                View all <ChevronRight size={14} />
              </button>
            </div>
            {pending
              .filter((t) => t.important)
              .slice(0, 4)
              .map(card)}
            {!pending.some((t) => t.important) && (
              <div className="empty">
                <Flag />
                <h3>A little room to choose.</h3>
                <p>
                  Mark a task important, or ask your assistant to help plan your
                  day.
                </p>
              </div>
            )}
            <button className="ask-card" onClick={() => setTab("assistant")}>
              <Sparkles />
              <span>
                <strong>Think it through with Humeto</strong>
                <small>Capture a task. Ask about priorities.</small>
              </span>
              <ArrowUpRight />
            </button>
          </>
        )}
        {tab === "tasks" && (
          <>
            <div className="section-title">
              <div>
                <span className="eyebrow">SMALL STEPS. REAL PROGRESS.</span>
                <h1>Tasks to-do</h1>
              </div>
              <button
                className="round primary"
                onClick={() => setSheet("create")}
                disabled={!writable}
                aria-label="Add task"
              >
                <Plus />
              </button>
            </div>
            <div className="search">
              <Search size={18} />
              <input
                placeholder="Find a task or project"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search tasks"
              />
            </div>
            <div className="toolbar">
              <div className="segments">
                <button
                  className={view === "priority" ? "selected" : ""}
                  onClick={() => setView("priority")}
                >
                  <LayoutGrid size={15} /> Priority
                </button>
                <button
                  className={view === "board" ? "selected" : ""}
                  onClick={() => setView("board")}
                >
                  Board
                </button>
                <button
                  className={view === "list" ? "selected" : ""}
                  onClick={() => setView("list")}
                >
                  <List size={15} />
                </button>
              </div>
              <select
                aria-label="Task filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="pending">Pending</option>
                <option value="done">Done</option>
                <option value="all">All tasks</option>
              </select>
            </div>
            {view === "priority" ? (
              <div className="matrix">
                {priorities.map(([name, description], i) => (
                  <section key={name} className={"quadrant q" + i}>
                    <header>
                      <h3>{name}</h3>
                      <span>
                        {filtered.filter((t) => priority(t) === i).length}
                      </span>
                    </header>
                    <p>{description}</p>
                    <div className="quadrant-scroll">
                      {filtered.filter((t) => priority(t) === i).map(card)}
                      {!filtered.some((t) => priority(t) === i) && (
                        <small className="muted">
                          A little space for what’s next.
                        </small>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ) : view === "board" ? (
              <div className="board">
                {data.stages.stages.map((s) => (
                  <section key={s.key}>
                    <header>
                      <h2>{s.title}</h2>
                      <span>
                        {filtered.filter((t) => t.stage === s.key).length}
                      </span>
                    </header>
                    {filtered.filter((t) => t.stage === s.key).map(card)}
                    {!filtered.some((t) => t.stage === s.key) && (
                      <p className="muted">Nothing here yet.</p>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <>
                {filtered.map(card)}
                {!filtered.length && (
                  <div className="empty">
                    <CheckCircle2 />
                    <h3>Room for your next step.</h3>
                    <p>Create a task or adjust your search.</p>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {tab === "focus" && (
          <>
            <div className="page-intro">
              <span className="eyebrow">ONE THING AT A TIME</span>
              <h1>
                Make space.
                <br />
                <em>For this moment.</em>
              </h1>
            </div>
            {active ? (
              <section className="focus-session">
                <span className="pill">
                  {active.state === "running" ? "● Focusing" : "Paused"}
                </span>
                <h2>{active.title}</h2>
                <div className="timer">
                  {String(Math.floor(elapsed / 60)).padStart(2, "0")}
                  <span>:</span>
                  {String(elapsed % 60).padStart(2, "0")}
                </div>
                <p>{active.target_minutes} minute session · Time spent</p>
                {active.check_in_at &&
                  new Date(active.check_in_at).getTime() <= tick && (
                    <div className="check-in">
                      <h3>How is it going?</h3>
                      <p>
                        Keep going, take a break, or choose a smaller next step.
                      </p>
                    </div>
                  )}
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={!writable}
                    onClick={() =>
                      void focusAction(
                        active.state === "running" ? "pause" : "resume",
                      )
                    }
                  >
                    {active.state === "running" ? (
                      <Pause size={17} />
                    ) : (
                      <Play size={17} />
                    )}{" "}
                    {active.state === "running" ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="primary"
                    disabled={!writable}
                    onClick={() => void focusAction("complete")}
                  >
                    Finished <Check size={17} />
                  </button>
                </div>
                <button
                  className="text"
                  disabled={!writable}
                  onClick={() => void focusAction("extend", { minutes: 10 })}
                >
                  Give me 10 more minutes
                </button>
                <button
                  className="text muted"
                  disabled={!writable}
                  onClick={() =>
                    void focusAction("blocked", {
                      blocker: "other",
                      note: "I need a different approach.",
                    })
                  }
                >
                  I'm stuck · take a pause
                </button>
                <button
                  className="text muted"
                  disabled={!writable}
                  onClick={() => void focusAction("stop")}
                >
                  Stop session & choose another task
                </button>
              </section>
            ) : (
              <>
                <section className="panel">
                  <h2>What would you like to move forward?</h2>
                  <p>Pick one task. Everything else can wait.</p>
                  <label>
                    Expected focus time
                    <select
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    >
                      {[10, 15, 25, 45, 60, 90].map((m) => (
                        <option value={m} key={m}>
                          {m} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                {pending.map((t) => (
                  <button
                    className="task"
                    disabled={!writable}
                    key={t.id}
                    onClick={() =>
                      void focusAction("start", {
                        taskId: t.id,
                        taskRevision: t.revision,
                      })
                    }
                  >
                    <Play size={18} />
                    <span className="task-copy">
                      <strong>{t.title}</strong>
                      <small>{t.project_title || "Your next step"}</small>
                    </span>
                  </button>
                ))}
                {!pending.length && (
                  <div className="empty">
                    <Target />
                    <h3>A clean slate.</h3>
                    <button
                      className="primary"
                      disabled={!writable}
                      onClick={() => setSheet("create")}
                    >
                      Create a task
                    </button>
                  </div>
                )}
              </>
            )}
            <h2 className="spaced">Recent focus</h2>
            {focus?.history?.slice(0, 5).map((s: any) => (
              <div className="history" key={s.id}>
                <Timer size={16} />
                <span>
                  {s.title}
                  <small>
                    {Math.floor(s.total_seconds / 60)} minutes · {s.state}
                  </small>
                </span>
              </div>
            ))}
          </>
        )}
        {tab === "assistant" && (
          <>
            <div className="section-title">
              <div>
                <span className="eyebrow">A LITTLE HELP MOVING FORWARD</span>
                <h1>Humeto assistant</h1>
              </div>
              <button
                className="icon"
                aria-label="New conversation"
                onClick={() =>
                  setAgent({ ...agent, threadId: null, messages: [] })
                }
              >
                <Plus />
              </button>
            </div>
            <div className="assistant-note">
              <Sparkles size={17} />
              {agent?.modelConfigured
                ? "GPT-5.4 mini · Changes need your approval"
                : "Task assistant · Reviewed actions"}
            </div>
            {!agent?.messages?.length && (
              <div className="chat-welcome">
                <Sparkles size={35} />
                <h2>What’s on your mind?</h2>
                <p>Turn a thought into a next step.</p>
                {[
                  "Create a task to review the proposal tomorrow",
                  "Show my important pending tasks",
                  "What tasks are overdue?",
                ].map((x) => (
                  <button key={x} onClick={() => setDraft(x)}>
                    {x}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            )}
            <div className="messages">
              {agent?.messages?.map((m: any) => (
                <article key={m.id} className={"message " + m.role}>
                  <small>{m.role === "user" ? "You" : "Humeto"}</small>
                  <p>{m.content}</p>
                  {m.result?.tasks?.map((t: Task) => (
                    <div className="chat-task" key={t.id}>
                      {t.title} · {formatDate(t.due_date)}
                    </div>
                  ))}
                  {m.result?.action && (
                    <div className="action-review">
                      <span className="eyebrow">REVIEW BEFORE APPLYING</span>
                      <h3>{m.result.action.payload.title}</h3>
                      <p>
                        {m.result.action.payload.stageTitle ||
                          label(m.result.action.payload.stage)}{" "}
                        · {formatDate(m.result.action.payload.dueDate)}
                      </p>
                      {m.result.action.payload.projectTitle && (
                        <p>
                          Project: {m.result.action.payload.projectTitle}
                          {m.result.action.payload.createProject
                            ? " · will be created"
                            : ""}
                        </p>
                      )}
                      {m.result.action.payload.reminderAt && (
                        <p>
                          Reminder:{" "}
                          {new Date(
                            m.result.action.payload.reminderAt,
                          ).toLocaleString()}
                        </p>
                      )}
                      {m.result.action.status === "pending" ? (
                        <div className="button-row">
                          {["apply", "cancel"].map((decision) => (
                            <button
                              className={
                                decision === "apply" ? "primary" : "secondary"
                              }
                              key={decision}
                              disabled={!writable}
                              onClick={() =>
                                void run(
                                  async () => {
                                    setAgent(
                                      await api("/api/agent", {
                                        operation: "action",
                                        actionId: m.result.action.id,
                                        decision,
                                        timezone,
                                      }),
                                    );
                                  },
                                  decision === "apply"
                                    ? "Applied."
                                    : "Proposal cancelled.",
                                )
                              }
                            >
                              {decision === "apply" ? "Apply" : "Cancel"}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <small>{m.result.action.status}</small>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                const message = draft.trim();
                if (!message) return;
                void run(async () => {
                  setAgent(
                    await api("/api/agent", {
                      operation: "message",
                      threadId: agent?.threadId || undefined,
                      message,
                      clientKey: crypto.randomUUID(),
                      timezone,
                    }),
                  );
                  setDraft("");
                }, "");
              }}
            >
              <textarea
                value={draft}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Capture a task, plan your day…"
                aria-label="Message Humeto"
                rows={2}
              />
              <button
                className="primary round"
                aria-label="Send message"
                disabled={!writable || !draft.trim()}
              >
                <Send size={18} />
              </button>
            </form>
          </>
        )}
        {tab === "projects" && (
          <>
            <div className="section-title">
              <div>
                <span className="eyebrow">THE BIGGER PICTURE</span>
                <h1>Projects & goals</h1>
              </div>
              <button
                className="icon"
                onClick={() => setSheet("project")}
                aria-label="Create project or goal"
                disabled={!writable}
              >
                <Plus />
              </button>
            </div>
            <section className="panel">
              <span className="eyebrow">YOUR MOMENTUM</span>
              <h2>{history?.uniqueCompleted || 0} tasks completed</h2>
              <p>
                Small steps add up. Each completion keeps its project and goal
                history.
              </p>
            </section>
            {(["projects", "goals"] as const).map((kind) => (
              <section key={kind}>
                <h2 className="spaced">
                  {kind === "projects" ? "Projects" : "Goals"}
                </h2>
                {data[kind].map((p) => (
                  <button
                    className="project"
                    key={p.id}
                    onClick={() => {
                      setQuery(p.title);
                      setFilter("all");
                      setTab("tasks");
                    }}
                  >
                    <Folder size={21} />
                    <span>
                      <strong>{p.title}</strong>
                      <small>
                        {p.status} ·{" "}
                        {kind === "projects"
                          ? data.tasks.filter((t) => t.project_id === p.id)
                              .length
                          : data.tasks.filter((t) =>
                              t.goals?.some((g) => g.id === p.id),
                            ).length}{" "}
                        linked tasks
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!data[kind].length && (
                  <div className="empty">
                    <p>
                      {kind === "projects"
                        ? "Give your tasks a shared purpose."
                        : "What would you like to work towards?"}
                    </p>
                    <button
                      className="text"
                      disabled={!writable}
                      onClick={() => setSheet("project")}
                    >
                      Create a {kind === "projects" ? "project" : "goal"}{" "}
                      <Plus size={14} />
                    </button>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </main>
      <nav className="bottom" aria-label="Main navigation">
        {[
          ["today", Home, "Today"],
          ["tasks", CheckCircle2, "Tasks"],
          ["focus", Timer, "Focus"],
          ["assistant", Sparkles, "Assistant"],
          ["projects", Flag, "Goals"],
        ].map(([key, Icon, text]) => {
          const I = Icon as typeof Home;
          return (
            <button
              key={String(key)}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(String(key));
                setError("");
              }}
            >
              <I size={21} />
              <span>{String(text)}</span>
            </button>
          );
        })}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {(sheet === "create" || (sheet === "task" && task)) && (
        <Sheet
          title={
            task && sheet === "task" ? "Your next step" : "A new next step"
          }
          close={() => {
            setSheet(null);
            setSelected(null);
          }}
        >
          {sheet === "create" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await api("/api/workspace/tasks", {
                    title: f.get("title"),
                    dueDate: f.get("dueDate") || "",
                    assignee: f.get("assignee") || "",
                    projectId: f.get("projectId") || "",
                    goalIds: f.getAll("goalIds"),
                    important: f.get("important") === "on",
                    urgent: f.get("urgent") === "on",
                  });
                  setSheet(null);
                }, "Task created.");
              }}
            >
              <label>
                What needs to happen?
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={200}
                  autoFocus
                  placeholder="A clear, small next step"
                />
              </label>
              <label>
                Due date
                <input type="date" name="dueDate" />
              </label>
              <label>
                Project
                <select name="projectId">
                  <option value="">No project</option>
                  {data.projects
                    .filter((p) => p.status !== "Archived")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Assigned to
                <select name="assignee" defaultValue={data.actor.name}>
                  <option value="">Unassigned</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="checks">
                <label>
                  <input type="checkbox" name="important" />
                  Important
                </label>
                <label>
                  <input type="checkbox" name="urgent" />
                  Urgent
                </label>
              </div>
              <fieldset>
                <legend>Contributes to goals</legend>
                {data.goals.map((g) => (
                  <label className="check" key={g.id}>
                    <input type="checkbox" name="goalIds" value={g.id} />
                    {g.title}
                  </label>
                ))}
                {!data.goals.length && (
                  <small>No goals yet. Add one in Goals.</small>
                )}
              </fieldset>
              <button className="primary full" disabled={!writable}>
                Create task <Plus size={17} />
              </button>
            </form>
          ) : (
            task && (
              <>
                <span className={"pill p" + priority(task)}>
                  {priorities[priority(task)][0]}
                </span>
                <h2 className="detail-title">{task.title}</h2>
                <p className="muted">
                  {task.project_title || "No project"} ·{" "}
                  {formatDate(task.due_date)}
                </p>
                <form
                  key={task.revision}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await patch(task, {
                        stage: f.get("stage"),
                        title: f.get("title"),
                        dueDate: f.get("dueDate") || "",
                        assignee: f.get("assignee") || "",
                        important: f.get("important") === "on",
                        urgent: f.get("urgent") === "on",
                      });
                    }, "Task updated.");
                  }}
                >
                  <label>
                    Task title
                    <input
                      name="title"
                      defaultValue={task.title}
                      required
                      minLength={2}
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Due date
                    <input
                      name="dueDate"
                      type="date"
                      defaultValue={task.due_date || ""}
                    />
                  </label>
                  <label>
                    Assigned to
                    <select name="assignee" defaultValue={task.assignee || ""}>
                      <option value="">Unassigned</option>
                      {data.members.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Workflow stage
                    <select name="stage" defaultValue={task.stage}>
                      {data.stages.stages.map((s) => (
                        <option value={s.key} key={s.key}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="checks">
                    <label>
                      <input
                        type="checkbox"
                        name="important"
                        defaultChecked={!!task.important}
                      />
                      Important
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="urgent"
                        defaultChecked={!!task.urgent}
                      />
                      Urgent
                    </label>
                  </div>
                  <button className="primary full" disabled={!writable}>
                    Save changes <Check size={17} />
                  </button>
                </form>
                <form
                  key={"links" + task.revision}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await api(
                        "/api/workspace/task-links/" + task.id,
                        {
                          revision: task.revision,
                          projectId: f.get("projectId") || "",
                          goalIds: f.getAll("goalIds"),
                        },
                        "PATCH",
                      );
                    }, "Project links saved.");
                  }}
                >
                  <label>
                    Project
                    <select
                      name="projectId"
                      defaultValue={task.project_id || ""}
                    >
                      <option value="">No project</option>
                      {data.projects.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset>
                    <legend>Goals</legend>
                    {data.goals.map((g) => (
                      <label className="check" key={g.id}>
                        <input
                          type="checkbox"
                          name="goalIds"
                          value={g.id}
                          defaultChecked={task.goals?.some(
                            (x) => x.id === g.id,
                          )}
                        />
                        {g.title}
                      </label>
                    ))}
                  </fieldset>
                  <button className="secondary full" disabled={!writable}>
                    Save project & goals
                  </button>
                </form>
                <Team
                  task={task}
                  writable={writable}
                  save={run}
                  members={data.members}
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await api("/api/workspace/scheduling", {
                        action: "remind",
                        taskId: task.id,
                        taskRevision: task.revision,
                        day: f.get("day"),
                        time: f.get("time"),
                        timezone,
                      });
                    }, "Reminder saved.");
                  }}
                >
                  <h3>A timely nudge</h3>
                  <div className="two">
                    <label>
                      Day
                      <input type="date" name="day" required />
                    </label>
                    <label>
                      Time
                      <input
                        type="time"
                        name="time"
                        defaultValue="09:00"
                        required
                      />
                    </label>
                  </div>
                  <button
                    className="secondary full"
                    disabled={!writable || task.stage === "Done"}
                  >
                    <Bell size={16} /> Set reminder
                  </button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await api("/api/workspace/scheduling", {
                        action: "series",
                        taskId: task.id,
                        taskRevision: task.revision,
                        frequency: f.get("frequency"),
                        interval: 1,
                        firstDay: f.get("firstDay"),
                        time: f.get("time"),
                        timezone,
                        endDay: "",
                      });
                    }, "Recurring series created.");
                  }}
                >
                  <h3>Make it a habit</h3>
                  <label>
                    Repeat
                    <select name="frequency">
                      <option value="daily">Daily</option>
                      <option value="weekdays">Weekdays</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                  <div className="two">
                    <label>
                      First day
                      <input type="date" name="firstDay" required />
                    </label>
                    <label>
                      Time
                      <input
                        type="time"
                        name="time"
                        defaultValue="09:00"
                        required
                      />
                    </label>
                  </div>
                  <button
                    className="secondary full"
                    disabled={!writable || task.stage === "Done"}
                  >
                    Create recurring series
                  </button>
                  <small className="muted">
                    Future occurrences are generated by your server scheduler.
                  </small>
                </form>
                {task.stage !== "Done" && (
                  <button
                    className="primary full"
                    disabled={!writable}
                    onClick={() =>
                      void run(async () => {
                        await patch(task, { stage: "Done" });
                        setSheet(null);
                      }, "Completed. Well done taking that step.")
                    }
                  >
                    <CheckCircle2 size={17} /> Mark complete
                  </button>
                )}
              </>
            )
          )}
        </Sheet>
      )}
      {sheet === "project" && (
        <Sheet title="A little direction" close={() => setSheet(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api("/api/workspace/" + f.get("kind"), {
                  title: f.get("title"),
                  description: f.get("description"),
                  targetDate: f.get("targetDate") || "",
                  status: "Active",
                });
                setSheet(null);
              }, "Created.");
            }}
          >
            <label>
              Type
              <select name="kind">
                <option value="projects">Project</option>
                <option value="goals">Goal</option>
              </select>
            </label>
            <label>
              Name
              <input name="title" required minLength={2} maxLength={160} />
            </label>
            <label>
              What would success look like?
              <textarea name="description" maxLength={2000} />
            </label>
            <label>
              Target date
              <input name="targetDate" type="date" />
            </label>
            <button className="primary full" disabled={!writable}>
              Create
            </button>
          </form>
        </Sheet>
      )}
      {sheet === "reminders" && (
        <Sheet title="Your timely nudges" close={() => setSheet(null)}>
          <button
            className="secondary full"
            onClick={() =>
              void run(async () => {
                if (!(await enableNotifications()))
                  throw Error(
                    "Notification permission is unavailable or was not granted. Enable it in device settings.",
                  );
              }, "Device reminders enabled.")
            }
          >
            <Bell size={16} /> Enable device reminders
          </button>
          <p className="muted">
            Upcoming reminders sync to this device while the app is open. Remote
            push and reminders created elsewhere while this app stays closed
            come later.
          </p>
          {schedule?.reminders?.map((r: any) => (
            <div className="reminder" key={r.id}>
              <h3>{r.title}</h3>
              <p>{new Date(r.remind_at).toLocaleString()}</p>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={!writable}
                  onClick={() =>
                    void run(async () => {
                      await api("/api/workspace/scheduling", {
                        action: "snooze",
                        id: r.id,
                        revision: r.revision,
                        minutes: 60,
                      });
                    }, "Snoozed for an hour.")
                  }
                >
                  Snooze 1h
                </button>
                <button
                  className="secondary"
                  disabled={!writable}
                  onClick={() =>
                    void run(async () => {
                      await api("/api/workspace/scheduling", {
                        action: "dismiss",
                        id: r.id,
                        revision: r.revision,
                      });
                    }, "Reminder dismissed.")
                  }
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
          {!schedule?.reminders?.length && (
            <div className="empty">
              <Bell />
              <h3>No nudges planned.</h3>
              <p>Open a task to set a reminder, or ask Humeto.</p>
            </div>
          )}
          {schedule?.series?.length > 0 && (
            <>
              <h3>Recurring tasks</h3>
              {schedule.series.map((s: any) => (
                <div className="reminder" key={s.id}>
                  <strong>{s.title}</strong>
                  <p>
                    {s.frequency} · {s.status} · next {formatDate(s.next_day)}
                  </p>
                  <button
                    className="secondary"
                    disabled={!writable}
                    onClick={() =>
                      void run(async () => {
                        await api("/api/workspace/scheduling", {
                          action: "series-state",
                          id: s.id,
                          revision: s.revision,
                          status: s.status === "active" ? "paused" : "active",
                        });
                      }, "Recurrence updated.")
                    }
                  >
                    {s.status === "active" ? "Pause" : "Resume"}
                  </button>
                </div>
              ))}
            </>
          )}
        </Sheet>
      )}
      {sheet === "settings" && (
        <Sheet title="Your space" close={() => setSheet(null)}>
          <div className="account">
            <div className="avatar">{data.actor.name[0]}</div>
            <h2>{data.actor.name}</h2>
            <p>{data.actor.email}</p>
            <small>
              {data.actor.tenantName} · {data.actor.role}
            </small>
          </div>
          <div className="panel">
            <h3>Workspace access</h3>
            <p>
              {data.subscription.status}
              {data.subscription.expires_at
                ? " · until " +
                  new Date(data.subscription.expires_at).toLocaleDateString()
                : ""}
            </p>
            <small>Same plan, roles and data as Humeto web.</small>
          </div>
          {data.actor.role === "owner" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await api("/api/workspace/vouchers", {
                    action: "redeem",
                    code: f.get("code"),
                  });
                }, "Voucher applied.");
              }}
            >
              <label>
                Access voucher
                <input
                  name="code"
                  required
                  autoCapitalize="characters"
                  placeholder="Your access code"
                />
              </label>
              <button className="secondary full" disabled={busy || !online}>
                Redeem voucher
              </button>
            </form>
          )}
          <button className="secondary full" onClick={() => void load()}>
            <RefreshCw size={16} /> Sync now
          </button>
          <button
            className="text"
            onClick={() => void openWeb("/workspace/tasks")}
          >
            Open Humeto web <ArrowUpRight size={15} />
          </button>
          <button
            className="secondary full"
            disabled={busy}
            onClick={() =>
              void run(
                async () => {
                  await api("/api/auth/logout", {});
                  await clearNotifications();
                  setData(null);
                  setSheet(null);
                },
                "Signed out.",
                false,
              )
            }
          >
            <LogOut size={16} /> Sign out
          </button>
          <small className="muted">
            Humeto mobile · 0.1.0 testing build
            <br />
            Cloud sync requires an internet connection. No private documents or
            passwords are stored in the app bundle.
          </small>
        </Sheet>
      )}
    </div>
  );
}
function Team({
  task,
  writable,
  save,
  members,
}: {
  task: Task;
  writable: boolean;
  save: (fn: () => Promise<void>, message?: string) => Promise<void>;
  members: { id: string; name: string }[];
}) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/api/workspace/assignments?type=task&id=" + task.id)
      .then(setState)
      .catch((e) => setError(e.message));
  }, [task.id]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save(async () => {
          await api("/api/workspace/assignments", {
            type: "task",
            id: task.id,
            userIds: f.getAll("members"),
            revision: state.revision,
          });
          setState(
            await api("/api/workspace/assignments?type=task&id=" + task.id),
          );
        }, "Team assignment saved.");
      }}
    >
      <h3>Shared with your team</h3>
      {error && <p className="error">{error}</p>}
      {state && (
        <>
          <fieldset>
            {members.map((m) => (
              <label className="check" key={m.id}>
                <input
                  type="checkbox"
                  name="members"
                  value={m.id}
                  defaultChecked={state.userIds.includes(m.id)}
                />
                {m.name}
              </label>
            ))}
          </fieldset>
          <button className="secondary full" disabled={!writable}>
            <Users size={16} /> Save team
          </button>
        </>
      )}
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
