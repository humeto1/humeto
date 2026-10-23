import { useEffect, useState } from "react";
export function TaskActivity({
  taskId,
  request,
  onChange,
}: {
  taskId: string;
  request: (path: string, body?: any) => Promise<any>;
  onChange?: () => Promise<void>;
}) {
  const [data, setData] = useState<any>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [kind, setKind] = useState("waiting"),
    [now, setNow] = useState(Date.now()),
    [note, setNote] = useState(""),
    [updateMinutes, setUpdateMinutes] = useState(60);
  const path = "/api/task-activities?taskId=" + encodeURIComponent(taskId);
  async function load() {
    setData(await request(path));
  }
  useEffect(() => {
    if (!open) return;
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden) void load().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [open, taskId]);
  async function act(body: any) {
    setBusy(true);
    try {
      await request(path, {
        ...body,
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi",
      });
      await load();
      await onChange?.();
      window.dispatchEvent(new Event("humeto-reminders"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Task activity tracking"
      style={{ overflowWrap: "anywhere" }}
    >
      <button type="button" onClick={() => setOpen(!open)}>
        Activity timers & status check-ins
      </button>
      {open && (
        <>
          <p>
            Track delegated, automated or waiting work while you focus on
            something else. This records an activity; it does not launch an AI
            job or start another person’s focus timer. Elapsed activity is
            separate from your personal worked time.
          </p>
          {error && <p role="alert">{error}</p>}
          {data && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  void act({
                    ...f,
                    action: "start",
                    kind,
                    minutes: Number(f.minutes),
                  });
                }}
              >
                <label>
                  Activity type
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="waiting">Waiting for an update</option>
                    <option value="team">Team member working</option>
                    <option value="automation">AI / automated process</option>
                  </select>
                </label>
                {kind === "team" ? (
                  <label>
                    Team member
                    <select name="performerId" required>
                      {data.members.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    Who or what is working?
                    <input
                      name="label"
                      maxLength={80}
                      required
                      placeholder="Application assistant, external reviewer…"
                    />
                  </label>
                )}
                <label>
                  Work being performed
                  <textarea name="note" required maxLength={1000} />
                </label>
                <label>
                  Ask for an update after (minutes)
                  <input
                    name="minutes"
                    type="number"
                    min={1}
                    max={1440}
                    defaultValue={60}
                    required
                  />
                </label>
                <button disabled={busy}>
                  Start activity & schedule check-in
                </button>
              </form>
              <label>
                Update note for the selected activity
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  placeholder="What changed or where did you stop?"
                />
              </label>
              <label>
                Next update in (minutes)
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={updateMinutes}
                  onChange={(e) => setUpdateMinutes(Number(e.target.value))}
                />
              </label>
              {data.activities.map((a: any) => {
                const seconds =
                  Number(a.seconds) +
                  (a.state === "running"
                    ? Math.max(0, (now - Date.parse(data.serverNow)) / 1000)
                    : 0);
                const allowed =
                  data.owner ||
                  data.actorId === a.created_by ||
                  data.actorId === a.performer_id;
                return (
                  <article key={a.id}>
                    <strong>
                      {a.performer_label} · {a.state}
                    </strong>
                    <p>
                      {Math.floor(seconds / 3600)}h{" "}
                      {Math.floor((seconds % 3600) / 60)}m activity elapsed ·
                      Recorded by {a.recorded_by}
                    </p>
                    <p>{a.note}</p>
                    {a.check_in_at && (
                      <p
                        role={
                          Date.parse(a.check_in_at) <= now
                            ? "status"
                            : undefined
                        }
                      >
                        {Date.parse(a.check_in_at) <= now
                          ? "Update due. What is the latest status?"
                          : "Next update: " +
                            new Date(a.check_in_at).toLocaleString()}
                      </p>
                    )}
                    {a.state !== "ended" && allowed && (
                      <div>
                        {[
                          "update",
                          a.state === "running" ? "pause" : "resume",
                          "stop",
                        ].map((action) => (
                          <button
                            key={action}
                            disabled={
                              busy ||
                              !note.trim() ||
                              !Number.isInteger(updateMinutes) ||
                              updateMinutes < 1 ||
                              updateMinutes > 1440
                            }
                            onClick={() =>
                              void act({
                                action,
                                id: a.id,
                                revision: a.revision,
                                note,
                                minutes: updateMinutes,
                              })
                            }
                          >
                            {action === "update"
                              ? `Save update · ask again in ${updateMinutes} min`
                              : action === "stop"
                                ? "End activity · task stays open"
                                : action === "pause"
                                  ? "Pause activity"
                                  : "Resume activity"}
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              <details>
                <summary>Activity update history</summary>
                {data.events.map((e: any) => (
                  <p key={e.id}>
                    {e.actor} · {e.event} ·{" "}
                    {new Date(e.created_at).toLocaleString()}
                    <br />
                    {e.note}
                  </p>
                ))}
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
