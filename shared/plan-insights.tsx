"use client";
import { useState, useEffect } from "react";
import { webApi, type Transport } from "./transport";
import "./productivity.css";
const timestamp = (s: string) =>
  s
    ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleString()
    : "Not recorded";
export function TaskDuration({
  taskId,
  request = webApi,
}: {
  taskId: string;
  request?: Transport;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    request("/api/milestones?taskId=" + encodeURIComponent(taskId))
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, taskId, request]);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Hours & duration</summary>
      {error && <p role="alert">{error}</p>}
      {data && (
        <div className="plan-insights">
          <strong>
            {(Number(data.timing?.seconds || 0) / 3600).toFixed(2)} focused
            hours
          </strong>
          <span>First focus: {timestamp(data.timing?.started_at)}</span>
          <span>Last session ended: {timestamp(data.timing?.ended_at)}</span>
          <small>
            Your focus sessions add up across days. Pauses and breaks are
            excluded; start and end are recorded automatically.
          </small>
          {data.links.map((m: any) => (
            <p key={m.id}>
              Milestone: {m.title} · {m.status}
            </p>
          ))}
        </div>
      )}
    </details>
  );
}
export function PlanInsights({
  type,
  id,
  writable,
  request = webApi,
}: {
  type: "project" | "goal";
  id: string;
  writable: boolean;
  request?: Transport;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const load = () =>
    request(
      `/api/milestones?type=${type}&parentId=${encodeURIComponent(id)}`,
    ).then(setData);
  useEffect(() => {
    if (open) void load().catch((e) => setError(e.message));
  }, [open, type, id, request]);
  const days = data
    ? Math.max(
        0,
        Math.floor(
          ((data.parent.completed_at
            ? Date.parse(data.parent.completed_at)
            : Date.now()) -
            Date.parse(
              data.parent.created_at.replace(" ", "T") +
                (data.parent.created_at.includes("Z") ? "" : "Z"),
            )) /
            86400000,
        ),
      )
    : 0;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Days, duration & milestones</summary>
      <div className="plan-insights">
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <strong>
              {data.parent.status === "Completed" && !data.parent.completed_at
                ? "Completion date not recorded"
                : `${days} days · ${data.parent.completed_at ? "completed" : "elapsed"}`}
            </strong>
            <small>
              Started {timestamp(data.parent.created_at)}
              <br />
              Completed {timestamp(data.parent.completed_at)}
            </small>
            {writable && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const p = data.parent;
                    await request(
                      "/api/workspace/" +
                        (type === "project" ? "projects" : "goals") +
                        "/" +
                        id,
                      {
                        title: p.title,
                        description: p.description,
                        targetDate: p.target_date,
                        status:
                          p.status === "Completed" ? "Active" : "Completed",
                        revision: p.revision,
                      },
                      "PATCH",
                    );
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {data.parent.status === "Completed"
                  ? "Reopen " + type
                  : "Mark " + type + " complete"}
              </button>
            )}
            <h4>Milestones</h4>
            {!data.milestones.length && (
              <p>Break this {type} into meaningful checkpoints.</p>
            )}
            <ul>
              {data.milestones.map((m: any) => (
                <li key={m.id}>
                  <strong>
                    {m.status === "Completed" ? "✓ " : ""}
                    {m.title}
                  </strong>
                  <small>
                    {m.target_date || "No deadline"} · {m.status} ·{" "}
                    {m.tasks.filter((t: any) => t.stage === "Done").length}/
                    {m.tasks.length} linked tasks done
                  </small>
                  {m.tasks.map((t: any) => (
                    <small key={t.id}>
                      {t.stage === "Done" ? "✓" : "○"} {t.title}
                    </small>
                  ))}
                  {writable && (
                    <button type="button" onClick={() => setEditing(m)}>
                      Edit milestone
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {writable && !editing && (
              <button
                type="button"
                onClick={() =>
                  setEditing({
                    title: "",
                    target_date: "",
                    status: "Pending",
                    tasks: [],
                  })
                }
              >
                Add milestone
              </button>
            )}
            {editing && (
              <form
                key={editing.id || "new"}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setError("");
                  try {
                    await request("/api/milestones", {
                      type,
                      parentId: id,
                      ...(editing.id
                        ? { id: editing.id, revision: editing.revision }
                        : {}),
                      title: f.get("title"),
                      targetDate: f.get("targetDate"),
                      status: f.get("status"),
                      taskIds: f.getAll("taskIds"),
                    });
                    await load();
                    setEditing(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Milestone name
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={160}
                    defaultValue={editing.title}
                  />
                </label>
                <label>
                  Milestone deadline (optional)
                  <input
                    name="targetDate"
                    type="date"
                    defaultValue={editing.target_date}
                  />
                </label>
                <label>
                  Milestone status
                  <select name="status" defaultValue={editing.status}>
                    <option>Pending</option>
                    <option>Completed</option>
                  </select>
                </label>
                <fieldset>
                  <legend>Link tasks in this {type}</legend>
                  {data.tasks.map((t: any) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        name="taskIds"
                        value={t.id}
                        defaultChecked={editing.tasks.some(
                          (x: any) => x.id === t.id,
                        )}
                      />{" "}
                      {t.title}
                    </label>
                  ))}
                  {!data.tasks.length && (
                    <p>Add tasks to this {type} to link them here.</p>
                  )}
                </fieldset>
                <button disabled={busy || !writable}>Save milestone</button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </details>
  );
}
