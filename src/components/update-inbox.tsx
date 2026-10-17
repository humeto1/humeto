"use client";
import { useState, useEffect, useRef } from "react";
import {
  Inbox,
  Mail,
  Plus,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Clock,
} from "lucide-react";
import type { Application, Person } from "@/lib/types";
import type { InboxRow, InboxReview } from "@/lib/update-inbox";
type Summary = Pick<
  InboxRow,
  | "id"
  | "sender"
  | "subject"
  | "source_at"
  | "status"
  | "revision"
  | "created_at"
>;
type Detail = {
  message: InboxRow;
  analysis: {
    candidates: Pick<Person, "id" | "name" | "email">[];
    applicationHints: string[];
    suggestedStatus: string;
    reason: string;
    applications: Application[];
  };
};
const stages = [
  "Offer received",
  "Conditional offer",
  "Decision received",
  "Visa approved",
  "Enrolled",
  "Failed",
  "Withdrawn",
];
export default function UpdateInbox({
  people,
  writable,
  refresh,
  search,
}: {
  people: Person[];
  writable: boolean;
  refresh: () => Promise<void>;
  search: string;
}) {
  const [items, setItems] = useState<Summary[]>([]),
    [total, setTotal] = useState(0),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [filter, setFilter] = useState("pending"),
    [captureOpen, setCaptureOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [personId, setPersonId] = useState(""),
    [appId, setAppId] = useState(""),
    [status, setStatus] = useState(""),
    [note, setNote] = useState(""),
    [matchNote, setMatchNote] = useState(""),
    [now, setNow] = useState(Date.now());
  const captureKey = useRef<{ signature: string; key: string } | null>(null),
    captureForm = useRef<HTMLFormElement>(null),
    panel = useRef<HTMLElement>(null);
  async function list() {
    const r = await fetch("/api/update-inbox");
    const v = await r.json();
    if (!r.ok) throw new Error(v.error);
    setItems(v.messages);
    setTotal(v.total);
  }
  async function older() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/update-inbox?offset=" + items.length);
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setItems((previous) => [
        ...previous,
        ...v.messages.filter(
          (m: Summary) => !previous.some((x) => x.id === m.id),
        ),
      ]);
      setTotal(v.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load(mid: string) {
    const r = await fetch("/api/update-inbox?id=" + encodeURIComponent(mid));
    const v = await r.json();
    if (!r.ok) throw new Error(v.error);
    setDetail(v);
    return v as Detail;
  }
  useEffect(() => {
    list()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setDetail(null);
    setError("");
    setNotice("");
    setNote("");
    setMatchNote("");
    setPersonId("");
    setAppId("");
    setStatus("");
    if (!selected) return;
    const c = new AbortController();
    fetch("/api/update-inbox?id=" + encodeURIComponent(selected), {
      signal: c.signal,
    })
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw new Error(v.error);
        setDetail(v);
        const candidate =
          v.analysis.candidates.length === 1 ? v.analysis.candidates[0].id : "";
        setPersonId(candidate);
        const hint = v.analysis.applications.filter(
          (a: Application) =>
            a.person_id === candidate &&
            v.analysis.applicationHints.includes(a.id),
        );
        if (hint.length === 1) setAppId(hint[0].id);
        setStatus(v.analysis.suggestedStatus);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    if (window.matchMedia("(max-width: 750px)").matches)
      panel.current?.scrollIntoView({ block: "start" });
    return () => c.abort();
  }, [selected]);
  async function action(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/update-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      await list();
      await refresh();
      if (selected) await load(selected);
      setNotice(success);
      return v;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function capture(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = Object.fromEntries(f) as Record<string, string>;
    if (!data.sourceAt || Number.isNaN(Date.parse(data.sourceAt))) {
      setError("Add the original received date and time.");
      return;
    }
    data.sourceAt = new Date(data.sourceAt).toISOString();
    const signature = JSON.stringify(data);
    if (captureKey.current?.signature !== signature)
      captureKey.current = { signature, key: crypto.randomUUID() };
    const v = await action(
      { operation: "capture", ...data, clientKey: captureKey.current.key },
      "Saved for review. No application has changed.",
    );
    if (v) {
      captureForm.current?.reset();
      captureKey.current = null;
      setCaptureOpen(false);
      setSelected(v.id);
    }
  }
  const current = detail?.message,
    review = current?.review as InboxReview | undefined;
  const app = detail?.analysis.applications.find(
    (a) => a.id === appId && a.person_id === personId,
  );
  const eligible = items
    .filter((x) =>
      (x.subject + " " + x.sender).toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (x) =>
        filter === "all" ||
        (filter === "pending"
          ? ["Pending", "Review"].includes(x.status)
          : x.status.toLowerCase() === filter),
    );
  const stamp = (at: string) =>
    new Date(at).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const needsExplanation =
    detail &&
    (detail.analysis.candidates.length !== 1 ||
      detail.analysis.candidates[0].id !== personId);
  return (
    <div className="update-inbox">
      <div className="inbox-intro">
        <div>
          <span className="eyebrow">A careful handoff</span>
          <h1>Every update, in the right place.</h1>
          <p>
            Match the applicant. Review one application. Keep the rest of their
            journey intact.
          </p>
        </div>
        <button
          className="btn primary"
          disabled={!writable || busy}
          onClick={() => setCaptureOpen(!captureOpen)}
        >
          <Plus size={16} /> Add email text
        </button>
      </div>
      <div className="inbox-mode">
        <Mail size={18} />
        <div>
          <strong>Local email review</strong>
          <p>
            Paste a message to test matching and reviewed status updates. Gmail
            sync and automatic email reading are not connected.
          </p>
        </div>
        <span>No messages sent</span>
      </div>
      {captureOpen && (
        <form
          className="inbox-capture panel"
          ref={captureForm}
          onSubmit={capture}
        >
          <h2>Bring an update into focus.</h2>
          <p>
            The message stays private to your account. Only the case update and
            your review note become shared application history.
          </p>
          <div className="form-grid">
            <label>
              Sender / original sender
              <input
                name="sender"
                maxLength={254}
                placeholder="admissions@example.edu"
              />
            </label>
            <label>
              Original received date and time
              <input name="sourceAt" type="datetime-local" required />
              <small>
                Use the email’s time, in this device’s timezone. We store it as
                UTC.
              </small>
            </label>
            <label>
              Subject
              <input
                name="subject"
                minLength={2}
                maxLength={300}
                required
                placeholder="Conditional offer — application reference"
              />
            </label>
            <label>
              Original message ID, if known
              <input
                name="sourceMessageId"
                maxLength={300}
                placeholder="Optional, for duplicate detection"
              />
            </label>
          </div>
          <label>
            Source link, if useful
            <input
              name="sourceUrl"
              type="url"
              maxLength={2000}
              placeholder="https://…"
            />
          </label>
          <label>
            Message text, including original recipient / forwarded headers
            <textarea
              name="body"
              minLength={10}
              maxLength={12000}
              rows={7}
              required
              placeholder="Paste the original email text here. Include the applicant email and reference where available."
            />
          </label>
          <div className="inbox-actions">
            <button className="btn primary" disabled={busy}>
              Save to review inbox <ArrowRight size={15} />
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setCaptureOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="filter-bar">
        <div className="segmented">
          {[
            ["pending", "Needs review"],
            ["applied", "Applied"],
            ["ignored", "Ignored"],
            ["all", "All updates"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={filter === k ? "active" : ""}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="subtle">
          {items.length} of {total} private updates loaded ·{" "}
          {items.filter((x) => ["Pending", "Review"].includes(x.status)).length}{" "}
          to review
        </span>
      </div>
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
      <div className="inbox-layout">
        <section className="inbox-list" aria-label="Captured updates">
          {eligible.map((x) => (
            <button
              key={x.id}
              disabled={busy}
              className={"inbox-card " + (selected === x.id ? "active" : "")}
              onClick={() => setSelected(x.id)}
            >
              <div>
                <span className={"inbox-status " + x.status.toLowerCase()}>
                  {x.status === "Review" ? "Ready to confirm" : x.status}
                </span>
                <Mail size={14} />
              </div>
              <h2>{x.subject}</h2>
              <p>{x.sender || "Sender to confirm"}</p>
              <small>{stamp(x.source_at)}</small>
            </button>
          ))}
          {!eligible.length && (
            <div className="inbox-empty">
              <Inbox size={28} />
              <h2>{loading ? "Loading your inbox…" : "A quieter queue."}</h2>
              <p>
                {loading
                  ? ""
                  : "Add an email update or switch views to see earlier decisions."}
              </p>
            </div>
          )}
          {items.length < total && (
            <button
              className="btn secondary small"
              disabled={busy}
              onClick={() => void older()}
            >
              Load earlier updates
            </button>
          )}
        </section>
        <section
          className="inbox-detail"
          ref={panel}
          aria-label="External update review"
        >
          {!selected ? (
            <div className="inbox-welcome">
              <ShieldCheck size={34} />
              <h2>
                One message.
                <br />
                One reviewed change.
              </h2>
              <p>
                Select an update to match the student and application. Shared
                forwarding addresses, names and phone numbers never silently
                decide the match.
              </p>
              <div>
                <span>Exact email hints</span>
                <span>Case-specific review</span>
                <span>Preserved outcomes</span>
              </div>
            </div>
          ) : !current ? (
            <p role="status">
              {error
                ? "This update could not be loaded."
                : "Loading this update…"}
            </p>
          ) : (
            <>
              <div className="inbox-message-heading">
                <span
                  className={"inbox-status " + current.status.toLowerCase()}
                >
                  {current.status}
                </span>
                <h2>{current.subject}</h2>
                <p>
                  {current.sender || "Sender not supplied"} ·{" "}
                  {stamp(current.source_at)}
                </p>
              </div>
              <details className="inbox-original" open>
                <summary>Original message text</summary>
                <pre>{current.body}</pre>
                {current.source_message_id && (
                  <small>Message ID: {current.source_message_id}</small>
                )}
                {current.source_url && (
                  <a href={current.source_url} target="_blank" rel="noreferrer">
                    Open source link ↗
                  </a>
                )}
              </details>
              <div className="inbox-match">
                <ShieldCheck size={18} />
                <div>
                  <strong>
                    {detail.analysis.candidates.length === 1
                      ? "An email match to check"
                      : detail.analysis.candidates.length
                        ? "More than one applicant appears"
                        : "Identity needs your review"}
                  </strong>
                  <p>{detail.analysis.reason}</p>
                  {detail.analysis.candidates.map((p) => (
                    <small key={p.id}>
                      {p.name} · {p.email}
                    </small>
                  ))}
                  {detail.analysis.applicationHints.length > 0 && (
                    <small>
                      Reference hints:{" "}
                      {detail.analysis.applicationHints.join(", ")}
                    </small>
                  )}
                  <small>
                    Local keyword hints use the subject only. They are not proof
                    of a decision.
                  </small>
                </div>
              </div>
              {current.status === "Applied" ? (
                <div className="inbox-applied">
                  <CheckCircle2 size={20} />
                  <div>
                    <h3>Applied to one application.</h3>
                    <p>
                      {review?.personName} ·{" "}
                      {review?.institution || review?.applicationId}
                    </p>
                    <strong>
                      {review?.fromStatus} → {review?.toStatus}
                    </strong>
                    <p>{review?.note}</p>
                    <small>
                      {stamp(current.applied_at)} · Other applications and the
                      applicant journey were unchanged.
                    </small>
                    <a href="/workspace/applications">Open applications ↗</a>
                  </div>
                </div>
              ) : current.status === "Ignored" ? (
                <div className="inbox-review">
                  <h3>Kept without changing a case.</h3>
                  <p>{current.decision_note}</p>
                  <button
                    disabled={!writable || busy}
                    className="btn secondary small"
                    onClick={() =>
                      void action(
                        {
                          operation: "reopen",
                          messageId: current.id,
                          revision: current.revision,
                        },
                        "Reopened for review.",
                      )
                    }
                  >
                    Reopen for review
                  </button>
                </div>
              ) : current.status === "Review" ? (
                <div className="inbox-review">
                  <span className="eyebrow">Confirm this exact change</span>
                  <h3>{review?.personName}</h3>
                  <p>{review?.email}</p>
                  <div className="inbox-case-summary">
                    <strong>
                      {review?.institution || "Institution to confirm"}
                    </strong>
                    <p>
                      {review?.kind} · {review?.country}
                      <br />
                      {review?.program}
                      <br />
                      Case {review?.applicationId}
                    </p>
                    <div>
                      <span>{review?.fromStatus}</span>
                      <ArrowRight size={16} />
                      <strong>{review?.toStatus}</strong>
                    </div>
                  </div>
                  <p>{review?.note}</p>
                  {review?.matchNote && (
                    <p>
                      <strong>Identity check:</strong> {review.matchNote}
                    </p>
                  )}
                  <small>
                    <Clock size={12} />{" "}
                    {current.review_expires_at > now
                      ? "Review expires in 15 minutes from preparation. Applicant and case revisions are checked again."
                      : "This review expired. Change the selection and prepare a fresh review."}
                  </small>
                  <div className="inbox-actions">
                    <button
                      disabled={
                        !writable || busy || current.review_expires_at <= now
                      }
                      className="btn primary"
                      onClick={() =>
                        void action(
                          {
                            operation: "apply",
                            messageId: current.id,
                            revision: current.revision,
                          },
                          "Application updated. The original message and review are retained.",
                        )
                      }
                    >
                      Apply this case update <CheckCircle2 size={15} />
                    </button>
                    <button
                      disabled={!writable || busy}
                      className="btn secondary"
                      onClick={() =>
                        void action(
                          {
                            operation: "clear",
                            messageId: current.id,
                            revision: current.revision,
                          },
                          "Review cleared. No application changed.",
                        )
                      }
                    >
                      Change selection
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  className="inbox-review"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!app) return;
                    void action(
                      {
                        operation: "preview",
                        messageId: current.id,
                        revision: current.revision,
                        applicationId: app.id,
                        applicationRevision: app.revision,
                        status,
                        note,
                        matchNote,
                      },
                      "Review prepared. The application has not changed.",
                    );
                  }}
                >
                  <h3>Match, then review.</h3>
                  <label>
                    Applicant
                    <select
                      required
                      value={personId}
                      disabled={!writable || busy}
                      onChange={(e) => {
                        setPersonId(e.target.value);
                        setAppId("");
                      }}
                    >
                      <option value="">Choose an applicant</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Specific application
                    <select
                      required
                      disabled={!personId || !writable || busy}
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                    >
                      <option value="">Choose a case</option>
                      {detail.analysis.applications
                        .filter((a) => a.person_id === personId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.institution || a.kind} · {a.country} · {a.status}{" "}
                            · {a.id}
                          </option>
                        ))}
                    </select>
                  </label>
                  {app && (
                    <p className="inbox-current-case">
                      {app.kind} · {app.program} · {app.intake}
                      <br />
                      Current status: <strong>{app.status}</strong>
                    </p>
                  )}
                  <label>
                    Proposed outcome
                    <select
                      required
                      value={status}
                      disabled={!writable || busy}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">Choose the actual outcome</option>
                      {stages.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <small>
                      {detail.analysis.suggestedStatus
                        ? "Subject hint: " +
                          detail.analysis.suggestedStatus +
                          ". Confirm it against the full message."
                        : "No reliable subject hint. Read the original and select an outcome only if supported."}
                    </small>
                  </label>
                  <label>
                    Evidence / review note
                    <textarea
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={3}
                      value={note}
                      disabled={!writable || busy}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What in this message supports the status change? This note is shared in case history."
                    />
                  </label>
                  <label>
                    How did you verify the applicant?{" "}
                    {needsExplanation ? "(required)" : "(optional)"}
                    <textarea
                      minLength={needsExplanation ? 10 : undefined}
                      required={!!needsExplanation}
                      maxLength={2000}
                      rows={2}
                      value={matchNote}
                      disabled={!writable || busy}
                      onChange={(e) => setMatchNote(e.target.value)}
                      placeholder="Explain other evidence if the email is absent, ambiguous or points to someone else."
                    />
                  </label>
                  <button
                    className="btn primary"
                    disabled={!writable || busy || !app}
                  >
                    Prepare review <ArrowRight size={15} />
                  </button>
                  <p className="inbox-footnote">
                    Ready / Submitted use the existing checklist and
                    portal-reference steps. Final outcomes and older messages
                    require manual correction review from Applications.
                  </p>
                </form>
              )}
              {["Pending", "Review"].includes(current.status) && (
                <details className="inbox-ignore">
                  <summary>Keep this update without changing a case</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void action(
                        {
                          operation: "ignore",
                          messageId: current.id,
                          revision: current.revision,
                          note: f.get("note"),
                        },
                        "Update retained as ignored. No case changed.",
                      );
                    }}
                  >
                    <label>
                      Why is no case change needed?
                      <input
                        name="note"
                        minLength={2}
                        maxLength={2000}
                        required
                        placeholder="Duplicate, unrelated, or retained as background evidence"
                      />
                    </label>
                    <button
                      className="btn secondary small"
                      disabled={!writable || busy}
                    >
                      Keep as ignored
                    </button>
                  </form>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
