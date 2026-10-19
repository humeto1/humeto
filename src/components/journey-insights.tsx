"use client";
import { useState, useEffect, useCallback } from "react";
import { Clock3, CalendarClock, TrendingUp, RefreshCw } from "lucide-react";
import { money } from "@/lib/pipeline";
import styles from "./journey-insights.module.css";
type Kind = "leads" | "applicants" | "applications";
type RecordRow = {
  id: string;
  kind: Kind;
  name: string;
  title: string;
  country: string;
  intake: string;
  personId: string;
  stage: string;
  stageTitle: string;
  revision: number;
  enteredAt: string | null;
  observedDays: number | null;
  baseline: boolean;
  deadline: {
    dueDate: string;
    timezone: string;
    label: string;
    revision: number;
  };
  daysUntil: number | null;
  fee: number | null;
  paid: number | null;
  pending: number | null;
  contingentIncentive: number | null;
  earnedCommission: number | null;
};
type Data = {
  records: RecordRow[];
  metrics: {
    kind: Kind;
    stage: string;
    title: string;
    visits: number;
    averageDays: number | null;
  }[];
  generatedAt: string;
};
const kinds = {
  leads: "Leads",
  applicants: "Applicants",
  applications: "Applications",
};
function DeadlineEditor({
  row,
  writable,
  onSaved,
}: {
  row: RecordRow;
  writable: boolean;
  onSaved: () => Promise<void>;
}) {
  const [dueDate, setDate] = useState(row.deadline.dueDate),
    [label, setLabel] = useState(row.deadline.label),
    [zone, setZone] = useState(row.deadline.timezone),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setDate(row.deadline.dueDate);
    setLabel(row.deadline.label);
    setZone(row.deadline.timezone);
  }, [row]);
  const save = async (clear = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/journey-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: row.kind,
          id: row.id,
          entityRevision: row.revision,
          revision: row.deadline.revision,
          dueDate: clear ? "" : dueDate,
          label: clear ? "" : label,
          timezone: zone,
        }),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      await onSaved();
      setError(clear ? "Deadline cleared." : "Deadline saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save deadline.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className={styles.editor}>
      <summary>
        {row.deadline.dueDate ? "Edit deadline" : "Set deadline"}
      </summary>
      <div>
        <label>
          Deadline label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={140}
            placeholder="e.g. Scholarship documents due"
          />
        </label>
        <label>
          Due date
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Deadline timezone
          <input
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            list="journey-timezones"
          />
        </label>
        <p>
          Due through the end of this local calendar day. No message is sent or
          application submitted.
        </p>
        <button
          className="btn primary small"
          disabled={busy || !writable || !dueDate}
          onClick={() => void save()}
        >
          Save deadline
        </button>
        {row.deadline.dueDate && (
          <button
            className="btn secondary small"
            disabled={busy || !writable}
            onClick={() => void save(true)}
          >
            Clear deadline
          </button>
        )}
        {error && <p role="status">{error}</p>}
      </div>
    </details>
  );
}
export default function JourneyInsights({ writable }: { writable: boolean }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [kind, setKind] = useState<Kind>("applicants"),
    [stage, setStage] = useState(""),
    [country, setCountry] = useState(""),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("deadline"),
    [overdue, setOverdue] = useState(false),
    [threshold, setThreshold] = useState(7),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/journey-insights"),
        v = await r.json();
      if (!r.ok) throw Error(v.error);
      setData(v);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load insights.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const group = data?.records.filter((r) => r.kind === kind) || [],
    rows = group
      .filter(
        (r) =>
          (!stage || r.stage === stage) &&
          (!country || r.country === country) &&
          (!overdue || (r.daysUntil !== null && r.daysUntil < 0)) &&
          `${r.name} ${r.title} ${r.country} ${r.intake}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
      .sort((a, b) =>
        sort === "age"
          ? (b.observedDays ?? -1) - (a.observedDays ?? -1)
          : sort === "value"
            ? (b.fee ?? b.earnedCommission ?? -1) -
              (a.fee ?? a.earnedCommission ?? -1)
            : (a.daysUntil ?? 999999) - (b.daysUntil ?? 999999),
      );
  const fee = rows.reduce((n, r) => n + (r.fee || 0), 0),
    pending = rows.reduce((n, r) => n + (r.pending || 0), 0),
    earned = rows.reduce((n, r) => n + (r.earnedCommission || 0), 0);
  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <span>
          <small>HUMETO CRM · JOURNEY INSIGHTS</small>
          <h1>See what needs attention.</h1>
          <p>
            Deadlines, observed stage time and case value in one place.
            Applicant and application journeys stay separate.
          </p>
        </span>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className={styles.filters}>
        <label>
          Journey
          <select
            aria-label="Journey"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setStage("");
              setCountry("");
            }}
          >
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {Array.from(new Map(group.map((r) => [r.stage, r.stageTitle]))).map(
              ([k, title]) => (
                <option key={k} value={k}>
                  {title}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Destination
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All destinations</option>
            {Array.from(new Set(group.map((r) => r.country).filter(Boolean)))
              .sort()
              .map((c) => (
                <option key={c}>{c}</option>
              ))}
          </select>
        </label>
        <label>
          Find a case
          <input
            placeholder="Name, institution, intake…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="deadline">Nearest deadline</option>
            <option value="age">Longest observed stage</option>
            <option value="value">
              Highest{" "}
              {kind === "applications" ? "earned commission" : "fee value"}
            </option>
          </select>
        </label>
      </div>
      <div className={styles.stats}>
        <article>
          <CalendarClock size={18} />
          <strong>
            {rows.filter((r) => r.daysUntil !== null && r.daysUntil < 0).length}
          </strong>
          <span>Overdue deadlines</span>
        </article>
        <article>
          <Clock3 size={18} />
          <strong>
            {rows.filter((r) => (r.observedDays ?? -1) >= threshold).length}
          </strong>
          <span>At least {threshold} days observed</span>
        </article>
        <article>
          <TrendingUp size={18} />
          <strong>PKR {money(kind === "applications" ? earned : fee)}</strong>
          <span>
            {kind === "applications"
              ? "Earned commission"
              : kind === "leads"
                ? "Unregistered lead fee potential"
                : "Agreed client fees"}
          </span>
        </article>
        {kind === "applicants" && (
          <article>
            <strong>PKR {money(pending)}</strong>
            <span>Pending agreed fees</span>
          </article>
        )}
      </div>
      <div className={styles.controls}>
        <label>
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => setOverdue(e.target.checked)}
          />
          Only overdue deadlines
        </label>
        <label>
          Stage attention threshold{" "}
          <input
            aria-label="Stage attention threshold"
            type="number"
            min={1}
            max={365}
            value={threshold}
            onChange={(e) =>
              setThreshold(
                Math.min(365, Math.max(1, Number(e.target.value) || 1)),
              )
            }
          />{" "}
          days
        </label>
        <span>
          {rows.length} {kinds[kind].toLowerCase()}
        </span>
      </div>
      <p className={styles.note}>
        Observed time measures recorded stage visits, not processing-speed
        predictions. “At least” means tracking began after this record already
        existed. Fee potential and contingent incentives are estimates; earned
        commissions are recorded separately. Application cards do not repeat
        their applicant’s fee.
      </p>
      <div className={styles.cards}>
        {rows.map((row) => (
          <article key={row.id} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.stage}>{row.stageTitle}</span>
              <span>{row.country || "Destination not set"}</span>
            </div>
            <h2>{row.title}</h2>
            {kind === "applications" && (
              <p>
                {row.name}
                {row.intake ? " · " + row.intake : ""}
              </p>
            )}
            <div className={styles.observed}>
              <Clock3 size={15} />
              {row.observedDays === null
                ? "Stage observation unavailable"
                : `${row.baseline ? "At least " : ""}${row.observedDays.toFixed(1)} days in this stage`}
              {(row.observedDays ?? -1) >= threshold && <b>Review progress</b>}
            </div>
            {row.deadline.dueDate && (
              <div
                className={
                  row.daysUntil !== null && row.daysUntil < 0
                    ? styles.overdue
                    : styles.due
                }
              >
                <strong>{row.deadline.label || "Case deadline"}</strong>
                <span>
                  {row.deadline.dueDate} · {row.deadline.timezone}
                </span>
                <b>
                  {row.daysUntil === 0
                    ? "Due today"
                    : (row.daysUntil ?? 0) < 0
                      ? `${-row.daysUntil!} days overdue`
                      : `Due in ${row.daysUntil} days`}
                </b>
              </div>
            )}
            <div className={styles.value}>
              {row.fee !== null && (
                <span>
                  {kind === "leads" ? "Potential" : "Agreed"} fee{" "}
                  <b>PKR {money(row.fee)}</b>
                </span>
              )}
              {row.paid !== null && (
                <span>
                  Received <b className={styles.received}>+{money(row.paid)}</b>
                </span>
              )}
              {row.pending !== null && (
                <span>
                  Pending{" "}
                  <b className={styles.outstanding}>−{money(row.pending)}</b>
                </span>
              )}
              {row.contingentIncentive !== null && (
                <span>
                  Contingent incentive{" "}
                  <b>PKR {money(row.contingentIncentive)}</b>
                </span>
              )}
              {row.earnedCommission !== null && (
                <span>
                  Earned commission <b>PKR {money(row.earnedCommission)}</b>
                </span>
              )}
            </div>
            {row.personId && (
              <a
                href={"/workspace/students/" + encodeURIComponent(row.personId)}
              >
                Open applicant →
              </a>
            )}
            <DeadlineEditor row={row} writable={writable} onSaved={load} />
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className={styles.empty}>
          {busy
            ? "Loading journeys…"
            : "No cases match these filters. Change the filters or add a lead, applicant or application."}
        </p>
      )}
      <section className={styles.metrics}>
        <h2>Recorded stage durations</h2>
        <p>
          Average elapsed days for completed visits recorded from their actual
          start. Existing baseline visits are excluded. Repeated visits count
          separately; this does not predict a university or embassy decision.
        </p>
        <div>
          {data?.metrics
            .filter((m) => m.kind === kind && m.visits > 0)
            .map((m) => (
              <article key={m.stage}>
                <strong>{m.title}</strong>
                <b>{m.averageDays?.toFixed(1)} days</b>
                <span>{m.visits} completed visits</span>
              </article>
            ))}
        </div>
        {!data?.metrics.some((m) => m.kind === kind && m.visits > 0) && (
          <p>
            No complete stage observations yet. Durations will appear as cases
            move between stages.
          </p>
        )}
      </section>
      <datalist id="journey-timezones">
        {[
          "Asia/Karachi",
          "Asia/Dubai",
          "Europe/London",
          "Europe/Berlin",
          "America/New_York",
          "America/Toronto",
          "Pacific/Auckland",
          "UTC",
        ].map((z) => (
          <option value={z} key={z} />
        ))}
      </datalist>
    </section>
  );
}
