"use client";
import AlertControls from "../../shared/alert-controls";
import RecurrenceEditor from "./recurrence-editor";
import { useEffect, useState, useCallback } from "react";
import {
  Repeat2,
  Bell,
  Clock,
  Settings2,
  History,
  Check,
  Pause,
  Play,
  CalendarPlus,
} from "lucide-react";
import type { Task } from "@/lib/types";
import { localDay } from "@/lib/scheduling-clock.mjs";
import styles from "./task-schedules.module.css";
type Preferences = {
  enabled: boolean;
  timezone: string;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  daily_limit: number;
  followup_minutes: 0 | 60 | 240 | 1440;
  revision: number;
};
type Reminder = {
  id: string;
  task_id: string;
  title: string;
  remind_at: string;
  timezone: string;
  revision: number;
  task_revision: number;
  due: boolean;
  ready: boolean;
  nudge_count: number | null;
};
type Series = {
  id: string;
  title: string;
  frequency: string;
  interval_count: number;
  next_day: string;
  end_day: string;
  local_time: string;
  timezone: string;
  status: string;
  revision: number;
  occurrence_count: number;
  last_error: string | null;
};
type State = {
  seriesEvents: {
    id: string;
    title: string;
    event: string;
    previous_day: string;
    next_day: string;
    created_at: string;
  }[];
  preferences: Preferences;
  reminders: Reminder[];
  series: Series[];
  events: {
    id: string;
    title: string;
    event: string;
    created_at: string;
    next_at: string;
  }[];
  worker: { online: boolean; lastSeen: string | null };
  quietUntil: string | null;
};
const when = (value: string, timezone?: string) =>
  new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  });
export default function TaskSchedules({
  tasks,
  writable,
  onChange,
}: {
  tasks: Task[];
  writable: boolean;
  onChange: () => void;
}) {
  const [data, setData] = useState<State | null>(null),
    [prefs, setPrefs] = useState<Preferences | null>(null),
    [tab, setTab] = useState("inbox"),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [taskId, setTaskId] = useState(""),
    [kind, setKind] = useState("remind"),
    [frequency, setFrequency] = useState("weekly"),
    [interval, setIntervalCount] = useState(1),
    [firstDay, setFirstDay] = useState(""),
    [endDay, setEndDay] = useState(""),
    [time, setTime] = useState("09:00"),
    [timezone, setTimezone] = useState("Asia/Karachi"),
    [snooze, setSnooze] = useState(60),
    [notice, setNotice] = useState("");
  const load = useCallback(async (forcePrefs = false) => {
    try {
      const r = await fetch("/api/workspace/scheduling", { cache: "no-store" }),
        j = await r.json();
      if (!r.ok) throw Error(j.error || "Unable to load schedules.");
      setData(j);
      setPrefs((prev) => (forcePrefs ? j.preferences : prev || j.preferences));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const zone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
    setTimezone(zone);
    setFirstDay(localDay(new Date(), zone));
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(refresh, 15000);
    const hash = () => {
      if (location.hash === "#task-followups") {
        setOpen(true);
        setTab("inbox");
      }
    };
    hash();
    window.addEventListener("hashchange", hash);
    window.addEventListener("humeto-reminders", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("humeto-reminders", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  async function act(action: string, body: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/workspace/scheduling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...body }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error || "Unable to save this schedule.");
      await load(action === "preferences");
      setNotice(
        action === "series"
          ? "Recurring series saved. Each run creates one new task."
          : action === "snooze"
            ? "Reminder snoozed. Your task stays open."
            : action === "dismiss"
              ? "Reminder dismissed. Your task stays open."
              : action === "finish"
                ? "Task completed. Its reminders have stopped."
                : action === "preferences"
                  ? "Follow-up preferences saved."
                  : "Schedule updated.",
      );
      window.dispatchEvent(new Event("humeto-reminders"));
      onChange();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  const choices = tasks.filter((t) => kind === "series" || t.stage !== "Done"),
    chosen = choices.find((t) => t.id === taskId) || choices[0];
  const tabs = [
    ["inbox", "Follow-up inbox", Bell],
    ["schedule", "Schedule a task", CalendarPlus],
    ["preferences", "My preferences", Settings2],
    ["history", "History", History],
  ] as const;
  const updatePrefs = (values: Partial<Preferences>) =>
    setPrefs((p) => (p ? { ...p, ...values } : p));
  return (
    <details
      id="task-followups"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={styles.shell}
    >
      <summary>
        <span className={styles.summaryIcon}>
          <Repeat2 size={19} />
        </span>
        <span>
          <strong>Follow-ups & recurring tasks</strong>
          <small>Build a rhythm. Let Humeto remember the follow-up.</small>
        </span>
        <span className={styles.summaryMeta}>
          {data?.reminders.filter((r) => r.ready).length || 0} ready ·{" "}
          {data?.series.filter((s) => s.status === "active").length || 0}{" "}
          repeating{" "}
          <span
            className={data?.worker.online ? styles.online : styles.offline}
          >
            {data?.worker.online ? "Scheduler running" : "Scheduler offline"}
          </span>
        </span>
      </summary>
      <div className={styles.body}>
        <AlertControls writable={writable} onSaved={() => load(true)} />
        <div className={styles.tabs} role="tablist" aria-label="Task schedules">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              aria-controls={"schedule-panel-" + key}
              id={"schedule-tab-" + key}
              onClick={() => setTab(key)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {!data ? (
          <p role="status">Loading your schedules…</p>
        ) : (
          <>
            {!data.worker.online && (
              <p className={styles.workerNotice}>
                Your schedules are saved. The task worker must be running to
                create recurring tasks and prepare new follow-ups, even when
                your browser is closed.
              </p>
            )}
            {tab === "inbox" && (
              <div
                role="tabpanel"
                id="schedule-panel-inbox"
                aria-labelledby="schedule-tab-inbox"
              >
                <div className={styles.sectionHead}>
                  <div>
                    <h3>A gentle nudge, at your pace.</h3>
                    <p>
                      {!data.preferences.enabled
                        ? "Follow-ups are paused in your preferences."
                        : data.quietUntil
                          ? `Quiet hours are on until ${when(data.quietUntil, data.preferences.timezone)}. Your tasks are still here.`
                          : `Up to ${data.preferences.daily_limit} nudges per day${data.preferences.followup_minutes ? `, with a ${data.preferences.followup_minutes}-minute follow-up interval` : ". Each reminder nudges once unless you snooze it"}.`}
                    </p>
                  </div>
                  <label>
                    Snooze for
                    <select
                      aria-label="Reminder snooze interval"
                      value={snooze}
                      onChange={(e) => setSnooze(Number(e.target.value))}
                    >
                      <option value={15}>15 minutes</option>
                      <option value={60}>1 hour</option>
                      <option value={240}>4 hours</option>
                      <option value={1440}>24 hours</option>
                    </select>
                  </label>
                </div>
                {data.reminders.length ? (
                  <div className={styles.inbox}>
                    {data.reminders.map((r) => (
                      <article
                        key={r.id}
                        className={r.ready ? styles.ready : ""}
                      >
                        <span className={styles.status}>
                          {r.ready
                            ? "READY FOR YOU"
                            : r.due
                              ? "DUE · SAVED IN YOUR INBOX"
                              : "COMING UP"}
                        </span>
                        <h4>{r.title}</h4>
                        <p>
                          <Clock size={12} /> {when(r.remind_at, r.timezone)} ·{" "}
                          {r.timezone}
                        </p>
                        <small>
                          {r.nudge_count
                            ? `${r.nudge_count} in-app nudge${r.nudge_count === 1 ? "" : "s"} prepared`
                            : "Not nudged yet"}
                          {r.due && !r.ready
                            ? " · muted, quiet, waiting for worker or daily limit"
                            : ""}
                        </small>
                        <div className={styles.actions}>
                          <button
                            disabled={!writable || busy}
                            onClick={() =>
                              void act("snooze", {
                                id: r.id,
                                revision: r.revision,
                                minutes: snooze,
                              })
                            }
                          >
                            Snooze
                          </button>
                          <button
                            disabled={!writable || busy}
                            onClick={() =>
                              void act("dismiss", {
                                id: r.id,
                                revision: r.revision,
                              })
                            }
                          >
                            Dismiss reminder
                          </button>
                          <button
                            className={styles.primary}
                            disabled={!writable || busy}
                            onClick={() =>
                              void act("finish", {
                                id: r.id,
                                revision: r.revision,
                                taskRevision: r.task_revision,
                              })
                            }
                          >
                            <Check size={13} />
                            Task finished
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>
                    <Bell size={25} />
                    <h3>Room to focus, nothing to chase.</h3>
                    <p>
                      Schedule a reminder or recurring task. Your due follow-ups
                      will appear here.
                    </p>
                    <button onClick={() => setTab("schedule")}>
                      Schedule your first follow-up
                    </button>
                  </div>
                )}
              </div>
            )}
            {tab === "schedule" && (
              <div
                role="tabpanel"
                id="schedule-panel-schedule"
                aria-labelledby="schedule-tab-schedule"
              >
                <div className={styles.sectionHead}>
                  <div>
                    <h3>One reminder, or a rhythm that repeats.</h3>
                    <p>
                      Repeating creates a new task each time. Completed work
                      remains in history.
                    </p>
                  </div>
                </div>
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (chosen)
                      void act(kind, {
                        taskId: chosen.id,
                        taskRevision: chosen.revision,
                        frequency,
                        interval,
                        firstDay,
                        endDay,
                        day: firstDay,
                        time,
                        timezone,
                      });
                  }}
                >
                  <label className={styles.wide}>
                    Task to use
                    <select
                      aria-label="Scheduled task"
                      value={chosen?.id || ""}
                      onChange={(e) => setTaskId(e.target.value)}
                      required
                      disabled={!writable || busy}
                    >
                      {choices.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                          {t.stage === "Done" ? " · completed template" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Schedule type
                    <select
                      aria-label="Task schedule type"
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="remind">One-time reminder</option>
                      <option value="series">Recurring task</option>
                    </select>
                  </label>
                  {kind === "series" && (
                    <>
                      <label>
                        Repeat
                        <select
                          aria-label="Task repeat frequency"
                          value={frequency}
                          onChange={(e) => setFrequency(e.target.value)}
                        >
                          <option value="daily">Daily</option>
                          <option value="weekdays">Weekdays</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </label>
                      <label>
                        Every (interval)
                        <input
                          aria-label="Repeat interval"
                          type="number"
                          min="1"
                          max="12"
                          value={interval}
                          onChange={(e) =>
                            setIntervalCount(Number(e.target.value))
                          }
                          required
                        />
                      </label>
                    </>
                  )}
                  <label>
                    {kind === "series" ? "First occurrence" : "Reminder date"}
                    <input
                      aria-label="Schedule first date"
                      type="date"
                      value={firstDay}
                      onChange={(e) => setFirstDay(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Local time
                    <input
                      aria-label="Schedule local time"
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Timezone
                    <input
                      aria-label="Schedule timezone"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Asia/Karachi"
                      required
                    />
                  </label>
                  {kind === "series" && (
                    <label>
                      End date (optional)
                      <input
                        aria-label="Schedule end date"
                        type="date"
                        value={endDay}
                        min={firstDay}
                        onChange={(e) => setEndDay(e.target.value)}
                      />
                    </label>
                  )}
                  <div className={styles.wide}>
                    <button
                      className={styles.primary}
                      disabled={!chosen || !writable || busy}
                      type="submit"
                    >
                      {kind === "series"
                        ? "Create recurring series"
                        : "Save reminder"}
                    </button>
                  </div>
                </form>
                {kind === "series" && (
                  <p className={styles.hint}>
                    Copies the source task’s latest title, priority, applicant,
                    project, goals and current staff assignments. Monthly dates
                    such as the 31st use the last day in shorter months. Missed
                    runs create only the latest occurrence, keeping catch-up
                    calm.
                  </p>
                )}
                {!!data.seriesEvents?.length && (
                  <details>
                    <summary>Schedule change history</summary>
                    {data.seriesEvents.map((e) => (
                      <p key={e.id} className={styles.hint}>
                        {e.title} · {e.event} · {e.previous_day} → {e.next_day}{" "}
                        · {new Date(e.created_at).toLocaleString()}
                      </p>
                    ))}
                  </details>
                )}
                <h3 className={styles.seriesHeading}>Your recurring series</h3>
                {data.series.length ? (
                  data.series.map((s) => (
                    <article className={styles.series} key={s.id}>
                      <div>
                        <strong>{s.title}</strong>
                        <p>
                          Every {s.interval_count}{" "}
                          {s.frequency === "weekdays"
                            ? "weekday(s)"
                            : s.frequency === "daily"
                              ? "day(s)"
                              : s.frequency === "weekly"
                                ? "week(s)"
                                : "month(s)"}{" "}
                          · {s.local_time} · {s.timezone}
                        </p>
                        <small>
                          {s.status} · {s.occurrence_count} task(s) created ·
                          next {s.next_day}
                          {s.end_day ? ` · ends ${s.end_day}` : ""}
                        </small>
                        {s.last_error && <p role="alert">{s.last_error}</p>}
                      </div>
                      {["active", "paused"].includes(s.status) && (
                        <div className={styles.actions}>
                          <RecurrenceEditor
                            series={s}
                            writable={writable}
                            busy={busy}
                            act={act}
                          />
                          <button
                            disabled={!writable || busy}
                            onClick={() =>
                              void act("series-state", {
                                id: s.id,
                                revision: s.revision,
                                status:
                                  s.status === "active" ? "paused" : "active",
                              })
                            }
                          >
                            {s.status === "active" ? (
                              <Pause size={13} />
                            ) : (
                              <Play size={13} />
                            )}{" "}
                            {s.status === "active"
                              ? "Pause series"
                              : "Resume series"}
                          </button>
                          <button
                            disabled={!writable || busy}
                            onClick={() =>
                              void act("series-state", {
                                id: s.id,
                                revision: s.revision,
                                status: "cancelled",
                              })
                            }
                          >
                            Cancel series
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <p className={styles.hint}>
                    No recurring series yet. Create one above for a regular
                    review, follow-up or planning routine.
                  </p>
                )}
              </div>
            )}
            {tab === "preferences" && prefs && (
              <div
                role="tabpanel"
                id="schedule-panel-preferences"
                aria-labelledby="schedule-tab-preferences"
              >
                <h3>Helpful follow-ups, without the noise.</h3>
                <p className={styles.hint}>
                  These preferences belong to you in this company. Quiet hours
                  and daily limits affect in-app nudges, not task creation or
                  your saved deadlines.
                </p>
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("preferences", {
                      revision: prefs.revision,
                      enabled: prefs.enabled,
                      timezone: prefs.timezone,
                      quietEnabled: prefs.quiet_enabled,
                      quietStart: prefs.quiet_start,
                      quietEnd: prefs.quiet_end,
                      dailyLimit: prefs.daily_limit,
                      followupMinutes: 0,
                    });
                  }}
                >
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={prefs.enabled}
                      onChange={(e) =>
                        updatePrefs({ enabled: e.target.checked })
                      }
                    />
                    Enable task notifications
                  </label>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={prefs.quiet_enabled}
                      onChange={(e) =>
                        updatePrefs({ quiet_enabled: e.target.checked })
                      }
                    />
                    Respect quiet hours
                  </label>
                  <label>
                    My timezone
                    <input
                      aria-label="Follow-up timezone"
                      value={prefs.timezone}
                      onChange={(e) =>
                        updatePrefs({ timezone: e.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    Quiet hours start
                    <input
                      aria-label="Quiet hours start"
                      type="time"
                      value={prefs.quiet_start}
                      onChange={(e) =>
                        updatePrefs({ quiet_start: e.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    Quiet hours end
                    <input
                      aria-label="Quiet hours end"
                      type="time"
                      value={prefs.quiet_end}
                      onChange={(e) =>
                        updatePrefs({ quiet_end: e.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    Maximum nudges per day
                    <input
                      aria-label="Daily nudge limit"
                      type="number"
                      min="1"
                      max="3"
                      value={prefs.daily_limit}
                      onChange={(e) =>
                        updatePrefs({ daily_limit: Number(e.target.value) })
                      }
                      required
                    />
                  </label>
                  <p>
                    No automatic repeat alerts. Snooze a reminder explicitly
                    when you want another nudge.
                  </p>
                  <div className={styles.wide}>
                    <button
                      type="submit"
                      disabled={!writable || busy}
                      className={styles.primary}
                    >
                      Save my preferences
                    </button>
                  </div>
                </form>
              </div>
            )}
            {tab === "history" && (
              <div
                role="tabpanel"
                id="schedule-panel-history"
                aria-labelledby="schedule-tab-history"
              >
                <h3>What Humeto followed up on</h3>
                <p className={styles.hint}>
                  Latest 30 reminder events. “Notified” means prepared in this
                  app, not delivered by email, WhatsApp or device push.
                </p>
                {data.events.length ? (
                  data.events.map((e) => (
                    <article className={styles.event} key={e.id}>
                      <span>
                        {e.event === "notified"
                          ? "Follow-up prepared"
                          : e.event}
                      </span>
                      <strong>{e.title}</strong>
                      <small>
                        {when(e.created_at)}
                        {e.next_at ? ` · next ${when(e.next_at)}` : ""}
                      </small>
                    </article>
                  ))
                ) : (
                  <p>
                    No reminder activity yet. Your scheduled, snoozed and
                    dismissed reminders will appear here.
                  </p>
                )}
              </div>
            )}
            <p className={styles.hint}>
              In-app delivery only. The scheduler keeps working while your
              browser is closed; device push and external messaging are not
              connected.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
