"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Megaphone, X, Eye, Send, Bell, Check } from "lucide-react";
import type { Actor } from "@/lib/types";
import styles from "./announcements.module.css";
type Item = {
  id: string;
  title: string;
  body: string;
  popup: boolean;
  image: string;
  cta_label: string;
  cta_path: string;
  read_at?: string | null;
  popup_dismissed_at?: string | null;
  status?: string;
  revision?: number;
  recipient_count?: number;
  read_count?: number;
  starts_at?: string;
  expires_at?: string;
  audience?: string;
};
type State = {
  inbox: Item[];
  campaigns: Item[];
  members: { id: string; name: string; role: string }[];
  canPublish: boolean;
};
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const images = [
  ["", "No image"],
  ["/assets/campus.webp", "Campus"],
  ["/assets/library.webp", "Library"],
  ["/assets/consultant.webp", "Consultant"],
  ["/assets/hero-tasks.webp", "Task planning"],
  ["/assets/hero-assistant.webp", "Application assistant"],
];
export default function Announcements({
  actor,
  center = false,
}: {
  actor: Actor;
  center?: boolean;
}) {
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [popup, setPopup] = useState<Item | null>(null),
    [preview, setPreview] = useState(false),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [audience, setAudience] = useState("students"),
    [selected, setSelected] = useState<string[]>([]),
    [usePopup, setUsePopup] = useState(true),
    [image, setImage] = useState("/assets/campus.webp"),
    [ctaLabel, setCtaLabel] = useState(""),
    [ctaPath, setCtaPath] = useState(""),
    [starts, setStarts] = useState(() => localInput(new Date())),
    [expires, setExpires] = useState(() =>
      localInput(new Date(Date.now() + 7 * 86400000)),
    );
  const dialog = useRef<HTMLDialogElement>(null),
    shown = useRef(false),
    dismissed = useRef(new Set<string>());
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/announcements", { cache: "no-store" }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (actor.role === "platform_admin") return;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(
          `humeto-announcements-dismissed:${actor.tenantId}:${actor.id}`,
        ) || "[]",
      );
      if (Array.isArray(saved))
        dismissed.current = new Set(
          saved.filter((x) => typeof x === "string").slice(-200),
        );
    } catch {}
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("humeto-announcements", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("humeto-announcements", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, actor.role]);
  useEffect(() => {
    if (center || shown.current || !data) return;
    const item = data.inbox.find(
      (n) =>
        n.popup &&
        !n.read_at &&
        !n.popup_dismissed_at &&
        !dismissed.current.has(n.id),
    );
    if (item) {
      shown.current = true;
      setPreview(false);
      setPopup(item);
    }
  }, [data, center]);
  useEffect(() => {
    if (popup && !preview && data && !data.inbox.some((n) => n.id === popup.id))
      setPopup(null);
  }, [data, popup, preview]);
  useEffect(() => {
    if (popup && !dialog.current?.open) dialog.current?.showModal();
    else if (!popup && dialog.current?.open) dialog.current.close();
  }, [popup]);
  async function act(action: string, values: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/announcements", {
          method: "POST",
          keepalive: action === "read" || action === "dismiss",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...values }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      await load();
      window.dispatchEvent(new Event("humeto-announcements"));
      setNotice(
        action === "draft"
          ? "Draft saved. Review it below before publishing."
          : action === "publish"
            ? "Published to the selected company audience."
            : action === "retract"
              ? "Announcement retracted."
              : "",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (popup && !preview) {
      dismissed.current.add(popup.id);
      try {
        sessionStorage.setItem(
          `humeto-announcements-dismissed:${actor.tenantId}:${actor.id}`,
          JSON.stringify([...dismissed.current].slice(-200)),
        );
      } catch {}
      void act("dismiss", { id: popup.id });
    }
    setPopup(null);
  }
  const draft: Item = {
    id: "preview",
    title: title || "Your announcement title",
    body: body || "Your message will appear here.",
    popup: usePopup,
    image,
    cta_label: ctaLabel,
    cta_path: ctaPath,
  };
  if (actor.role === "platform_admin") return null;
  const count = data?.inbox.filter((n) => !n.read_at).length || 0;
  return (
    <>
      {!center ? (
        <a
          href="/workspace/notifications"
          className="notification-button"
          aria-label={`Company notifications${count ? `: ${count} unread` : ""}`}
          title="Company notifications"
        >
          <Megaphone size={18} />
          {count > 0 && <span />}
        </a>
      ) : (
        <section className={styles.center}>
          <header>
            <span className={styles.eyebrow}>
              <Megaphone size={16} /> COMPANY NOTIFICATIONS
            </span>
            <h1>A message that reaches the right people.</h1>
            <p>
              Company updates, reminders and useful next steps, together in one
              place.
            </p>
          </header>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          {!data ? (
            <p>Loading company notifications…</p>
          ) : (
            <>
              {data.canPublish && (
                <details className={styles.compose} open>
                  <summary>Create an announcement</summary>
                  <p>
                    Only company admins can publish. Staff / instructors uses
                    existing staff accounts; coaching roles are a later module.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("draft", {
                        title,
                        body,
                        audience,
                        userIds: selected,
                        popup: usePopup,
                        image,
                        ctaLabel,
                        ctaPath,
                        startsAt: new Date(starts).toISOString(),
                        expiresAt: new Date(expires).toISOString(),
                      });
                    }}
                  >
                    <label className={styles.wide}>
                      Title
                      <input
                        aria-label="Announcement title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={150}
                        required
                      />
                    </label>
                    <label className={styles.wide}>
                      Message
                      <textarea
                        aria-label="Announcement message"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        maxLength={4000}
                        required
                      />
                    </label>
                    <label>
                      Who should receive it?
                      <select
                        aria-label="Announcement audience"
                        value={audience}
                        onChange={(e) => setAudience(e.target.value)}
                      >
                        <option value="all">Everyone in this company</option>
                        <option value="staff">Staff / instructors</option>
                        <option value="students">Students</option>
                        <option value="selected">Selected people</option>
                      </select>
                    </label>
                    <label>
                      Illustration
                      <select
                        aria-label="Announcement image"
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                      >
                        {images.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {audience === "selected" && (
                      <fieldset className={styles.wide}>
                        <legend>Select recipients</legend>
                        {data.members.map((m) => (
                          <label className={styles.checkbox} key={m.id}>
                            <input
                              type="checkbox"
                              checked={selected.includes(m.id)}
                              onChange={(e) =>
                                setSelected((ids) =>
                                  e.target.checked
                                    ? [...ids, m.id]
                                    : ids.filter((id) => id !== m.id),
                                )
                              }
                            />
                            {m.name} ·{" "}
                            {m.role === "consultant" ? "staff" : m.role}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <label>
                      Start (your local time)
                      <input
                        aria-label="Announcement start"
                        type="datetime-local"
                        value={starts}
                        onChange={(e) => setStarts(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Expires (your local time)
                      <input
                        aria-label="Announcement expiry"
                        type="datetime-local"
                        value={expires}
                        onChange={(e) => setExpires(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Button text (optional)
                      <input
                        aria-label="Announcement button text"
                        value={ctaLabel}
                        onChange={(e) => setCtaLabel(e.target.value)}
                        maxLength={60}
                      />
                    </label>
                    <label>
                      Workspace link (optional)
                      <input
                        aria-label="Announcement button link"
                        value={ctaPath}
                        onChange={(e) => setCtaPath(e.target.value)}
                        placeholder="/workspace/documents"
                      />
                    </label>
                    <label className={`${styles.checkbox} ${styles.wide}`}>
                      <input
                        type="checkbox"
                        checked={usePopup}
                        onChange={(e) => setUsePopup(e.target.checked)}
                      />
                      Also show a dismissible pop-up
                    </label>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        onClick={() => {
                          setPreview(true);
                          setPopup(draft);
                        }}
                      >
                        <Eye size={14} />
                        Preview
                      </button>
                      <button
                        type="submit"
                        disabled={busy || !title.trim() || !body.trim()}
                        className={styles.primary}
                      >
                        Save draft
                      </button>
                    </div>
                  </form>
                </details>
              )}
              <h2>
                Your notification inbox <small>{count} unread</small>
              </h2>
              <div className={styles.inbox}>
                {data.inbox.length ? (
                  data.inbox.map((n) => (
                    <article
                      key={n.id}
                      className={n.read_at ? styles.read : ""}
                    >
                      {n.image && <img src={n.image} alt="" />}
                      <div>
                        <span className={styles.eyebrow}>
                          {n.read_at ? "READ" : "NEW UPDATE"}
                        </span>
                        <h3>{n.title}</h3>
                        <p>{n.body}</p>
                        <div className={styles.actions}>
                          <button
                            onClick={() => {
                              setPreview(false);
                              setPopup(n);
                            }}
                          >
                            Open message
                          </button>
                          {!n.read_at && (
                            <button
                              disabled={busy}
                              onClick={() => void act("read", { id: n.id })}
                            >
                              <Check size={13} />
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className={styles.empty}>
                    <Bell size={24} />
                    <h3>You’re up to date.</h3>
                    <p>Updates from your company admin will appear here.</p>
                  </div>
                )}
              </div>
              {data.canPublish && (
                <>
                  <h2>Announcement history</h2>
                  <p>
                    Read counts reflect in-app reads. Recipients are frozen when
                    published; new members are not automatically added.
                  </p>
                  {data.campaigns.length ? (
                    data.campaigns.map((n) => (
                      <article key={n.id} className={styles.campaign}>
                        <div>
                          <strong>{n.title}</strong>
                          <small>
                            {n.status} · {n.audience} ·{" "}
                            {n.status === "draft"
                              ? n.audience === "selected"
                                ? n.recipient_count
                                : data.members.filter(
                                    (m) =>
                                      n.audience === "all" ||
                                      (n.audience === "staff"
                                        ? ["owner", "consultant"].includes(
                                            m.role,
                                          )
                                        : m.role === "student"),
                                  ).length
                              : n.recipient_count}{" "}
                            {n.status === "draft"
                              ? "planned recipients"
                              : "recipients"}{" "}
                            · {n.read_count} read
                            {n.starts_at
                              ? ` · starts ${new Date(n.starts_at).toLocaleString()}`
                              : ""}
                          </small>
                        </div>
                        <div className={styles.actions}>
                          <button
                            onClick={() => {
                              setPreview(true);
                              setPopup(n);
                            }}
                          >
                            Preview
                          </button>
                          {n.status === "draft" && (
                            <button
                              className={styles.primary}
                              disabled={busy}
                              onClick={() =>
                                void act("publish", {
                                  id: n.id,
                                  revision: n.revision,
                                })
                              }
                            >
                              <Send size={13} />
                              Publish
                            </button>
                          )}
                          {n.status === "published" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act("retract", {
                                  id: n.id,
                                  revision: n.revision,
                                })
                              }
                            >
                              Retract
                            </button>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p>No announcements yet. Save your first draft above.</p>
                  )}
                </>
              )}
            </>
          )}
          <p className={styles.footnote}>
            In-app notifications and pop-ups. Device push, email and WhatsApp
            delivery are not enabled by this feature.
          </p>
        </section>
      )}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={
          center ? "announcement-center-title" : "announcement-popup-title"
        }
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClose={() => setPopup(null)}
      >
        {popup && (
          <div className={popup.image ? styles.popup : styles.popupPlain}>
            <button
              className={styles.close}
              aria-label="Close company announcement"
              onClick={close}
            >
              <X size={20} />
            </button>
            {popup.image && (
              <img className={styles.cover} src={popup.image} alt="" />
            )}
            <div className={styles.popupBody}>
              <span className={styles.eyebrow}>
                <Megaphone size={14} />
                {preview ? "ANNOUNCEMENT PREVIEW" : actor.tenantName}
              </span>
              <h2
                id={
                  center
                    ? "announcement-center-title"
                    : "announcement-popup-title"
                }
              >
                {popup.title}
              </h2>
              <p>{popup.body}</p>
              {popup.cta_label && popup.cta_path && (
                <a
                  className={styles.cta}
                  href={popup.cta_path}
                  onClick={(e) => {
                    if (preview) e.preventDefault();
                    else close();
                  }}
                >
                  {popup.cta_label}
                </a>
              )}
              <button className={styles.dismiss} onClick={close}>
                {preview ? "Close preview" : "Got it, thank you"}
              </button>
              {preview && <small>Preview only · nothing has been sent</small>}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
