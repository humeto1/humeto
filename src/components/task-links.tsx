"use client";
import { useState } from "react";
import type { Task, Workstream } from "@/lib/types";
export default function TaskLinks({
  task,
  projects,
  goals,
  onChange,
  writable,
}: {
  task: Task;
  projects: Workstream[];
  goals: Workstream[];
  onChange: () => Promise<void>;
  writable: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="task-links">
      <summary>
        {task.project_title || "Link project / goals"}
        {task.goals?.length
          ? ` · ${task.goals.length} goal${task.goals.length === 1 ? "" : "s"}`
          : ""}
      </summary>
      <form
        key={task.revision}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/workspace/task-links/" + task.id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                revision: task.revision,
                projectId: f.get("projectId"),
                goalIds: f.getAll("goals"),
              }),
            });
            const result = await r.json();
            if (!r.ok) throw new Error(result.error);
            await onChange();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Project
          <select name="projectId" defaultValue={task.project_id || ""}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.status === "Archived" ? " · archived" : ""}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Contributes to goals</legend>
          {goals.map((g) => (
            <label className="goal-checkbox" key={g.id}>
              <input
                type="checkbox"
                name="goals"
                value={g.id}
                defaultChecked={task.goals?.some((x) => x.id === g.id)}
              />
              {g.title}
            </label>
          ))}
          {!goals.length && <p>Create a goal in Projects & goals.</p>}
        </fieldset>
        <small>
          Changes affect future completions. History keeps the original links.
        </small>
        {error && <p role="alert">{error}</p>}
        <button className="btn secondary small" disabled={busy || !writable}>
          {busy ? "Saving…" : "Save links"}
        </button>
      </form>
    </details>
  );
}
