import {
  TaskCurrencyProvider,
  CurrencyPreferences,
} from "../../shared/task-currency";
import { TaskOptions, TaskStorage } from "../../shared/task-storage";
import { GoalField } from "../../shared/goal-field";
import { taskGoals } from "../../shared/task-relations";
import { HomeTasks } from "../../shared/home-tasks";
import { useChatViewport } from "../../shared/chat-viewport";
import { TaskDetailGroup } from "../../shared/task-detail-group";
import { useTouchDrag } from "../../shared/touch-drag";
import { ParentControls } from "../../shared/parent-controls";
import { TaskActivity } from "../../shared/task-activity";
import { HoldToComplete } from "../../shared/focus-controls";
import { FocusRest } from "../../shared/focus-rest";
import BirdsEye from "../../shared/birds-eye";
import { TaskLinks } from "../../shared/task-links";
import { Share } from "@capacitor/share";
import { RandomTaskPicker, FocusTransition } from "../../shared/focus-play";
import { mergeConversation, useChatHistory } from "../../shared/chat-history";
import {
  TaskValueFields,
  TaskValueBadge,
  valuePayload,
} from "../../shared/task-value";
import TaskCalendar from "../../shared/task-calendar";
import PlanningHub from "../../shared/planning-hub";
import AlertControls from "../../shared/alert-controls";
import { deviceAlerts } from "./notifications";
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
  MessageSquare,
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
  Eye,
  Square,
  Users,
  WifiOff,
  Folder,
  Send,
} from "lucide-react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
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
const defaultCategories = [
  "Personal",
  "Work",
  "Social",
  "Relationship",
  "Family",
  "Hobby",
  "Financial",
];
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
async function downloadProjectFile(path: string, name: string) {
  if (!Capacitor.isNativePlatform()) {
    window.open(path, "_blank", "noopener");
    return;
  }
  const response = await CapacitorHttp.request({
    url: SERVER + path,
    method: "GET",
    headers: { Origin: SERVER },
    responseType: "blob",
  });
  if (response.status !== 200 || typeof response.data !== "string")
    throw Error("This file is not available for download.");
  const stored = await Filesystem.writeFile({
    path:
      "humeto-share-" +
      crypto.randomUUID() +
      "-" +
      name.replace(/[^a-zA-Z0-9._-]/g, "_"),
    data: response.data,
    directory: Directory.Cache,
  });
  await Share.share({
    title: name,
    files: [stored.uri],
    dialogTitle: "Open or share file",
  });
}
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
  const authLock = useRef(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (authLock.current) return;
    authLock.current = true;
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
      authLock.current = false;
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
    [impactFilter, setImpactFilter] = useState("all"),
    [projectFilter, setProjectFilter] = useState("all"),
    [goalFilter, setGoalFilter] = useState("all"),
    [natureFilter, setNatureFilter] = useState("all"),
    [categoryFilter, setCategoryFilter] = useState("all"),
    [dueFilter, setDueFilter] = useState("all"),
    [ownerFilter, setOwnerFilter] = useState("all"),
    [planView, setPlanView] = useState("projects"),
    [focusSelection, setFocusSelection] = useState(""),
    [focusQuery, setFocusQuery] = useState(""),
    [focus, setFocus] = useState<any>(null),
    [schedule, setSchedule] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [agent, setAgentRaw] = useState<any>(null),
    [draft, setDraft] = useState(""),
    [minutes, setMinutes] = useState(25),
    [tick, setTick] = useState(Date.now());
  const setAgent = (next: any) =>
    setAgentRaw((previous: any) => mergeConversation(previous, next));
  const chatHistory = useChatHistory(agent, setAgentRaw, (query) =>
    api("/api/agent" + query),
  );
  useChatViewport(tab === "assistant");
  const busyLock = useRef(false);
  const refreshSequence = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  async function refresh() {
    const sequence = ++refreshSequence.current;
    const [d, f, s, h] = await Promise.all([
      api<Bootstrap>("/api/mobile"),
      api("/api/workspace/focus"),
      api("/api/workspace/scheduling"),
      api(
        "/api/workspace/task-history?timezone=" + encodeURIComponent(timezone),
      ),
    ]);
    if (sequence !== refreshSequence.current) return;
    setData(d);
    setFocus(f);
    setSchedule(s);
    setHistory(h);
    await syncNotifications(s.reminders, f.active, s.preferences, s.series);
  }
  const loadingRequest = useRef(false);
  async function load() {
    if (loadingRequest.current) return;
    loadingRequest.current = true;
    try {
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      else setError((e as Error).message);
    } finally {
      loadingRequest.current = false;
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
    // Only the visible focus surfaces need second-by-second updates.
    if (!focus?.active || (tab !== "today" && tab !== "focus") || sheet) return;
    const update = () => {
      if (!document.hidden) setTick(Date.now());
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [focus?.active?.id, tab, sheet]);
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
    if (busyLock.current) return;
    busyLock.current = true;
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
      busyLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const touchTasks = useTouchDrag({
    enabled:
      !!data?.writable &&
      online &&
      !busy &&
      tab === "tasks" &&
      ["board", "priority"].includes(view),
    onDrop: async (id, zone) => {
      const t = data?.tasks.find((t) => t.id === id);
      if (!t) return;
      if (zone.startsWith("stage:")) {
        const stage = zone.slice(6);
        if (
          !data?.stages.stages.some((s) => s.key === stage) ||
          stage === t.stage
        )
          return;
        await run(() => patch(t, { stage }), "Task moved.");
      } else if (zone.startsWith("priority:")) {
        const n = Number(zone.slice(9));
        if (!Number.isInteger(n) || n < 0 || n > 3 || priority(t) === n) return;
        await run(
          () =>
            patch(t, {
              important: n === 0 || n === 1,
              urgent: n === 0 || n === 2,
            }),
          "Priority updated.",
        );
      }
    },
  });
  if (loading)
    return (
      <div className="loading">
        <div className="brand">
          <b>h</b> humeto.
        </div>
        <p>AI task management app</p>
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
  const focusTask = data.tasks.find((t) => t.id === active?.task_id);
  const focusChoice =
    pending.find((t) => t.id === focusSelection) || focusTask || pending[0];
  const switchPending =
    !!active && !!focusChoice && focusChoice.id !== active.task_id;
  const focusTitle =
    focusTask?.display_title ||
    focusTask?.title ||
    active?.display_title ||
    active?.title;
  const categories = [
    ...new Set([
      ...defaultCategories,
      ...data.tasks.map((t) => t.category || "").filter(Boolean),
    ]),
  ].sort();
  const todayDate = new Date().toLocaleDateString("en-CA");
  const task = data.tasks.find((t) => t.id === selected);
  const label = (stage: string) =>
    data.stages.stages.find((s) => s.key === stage)?.title || stage;
  function clearTaskFilters() {
    setImpactFilter("all");
    setProjectFilter("all");
    setGoalFilter("all");
    setCategoryFilter("all");
    setNatureFilter("all");
    setDueFilter("all");
    setOwnerFilter("all");
    setQuery("");
    setFilter("all");
  }
  const filtered = data.tasks.filter(
    (t) =>
      (impactFilter === "all" || (t.value_type || "none") === impactFilter) &&
      (projectFilter === "all" ||
        (projectFilter === "none"
          ? !t.project_id
          : t.project_id === projectFilter)) &&
      (goalFilter === "all" ||
        (goalFilter === "none"
          ? !taskGoals(t, data.projects, data.goals).length
          : taskGoals(t, data.projects, data.goals).some(
              (g) => g.id === goalFilter,
            ))) &&
      (natureFilter === "all" || (t.work_kind || "one_off") === natureFilter) &&
      (categoryFilter === "all" ||
        (categoryFilter === "uncategorized"
          ? !t.category
          : t.category === categoryFilter)) &&
      (ownerFilter === "all" ||
        (ownerFilter === "mine"
          ? t.assignee === data.actor.name
          : !t.assignee)) &&
      (dueFilter === "all" ||
        (dueFilter === "none"
          ? !t.due_date
          : dueFilter === "today"
            ? t.due_date === todayDate
            : !!t.due_date && t.due_date < todayDate && t.stage !== "Done")) &&
      (filter === "all" ||
        (filter === "done" ? t.stage === "Done" : t.stage !== "Done")) &&
      [
        t.title,
        t.display_title,
        t.category,
        t.project_title,
        t.assignee,
        ...taskGoals(t, data.projects, data.goals).map((g) => g.title),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const card = (t: Task) => (
    <div
      className={
        "touch-task-card" +
        (writable && ["board", "priority"].includes(view)
          ? " has-touch-handle"
          : "")
      }
      key={t.id}
      {...touchTasks.card(t.id, t.display_title || t.title)}
    >
      <button
        className="task"
        aria-label={"Open task: " + t.title}
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
          <strong>{t.display_title || t.title}</strong>
          {t.display_title && <small>Original: {t.title}</small>}
          <small>
            {t.project_title || "No project"} · {formatDate(t.due_date)}
          </small>
          <span className="task-tags">
            {t.category && <span className="task-tag">{t.category}</span>}
            {active?.task_id === t.id && (
              <span className="task-tag focusing">In focus</span>
            )}
            {t.stage !== "Done" && t.due_date && t.due_date < todayDate && (
              <span className="task-tag overdue">Overdue</span>
            )}
          </span>
          <TaskValueBadge task={t} />
        </span>
        <ChevronRight size={16} />
      </button>
      <TaskOptions
        task={t}
        writable={writable}
        refresh={refresh}
        request={api}
      />
    </div>
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
          taskRevision: active?.task_revision,
          minutes,
          ...extras,
        });
        setFocusSelection("");
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
    <TaskCurrencyProvider request={api} syncToken={data.tasks}>
      <div className={"app" + (tab === "assistant" ? " chat-screen" : "")}>
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
              <button className="ask-card" onClick={() => setTab("assistant")}>
                <Sparkles />
                <span>
                  <strong>Ask AI to add or edit your tasks</strong>
                  <small>Tell Humeto what you need. Review changes before applying.</small>
                </span>
                <ArrowUpRight />
              </button>
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
                <p>
                  Hello, {data.actor.name.split(" ")[0]}. What matters today?
                </p>
              </div>
              <section className="focus-hero">
                <span className="eyebrow">YOUR NEXT SMALL WIN</span>
                <h2>
                  {active ? focusTitle : "One task. Your full attention."}
                </h2>
                <p>
                  {active
                    ? "One task. Your full attention. Your active focus is shared here."
                    : "Choose something meaningful. We’ll help you stay with it."}
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    active ? setTab("focus") : setSheet("focus-picker")
                  }
                >
                  {active ? "Return to focus" : "Find my focus"}
                  <ArrowUpRight size={18} />
                </button>
                {active && (
                  <button
                    className="text"
                    disabled={!writable}
                    onClick={() => setSheet("focus-picker")}
                  >
                    Switch focus task
                  </button>
                )}
                <div className="orbit">
                  <Target />
                </div>
              </section>
              <HomeTasks
                tasks={data.tasks}
                projects={data.projects}
                goals={data.goals}
                writable={writable}
                request={api}
                refresh={refresh}
                onAdd={() => setSheet("create")}
                onOpen={(id) => {
                  setSelected(id);
                  setSheet("task");
                }}
              />
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
                    Mark a task important, or ask your assistant to help plan
                    your day.
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "tasks" && (
            <div ref={touchTasks.boardRef}>
              <span className="touch-drag-status" role="status">
                {touchTasks.status}
              </span>
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
              <TaskStorage
                tasks={data.tasks}
                writable={writable}
                refresh={refresh}
                request={api}
              >
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
                      aria-label="List view"
                      onClick={() => setView("list")}
                    >
                      <List size={15} />
                    </button>
                  </div>
                  <button
                    className="secondary"
                    aria-label="Calendar view"
                    aria-pressed={view === "calendar"}
                    title="Tasks by due date"
                    onClick={() => setView("calendar")}
                  >
                    <Calendar size={15} />
                  </button>
                  <button
                    className="secondary"
                    aria-label="Bird’s-eye view"
                    title="All tasks at a glance"
                    aria-pressed={view === "birds"}
                    onClick={() => setView("birds")}
                  >
                    <Eye size={16} />
                  </button>
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
                <div className="task-filter-reset">
                  <button type="button" onClick={clearTaskFilters}>
                    Clear filters
                  </button>
                </div>
                <details className="task-filter-panel">
                  <summary>
                    Filters ·{" "}
                    {
                      [
                        impactFilter,
                        projectFilter,
                        goalFilter,
                        natureFilter,
                        categoryFilter,
                        dueFilter,
                        ownerFilter,
                      ].filter((v) => v !== "all").length
                    }{" "}
                    active
                  </summary>
                  <div className="task-filters">
                    <label>
                      Expected impact
                      <select
                        aria-label="Expected impact filter"
                        value={impactFilter}
                        onChange={(e) => setImpactFilter(e.target.value)}
                      >
                        <option value="all">Any impact</option>
                        <option value="profit">Potential profit</option>
                        <option value="avoid_loss">Avoid loss</option>
                        <option value="none">No estimate</option>
                      </select>
                    </label>
                    <label>
                      Project
                      <select
                        aria-label="Project filter"
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
                      >
                        <option value="all">All projects</option>
                        <option value="none">No project</option>
                        {data.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Goal
                      <select
                        aria-label="Goal filter"
                        value={goalFilter}
                        onChange={(e) => setGoalFilter(e.target.value)}
                      >
                        <option value="all">All goals</option>
                        <option value="none">No goal</option>
                        {data.goals.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Task type
                      <select
                        aria-label="Task type filter"
                        value={natureFilter}
                        onChange={(e) => setNatureFilter(e.target.value)}
                      >
                        <option value="all">All work</option>
                        <option value="one_off">One-off tasks</option>
                        <option value="routine">Repeating</option>
                      </select>
                    </label>
                    <label>
                      Category
                      <select
                        aria-label="Category filter"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                      >
                        <option value="all">All categories</option>
                        <option value="uncategorized">Uncategorized</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Due date
                      <select
                        aria-label="Due date filter"
                        value={dueFilter}
                        onChange={(e) => setDueFilter(e.target.value)}
                      >
                        <option value="all">Any date</option>
                        <option value="today">Today</option>
                        <option value="overdue">Overdue</option>
                        <option value="none">No due date</option>
                      </select>
                    </label>
                    <label>
                      Assignment
                      <select
                        aria-label="Assignment filter"
                        value={ownerFilter}
                        onChange={(e) => setOwnerFilter(e.target.value)}
                      >
                        <option value="all">Everyone</option>
                        <option value="mine">Assigned to me</option>
                        <option value="unassigned">Unassigned</option>
                      </select>
                    </label>
                  </div>
                </details>
                {view === "birds" ? (
                  <BirdsEye
                    tasks={filtered}
                    openTask={(t) => {
                      setSelected(t.id);
                      setSheet("task");
                    }}
                    stageTitle={label}
                  />
                ) : view === "calendar" ? (
                  <TaskCalendar
                    tasks={filtered}
                    openTask={(t) => {
                      setSelected(t.id);
                      setSheet("task");
                    }}
                  />
                ) : view === "priority" ? (
                  <div className="matrix">
                    {priorities.map(([name, description], i) => (
                      <section
                        key={name}
                        className={"quadrant q" + i}
                        {...touchTasks.zone("priority:" + i, name)}
                      >
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
                      <section
                        key={s.key}
                        {...touchTasks.zone("stage:" + s.key)}
                      >
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
              </TaskStorage>
            </div>
          )}
          {tab === "focus" && (
            <>
              <div className="page-intro focus-intro">
                <span className="eyebrow">ONE THING AT A TIME</span>
                <h1>Focus</h1>
              </div>
              <section className="focus-session">
                {!active && <h2>Choose a task</h2>}
                <label className="focus-task-select">
                  Select task
                  <select
                    aria-label="Focus task selector"
                    disabled={!writable || !pending.length}
                    value={focusChoice?.id || ""}
                    onChange={(e) => setFocusSelection(e.target.value)}
                  >
                    {!pending.length && <option value="">No open tasks</option>}
                    {pending.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.display_title || t.title}
                      </option>
                    ))}
                  </select>
                </label>
                {active ? (
                  <>
                    <span className="pill">
                      {active.state === "running" ? "● Focusing" : "Paused"}
                    </span>
                    {switchPending && (
                      <p className="focus-switch-notice">
                        Start to switch · Current: {focusTitle}
                      </p>
                    )}
                    <div className="timer" aria-label="Elapsed focus time">
                      {String(Math.floor(elapsed / 60)).padStart(2, "0")}
                      <span>:</span>
                      {String(elapsed % 60).padStart(2, "0")}
                    </div>
                    <p className="focus-time-meta">
                      {active.target_minutes} min estimate
                    </p>
                    <div className="focus-toolbar">
                      <button
                        className="focus-ui-button focus-ui-primary"
                        disabled={
                          !writable ||
                          (active.state === "running" && !switchPending)
                        }
                        onClick={() =>
                          void focusAction(
                            switchPending ? "switch" : "resume",
                            switchPending
                              ? {
                                  taskId: focusChoice.id,
                                  nextTaskRevision: focusChoice.revision,
                                }
                              : {},
                          )
                        }
                      >
                        <Play size={15} />
                        Start
                      </button>
                      <button
                        className="focus-ui-button"
                        disabled={!writable || active.state !== "running"}
                        onClick={() => void focusAction("pause")}
                      >
                        <Pause size={15} />
                        Pause
                      </button>
                      <button
                        className="focus-ui-button"
                        disabled={!writable}
                        onClick={() => void focusAction("stop")}
                      >
                        <Square size={14} />
                        Stop
                      </button>
                      <HoldToComplete
                        key={active.id}
                        disabled={!writable || switchPending}
                        onComplete={() => void focusAction("complete")}
                      />
                    </div>
                    <FocusRest
                      key={active.id}
                      active={active}
                      now={tick}
                      totalSeconds={
                        Number(
                          focus?.taskTotals?.find(
                            (t: any) => t.task_id === active.task_id,
                          )?.seconds || 0,
                        ) + Math.max(0, elapsed - Number(active.total_seconds))
                      }
                      sessions={
                        focus?.taskTotals?.find(
                          (t: any) => t.task_id === active.task_id,
                        )?.sessions || 1
                      }
                      onAction={(action, extra) =>
                        void focusAction(action, extra)
                      }
                      busy={busy || !writable}
                    />
                    <FocusTransition onReady={() => setSheet("focus-picker")} />
                    <details className="focus-more">
                      <summary>Check-in options</summary>
                      <button
                        className="focus-ui-button"
                        disabled={!writable}
                        onClick={() =>
                          void focusAction("extend", { minutes: 10 })
                        }
                      >
                        +10 min
                      </button>
                      <button
                        className="focus-ui-button"
                        disabled={!writable}
                        onClick={() =>
                          void focusAction("blocked", {
                            blocker: "other",
                            note: "I need a different approach.",
                          })
                        }
                      >
                        I'm stuck
                      </button>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="focus-start-row">
                      <label className="focus-task-select">
                        Check-in
                        <select
                          aria-label="Expected focus time"
                          value={minutes}
                          onChange={(e) => setMinutes(Number(e.target.value))}
                        >
                          {[10, 15, 25, 45, 60, 90].map((m) => (
                            <option key={m} value={m}>
                              {m} min
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="focus-ui-button focus-ui-primary"
                        disabled={!writable || !focusChoice}
                        onClick={() =>
                          void focusAction("start", {
                            taskId: focusChoice?.id,
                            taskRevision: focusChoice?.revision,
                          })
                        }
                      >
                        <Play size={16} />
                        Start
                      </button>
                    </div>
                    <RandomTaskPicker
                      tasks={pending}
                      onChoose={setFocusSelection}
                    />
                    {!pending.length && (
                      <button
                        className="focus-ui-button"
                        disabled={!writable}
                        onClick={() => setSheet("create")}
                      >
                        <Plus size={15} />
                        New task
                      </button>
                    )}
                  </>
                )}
              </section>
              <h2 className="spaced">Recent focus</h2>
              {focus?.history?.slice(0, 5).map((s: any) => (
                <div className="history" key={s.id}>
                  <Timer size={16} />
                  <span>
                    {s.title}
                    <small>
                      {Math.floor(s.total_seconds / 60)} minutes ·{" "}
                      {s.state === "completed"
                        ? "Task completed"
                        : "Work session saved"}
                      <br />
                      Started: {new Date(s.started_at).toLocaleString()}
                      {s.ended_at && (
                        <>
                          <br />
                          Finished working:{" "}
                          {new Date(s.ended_at).toLocaleString()}
                        </>
                      )}
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
                  <h1>Chat</h1>
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
                  : "Humeto AI · Reviewed actions"}
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
              <div
                className="messages"
                tabIndex={0}
                aria-label="Conversation messages"
                ref={chatHistory.scroller}
                onScroll={chatHistory.onScroll}
                style={{
                  overflowY: "auto",
                  overflowAnchor: "none",
                }}
              >
                {agent?.history?.hasOlder && (
                  <button
                    onClick={() => void chatHistory.loadOlder()}
                    disabled={chatHistory.loadingOlder}
                  >
                    {chatHistory.loadingOlder
                      ? "Loading older messages…"
                      : "Load older messages"}
                  </button>
                )}
                {chatHistory.historyError && (
                  <p role="alert">
                    {chatHistory.historyError} Try loading again.
                  </p>
                )}
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
                <h1>Plans</h1>
                <label className="plan-add">
                  <span className="sr-only">Add plan</span>
                  <select
                    aria-label="Add plan"
                    value=""
                    disabled={!writable}
                    onChange={(e) => {
                      const kind = e.target.value;
                      setPlanView(kind);
                      setSheet("project");
                    }}
                  >
                    <option value="" disabled>
                      Add…
                    </option>
                    <option value="projects">Project</option>
                    <option value="goals">Goal</option>
                  </select>
                </label>
              </div>
              <div
                className="plan-sections"
                role="group"
                aria-label="Plan sections"
              >
                {[
                  ["projects", "Projects"],
                  ["goals", "Goals"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={planView === key ? "active" : ""}
                    aria-pressed={planView === key}
                    onClick={() => setPlanView(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <PlanningHub
                tasks={data.tasks}
                projects={data.projects}
                goals={data.goals}
                writable={writable}
                refresh={refresh}
                request={api}
                view={planView === "calendar" ? "calendar" : "deadlines"}
              />
              {(["projects", "goals"] as const)
                .filter((kind) => kind === planView)
                .map((kind) => (
                  <section key={kind}>
                    <h2 className="spaced">
                      {kind === "projects" ? "Projects" : "Goals"}
                    </h2>
                    {data[kind].map((p) => (
                      <article className="mobile-plan-card" key={p.id}>
                        <button
                          className="project"
                          key={p.id}
                          onClick={() => {
                            setQuery("");
                            setFilter("all");
                            setProjectFilter(
                              kind === "projects" ? p.id : "all",
                            );
                            setGoalFilter(kind === "goals" ? p.id : "all");
                            setCategoryFilter("all");
                            setNatureFilter("all");
                            setImpactFilter("all");
                            setDueFilter("all");
                            setOwnerFilter("all");
                            setTab("tasks");
                          }}
                        >
                          <Folder size={21} />
                          <span>
                            <strong>{p.title}</strong>
                            <small>
                              {p.category || "Uncategorized"} ·{" "}
                              {p.target_date
                                ? "Deadline " + p.target_date
                                : "Needs a deadline"}
                            </small>
                            {p.goal_id && (
                              <small>
                                Supports{" "}
                                {data.goals.find((g) => g.id === p.goal_id)
                                  ?.title || "a goal"}
                              </small>
                            )}
                            <small>
                              {p.status} ·{" "}
                              {kind === "projects"
                                ? data.tasks.filter(
                                    (t) => t.project_id === p.id,
                                  ).length
                                : data.tasks.filter((t) =>
                                    taskGoals(
                                      t,
                                      data.projects,
                                      data.goals,
                                    ).some((g) => g.id === p.id),
                                  ).length}{" "}
                              linked tasks
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                        <ParentControls
                          type={kind === "projects" ? "project" : "goal"}
                          id={p.id}
                          writable={writable}
                          request={api}
                          shareLink={async (url, title) => {
                            await Share.share({
                              title,
                              url,
                              dialogTitle: "Share project",
                            });
                          }}
                          downloadFile={downloadProjectFile}
                        />
                      </article>
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
            ["assistant", MessageSquare, "Chat"],
            ["projects", Flag, "Plans"],
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
        <datalist id="task-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {sheet === "focus-picker" && (
          <Sheet
            title={active ? "Switch focus task" : "Choose a focus task"}
            close={() => setSheet(null)}
          >
            <label>
              Find a task
              <input
                aria-label="Find focus task"
                value={focusQuery}
                onChange={(e) => setFocusQuery(e.target.value)}
                placeholder="Search tasks, projects or categories"
              />
            </label>
            <label>
              Expected focus time
              <select
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              >
                {[10, 15, 25, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
            <RandomTaskPicker
              tasks={pending.filter(
                (t) =>
                  t.id !== active?.task_id &&
                  [t.title, t.display_title, t.project_title, t.category]
                    .join(" ")
                    .toLowerCase()
                    .includes(focusQuery.toLowerCase()),
              )}
              onChoose={(id) => {
                const task = pending.find((t) => t.id === id);
                if (task) setFocusQuery(task.title);
              }}
            />
            <div className="focus-picker-list">
              {pending
                .filter(
                  (t) =>
                    t.id !== active?.task_id &&
                    [t.title, t.display_title, t.project_title, t.category]
                      .join(" ")
                      .toLowerCase()
                      .includes(focusQuery.toLowerCase()),
                )
                .map((t) => (
                  <button
                    className="task"
                    key={t.id}
                    disabled={!writable}
                    onClick={() =>
                      void run(
                        async () => {
                          await api("/api/workspace/focus", {
                            action: active ? "switch" : "start",
                            taskId: t.id,
                            taskRevision: t.revision,
                            nextTaskRevision: t.revision,
                            sessionId: active?.id,
                            revision: active?.revision,
                            minutes,
                          });
                          setSheet(null);
                          setFocusQuery("");
                          setTab("focus");
                        },
                        active
                          ? "Focus switched. Previous time saved."
                          : "Focus started.",
                      )
                    }
                  >
                    <Play size={18} />
                    <span className="task-copy">
                      <strong>{t.display_title || t.title}</strong>
                      {t.display_title && <small>Original: {t.title}</small>}
                      <small>
                        {t.category || "Uncategorized"} ·{" "}
                        {t.project_title || "No project"}
                      </small>
                    </span>
                  </button>
                ))}
            </div>
            {!pending.some(
              (t) =>
                t.id !== active?.task_id &&
                [t.title, t.display_title, t.project_title, t.category]
                  .join(" ")
                  .toLowerCase()
                  .includes(focusQuery.toLowerCase()),
            ) && (
              <p>
                No matching unfinished tasks. Add a task or try another search.
              </p>
            )}
          </Sheet>
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
                    const daily = f.get("repeat") === "daily";
                    await api(
                      daily
                        ? "/api/workspace/planning"
                        : "/api/workspace/tasks",
                      {
                        ...(daily
                          ? {
                              action: "routine",
                              kind: "operations",
                              frequency: "daily",
                              interval: 1,
                              firstDay:
                                f.get("dueDate") ||
                                new Date().toLocaleDateString("en-CA"),
                              time: "00:00",
                              timezone,
                            }
                          : {}),
                        ...valuePayload(f),
                        title: f.get("title"),
                        category: f.get("category") || "",
                        dueDate: f.get("dueDate") || "",
                        assignee: f.get("assignee") || "",
                        projectId: f.get("projectId") || "",
                        goalIds: f.getAll("goalIds"),
                        important: f.get("important") === "on",
                        urgent: f.get("urgent") === "on",
                      },
                    );
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
                  Repeat
                  <select name="repeat" aria-label="Repeat" defaultValue="none">
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                  </select>
                </label>
                <label>
                  Category
                  <input
                    name="category"
                    list="task-categories"
                    maxLength={60}
                    placeholder="Choose or type your own"
                  />
                </label>
                <TaskValueFields />
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
                <GoalField goals={data.goals} />
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
                  <h2 className="detail-title">
                    {task.display_title || task.title}
                  </h2>
                  {task.display_title && <p>Original: {task.title}</p>}
                  {task.stage !== "Done" && active?.task_id !== task.id && (
                    <button
                      className="secondary"
                      disabled={!writable}
                      onClick={() => {
                        setFocusQuery(task.title);
                        setSheet("focus-picker");
                      }}
                    >
                      <Timer size={16} />
                      Focus on this task
                    </button>
                  )}
                  <p className="muted">
                    {task.project_title || "No project"} ·{" "}
                    {formatDate(task.due_date)}
                  </p>
                  <TaskDetailGroup
                    title="Task essentials"
                    hint="Title, date, stage & priority"
                    open
                  >
                    <form
                      key={task.revision}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(async () => {
                          await patch(task, {
                            ...valuePayload(f),
                            stage: f.get("stage"),
                            title: f.get("title"),
                            category: f.get("category") || "",
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
                        Category
                        <input
                          name="category"
                          list="task-categories"
                          maxLength={60}
                          defaultValue={task.category || ""}
                          placeholder="Choose or type your own"
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
                        <select
                          name="assignee"
                          defaultValue={task.assignee || ""}
                        >
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
                      <TaskDetailGroup
                        title="Financial impact"
                        hint="Expected reward & loss"
                      >
                        <TaskValueFields task={task} />
                      </TaskDetailGroup>
                      <button className="primary full" disabled={!writable}>
                        Save changes <Check size={17} />
                      </button>
                    </form>
                  </TaskDetailGroup>
                  <TaskDetailGroup
                    title="Team & plans"
                    hint="Assignments, project & goals"
                  >
                    <TaskRelations
                      task={task}
                      projects={data.projects}
                      goals={data.goals}
                      writable={writable}
                      save={run}
                    />

                    <Team
                      task={task}
                      writable={writable}
                      save={run}
                      members={data.members}
                    />
                  </TaskDetailGroup>
                  <TaskDetailGroup
                    title="Reminders & repeat"
                    hint="Nudges & recurring tasks"
                  >
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
                          <option value="yearly">Yearly</option>
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
                        Future occurrences are generated by your server
                        scheduler.
                      </small>
                    </form>
                  </TaskDetailGroup>
                  <TaskDetailGroup
                    title="Links & activity"
                    hint="Resources & work updates"
                  >
                    <TaskLinks taskId={task.id} request={api} />
                    <TaskActivity
                      taskId={task.id}
                      request={api}
                      onChange={refresh}
                    />
                  </TaskDetailGroup>
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
                    category: f.get("category"),
                    successMetric: f.get("successMetric") || "",
                    goalId: f.get("goalId") || "",
                    status: "Active",
                  });
                  setSheet(null);
                }, "Created.");
              }}
            >
              <label>
                Type
                <select
                  name="kind"
                  defaultValue={planView === "goals" ? "goals" : "projects"}
                >
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
                Deadline
                <input name="targetDate" type="date" required />
              </label>
              <label>
                Category
                <input
                  name="category"
                  list="planning-categories"
                  maxLength={60}
                  defaultValue="Personal"
                />
              </label>
              <label>
                Measurable outcome (goal)
                <input
                  name="successMetric"
                  maxLength={500}
                  placeholder="Save PKR 100,000"
                />
              </label>
              <label>
                Supports goal (project)
                <select name="goalId">
                  <option value="">No goal</option>
                  {data.goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary full" disabled={!writable}>
                Create
              </button>
            </form>
          </Sheet>
        )}
        {sheet === "reminders" && (
          <Sheet title="Your timely nudges" close={() => setSheet(null)}>
            <AlertControls
              request={api}
              writable={writable}
              device={deviceAlerts}
              onSaved={refresh}
            />
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
              Upcoming reminders sync to this device while the app is open.
              Remote push and reminders created elsewhere while this app stays
              closed come later.
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
            <CurrencyPreferences />
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
                    refreshSequence.current++;
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
              Humeto mobile · 0.2.11 testing build
              <br />
              Cloud sync requires an internet connection. No private documents
              or passwords are stored in the app bundle.
            </small>
          </Sheet>
        )}
      </div>
    </TaskCurrencyProvider>
  );
}
function TaskRelations({
  task,
  projects,
  goals,
  save,
  writable,
}: {
  task: Task;
  projects: any[];
  goals: any[];
  writable: boolean;
  save: (fn: () => Promise<void>, message?: string) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(task.project_id || ""),
    [goalIds, setGoalIds] = useState<string[]>(
      task.goals?.map((g) => g.id) || [],
    );
  useEffect(() => {
    setProjectId(task.project_id || "");
    setGoalIds(task.goals?.map((g) => g.id) || []);
  }, [task.id, task.revision]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(async () => {
          await api(
            "/api/workspace/task-links/" + task.id,
            { revision: task.revision, projectId, goalIds },
            "PATCH",
          );
        }, "Project links saved.");
      }}
    >
      <label>
        Project
        <select
          name="projectId"
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
      {goals.find(
        (g) => g.id === projects.find((p) => p.id === projectId)?.goal_id,
      ) && (
        <small className="muted">
          Via project:{" "}
          {
            goals.find(
              (g) => g.id === projects.find((p) => p.id === projectId)?.goal_id,
            )?.title
          }
        </small>
      )}
      <GoalField goals={goals} value={goalIds} onChange={setGoalIds} />
      <button className="secondary full" disabled={!writable}>
        Save project & goals
      </button>
    </form>
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
            inherit: state.inherits || false,
          });
          setState(
            await api("/api/workspace/assignments?type=task&id=" + task.id),
          );
        }, "Team assignment saved.");
      }}
    >
      <h3>Shared with your team</h3>
      {state && (
        <label className="check">
          <input
            type="checkbox"
            checked={!!state.inherits}
            onChange={(e) => setState({ ...state, inherits: e.target.checked })}
          />
          Use project, goal and routine teams
        </label>
      )}
      {state?.inherits && (
        <p>
          {state.inherited
            ?.map((m: any) => m.name + " (" + m.entity_type + ")")
            .join(", ") || "No parent team assigned yet."}
        </p>
      )}
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
                  onChange={() => setState({ ...state, inherits: false })}
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
