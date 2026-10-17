"use client";
import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Send,
  Check,
  Mail,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
type Action = {
  id: string;
  status: string;
  targetId: string;
  payload: {
    kind: string;
    summary: string;
    email: string;
    personName: string;
    personId: string;
    subject?: string;
    body?: string;
  };
};
type State = {
  engine: string;
  messages: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
    action: Action | null;
  }[];
  drafts: {
    id: string;
    recipient: string;
    subject: string;
    body: string;
    status: string;
  }[];
};
export default function CrmAssistant({
  onChange,
  writable,
}: {
  onChange: () => Promise<void>;
  writable: boolean;
}) {
  const [state, setState] = useState<State | null>(null),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draftsOpen, setDraftsOpen] = useState(false);
  const client = useRef<{ message: string; key: string } | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  async function load() {
    try {
      const r = await fetch("/api/crm-agent");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setState(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function send(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/crm-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setState(d);
      await onChange();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function message(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (client.current?.message !== text)
      client.current = { message: text, key: crypto.randomUUID() };
    if (
      await send({
        operation: "message",
        message: text,
        clientKey: client.current.key,
      })
    ) {
      setInput("");
      client.current = null;
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  const examples = [
    "Show cases for amira.shah@example.com",
    "Open admission case for amira.shah@example.com in United Kingdom",
    "Draft document reminder for amira.shah@example.com",
    "Draft fee reminder for fatima.ahmed@example.com",
  ];
  return (
    <div className="crm-ai">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A LITTLE CLARITY BEFORE THE NEXT STEP</span>
          <h1>What can we move forward?</h1>
          <p>
            Review case actions and reminder drafts with your CRM companion.
          </p>
        </div>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          Refresh chat
        </button>
      </div>
      <div className="crm-chat-status">
        <span>
          <Sparkles size={16} />
          Local command testing
        </span>
        <span>Private chat · applied case changes shared with your team</span>
        <button onClick={() => setDraftsOpen((v) => !v)}>
          <Mail size={14} />
          {state?.drafts.length || 0} saved drafts
        </button>
      </div>
      <p className="report-explanation">
        Commands use saved workspace records. Changes require a review. Emails
        are saved as drafts only; there is no connected mailbox. A review
        expires after 15 minutes.
      </p>
      <div className="crm-chat-layout">
        <section className="crm-conversation" aria-label="CRM conversation">
          {!state ? (
            <p role="status">Loading your conversation…</p>
          ) : !state.messages.length ? (
            <div className="crm-chat-welcome">
              <Sparkles size={30} />
              <h2>One conversation. A clear next step.</h2>
              <p>
                Open a tracking case, find an application, change its stage or
                prepare an accurate reminder. Start with a registered
                applicant’s email.
              </p>
            </div>
          ) : (
            state.messages.map((m) => (
              <article className={"crm-message " + m.role} key={m.id}>
                <span>{m.role === "user" ? "You" : "Humeto · CRM"}</span>
                <p>{m.content}</p>
                {m.action && (
                  <div className="crm-action">
                    <strong>{m.action.payload.summary}</strong>
                    <small>
                      {m.action.payload.personName} · {m.action.payload.email}
                    </small>
                    {m.action.payload.subject && (
                      <>
                        <h3>{m.action.payload.subject}</h3>
                        <pre>{m.action.payload.body}</pre>
                      </>
                    )}
                    <footer>
                      {m.action.status === "pending" ? (
                        <>
                          <button
                            className="btn primary small"
                            disabled={busy || !writable}
                            onClick={() =>
                              void send({
                                operation: "action",
                                actionId: m.action!.id,
                                decision: "apply",
                              })
                            }
                          >
                            <Check size={14} />
                            {m.action.payload.kind === "draft"
                              ? "Save draft · do not send"
                              : "Apply reviewed change"}
                          </button>
                          <button
                            className="btn secondary small"
                            disabled={busy || !writable}
                            onClick={() =>
                              void send({
                                operation: "action",
                                actionId: m.action!.id,
                                decision: "cancel",
                              })
                            }
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <span className="crm-action-state">
                          {m.action.status === "applied"
                            ? m.action.payload.kind === "draft"
                              ? "Draft saved · not sent"
                              : "Applied"
                            : m.action.status}
                        </span>
                      )}
                      {m.action.status === "applied" &&
                        m.action.payload.kind !== "draft" && (
                          <a
                            href={
                              m.action.payload.kind === "close-applicant"
                                ? "/workspace/students/" +
                                  m.action.payload.personId
                                : "/workspace/applications"
                            }
                          >
                            View record <ArrowUpRight size={12} />
                          </a>
                        )}
                    </footer>
                    {m.action.targetId && m.action.payload.kind !== "draft" && (
                      <small>Record: {m.action.targetId}</small>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
          <div ref={bottom} />
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          <form className="crm-chat-compose" onSubmit={message}>
            <label htmlFor="crm-chat-input">
              Tell Humeto what you want to do
            </label>
            <textarea
              id="crm-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={2000}
              placeholder="Show cases for amira.shah@example.com"
              disabled={!state || !writable || busy}
            />
            <div>
              <small>
                {writable
                  ? "Supported local commands · no live AI model"
                  : "Workspace is read-only"}
              </small>
              <button
                className="btn primary"
                disabled={!state || !input.trim() || busy || !writable}
              >
                {busy ? (
                  "Working…"
                ) : (
                  <>
                    Review command <Send size={14} />
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
        <aside className="crm-chat-guide">
          <h2>Try a next step</h2>
          {examples.map((text) => (
            <button
              key={text}
              disabled={busy}
              onClick={() => {
                setInput(text);
                document.getElementById("crm-chat-input")?.focus();
              }}
            >
              {text}
              <ArrowUpRight size={13} />
            </button>
          ))}
          <h3>Other supported commands</h3>
          <p>Move application APP-ID to Offer received</p>
          <p>Close application APP-ID</p>
          <p>Close applicant EMAIL</p>
          <small>
            Use “Show cases for EMAIL” to find an exact application ID. Ready
            and Submitted transitions use the existing checklist/reference
            review.
          </small>
          <a href="/workspace/leads">Create a lead in CRM →</a>
        </aside>
      </div>
      {draftsOpen && (
        <section className="crm-drafts">
          <h2>Saved email drafts · not sent</h2>
          <p>
            No drafts are queued for automatic delivery. Connect and test a
            mailbox in a future phase before sending.
          </p>
          {state?.drafts.map((d) => (
            <details key={d.id}>
              <summary>
                {d.subject} · {d.recipient}
              </summary>
              <pre>{d.body}</pre>
              <a
                download={`humeto-reminder-${d.id}.txt`}
                href={
                  "data:text/plain;charset=utf-8," +
                  encodeURIComponent(
                    `To: ${d.recipient}\nSubject: ${d.subject}\n\n${d.body}`,
                  )
                }
              >
                Download draft text
              </a>
            </details>
          ))}
          {!state?.drafts.length && <p>No saved drafts yet.</p>}
        </section>
      )}
    </div>
  );
}
