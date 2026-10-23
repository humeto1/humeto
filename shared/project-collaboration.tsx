import { useEffect, useState } from "react";
type Transport = (path: string, body?: any) => Promise<any>;
export function ProjectCollaboration({
  projectId,
  token,
  request,
  baseUrl = "",
  shareLink,
  downloadFile,
}: {
  projectId?: string;
  token?: string;
  request: Transport;
  baseUrl?: string;
  shareLink?: (url: string, title: string) => Promise<void>;
  downloadFile?: (path: string, name: string) => Promise<void>;
}) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(""),
    [sent, setSent] = useState(false);
  const path =
    "/api/project-sharing?" +
    (token
      ? "token=" + encodeURIComponent(token)
      : "projectId=" + encodeURIComponent(projectId!));
  async function load() {
    setState(await request(path));
  }
  useEffect(() => {
    let live = true;
    setState(null);
    request(path)
      .then((s) => {
        if (live) setState(s);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    let polling = false;
    const timer = setInterval(async () => {
      if (polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const next = await request(path);
        if (live) setState(next);
      } catch {
        /* Keep the current conversation during a transient disconnect. */
      } finally {
        polling = false;
      }
    }, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path]);
  async function act(body: any): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const result = await request(path, {
        ...body,
        challenge: state?.challenge,
      });
      if (result.url) setUrl(result.url);
      if (result.sent) setSent(true);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      try {
        await load();
      } catch {}
      return false;
    } finally {
      setBusy(false);
    }
  }
  function form(event: React.FormEvent<HTMLFormElement>, operation: string) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void act({
      ...data,
      operation,
      days: data.days ? Number(data.days) : undefined,
    });
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Maximum file size is 2 MB.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    await act({
      operation: "upload",
      name: file.name,
      bytes: btoa(binary),
      author:
        (document.getElementById("guest-author") as HTMLInputElement)?.value ||
        "Guest",
    });
  }
  const canWrite = !token || state?.permission === "contribute";
  return (
    <section
      aria-label="Project collaboration"
      style={{
        display: "grid",
        gap: 16,
        padding: 16,
        border: "1px solid #dce5ce",
        borderRadius: 16,
        overflowWrap: "anywhere",
      }}
    >
      <h3>{token ? "Your shared project" : "Project chat, files & sharing"}</h3>
      {error && <p role="alert">{error}</p>}
      {!state ? (
        <p>Opening project…</p>
      ) : state.locked ? (
        <>
          <p>
            This project is restricted. Verify the invited email address; no app
            or account is needed.
          </p>
          <form onSubmit={(e) => form(e, "request-code")}>
            <label>
              Invited email
              <input name="email" type="email" required />
            </label>
            <button disabled={busy}>Send access code</button>
          </form>
          {sent && (
            <form onSubmit={(e) => form(e, "verify-code")}>
              <label>
                Email code
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  required
                />
              </label>
              <button disabled={busy}>Open project</button>
            </form>
          )}
        </>
      ) : (
        <>
          {token && (
            <>
              <h2>{state.project.title}</h2>
              <p>
                Status: <strong>{state.project.stageTitle}</strong> · Due:{" "}
                {state.project.due_date || "Not set"}
              </p>
              <button
                disabled={busy}
                onClick={() => void load().catch((e) => setError(e.message))}
              >
                Refresh status
              </button>
            </>
          )}
          <p>
            Everything added here is visible to people with access to this
            project. Guest names are self-reported unless verified by email.
          </p>
          <div>
            {state.links.map((l: any) => (
              <p key={l.id}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {l.label}
                </a>{" "}
                {!token && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act({ operation: "remove-link", id: l.id })
                    }
                  >
                    Remove link
                  </button>
                )}
              </p>
            ))}
          </div>
          {canWrite && (
            <form onSubmit={(e) => form(e, "link")}>
              <label>
                Link label
                <input
                  name="label"
                  maxLength={120}
                  placeholder="Google Drive folder, social profile…"
                  required
                />
              </label>
              <label>
                HTTPS link
                <input
                  name="url"
                  type="url"
                  placeholder="https://drive.google.com/…"
                  required
                />
              </label>
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                style={{ display: "none" }}
              />
              <button disabled={busy}>Add link</button>
            </form>
          )}
          {token && canWrite && (
            <label>
              Your name
              <input id="guest-author" maxLength={80} defaultValue="Guest" />
            </label>
          )}
          <h4>Project conversation</h4>
          <small>Team & client replies · refreshes automatically</small>
          {state.comments.map((c: any) => (
            <article key={c.id}>
              <strong>{c.author}</strong>{" "}
              <small>{new Date(c.created_at).toLocaleString()}</small>
              <p style={{ whiteSpace: "pre-wrap" }}>{c.content}</p>
            </article>
          ))}
          {canWrite && (
            <form
              onSubmit={(e) => {
                const form = e.currentTarget;
                const f = new FormData(form);
                e.preventDefault();
                void act({
                  operation: "comment",
                  content: f.get("content"),
                  author:
                    (
                      document.getElementById(
                        "guest-author",
                      ) as HTMLInputElement
                    )?.value || "Guest",
                  website: f.get("website"),
                }).then((sent) => {
                  if (sent) form.reset();
                });
              }}
            >
              <label>
                Add information or a question
                <textarea name="content" required maxLength={2000} />
              </label>
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                style={{ display: "none" }}
              />
              <button disabled={busy}>Add comment</button>
            </form>
          )}
          <h4>Attachments</h4>
          <p>
            PDF, DOCX, XLSX, PNG, JPEG or WebP · 2 MB each · 20 files / 20 MB
            per project. Files stay quarantined until security scanning clears
            them.
          </p>
          {state.attachments.map((f: any) => (
            <p key={f.id}>
              {f.name} · {Math.ceil(f.size / 1024)} KB · {f.status}{" "}
              {f.status === "clean" &&
                (downloadFile ? (
                  <button
                    onClick={() =>
                      void downloadFile(
                        path + "&attachment=" + f.id,
                        f.name,
                      ).catch((e) => setError(e.message))
                    }
                  >
                    Download
                  </button>
                ) : (
                  <a
                    href={baseUrl + path + "&attachment=" + f.id}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download
                  </a>
                ))}{" "}
              {!token && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act({ operation: "remove-file", id: f.id })
                  }
                >
                  Remove file
                </button>
              )}
            </p>
          ))}
          {canWrite && (
            <label>
              Attach file
              <input
                type="file"
                accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp"
                disabled={busy}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {!token && (
            <>
              <h4>Share this project</h4>
              <form onSubmit={(e) => form(e, "share")}>
                <label>
                  Restrict to email (optional)
                  <input
                    name="email"
                    type="email"
                    placeholder="Leave blank for anyone with the link"
                  />
                </label>
                <label>
                  Access
                  <select name="permission">
                    <option value="view">View only</option>
                    <option value="contribute">
                      Comment, add links and upload files
                    </option>
                  </select>
                </label>
                <label>
                  Expires after (days)
                  <input
                    name="days"
                    type="number"
                    min={1}
                    max={90}
                    defaultValue={30}
                    required
                  />
                </label>
                <button disabled={busy}>Create share link</button>
              </form>
              {url && (
                <div>
                  <input aria-label="Project share link" value={url} readOnly />
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(url)
                        .catch(() =>
                          setError("Select and copy the link above."),
                        )
                    }
                  >
                    Copy link
                  </button>
                  <button
                    onClick={() => {
                      if (shareLink)
                        void shareLink(url, state.project.title).catch(
                          () => {},
                        );
                      else if (navigator.share)
                        void navigator
                          .share({ title: state.project.title, url })
                          .catch(() => {});
                      else void navigator.clipboard.writeText(url);
                    }}
                  >
                    Share…
                  </button>
                  <a
                    href={
                      "mailto:?subject=" +
                      encodeURIComponent(state.project.title) +
                      "&body=" +
                      encodeURIComponent(url)
                    }
                  >
                    Email
                  </a>{" "}
                  ·{" "}
                  <a
                    href={"https://wa.me/?text=" + encodeURIComponent(url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp
                  </a>
                </div>
              )}
              {state.shares.map((s: any) => (
                <p key={s.id}>
                  {s.email || "Anyone with the link"} · {s.permission} ·{" "}
                  {s.revoked
                    ? "Revoked"
                    : "Expires " +
                      new Date(Number(s.expires_at)).toLocaleDateString()}{" "}
                  {!s.revoked && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act({ operation: "revoke", id: s.id })
                      }
                    >
                      Revoke access
                    </button>
                  )}
                </p>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
