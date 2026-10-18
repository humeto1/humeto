"use client";
import { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  FileText,
  Calendar,
  ArrowUpRight,
  Paperclip,
  Send,
  CheckCircle2,
  Clock,
} from "lucide-react";
import type { Actor, DocumentRow } from "@/lib/types";
import type { RequestRow } from "@/lib/request-workflow";
type Reply = {
  id: string;
  message: string;
  actor_name: string;
  channel: string;
  timezone: string;
  proposal: { state: string; day: string; at: string; reason: string };
  proposal_state: string;
  request_revision: number;
  document_id: string;
  document_version: number;
  created_at: string;
};
type Thread = {
  request: RequestRow;
  replies: Reply[];
  events: {
    id: string;
    event: string;
    note: string;
    actor_name: string;
    created_at: string;
    document_id: string;
    document_version: number;
  }[];
};
export default function RequestCenter({
  requests,
  documents,
  actor,
  writable,
  refresh,
  search,
}: {
  requests: RequestRow[];
  documents: DocumentRow[];
  actor: Actor;
  writable: boolean;
  refresh: () => Promise<void>;
  search: string;
}) {
  const staff = ["owner", "consultant"].includes(actor.role);
  const [selectedId, setSelectedId] = useState(""),
    [thread, setThread] = useState<Thread | null>(null),
    [filter, setFilter] = useState("active"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [message, setMessage] = useState(""),
    [documentId, setDocumentId] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [timezone, setTimezone] = useState("Asia/Karachi"),
    [detected, setDetected] = useState("Asia/Karachi"),
    [reviewNote, setReviewNote] = useState(""),
    [now, setNow] = useState("");
  const replyKey = useRef<{ signature: string; key: string } | null>(null),
    upload = useRef<HTMLInputElement>(null),
    threadPanel = useRef<HTMLElement>(null);
  const selected = requests.find((r) => r.id === selectedId);
  const r = thread?.request;
  useEffect(() => {
    const zone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
    setTimezone(zone);
    setDetected(zone);
    setNow(new Date().toISOString());
    const deepLink = new URLSearchParams(location.search).get("request");
    if (deepLink && requests.some((r) => r.id === deepLink))
      setSelectedId(deepLink);
    const timer = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    setThread(null);
    setError("");
    const controller = new AbortController();
    fetch("/api/workspace/requests/" + selectedId, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setThread(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [selectedId, selected?.revision]);
  useEffect(() => {
    setMessage("");
    setDocumentId("");
    setFile(null);
    setReviewNote("");
    setNotice("");
    replyKey.current = null;
    if (upload.current) upload.current.value = "";
    if (selectedId && window.matchMedia("(max-width: 750px)").matches)
      threadPanel.current?.scrollIntoView({ block: "start" });
  }, [selectedId]);
  async function run(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/" + path, {
        method,
        headers:
          body instanceof FormData
            ? undefined
            : { "Content-Type": "application/json" },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await refresh();
      if (selectedId) {
        const response = await fetch("/api/workspace/requests/" + selectedId);
        if (response.ok) setThread(await response.json());
      }
      window.dispatchEvent(new Event("humeto-reminders"));
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function reply(e: React.FormEvent) {
    e.preventDefault();
    if (!r) return;
    const signature = JSON.stringify([
      r.id,
      message,
      documentId,
      timezone,
      file?.name,
      file?.size,
      file?.lastModified,
    ]);
    if (replyKey.current?.signature !== signature)
      replyKey.current = { signature, key: crypto.randomUUID() };
    let result;
    if (file) {
      if (file.size > 15 * 1024 * 1024) {
        setError("Choose a PDF, PNG or JPEG up to 15 MB.");
        return;
      }
      const f = new FormData();
      f.set("personId", r.person_id);
      f.set("sectionKey", r.section_key);
      f.set("title", file.name);
      f.set("category", r.section_key === "passports" ? "Identity" : "Other");
      f.set("file", file);
      f.set("readInformation", "true");
      f.set("requestId", r.id);
      f.set("requestRevision", String(r.revision));
      f.set("replyMessage", message);
      f.set("replyTimezone", timezone);
      f.set("replyClientKey", replyKey.current.key);
      result = await run("documents", "POST", f);
    } else
      result = await run("requests/" + r.id + "/reply", "POST", {
        revision: r.revision,
        message,
        documentId,
        timezone,
        clientKey: replyKey.current.key,
      });
    if (result) {
      setMessage("");
      setFile(null);
      setDocumentId("");
      replyKey.current = null;
      if (upload.current) upload.current.value = "";
      setNotice(
        file || documentId
          ? "File received. It is waiting for consultant review."
          : "Reply saved. Any suggested date needs consultant confirmation.",
      );
    }
  }
  function action(status: string, acceptFile = false) {
    if (!r) return;
    if (reviewNote.trim().length < 2) {
      setError("Add a short review note before changing the request.");
      return;
    }
    void run("requests/" + r.id, "PATCH", {
      revision: r.revision,
      status,
      note: reviewNote,
      acceptFile,
    }).then((result) => {
      if (result) {
        setReviewNote("");
        setNotice(
          status === "Resolved"
            ? "Request resolved. Its evidence and history are retained."
            : status === "Open"
              ? "Request reopened. Add a new reply or file when ready."
              : "Changes requested. The conversation stays open.",
        );
      }
    });
  }
  const shown = requests
    .filter((x) =>
      (x.title + " " + x.message + " " + x.person_name)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .filter((x) =>
      filter === "all" || filter === "review"
        ? filter === "all" || x.status === "File received"
        : filter === "due"
          ? x.status === "Waiting for document" &&
            !!x.follow_up_at &&
            x.follow_up_at <= now
          : x.status !== "Resolved",
    );
  const due = requests.filter(
    (x) =>
      x.status === "Waiting for document" &&
      x.follow_up_at &&
      x.follow_up_at <= now,
  ).length;
  const review = requests.filter((x) => x.status === "File received").length;
  const format = (at: string, zone = timezone) =>
    new Date(at).toLocaleString("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const linked = r && documents.find((d) => d.id === r.document_id);
  return (
    <div className="request-center">
      <div className="request-queue-summary">
        <span>
          <MessageSquare size={16} />
          {requests.filter((x) => x.status !== "Resolved").length} active
          requests
        </span>
        <span>
          <FileText size={16} />
          {review} files to review
        </span>
        <span>
          <Clock size={16} />
          {due} follow-ups due
        </span>
      </div>
      <div className="filter-bar">
        <div className="segmented">
          {[
            ["active", "Active"],
            ["review", "Files to review"],
            ["due", "Follow-ups due"],
            ["all", "All requests"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? "active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="subtle">
          In-app conversation · no external messages sent
        </span>
      </div>
      <div
        className={
          "request-master-detail " + (selectedId ? "has-selection" : "")
        }
      >
        <section className="request-list" aria-label="Requests">
          {shown.map((x) => (
            <button
              key={x.id}
              disabled={busy}
              onClick={() => setSelectedId(x.id)}
              className={
                "request-summary-card " + (selectedId === x.id ? "active" : "")
              }
            >
              <div>
                <span
                  className={
                    "request-status " +
                    (x.status === "Resolved"
                      ? "resolved"
                      : x.status === "File received"
                        ? "received"
                        : "")
                  }
                >
                  {x.status}
                </span>
                <ArrowUpRight size={13} />
              </div>
              <h2>{x.title}</h2>
              <p>{x.message}</p>
              <small>{x.person_name}</small>
              {x.requires_document ? (
                <small>
                  <Paperclip size={11} /> Supporting file required
                </small>
              ) : null}
              {x.follow_up_at && (
                <small>
                  <Calendar size={11} />
                  {format(x.follow_up_at, x.follow_up_timezone)} ·{" "}
                  {x.follow_up_timezone}
                </small>
              )}
            </button>
          ))}
          {!shown.length && (
            <div className="request-empty">
              <CheckCircle2 size={25} />
              <h2>
                {requests.length
                  ? "Nothing in this view."
                  : "A clear next step starts here."}
              </h2>
              <p>
                {requests.length
                  ? "Other requests remain available under All requests."
                  : "Your consultant can request specific information or supporting documents."}
              </p>
            </div>
          )}
        </section>
        <section
          ref={threadPanel}
          className="request-thread"
          aria-label="Request conversation"
        >
          {!selectedId ? (
            <div className="request-welcome">
              <MessageSquare size={31} />
              <h2>A conversation, not another chase.</h2>
              <p>
                Choose a request to reply with an expected date, share a
                document or review what arrived.
              </p>
              <div>
                <span>Reply in your own time</span>
                <span>Review suggested dates</span>
                <span>Keep file versions and history</span>
              </div>
            </div>
          ) : !r ? (
            <p role="status">
              {error
                ? "Conversation unavailable. Select another request or reload to try again."
                : "Loading the conversation…"}
            </p>
          ) : (
            <>
              <div className="request-thread-heading">
                <div>
                  <span className="eyebrow">{r.person_name}</span>
                  <h2>{r.title}</h2>
                </div>
                <a
                  href={"/workspace/students/" + r.person_id}
                  className="subtle-link"
                >
                  Open profile ↗
                </a>
              </div>
              <p className="request-initial-message">{r.message}</p>
              <span className="request-status">{r.status}</span>
              {r.follow_up_at && (
                <div className="request-date-callout">
                  <Calendar size={18} />
                  <span>
                    Next follow-up:{" "}
                    <strong>
                      {format(r.follow_up_at, r.follow_up_timezone)}
                    </strong>
                    <small>
                      {r.follow_up_timezone} · in-app reminder for the
                      consultant
                    </small>
                  </span>
                </div>
              )}
              {r.document_id && (
                <div className="request-file-callout">
                  <FileText size={21} />
                  <div>
                    <strong>
                      {linked?.title || "Linked supporting file"} · version{" "}
                      {r.document_version}
                    </strong>
                    <p>
                      {r.status === "Resolved"
                        ? "Accepted for this request. This is not a document-authenticity certification."
                        : "Received and awaiting review. Upload alone does not mean verified or complete."}
                    </p>
                    <a
                      href={`/api/workspace/documents/${r.document_id}/download?version=${r.document_version}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View linked file ↗
                    </a>
                  </div>
                </div>
              )}
              {r.review_note && (
                <p className="request-review-note">
                  <strong>Consultant note</strong>
                  {r.review_note}
                </p>
              )}
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
              <div className="request-replies">
                {thread.replies.map((m) => (
                  <article key={m.id}>
                    <div>
                      <strong>{m.actor_name}</strong>
                      <span>
                        {m.channel} · {format(m.created_at, m.timezone)}
                      </span>
                    </div>
                    {m.message && <p>{m.message}</p>}
                    {m.document_id && (
                      <a
                        href={`/api/workspace/documents/${m.document_id}/download?version=${m.document_version}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Paperclip size={12} /> Attached file · v
                        {m.document_version}
                      </a>
                    )}
                    {m.proposal.state === "suggested" && (
                      <div className="request-proposal">
                        <Calendar size={17} />
                        <div>
                          <strong>
                            Suggested follow-up:{" "}
                            {format(m.proposal.at, m.timezone)}
                          </strong>
                          <p>{m.proposal.reason}</p>
                          {m.proposal_state === "Applied" ? (
                            <small>Follow-up confirmed</small>
                          ) : m.request_revision !== r.revision ? (
                            <small>
                              Earlier proposal — use the latest conversation or
                              confirm a date below.
                            </small>
                          ) : staff &&
                            !["Resolved", "File received"].includes(
                              r.status,
                            ) ? (
                            <button
                              className="btn secondary small"
                              disabled={busy || !writable}
                              onClick={() =>
                                void run(
                                  "requests/" + r.id + "/schedule",
                                  "POST",
                                  { revision: r.revision, replyId: m.id },
                                ).then((v) => {
                                  if (v)
                                    setNotice(
                                      "Follow-up updated. The previous reminder has stopped.",
                                    );
                                })
                              }
                            >
                              Use this follow-up date
                            </button>
                          ) : (
                            <small>
                              Waiting for your consultant to confirm the date.
                            </small>
                          )}
                        </div>
                      </div>
                    )}
                    {m.proposal.state === "clarify" && (
                      <p className="request-clarification">
                        {m.proposal.reason}
                      </p>
                    )}
                  </article>
                ))}
              </div>
              {r.status !== "Resolved" && (
                <form className="request-reply-form" onSubmit={reply}>
                  <h3>
                    {staff
                      ? "Add a note or supporting file"
                      : "Tell us where things stand"}
                  </h3>
                  <label>
                    Reply
                    <textarea
                      aria-label="Request reply"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      maxLength={2000}
                      placeholder="I expect to receive my passport after 20 days."
                      disabled={busy || !writable}
                    />
                  </label>
                  <label>
                    Dates in this reply use
                    <select
                      aria-label="Reply timezone"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    >
                      {[
                        ...new Set([
                          timezone,
                          detected,
                          "Asia/Karachi",
                          "Europe/London",
                          "America/New_York",
                          "Pacific/Auckland",
                          "UTC",
                        ]),
                      ].map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </select>
                  </label>
                  <details>
                    <summary>
                      <Paperclip size={13} /> Add a supporting document
                    </summary>
                    <label>
                      Upload a PDF, PNG or JPEG · up to 15 MB
                      <input
                        ref={upload}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg"
                        onChange={(e) => {
                          setFile(e.target.files?.[0] || null);
                          replyKey.current = null;
                        }}
                        disabled={busy || !writable}
                      />
                    </label>
                    <label>
                      Or link a file already in the library
                      <select
                        name="documentId"
                        value={documentId}
                        onChange={(e) => setDocumentId(e.target.value)}
                        disabled={!!file || busy || !writable}
                      >
                        <option value="">Choose a file</option>
                        {documents
                          .filter((d) => d.person_id === r.person_id)
                          .map((d) => (
                            <option value={d.id} key={d.id}>
                              {d.title} · v{d.current_version}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p>
                      Files stay linked to this applicant. The consultant
                      reviews them before completing this request.
                    </p>
                  </details>
                  <button
                    className="btn primary"
                    disabled={
                      busy ||
                      !writable ||
                      (!message.trim() && !file && !documentId)
                    }
                  >
                    {busy ? (
                      "Saving…"
                    ) : (
                      <>
                        <Send size={14} />
                        Send reply{file || documentId ? " & share file" : ""}
                      </>
                    )}
                  </button>
                </form>
              )}
              {staff && (
                <section className="request-review-controls">
                  <h3>Consultant review</h3>
                  {r.status !== "Resolved" && r.status !== "File received" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run("requests/" + r.id + "/schedule", "POST", {
                          revision: r.revision,
                          day: f.get("day"),
                          timezone,
                        }).then((v) => {
                          if (v)
                            setNotice(
                              "Follow-up scheduled at 09:00 in the selected timezone.",
                            );
                        });
                      }}
                    >
                      <label>
                        Confirm a different follow-up date
                        <input
                          type="date"
                          name="day"
                          required
                          disabled={busy || !writable}
                        />
                      </label>
                      <small>09:00 · {timezone}</small>
                      <button
                        className="btn secondary small"
                        disabled={busy || !writable}
                      >
                        Schedule follow-up
                      </button>
                    </form>
                  )}
                  <label>
                    Review / change note
                    <textarea
                      aria-label="Consultant review note"
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      maxLength={2000}
                      placeholder="Explain what was checked or what is still needed."
                    />
                  </label>
                  <div className="crm-actions">
                    {r.status === "File received" && r.document_id && (
                      <button
                        className="btn primary small"
                        disabled={busy || !writable || !linked}
                        onClick={() => action("Resolved", true)}
                      >
                        Accept file & resolve request
                      </button>
                    )}
                    {r.status !== "Resolved" && (
                      <button
                        className="btn secondary small"
                        disabled={busy || !writable}
                        onClick={() => action("Changes requested")}
                      >
                        Request changes
                      </button>
                    )}
                    {r.status !== "Resolved" &&
                      !r.requires_document &&
                      !r.document_id && (
                        <button
                          className="btn primary small"
                          disabled={busy || !writable}
                          onClick={() => action("Resolved")}
                        >
                          Resolve information request
                        </button>
                      )}
                    {r.status === "Resolved" && (
                      <button
                        className="btn secondary small"
                        disabled={busy || !writable}
                        onClick={() => action("Open")}
                      >
                        Reopen request
                      </button>
                    )}
                  </div>
                  {r.document_id && !linked && (
                    <small>
                      An authorized reviewer needs to access the linked evidence
                      before accepting it.
                    </small>
                  )}
                </section>
              )}
              <details className="request-history">
                <summary>Request history · {thread.events.length}</summary>
                {thread.events.map((e) => (
                  <article key={e.id}>
                    <strong>{e.event}</strong>
                    <p>{e.note}</p>
                    <small>
                      {e.actor_name} · {format(e.created_at)}
                    </small>
                    {e.document_id && (
                      <a
                        href={`/api/workspace/documents/${e.document_id}/download?version=${e.document_version}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Evidence version {e.document_version} ↗
                      </a>
                    )}
                  </article>
                ))}
              </details>
            </>
          )}
        </section>
      </div>
      {error && !r && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
