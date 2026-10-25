import { useEffect, useState, type ReactNode } from "react";
import { ProjectCollaboration } from "./project-collaboration";
import { webApi, type Transport } from "./transport";
import "./social-chat.css";
export type ChatMode = "ai" | "projects" | "break";
export function ChatNavigation({
  mode,
  onChange,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
}) {
  return (
    <div className="chat-mode-tabs" role="group" aria-label="Chat options">
      {(
        [
          ["ai", "Humeto AI"],
          ["projects", "Project chats"],
          ["break", "Break chat"],
        ] as const
      ).map(([key, label]) => (
        <button
          type="button"
          key={key}
          aria-pressed={mode === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function ProjectChatList({
  request = webApi,
  downloadFile,
  shareLink,
}: {
  request?: Transport;
  downloadFile?: (path: string, name: string) => Promise<void>;
  shareLink?: (url: string, title: string) => Promise<void>;
}) {
  const [projects, setProjects] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    request("/api/project-chat")
      .then((r) => {
        if (live) setProjects(r.projects);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [request]);
  return (
    <section className="social-chat" aria-label="Project chats">
      <h2>Team & client chats</h2>
      <p>
        Conversations stay within each shared project and its invited people.
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        Choose a project
        <select
          aria-label="Project chat"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      {!projects.length && !error && (
        <p>No project chats yet. Open Plans to add a project and its team.</p>
      )}
      {selected && (
        <ProjectCollaboration
          key={selected}
          projectId={selected}
          request={request}
          downloadFile={downloadFile}
          shareLink={shareLink}
        />
      )}
    </section>
  );
}
export function BreakChat({ request = webApi }: { request?: Transport }) {
  const [state, setState] = useState<any>(null),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [agree, setAgree] = useState(false),
    [report, setReport] = useState(""),
    [reason, setReason] = useState("abuse");
  async function load() {
    setState(await request("/api/break-chat"));
  }
  useEffect(() => {
    let live = true,
      polling = false;
    const refresh = async () => {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const s = await request("/api/break-chat");
        if (live) setState(s);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 7000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [request]);
  async function act(body: any) {
    setBusy(true);
    setError("");
    try {
      await request("/api/break-chat", body);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="social-chat break-chat"
      aria-label="Anonymous break chat"
    >
      <h2>A little break, together</h2>
      <p>
        A public room for people across Humeto. Text only, with friendly animal
        aliases. The room shows the last 24 hours.
      </p>
      {error && <p role="alert">{error}</p>}
      {!state ? (
        <p>Opening break chat…</p>
      ) : !state.joined ? (
        <div className="break-rules">
          <h3>Keep this a kind place</h3>
          <p>
            No abuse, profanity, harassment, hate, sexual content, spam, links
            or personal details—in any language. Messages are sent to OpenAI for
            safety checks before appearing. Reports go to Humeto moderation;
            repeated violations pause access.
          </p>
          <p>
            Other participants see only your animal alias. Humeto retains
            account-linked messages for up to 30 days for moderation; this is not
            an untraceable service. Do not share confidential information.
          </p>
          <label>
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />{" "}
            I agree to the break-chat rules
          </label>
          <button
            type="button"
            disabled={!agree || busy}
            onClick={() => void act({ action: "join", agree: true })}
          >
            Join as {state.alias}
          </button>
        </div>
      ) : (
        <>
          <p className="break-alias">
            You are <strong>{state.alias}</strong> · No names or profiles shown
          </p>
          {state.bannedUntil > Date.now() && (
            <p role="status">
              Your sending access is paused until{" "}
              {new Date(state.bannedUntil).toLocaleString()}.
            </p>
          )}
          <div className="break-feed" aria-label="Break conversation">
            {!state.messages.length && (
              <p>No messages yet. Say something kind to start.</p>
            )}
            {state.messages.map((m: any) => (
              <article key={m.id}>
                <header>
                  <strong>
                    {m.alias}
                    {m.mine ? " (you)" : ""}
                  </strong>
                  <time>
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                <p>{m.content}</p>
                <div className="break-actions">
                  {m.mine ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act({ action: "delete", messageId: m.id })
                      }
                    >
                      Delete
                    </button>
                  ) : (
                    <>
                      <button disabled={busy} onClick={() => setReport(m.id)}>
                        Report
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act({ action: "block", memberId: m.member })
                        }
                      >
                        Block {m.alias}
                      </button>
                    </>
                  )}
                </div>
                {report === m.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({
                        action: "report",
                        messageId: m.id,
                        reason,
                      }).then((ok) => {
                        if (ok) setReport("");
                      });
                    }}
                  >
                    <label>
                      Reason
                      <select
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      >
                        <option value="abuse">
                          Abuse or inappropriate language
                        </option>
                        <option value="personal_information">
                          Personal information
                        </option>
                        <option value="spam">Spam</option>
                        <option value="other">Other concern</option>
                      </select>
                    </label>
                    <button disabled={busy}>Submit report</button>
                    <button type="button" onClick={() => setReport("")}>
                      Cancel report
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act({
                action: "send",
                text,
                clientId: crypto.randomUUID(),
              }).then((ok) => {
                if (ok) setText("");
              });
            }}
          >
            <label>
              Message the break room
              <textarea
                aria-label="Break chat message"
                value={text}
                maxLength={500}
                required
                onChange={(e) => setText(e.target.value)}
                placeholder="Share a kind thought or a lighthearted joke…"
              />
            </label>
            <small>
              {text.length}/500 · Text only · Checked before posting
            </small>
            <button
              disabled={busy || !text.trim() || state.bannedUntil > Date.now()}
            >
              {busy ? "Checking…" : "Send message"}
            </button>
          </form>
        </>
      )}
      {state?.review && (
        <details>
          <summary>Moderation queue · {state.review.length}</summary>
          {state.review.map((r: any, i: number) => (
            <article key={r.id + ":" + i}>
              <strong>{r.alias}</strong>
              <p>{r.content}</p>
              <small>{r.reason}</small>
              {(["dismiss", "remove", "ban"] as const).map((decision) => (
                <button
                  key={decision}
                  disabled={busy}
                  onClick={() =>
                    void act({ action: "moderate", messageId: r.id, decision })
                  }
                >
                  {decision === "ban"
                    ? "Remove & ban for 30 days"
                    : decision === "remove"
                      ? "Remove message"
                      : "Dismiss report"}
                </button>
              ))}
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
export function ChatHub({
  children,
  request = webApi,
}: {
  children: ReactNode;
  request?: Transport;
}) {
  const [mode, setMode] = useState<ChatMode>("ai");
  return (
    <>
      <ChatNavigation mode={mode} onChange={setMode} />
      {mode === "ai" ? (
        children
      ) : mode === "projects" ? (
        <ProjectChatList request={request} />
      ) : (
        <BreakChat request={request} />
      )}
    </>
  );
}
