import { useEffect, useState } from "react";
export function TaskLinks({
  taskId,
  request,
}: {
  taskId: string;
  request: (path: string, body?: any) => Promise<any>;
}) {
  const [links, setLinks] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const path = "/api/task-links?taskId=" + encodeURIComponent(taskId);
  async function load() {
    setLinks((await request(path)).links);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [taskId]);
  async function save(body: any) {
    setBusy(true);
    try {
      await request(path, body);
      await load();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Task reference links">
      <h3>Reference links</h3>
      <p>
        Drive folders, files, or any HTTPS reference. Client chat and sharing
        live under the project.
      </p>
      {error && <p role="alert">{error}</p>}
      {links.map((l) => (
        <p key={l.id}>
          <a href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label}
          </a>{" "}
          <button
            disabled={busy}
            onClick={() => void save({ operation: "remove", id: l.id })}
          >
            Remove link
          </button>
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        <label>
          Link label
          <input name="label" required maxLength={120} />
        </label>
        <label>
          HTTPS link
          <input name="url" type="url" required maxLength={2000} />
        </label>
        <button disabled={busy}>Add reference link</button>
      </form>
    </section>
  );
}
