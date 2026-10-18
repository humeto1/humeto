"use client";
import { useEffect, useState, useCallback } from "react";
type Message = {
  id: string;
  remote: string;
  body: string;
  direction: string;
  status: string;
  created_at: number;
};
type State = {
  owner: boolean;
  connection: null | {
    status: string;
    phone: string;
    qr: string | null;
    heartbeat: number;
    error: string | null;
  };
  messages: Message[];
};
export default function CompanyWhatsApp() {
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState(""),
    [phone, setPhone] = useState(""),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function act(action: string, extra: object = {}) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (action === "draft") setBody("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const c = data?.connection,
    alive = c && c.heartbeat > Date.now() - 30000;
  return (
    <section className="panel settings-panel" style={{ gridColumn: "1 / -1" }}>
      <h2>Company WhatsApp</h2>
      <p>
        One company. One private WhatsApp connection. Pair your company number
        to receive messages and send reviewed replies to your team and students.
      </p>
      <p>
        <strong>{alive ? c?.status : "Worker offline / not paired"}</strong>
        {c?.phone ? " · +" + c.phone : ""}
      </p>
      {error && <p role="alert">{error}</p>}
      {c?.error && <p role="alert">{c.error}</p>}
      {data?.owner && (
        <div className="form-actions">
          <button
            className="btn primary small"
            disabled={busy}
            onClick={() => act("connect")}
          >
            Show pairing QR
          </button>
          <button
            className="btn secondary small"
            disabled={busy}
            onClick={() => act("disconnect")}
          >
            Disconnect company number
          </button>
        </div>
      )}
      {data?.owner && c?.qr && alive && (
        <div>
          <img
            src={c.qr}
            width={230}
            height={230}
            alt="Private WhatsApp pairing QR for your company"
          />
          <p>
            WhatsApp → Linked devices → Link a device. This QR expires quickly;
            keep it private.
          </p>
        </div>
      )}
      <p>
        Pairing and delivery require the Humeto WhatsApp worker. No third-party
        messaging API. Messages stay inside this company workspace.
      </p>
      <h3>Compose a reviewed message</h3>
      <label
        style={{ display: "grid", gap: 8, margin: "18px 0", maxWidth: 680 }}
      >
        Company team member or student phone
        <input
          style={{
            padding: "12px 14px",
            border: "1px solid #dce3d8",
            borderRadius: 10,
            font: "inherit",
            background: "#fff",
          }}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+923001234567"
        />
      </label>
      <label
        style={{ display: "grid", gap: 8, margin: "18px 0", maxWidth: 680 }}
      >
        Message
        <textarea
          style={{
            padding: "12px 14px",
            border: "1px solid #dce3d8",
            borderRadius: 10,
            font: "inherit",
            minHeight: 110,
            background: "#fff",
          }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          placeholder="Write your message, then review the draft below before sending."
        />
      </label>
      <button
        className="btn secondary small"
        disabled={busy || !body.trim()}
        onClick={() => act("draft", { remote: phone, body })}
      >
        Save draft for review
      </button>
      <h3>Company inbox & outbox</h3>
      {data?.messages.length ? (
        data.messages.map((m) => (
          <article
            key={m.id}
            style={{
              padding: "14px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <strong>
              {m.direction === "in" ? "Received from" : "To"} +
              {m.remote.split("@")[0]}
            </strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
            <small>
              {m.status} · {new Date(Number(m.created_at)).toLocaleString()}
            </small>
            {m.status === "draft" && (
              <button
                className="btn primary small"
                disabled={busy || !alive || c?.status !== "connected"}
                onClick={() => act("send", { id: m.id })}
              >
                Approve & send this message
              </button>
            )}
            {m.status === "unknown" && (
              <p>
                Delivery could not be confirmed. Check WhatsApp before creating
                another message.
              </p>
            )}
          </article>
        ))
      ) : (
        <p>
          No company messages yet. Pair your number to begin. Drafts can be
          prepared before connecting.
        </p>
      )}
      <p>
        Text messages are supported in this first connector. Attachment
        handling, student matching and AI reply proposals will follow.
      </p>
    </section>
  );
}
