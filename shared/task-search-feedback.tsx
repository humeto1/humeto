"use client";
import { useEffect, useState } from "react";
import { taskSimilarityScore, type SearchableTask } from "./task-search";
import { webApi, type Transport } from "./planning-hub";

export function TaskSearchFeedback({
  query,
  tasks,
  visibleCount,
  onAdd,
  onOpen,
  refresh,
  writable,
  request = webApi,
}: {
  query: string;
  tasks: SearchableTask[];
  visibleCount: number;
  onAdd?: (title: string) => void;
  onOpen: (id: string) => void;
  refresh: () => Promise<void>;
  writable: boolean;
  request?: Transport;
}) {
  const [stored, setStored] = useState<SearchableTask[]>([]);
  const [checked, setChecked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [separate, setSeparate] = useState(false);
  const title = query.trim().slice(0, 160);
  const enabled = title.length >= 2 && visibleCount === 0;
  useEffect(() => {
    setSeparate(false);
    setError("");
    setChecked("");
    setStored([]);
    if (!enabled) return;
    let live = true;
    const timer = setTimeout(() => {
      request("/api/workspace/task-storage")
        .then((result) => {
          if (live) {
            setStored(result.items || []);
            setChecked(title);
          }
        })
        .catch(() => {
          if (live) {
            setError(
              "Archive and Bin could not be checked. Check them before adding a task.",
            );
            setChecked(title);
          }
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, title, request, tasks]);
  if (!enabled) return null;
  const matches = [...tasks, ...stored]
    .map((task) => ({ task, score: taskSimilarityScore(task, title) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);
  const ready = checked === title;
  async function restore(task: SearchableTask) {
    setBusy(true);
    setError("");
    try {
      await request("/api/workspace/task-storage/" + task.id, {
        action: "restore",
        revision: task.revision,
      });
      await refresh();
    } catch {
      setError("Could not restore this task. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Task search suggestions"
      style={{
        padding: 16,
        margin: "12px 0",
        border: "1px solid #d9dfd2",
        borderRadius: 14,
        overflowWrap: "anywhere",
      }}
    >
      <p role="status">
        {!ready
          ? "Checking existing tasks, Archive and Bin…"
          : error
            ? "Existing task check is incomplete."
            : matches.length
              ? "Possible existing tasks — check these before adding another."
              : "No similar task found in your available tasks."}
      </p>
      {matches.slice(0, 5).map(({ task }) => (
        <div
          key={task.id}
          style={{
            margin: "10px 0",
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ flex: "1 1 160px" }}>
            <strong>{task.display_title || task.title}</strong>
            <small style={{ display: "block" }}>
              {task.storage_state === "archive"
                ? "Archive"
                : task.storage_state === "bin"
                  ? "Bin"
                  : task.stage === "Done"
                    ? "Completed"
                    : "Outside the current view or filters"}
              {task.project_title ? " · " + task.project_title : ""}
            </small>
          </span>
          {task.storage_state && task.storage_state !== "active" ? (
            <button
              type="button"
              className="btn secondary"
              disabled={!writable || busy}
              onClick={() => void restore(task)}
            >
              Restore task
            </button>
          ) : (
            <button
              type="button"
              className="btn secondary"
              onClick={() => onOpen(task.id)}
            >
              Open task
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {onAdd && ready && (
        <>
          {(matches.length > 0 || !!error) && (
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                margin: "10px 0",
              }}
            >
              <input
                type="checkbox"
                checked={separate}
                onChange={(event) => setSeparate(event.target.checked)}
              />
              I checked; this is a separate task.
            </label>
          )}
          <button
            type="button"
            className="btn primary"
            style={{
              whiteSpace: "normal",
              maxWidth: "100%",
              textAlign: "left",
            }}
            disabled={
              !writable ||
              busy ||
              ((matches.length > 0 || !!error) && !separate)
            }
            onClick={() => onAdd(title)}
          >
            + Add “{title}” as a new task
          </button>
        </>
      )}
      {!onAdd && matches.length > 0 && (
        <p>
          A similar name can be intentional. Check the project and
          completed/repeating work before saving.
        </p>
      )}
    </section>
  );
}
