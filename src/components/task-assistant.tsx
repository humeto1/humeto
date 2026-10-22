"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  Clock,
  LoaderCircle,
  MessageSquare,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type { Actor } from "@/lib/types";
import type {
  AgentState,
  ActionCard,
  TaskSummary,
} from "@/lib/agent/contracts";
import styles from "./task-assistant.module.css";
const examples = [
  [
    "Capture a next step",
    "Create a task to create a group with the new prospect team and remind me tomorrow",
  ],
  ["Find my priorities", "How many important tasks are pending?"],
  ["Look at the whole team", "Show overdue team tasks"],
];
const empty: AgentState = {
  threads: [],
  threadId: null,
  messages: [],
  reminders: [],
  counts: { pending: 0, important: 0, urgent: 0, quadrants: [0, 0, 0, 0] },
  engine: "Local command testing",
  modelConfigured: false,
};
function when(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
async function request(body?: unknown, query = "") {
  const r = await fetch("/api/agent" + query, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Unable to reach your assistant.");
  return data as AgentState;
}
export default function TaskAssistant({
  actor,
  onChange,
}: {
  actor: Actor;
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<AgentState>(empty),
    [timezone, setTimezone] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [pending, setPending] = useState("");
  const messageScroller = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    thread = useRef<string | null>(null),
    busyRef = useRef(false);
  const retry = useRef<{ message: string; key: string } | null>(null);
  const receive = useCallback((state: AgentState) => {
    thread.current = state.threadId;
    setData(state);
  }, []);
  useEffect(
    () =>
      setTimezone(
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi",
      ),
    [],
  );
  useEffect(() => {
    if (!timezone) return;
    let live = true;
    request(undefined, "?timezone=" + encodeURIComponent(timezone))
      .then((d) => {
        if (live) receive(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    const poll = window.setInterval(() => {
      if (document.hidden || busyRef.current) return;
      request(undefined, "?summary=1&timezone=" + encodeURIComponent(timezone))
        .then((d) => {
          if (live)
            setData((prev) => ({
              ...prev,
              counts: d.counts,
              reminders: d.reminders,
              engine: d.engine,
              modelConfigured: d.modelConfigured,
            }));
        })
        .catch(() => {});
    }, 15000);
    return () => {
      live = false;
      window.clearInterval(poll);
    };
  }, [timezone, receive]);
  useEffect(() => {
    const box = messageScroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [data.messages.length, pending]);
  function usePrompt(text: string) {
    setDraft(text);
    composer.current?.focus();
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || busy || !timezone) return;
    setBusy(true);
    busyRef.current = true;
    setError("");
    if (retry.current?.message !== message)
      retry.current = { message, key: crypto.randomUUID() };
    setPending(message);
    setDraft("");
    try {
      receive(
        await request({
          operation: "message",
          threadId: data.threadId || undefined,
          message,
          clientKey: retry.current!.key,
          timezone,
        }),
      );
      retry.current = null;
    } catch (e) {
      setError((e as Error).message);
      setDraft(message);
    } finally {
      setBusy(false);
      busyRef.current = false;
      setPending("");
      composer.current?.focus();
    }
  }
  async function action(id: string, decision: "apply" | "cancel") {
    if (busy || !timezone) return;
    setBusy(true);
    busyRef.current = true;
    setError("");
    try {
      receive(
        await request({
          operation: "action",
          actionId: id,
          decision,
          timezone,
        }),
      );
      await onChange();
      window.dispatchEvent(new Event("humeto-reminders"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  async function select(id: string) {
    if (busy || !timezone) return;
    setError("");
    setLoading(true);
    try {
      receive(
        await request(
          undefined,
          `?threadId=${id}&timezone=${encodeURIComponent(timezone)}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function dismiss(id: string) {
    if (!timezone || busy) return;
    setBusy(true);
    busyRef.current = true;
    try {
      const next = await request({
        operation: "dismiss",
        reminderId: id,
        timezone,
      });
      setData((prev) => ({ ...prev, reminders: next.reminders }));
      window.dispatchEvent(new Event("humeto-reminders"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  function taskRow(t: TaskSummary) {
    return (
      <div key={t.id} className={styles.taskResult}>
        <span className={styles.taskTick}>
          {t.stage === "Done" ? <Check size={13} /> : <Clock size={13} />}
        </span>
        <div>
          <strong>{t.title}</strong>
          <small>
            {t.stage} · {t.important ? "Important" : "Not important"} ·{" "}
            {t.urgent ? "Urgent" : "Not urgent"}
            {t.due_date ? ` · Due ${t.due_date}` : ""}
          </small>
          <small>{t.assignee || "Unassigned"}</small>
        </div>
        <button
          title="Use this task in a follow-up"
          aria-label={`Discuss ${t.title}`}
          onClick={() => usePrompt(`Mark "${t.id}" done`)}
        >
          <ArrowUpRight size={14} />
        </button>
      </div>
    );
  }
  function review(card: ActionCard) {
    const p = card.payload,
      expired = card.expiresAt < Date.now(),
      inactive = card.status !== "pending" || expired;
    return (
      <div className={styles.review}>
        <div className={styles.reviewTop}>
          <Sparkles size={14} />
          <strong>
            {p.kind === "create" ? "Create a task" : "Update task"}
          </strong>
          <span>
            {card.status === "applied"
              ? "Applied"
              : card.status === "cancelled"
                ? "Cancelled"
                : expired
                  ? "Expired"
                  : "Awaiting your review"}
          </span>
        </div>
        <h3>{p.title}</h3>
        <dl>
          <div>
            <dt>Owner</dt>
            <dd>{p.assignee}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{p.stage}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>
              {p.important ? "Important" : "Not important"} ·{" "}
              {p.urgent ? "Urgent" : "Not urgent"}
            </dd>
          </div>
          <div>
            <dt>Due date</dt>
            <dd>{p.dueDate || "No due date"}</dd>
          </div>
          {p.projectTitle && (
            <div>
              <dt>Project</dt>
              <dd>
                {p.projectTitle}
                {p.createProject ? " · will be created when applied" : ""}
              </dd>
            </div>
          )}
          {p.reminderAt && (
            <div className={styles.reminderDetail}>
              <dt>
                <Bell size={12} /> In-app reminder
              </dt>
              <dd>
                {when(p.reminderAt, p.timezone)}
                <small>{p.timezone}</small>
              </dd>
            </div>
          )}
        </dl>
        {!inactive && (
          <div className={styles.reviewButtons}>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void action(card.id, "apply")}
            >
              <Check size={14} /> Apply{" "}
              {p.kind === "create" ? "task" : "update"}
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void action(card.id, "cancel")}
            >
              Cancel
            </button>
          </div>
        )}
        {card.status === "applied" && (
          <a href="/workspace/tasks" className={styles.applied}>
            <CheckCheck size={14} /> Saved to your tasks{" "}
            <ArrowUpRight size={12} />
          </a>
        )}
      </div>
    );
  }
  const live = data.modelConfigured;
  return (
    <section className={styles.assistant} aria-label="Humeto task assistant">
      <div className={styles.pageHeading}>
        <div>
          <span className="eyebrow">A LITTLE MORE HEADSPACE</span>
          <h1>Your day, in a conversation.</h1>
          <p>Give your next step a home. Ask what matters. Keep moving.</p>
        </div>
        <a href="/workspace/tasks" className="btn secondary">
          View task board <ArrowUpRight size={14} />
        </a>
      </div>
      <div className={styles.layout}>
        <aside className={styles.conversations}>
          <button
            className={styles.newChat}
            disabled={busy}
            onClick={() => {
              thread.current = null;
              setData((prev) => ({ ...prev, threadId: null, messages: [] }));
              setDraft("");
              setError("");
              composer.current?.focus();
            }}
          >
            <Plus size={16} /> New conversation
          </button>
          <span className={styles.label}>YOUR CONVERSATIONS</span>
          <div className={styles.threadList}>
            {data.threads.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                className={data.threadId === t.id ? styles.activeThread : ""}
                onClick={() => void select(t.id)}
              >
                <MessageSquare size={14} />
                <span>{t.title}</span>
              </button>
            ))}
            {!data.threads.length && (
              <p className={styles.emptyHistory}>
                Your first conversation starts here. It will be saved just for
                you.
              </p>
            )}
          </div>
          <div className={styles.channelNote}>
            <span className={styles.online} />
            <strong>In-app chat</strong>
            <small>Your connected channels come next.</small>
            <div>WhatsApp · Telegram · Email</div>
            <span>Planned · not connected</span>
          </div>
        </aside>
        <div className={styles.chat}>
          <header className={styles.chatHeader}>
            <span className={styles.assistantMark}>
              <Sparkles size={19} />
            </span>
            <div>
              <strong>Humeto assistant</strong>
              <small>
                {live
                  ? "GPT-5.4 mini · reviewed task actions"
                  : data.engine === "OpenAI"
                    ? "Live model needs configuration"
                    : "Local command testing · no live AI connected"}
              </small>
            </div>
            <span className={styles.private}>Private chat</span>
          </header>
          <div
            ref={messageScroller}
            className={styles.messages}
            aria-label="Conversation messages"
            aria-busy={busy || loading}
          >
            {loading ? (
              <div className={styles.loading}>
                <LoaderCircle size={20} className={styles.spin} /> Opening your
                conversation…
              </div>
            ) : !data.messages.length && !pending ? (
              <div className={styles.welcome}>
                <span className={styles.welcomeSpark}>
                  <Sparkles size={28} />
                </span>
                <h2>
                  What’s on your mind,
                  <br />
                  <em>{actor.name.split(" ")[0]}?</em>
                </h2>
                <p>
                  Tell me the task. I’ll help you organize the details.
                  <br />
                  You review changes before they become part of your day.
                </p>
                <div className={styles.examples}>
                  {examples.map(([label, prompt]) => (
                    <button key={label} onClick={() => usePrompt(prompt)}>
                      <span>{label}</span>
                      <strong>{prompt}</strong>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              data.messages.map((m) => (
                <article
                  key={m.id}
                  className={`${styles.message} ${m.role === "user" ? styles.user : styles.agent}`}
                >
                  <span className={styles.speaker}>
                    {m.role === "user" ? (
                      "You"
                    ) : (
                      <>
                        <Sparkles size={12} /> Humeto
                      </>
                    )}
                    <time dateTime={m.created_at.replace(" ", "T") + "Z"}>
                      ·{" "}
                      {when(
                        m.created_at.replace(" ", "T") + "Z",
                        timezone || "Asia/Karachi",
                      )}
                    </time>
                  </span>
                  <div className={styles.bubble}>
                    <p>{m.content}</p>
                    {m.result.action && review(m.result.action)}
                    {!!m.result.tasks?.length && (
                      <div className={styles.taskResults}>
                        {m.result.tasks.map(taskRow)}
                      </div>
                    )}
                    {m.role === "assistant" && m.result.engine && (
                      <small className={styles.engineLabel}>
                        {m.result.engine}
                      </small>
                    )}
                  </div>
                </article>
              ))
            )}
            {pending && (
              <>
                <article className={`${styles.message} ${styles.user}`}>
                  <span className={styles.speaker}>You</span>
                  <div className={styles.bubble}>
                    <p>{pending}</p>
                  </div>
                </article>
                <div className={styles.thinking} role="status">
                  <LoaderCircle size={14} className={styles.spin} /> Reading
                  your request…
                </div>
              </>
            )}
          </div>
          <div className={styles.composerArea}>
            {error && (
              <div className={styles.error} role="alert">
                {error}
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={14} />
                </button>
              </div>
            )}
            <form onSubmit={send} className={styles.composer}>
              <label htmlFor="assistant-message" className={styles.srOnly}>
                Message Humeto assistant
              </label>
              <textarea
                id="assistant-message"
                ref={composer}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Add a task, ask about priorities, or plan a reminder…"
                disabled={loading}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className={styles.composerBottom}>
                <span>
                  <Clock size={12} /> {timezone || "Detecting timezone…"}
                </span>
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={busy || loading || !draft.trim()}
                >
                  {busy ? (
                    <LoaderCircle size={17} className={styles.spin} />
                  ) : (
                    <ArrowUp size={18} />
                  )}
                </button>
              </div>
            </form>
            <p className={styles.disclaimer}>
              {live
                ? "AI proposes. You decide. Counts come from your saved tasks."
                : "Test mode supports the example commands. A live model is not configured."}{" "}
              Reminders appear in the app.
            </p>
          </div>
        </div>
        <aside className={styles.rail}>
          <section className={styles.priorityPanel}>
            <span className={styles.label}>YOUR FOCUS, RIGHT NOW</span>
            <div className={styles.priorityNumber}>
              {data.counts.important}
              <span>important tasks pending</span>
            </div>
            <div className={styles.quadrants}>
              {["Do now", "Schedule", "Delegate", "Later"].map((q, i) => (
                <button
                  key={q}
                  onClick={() =>
                    usePrompt(
                      `Show my ${i < 2 ? "important" : "not important"} ${i % 2 === 0 ? "urgent" : "not urgent"} pending tasks`,
                    )
                  }
                >
                  <span>{q}</span>
                  <strong>{data.counts.quadrants[i]}</strong>
                  <small>
                    {i < 2 ? "Important" : "Not important"} ·{" "}
                    {i % 2 === 0 ? "Urgent" : "Not urgent"}
                  </small>
                </button>
              ))}
            </div>
            <button
              className={styles.textLink}
              onClick={() => usePrompt("Show my pending tasks")}
            >
              {data.counts.pending} pending in total <ArrowUpRight size={13} />
            </button>
            <small className={styles.scope}>
              Assigned to {actor.name}. Completed tasks excluded.
            </small>
          </section>
          <section className={styles.reminders} id="reminders">
            <div className={styles.railHeading}>
              <Bell size={16} />
              <h2>Your reminders</h2>
              <span>{data.reminders.length}</span>
            </div>
            {!data.reminders.length ? (
              <p>
                No reminders scheduled yet. Tell me what you’d like to remember.
              </p>
            ) : (
              data.reminders.map((r) => (
                <div
                  className={`${styles.reminder} ${r.due ? styles.due : ""}`}
                  key={r.id}
                >
                  <span>{r.due ? "DUE NOW" : "SCHEDULED"}</span>
                  <strong>{r.title}</strong>
                  <small>
                    {when(r.remind_at, r.timezone)} · {r.timezone}
                  </small>
                  <div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        usePrompt(`Remind me about "${r.task_id}" in 1 hour`)
                      }
                    >
                      Snooze 1h
                    </button>
                    <button disabled={busy} onClick={() => void dismiss(r.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
            <small>
              Available here when due. App refreshes every 15 seconds. Email and
              messaging delivery come later.
            </small>
          </section>
          <div className={styles.howItWorks}>
            <Sparkles size={16} />
            <strong>One task. Every view.</strong>
            <p>
              Changes you apply here also appear on your task board, list and
              four-quadrant matrix.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
