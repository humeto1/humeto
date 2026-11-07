"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Pencil, X } from "lucide-react";
import { webApi, type Transport } from "./transport";
import "./plan-actions.css";
type Plan = { id: string; title: string; status: string; revision: number };
export function PlanActions({
  type,
  planId,
  writable,
  request = webApi,
  onUpdate,
  onDeleted,
  onEdit,
  renameOnly = false,
}: {
  type: "project" | "goal";
  planId: string;
  writable: boolean;
  request?: Transport;
  onUpdate?: () => Promise<void>;
  onDeleted?: () => void;
  onEdit?: () => void;
  renameOnly?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [phase, setPhase] = useState("menu"),
    [plan, setPlan] = useState<Plan | null>(null),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [counts, setCounts] = useState({ total: 0, tasks: 0 }),
    [deleteTasks, setDeleteTasks] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    locked = useRef(false);
  const label = type === "project" ? "Project" : "Goal";
  async function load() {
    const d = await request(
      `/api/plan-actions?type=${type}&planId=${encodeURIComponent(planId)}`,
    );
    setPlan(d.plan);
    setTitle(d.plan.title);
    setCounts(d.counts);
  }
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    void load().catch((e) => setError(e.message));
    return () => dialog.current?.close();
  }, [open, planId, type, request]);
  function close() {
    if (busy) return;
    setOpen(false);
    setError("");
    trigger.current?.focus();
  }
  async function save(action: string) {
    if (!plan || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await request("/api/plan-actions", {
        type,
        planId,
        action,
        revision: plan.revision,
        ...(["rename", "duplicate"].includes(action)
          ? { title: title.trim() }
          : {}),
        ...(action === "delete" ? { deleteTasks } : {}),
      });
      await onUpdate?.();
      window.dispatchEvent(new Event("humeto-profit"));
      setOpen(false);
      if (action === "delete") onDeleted?.();
      else trigger.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={renameOnly ? "plan-rename-icon" : "plan-more"}
        aria-label={renameOnly ? `Rename ${type}` : `${label} options`}
        aria-haspopup="dialog"
        disabled={!writable}
        onClick={() => {
          setPhase(renameOnly ? "rename" : "menu");
          setPlan(null);
          setError("");
          setDeleteTasks(false);
          setOpen(true);
        }}
      >
        {renameOnly ? <Pencil size={17} /> : <MoreVertical size={19} />}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="plan-action-dialog"
            aria-label={`${label} options`}
            onCancel={(e) => {
              e.preventDefault();
              close();
            }}
          >
            <header>
              <h3>
                {phase === "menu"
                  ? `${label} options`
                  : phase === "duplicate"
                    ? `Duplicate ${type}`
                    : phase === "delete"
                      ? `Delete ${type}?`
                      : phase === "rename"
                        ? `Rename ${type}`
                        : `${phase === "pause" ? "Pause" : "Resume"} ${type}?`}
              </h3>
              <button
                type="button"
                aria-label="Close plan options"
                disabled={busy}
                onClick={close}
              >
                <X size={19} />
              </button>
            </header>
            {!plan && !error && <p role="status">Loading…</p>}
            {plan && phase === "menu" && (
              <div className="plan-action-list">
                <strong>{plan.title}</strong>
                <button
                  type="button"
                  onClick={() => {
                    setTitle(plan.title);
                    setPhase("rename");
                  }}
                >
                  Rename
                </button>
                {["Active", "Paused"].includes(plan.status) && (
                  <button
                    type="button"
                    onClick={() =>
                      setPhase(plan.status === "Paused" ? "resume" : "pause")
                    }
                  >
                    {plan.status === "Paused" ? "Resume" : "Pause"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setTitle(plan.title.slice(0, 153) + " (copy)");
                    setPhase("duplicate");
                  }}
                >
                  Duplicate
                </button>
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onEdit();
                    }}
                  >
                    Edit details
                  </button>
                )}
                <button
                  type="button"
                  className="plan-action-danger"
                  onClick={() => setPhase("delete")}
                >
                  Delete
                </button>
              </div>
            )}
            {plan && phase !== "menu" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(phase);
                }}
              >
                {["rename", "duplicate"].includes(phase) && (
                  <label>
                    Name
                    <input
                      autoFocus
                      name="planName"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      minLength={2}
                      maxLength={160}
                      required
                      disabled={busy}
                    />
                  </label>
                )}
                {phase === "duplicate" && (
                  <p>
                    Copy the map, activities, repeat settings, KPI/CSF settings,
                    milestones, team and financial targets. Copied activities
                    start outside Tasks with fresh progress. Results, work
                    history, chat, files and sharing access stay with the
                    original.
                    {type === "goal"
                      ? " Linked projects stay with the original goal."
                      : ""}
                  </p>
                )}
                {phase === "pause" && (
                  <p>
                    Pause this {type} and its unfinished tasks. Focus sessions
                    pause, repeat generation and reminders stop, and stages and
                    history are kept.
                  </p>
                )}
                {phase === "resume" && (
                  <p>
                    Resume this {type} and tasks whose other projects or goals
                    are active. Repeat schedules continue from today. Focus
                    sessions resume when you choose.
                  </p>
                )}
                {phase === "delete" && (
                  <>
                    <p>
                      Delete “{plan.title}” and its map. This removes its
                      settings, chat, files and sharing access. Map-only
                      activities move to Archive. Keeping linked tasks preserves
                      their history.
                    </p>
                    <label className="plan-delete-tasks">
                      <input
                        type="checkbox"
                        checked={deleteTasks}
                        disabled={busy}
                        onChange={(e) => setDeleteTasks(e.target.checked)}
                      />
                      Also delete {counts.tasks} linked tasks
                    </label>
                    <p>
                      {deleteTasks
                        ? "Linked tasks move to Bin for 30 days."
                        : "Linked tasks stay in Tasks, detached from this " +
                          type +
                          "."}
                    </p>
                  </>
                )}
                <button
                  type="submit"
                  className={
                    phase === "delete"
                      ? "plan-action-danger"
                      : "plan-action-primary"
                  }
                  disabled={
                    busy ||
                    (["rename", "duplicate"].includes(phase) &&
                      title.trim().length < 2)
                  }
                >
                  {busy
                    ? "Saving…"
                    : phase === "delete"
                      ? `Delete ${type}`
                      : phase === "rename"
                        ? "Save name"
                        : phase === "duplicate"
                          ? "Create copy"
                          : phase === "pause"
                            ? `Pause ${type}`
                            : `Resume ${type}`}
                </button>
                <button type="button" disabled={busy} onClick={close}>
                  Cancel
                </button>
              </form>
            )}
            {error && (
              <p role="alert">
                {error}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void load()
                      .then(() => setError(""))
                      .catch((e) => setError(e.message))
                  }
                >
                  Reload
                </button>
              </p>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
