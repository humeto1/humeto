"use client";
import {
  useCallback,
  useEffect,
  useState,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Plus, Target, Check, MoreHorizontal, X } from "lucide-react";
import { type Transport } from "./transport";
import { kpiAchievement, kpiLocalDay } from "./kpi-period";
import "./plan-tabs.css";
import { ActivityBadges, ActivityTags } from "./activity-markers";
const periods: Record<string, string> = {
  once: "Overall",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_year: "Every 6 months",
  yearly: "Yearly",
};
type Activity = {
  id: string;
  title: string;
  stage: string;
  storage_state: string;
  revision: number;
  is_csf: boolean;
  is_kpi: boolean;
  activity_note: string;
  frequency: string | null;
};
type Result = {
  period_start: string;
  actual: number;
  target_snapshot: number;
  unit_snapshot: string;
  direction_snapshot: string;
  revision: number;
  note: string;
  cadence_snapshot: string;
};
type Kpi = {
  id: string;
  activity_id: string;
  title: string;
  target: number;
  unit: string;
  direction: string;
  cadence: string;
  timezone: string;
  archived: boolean;
  revision: number;
  day: string;
  today: string;
  historyTotal: number;
  historyMore: boolean;
  periodTarget: { target: number; unit: string; direction: string };
  period: { start: string; end: string; label: string };
  current: Result | null;
  history: Result[];
};
type Data = { activities: Activity[]; kpis: Kpi[] };
type Editing =
  | { kind: "activity"; item?: Activity }
  | { kind: "kpi"; activityId: string; item?: Kpi }
  | { kind: "result"; item: Kpi; day?: string };
export function PlanSuccess({
  type,
  id,
  writable,
  request,
  active,
  onUpdate,
}: {
  type: "project" | "goal" | "activity";
  id: string;
  writable: boolean;
  request: Transport;
  active: boolean;
  onUpdate?: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Editing | null>(null),
    [choice, setChoice] = useState("new"),
    [archived, setArchived] = useState(false),
    [resultBusy, setResultBusy] = useState(false),
    [historyBusy, setHistoryBusy] = useState(""),
    [older, setOlder] = useState<
      Record<string, { items: Result[]; more: boolean }>
    >({});
  const locked = useRef(false),
    uid = useId();
  const path = `/api/plan-success?type=${type}&parentId=${encodeURIComponent(id)}`;
  const load = useCallback(
    (resetHistory = true) =>
      request(path).then((next) => {
        setData(next);
        if (resetHistory) setOlder({});
      }),
    [request, path],
  );
  useEffect(() => {
    if (!active || editing || busy) return;
    let alive = true;
    const refresh = () => {
      if (!document.hidden && alive)
        void load(false).catch((e) => {
          if (alive) setError(e.message);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, load, !!editing, busy]);
  async function moreHistory(k: Kpi) {
    if (historyBusy) return;
    setHistoryBusy(k.id);
    try {
      const previous = older[k.id]?.items || k.history;
      const next = await request(
        path +
          "&kpiId=" +
          encodeURIComponent(k.id) +
          "&offset=" +
          previous.length,
      );
      const page = next.kpis.find((m: Kpi) => m.id === k.id);
      if (page)
        setOlder((old) => ({
          ...old,
          [k.id]: {
            items: [...previous, ...page.history],
            more: page.historyMore,
          },
        }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryBusy("");
    }
  }
  async function save(values: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await request("/api/plan-success", {
        type,
        parentId: id,
        ...values,
      });
      await load();
      if (
        values.action === "activity" &&
        values.isKpi &&
        !data?.kpis.some((k) => k.activity_id === saved.id && !k.archived)
      )
        setEditing({ kind: "kpi", activityId: String(saved.id) });
      else setEditing(null);
      setNotice("Saved on this activity. Tasks and maps use the same record.");
      await onUpdate?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const activities = data?.activities.filter((a) => a.is_csf || a.is_kpi) || [];
  const kpis =
    data?.kpis.filter(
      (k) =>
        !k.archived &&
        activities.some((a) => a.id === k.activity_id && a.is_kpi),
    ) || [];
  const met = kpis.filter(
    (k) =>
      k.current &&
      kpiAchievement(
        Number(k.current.actual),
        Number(k.current.target_snapshot),
        k.current.direction_snapshot,
      ),
  ).length;
  const chosen =
    editing?.kind === "activity"
      ? editing.item || data?.activities.find((a) => a.id === choice)
      : undefined;
  function addActivity() {
    setChoice("new");
    setEditing(
      type === "activity" && data?.activities[0]
        ? { kind: "activity", item: data.activities[0] }
        : { kind: "activity" },
    );
    setError("");
  }
  const needsTarget = activities.filter(
    (a) =>
      a.is_kpi &&
      !data?.kpis.some((k) => k.activity_id === a.id && !k.archived),
  );
  return (
    <section className="success-measures" aria-label="Activity CSFs and KPIs">
      <div className="plan-panel-heading">
        <div>
          <h3>What matters & how it’s doing</h3>
          <p>
            Review the CSF and KPI markers on your activities. Markers stay
            independent of Tasks and completion.
          </p>
        </div>
      </div>
      {kpis.length > 0 && (
        <div className="success-summary">
          <strong>
            {met}
            <small> / {kpis.length}</small>
          </strong>
          <span>
            targets met<small>Measured totals for their current periods</small>
          </span>
        </div>
      )}
      {!!needsTarget.length && (
        <p className="success-setup-notice" role="status">
          {needsTarget.length} KPI{" "}
          {needsTarget.length === 1 ? "activity needs" : "activities need"} a
          target · {kpis.length} configured measurements
        </p>
      )}
      {error && !editing && (
        <p className="plan-tool-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => void load().then(() => setError(""))}
          >
            Reload
          </button>
        </p>
      )}
      <p className="plan-tool-notice" role="status">
        {notice}
      </p>
      {!data && !error && <p>Loading activities…</p>}
      {!activities.length && data && (
        <div className="success-empty">
          <Target size={22} />
          <h4>Highlight what drives this {type}</h4>
          <p>
            “Run ad” can be a completed task and still be a CSF. “Daily protein”
            can be a repeating activity with a KPI. Use the same boxes you plan
            in WBS.
          </p>
          <button
            type="button"
            className="plan-tool-primary"
            disabled={!writable}
            onClick={addActivity}
          >
            Mark an activity
          </button>
        </div>
      )}
      {activities.map((a) => (
        <article className="success-factor" key={a.id}>
          <header>
            <div>
              <h4>{a.title}</h4>
              <ActivityBadges activity={a} />
              {needsTarget.some((item) => item.id === a.id) && (
                <small className="activity-needs-target">Needs target</small>
              )}
              <small className="success-activity-state">
                {a.frequency
                  ? "Repeating"
                  : a.stage === "Done"
                    ? "Completed"
                    : a.stage}{" "}
                · {a.storage_state === "active" ? "In Tasks" : "WBS only"}
              </small>
            </div>
            <button
              type="button"
              className="plan-tool-icon"
              disabled={!writable || busy}
              aria-label={`Edit indicators for ${a.title}`}
              onClick={() => {
                setEditing({ kind: "activity", item: a });
                setError("");
              }}
            >
              <MoreHorizontal size={18} />
            </button>
          </header>
          {a.activity_note && <p>{a.activity_note}</p>}
          {a.is_kpi && (
            <div className="success-kpis">
              {data?.kpis
                .filter(
                  (k) => k.activity_id === a.id && (archived || !k.archived),
                )
                .map((k) => {
                  const current = k.current,
                    actual = current ? Number(current.actual) : null,
                    target = current
                      ? Number(current.target_snapshot)
                      : k.target,
                    unit = current ? current.unit_snapshot : k.unit,
                    direction = current
                      ? current.direction_snapshot
                      : k.direction,
                    hit = kpiAchievement(actual, target, direction);
                  return (
                    <section
                      className="success-kpi"
                      key={k.id}
                      aria-label={k.title}
                    >
                      <div className="success-kpi-top">
                        <h5>{k.title}</h5>
                        <button
                          type="button"
                          className="plan-tool-icon"
                          disabled={!writable || busy}
                          aria-label={`Edit measurement ${k.title}`}
                          onClick={() =>
                            setEditing({
                              kind: "kpi",
                              activityId: a.id,
                              item: k,
                            })
                          }
                        >
                          <MoreHorizontal size={17} />
                        </button>
                      </div>
                      <div className="success-kpi-value">
                        <strong>
                          {actual === null ? "—" : actual.toLocaleString()}
                        </strong>
                        <span>
                          / {direction === "at_most" ? "≤ " : ""}
                          {target.toLocaleString()} {unit}
                          <small>
                            {periods[k.cadence]}
                            {k.archived ? " · Archived" : ""}
                          </small>
                        </span>
                      </div>
                      <div className="success-kpi-bottom">
                        <span>
                          {actual === null ? (
                            "No result logged"
                          ) : hit ? (
                            <>
                              <Check size={13} /> Target met
                            </>
                          ) : direction === "at_most" ? (
                            "Above limit"
                          ) : (
                            "Below target"
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={!writable || busy || k.archived}
                          onClick={() => {
                            setResultBusy(true);
                            setEditing({ kind: "result", item: k });
                          }}
                        >
                          {current ? "Update result" : "Log result"}
                        </button>
                      </div>
                      <small className="success-period">
                        {k.period.label} · {k.timezone}
                      </small>
                      {!!k.history.length && (
                        <details className="success-history">
                          <summary>History</summary>
                          {(older[k.id]?.items || k.history).map((h) => (
                            <div key={h.period_start + h.cadence_snapshot}>
                              <span>
                                {h.cadence_snapshot === "once"
                                  ? "Overall"
                                  : h.period_start}
                              </span>
                              <strong>
                                {Number(h.actual)} / {Number(h.target_snapshot)}{" "}
                                {h.unit_snapshot}
                              </strong>
                              <button
                                type="button"
                                disabled={!writable || busy}
                                aria-label={`Edit result for ${h.cadence_snapshot === "once" ? "Overall" : h.period_start}`}
                                onClick={() => {
                                  setResultBusy(true);
                                  setEditing({
                                    kind: "result",
                                    item: k,
                                    day:
                                      h.cadence_snapshot === "once"
                                        ? k.today
                                        : h.period_start,
                                  });
                                }}
                              >
                                Edit
                              </button>
                            </div>
                          ))}
                          <small>
                            Showing {(older[k.id]?.items || k.history).length}{" "}
                            of {k.historyTotal} results
                          </small>
                          {(older[k.id]?.more ?? k.historyMore) && (
                            <button
                              type="button"
                              disabled={!!historyBusy}
                              onClick={() => void moreHistory(k)}
                            >
                              Load older results
                            </button>
                          )}
                        </details>
                      )}
                    </section>
                  );
                })}
              <button
                type="button"
                className="plan-tool-add"
                disabled={!writable || busy}
                onClick={() => setEditing({ kind: "kpi", activityId: a.id })}
              >
                <Plus size={15} />{" "}
                {needsTarget.some((item) => item.id === a.id)
                  ? "Set target"
                  : "Add measurement"}
              </button>
            </div>
          )}
        </article>
      ))}
      {!!activities.length && (
        <button
          type="button"
          className="plan-tool-add"
          disabled={!writable || busy}
          onClick={addActivity}
        >
          <Plus size={15} /> Mark an activity
        </button>
      )}
      {data?.kpis.some((k) => k.archived) && (
        <label className="success-show-archived">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Show archived measurements
        </label>
      )}
      {editing && (
        <Modal busy={busy} close={() => setEditing(null)}>
          <div className="success-editor">
            <div className="success-editor-heading">
              <h4>
                {editing.kind === "activity"
                  ? "Activity indicators"
                  : editing.kind === "kpi"
                    ? "KPI measurement"
                    : "Log a result"}
              </h4>
              <button
                type="button"
                className="plan-tool-icon"
                aria-label="Close activity editor"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                <X size={19} />
              </button>
            </div>
            {editing.kind === "activity" && !editing.item && (
              <label className="success-activity-picker">
                Choose an activity
                <select
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="new">+ New activity in WBS</option>
                  {data?.activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <form
              key={
                editing.kind +
                (chosen?.id || ("item" in editing ? editing.item?.id : "new"))
              }
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (editing.kind === "activity")
                  void save({
                    action: "activity",
                    ...(chosen ? { id: chosen.id } : {}),
                    revision: chosen?.revision || 0,
                    ...(!chosen ? { title: f.get("title") } : {}),
                    isCsf: f.get("isCsf") === "on",
                    isKpi: f.get("isKpi") === "on",
                    note: f.get("note"),
                  });
                else if (editing.kind === "kpi")
                  void save({
                    action: "kpi",
                    ...(editing.item ? { id: editing.item.id } : {}),
                    activityId: editing.activityId,
                    revision: editing.item?.revision || 0,
                    title: f.get("title"),
                    target: Number(f.get("target")),
                    unit: f.get("unit"),
                    cadence: f.get("cadence"),
                    direction: f.get("direction"),
                    timezone:
                      editing.item?.timezone ||
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                    archived: f.get("archived") === "on",
                  });
                else
                  void save({
                    action: "result",
                    id: editing.item.id,
                    activityId: editing.item.activity_id,
                    kpiRevision: Number(f.get("kpiRevision")),
                    revision: Number(f.get("resultRevision")),
                    day: f.get("reportDay"),
                    entryMode: f.get("entryMode"),
                    actual: Number(f.get("actual")),
                    note: f.get("note"),
                  });
              }}
            >
              {editing.kind === "activity" ? (
                <>
                  {chosen ? (
                    <p>
                      <strong>{chosen.title}</strong>
                      <br />
                      {chosen.stage} ·{" "}
                      {chosen.storage_state === "active"
                        ? "In Tasks"
                        : "WBS only"}
                    </p>
                  ) : (
                    <>
                      <label htmlFor={uid + "title"}>Activity name</label>
                      <input
                        autoFocus
                        id={uid + "title"}
                        name="title"
                        maxLength={200}
                        placeholder="Run ad, gym, daily protein…"
                        required
                      />
                    </>
                  )}
                  <ActivityTags
                    isCsf={chosen?.is_csf ?? true}
                    isKpi={chosen?.is_kpi ?? false}
                    disabled={!writable || busy}
                  />
                  <label htmlFor={uid + "note"}>
                    Why it matters (optional)
                  </label>
                  <textarea
                    name="note"
                    id={uid + "note"}
                    defaultValue={chosen?.activity_note || ""}
                    maxLength={1000}
                    rows={2}
                  />
                  <p className="success-helper">
                    These are markers on the same activity. They don’t add it to
                    Tasks or change its completion or repeat settings.
                  </p>
                </>
              ) : editing.kind === "kpi" ? (
                <>
                  <label htmlFor={uid + "title"}>Measurement name</label>
                  <input
                    autoFocus
                    id={uid + "title"}
                    name="title"
                    maxLength={160}
                    defaultValue={editing.item?.title || ""}
                    placeholder="Leads, demos, grams of protein…"
                    required
                  />
                  <div className="success-form-row">
                    <label>
                      Target
                      <input
                        name="target"
                        type="number"
                        min="0"
                        max="1000000000000"
                        step="any"
                        defaultValue={editing.item?.target ?? 3}
                        required
                      />
                    </label>
                    <label>
                      Unit
                      <input
                        name="unit"
                        maxLength={40}
                        defaultValue={editing.item?.unit || ""}
                        placeholder="leads, grams, visits"
                      />
                    </label>
                  </div>
                  <label htmlFor={uid + "cadence"}>Target period</label>
                  <select
                    id={uid + "cadence"}
                    name="cadence"
                    defaultValue={editing.item?.cadence || "daily"}
                  >
                    {Object.entries(periods).map(([v, l]) => (
                      <option value={v} key={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={uid + "direction"}>Success means</label>
                  <select
                    id={uid + "direction"}
                    name="direction"
                    defaultValue={editing.item?.direction || "at_least"}
                  >
                    <option value="at_least">At least the target</option>
                    <option value="at_most">At most the target</option>
                  </select>
                  {editing.item && (
                    <>
                      <p className="success-helper">
                        Saved periods keep their original targets. Changes apply
                        to new results from today.
                      </p>
                      <label className="success-show-archived">
                        <input
                          type="checkbox"
                          name="archived"
                          defaultChecked={editing.item.archived}
                        />{" "}
                        Archive measurement
                      </label>
                    </>
                  )}
                </>
              ) : (
                <ResultFields
                  key={editing.item.id + (editing.day || "current")}
                  item={editing.item}
                  initialDay={editing.day}
                  path={path}
                  request={request}
                  onBusy={setResultBusy}
                />
              )}
              <div className="success-editor-actions">
                <button
                  type="submit"
                  className="plan-tool-primary"
                  disabled={
                    busy ||
                    !writable ||
                    (editing.kind === "result" && resultBusy)
                  }
                >
                  {busy
                    ? "Saving…"
                    : editing.kind === "result"
                      ? "Save result"
                      : "Save indicators"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </div>
              {error && (
                <p className="plan-tool-error" role="alert">
                  {error}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void load().then(() => {
                        setEditing(null);
                        setError("");
                      })
                    }
                  >
                    Reload activities
                  </button>
                </p>
              )}
            </form>
          </div>
        </Modal>
      )}
    </section>
  );
}
function Modal({
  children,
  busy,
  close,
}: {
  children: ReactNode;
  busy: boolean;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      d?.close();
    };
  }, []);
  return createPortal(
    <dialog
      className="success-modal"
      aria-label="Activity indicators and measurements"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}

function ResultFields({
  item,
  initialDay,
  path,
  request,
  onBusy,
}: {
  item: Kpi;
  initialDay?: string;
  path: string;
  request: Transport;
  onBusy: (busy: boolean) => void;
}) {
  const [metric, setMetric] = useState(item),
    [day, setDay] = useState(initialDay || item.day),
    [mode, setMode] = useState<"current" | "dated">(
      initialDay ? "dated" : "current",
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [rollover, setRollover] = useState(false);
  const sequence = useRef(0),
    alive = useRef(true);
  async function choose(selected?: string) {
    const ticket = ++sequence.current;
    setLoading(true);
    onBusy(true);
    setError("");
    if (selected !== undefined) {
      setDay(selected);
      setMode("dated");
    }
    if (selected === "") {
      setError("Choose a reporting date.");
      return;
    }
    try {
      const next = await request(
        path +
          "&kpiId=" +
          encodeURIComponent(item.id) +
          (selected ? "&day=" + encodeURIComponent(selected) : ""),
      );
      const k = next.kpis.find((k: Kpi) => k.id === item.id);
      if (!alive.current || ticket !== sequence.current) return;
      if (!k) throw Error("Measurement is no longer available.");
      setMetric(k);
      setDay(k.day);
      setMode(selected ? "dated" : "current");
      setRollover(false);
      setLoading(false);
      onBusy(false);
    } catch (e) {
      if (alive.current && ticket === sequence.current) {
        setError((e as Error).message);
        setLoading(false);
        onBusy(true);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void choose(initialDay);
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    const check = () => {
      if (mode === "current" && kpiLocalDay(metric.timezone) !== metric.today) {
        setRollover(true);
        onBusy(true);
      }
    };
    const timer = setInterval(check, 1000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [metric.today, metric.timezone, mode, onBusy]);
  const current = metric.current;
  const target = current
      ? Number(current.target_snapshot)
      : Number(metric.periodTarget.target),
    unit = current ? current.unit_snapshot : metric.periodTarget.unit;
  return (
    <>
      <p>
        <strong>{metric.title}</strong> · {metric.period.label}
      </p>
      <label>
        Reporting date
        <input
          type="date"
          name="reportDay"
          value={day}
          max={kpiLocalDay(metric.timezone)}
          onChange={(e) => void choose(e.target.value)}
          required
        />
      </label>
      <div className="success-date-shortcuts">
        <button type="button" onClick={() => void choose()}>
          Today
        </button>
        <button
          type="button"
          onClick={() => {
            const d = new Date(kpiLocalDay(metric.timezone) + "T12:00:00Z");
            d.setUTCDate(d.getUTCDate() - 1);
            void choose(d.toISOString().slice(0, 10));
          }}
        >
          Yesterday
        </button>
      </div>
      {rollover && (
        <p role="alert">
          A new reporting day has started. Choose Today or select a date before
          saving. Your entered total is still here.
        </p>
      )}
      {loading && <p role="status">Loading reporting period…</p>}
      {error && (
        <p role="alert">
          {error}
          <button
            type="button"
            onClick={() => void choose(mode === "current" ? undefined : day)}
          >
            Retry
          </button>
        </p>
      )}
      <input type="hidden" name="entryMode" value={mode} />
      <input
        type="hidden"
        name="resultRevision"
        value={current?.revision || 0}
      />
      <input type="hidden" name="kpiRevision" value={metric.revision} />
      <fieldset
        disabled={loading || !!error || rollover}
        className="success-result-fields"
        key={metric.id + metric.period.start + ":" + (current?.revision || 0)}
      >
        <legend>
          {metric.period.label} · Target {target.toLocaleString()} {unit} ·{" "}
          {metric.timezone}
        </legend>
        <label>
          Measured total for this period
          <input
            name="actual"
            type="number"
            min="0"
            max="1000000000000"
            step="any"
            defaultValue={current?.actual ?? ""}
            required
          />
        </label>
        <p className="success-helper">
          Enter the full total. This replaces the saved value for this period.
          Historical entries use that date’s target; saved periods retain their
          original target.
        </p>
        <label>
          Note (optional)
          <textarea
            name="note"
            defaultValue={current?.note || ""}
            maxLength={1000}
            rows={2}
          />
        </label>
      </fieldset>
    </>
  );
}
