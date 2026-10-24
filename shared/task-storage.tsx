"use client";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { webApi, type Transport } from "./planning-hub";
import "./task-storage.css";
export function TaskOptions({
  task,
  writable,
  refresh,
  request = webApi,
}: {
  task: { id: string; title: string; revision: number };
  writable: boolean;
  refresh: () => Promise<void>;
  request?: Transport;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    if (!position) return;
    const close = (e: PointerEvent) => {
      if (
        !(e.target as HTMLElement).closest(
          ".task-options,.task-options-popover",
        )
      )
        setPosition(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPosition(null);
        anchor.current?.focus();
      }
    };
    const scroll = () => setPosition(null);
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("wheel", scroll, { passive: true });
    window.addEventListener("touchmove", scroll, { passive: true });
    window.addEventListener("resize", scroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("wheel", scroll);
      window.removeEventListener("touchmove", scroll);
      window.removeEventListener("resize", scroll);
    };
  }, [position]);
  if (!writable) return null;
  async function move(action: string) {
    setBusy(true);
    setError("");
    try {
      await request("/api/workspace/task-storage/" + task.id, {
        action,
        revision: task.revision,
      });
      setPosition(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span
      className="task-options"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        ref={anchor}
        className="task-options-trigger"
        aria-label={"Task options: " + task.title}
        aria-expanded={!!position}
        onClick={() => {
          if (position) {
            setPosition(null);
            return;
          }
          const b = anchor.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(innerWidth - 175, b.right - 165)),
            top:
              b.bottom + 150 < innerHeight
                ? b.bottom + 5
                : Math.max(8, b.top - 145),
          });
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {position &&
        createPortal(
          <div
            className="task-options-popover"
            role="group"
            aria-label="Task actions"
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              zIndex: 100000,
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => void move("archive")}
            >
              Archive
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void move("bin")}
            >
              Move to Bin
            </button>
            {error && <small role="alert">{error}</small>}
          </div>,
          document.body,
        )}
    </span>
  );
}
export function TaskStorage({
  children,
  tasks,
  writable,
  refresh,
  request = webApi,
}: {
  children: ReactNode;
  tasks: unknown[];
  writable: boolean;
  refresh: () => Promise<void>;
  request?: Transport;
}) {
  const [view, setView] = useState("active"),
    [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void request("/api/workspace/task-storage")
      .then((r) => {
        if (live) {
          setItems(r.items);
          setError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [request, tasks]);
  async function change(t: any, action: string) {
    setBusy(t.id);
    setError("");
    try {
      await request("/api/workspace/task-storage/" + t.id, {
        action,
        revision: t.revision,
      });
      await refresh();
      const r = await request("/api/workspace/task-storage");
      setItems(r.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="task-storage">
      <div
        className="task-storage-tabs"
        role="group"
        aria-label="Task locations"
      >
        {[
          ["active", "Active tasks"],
          ["bin", "Bin"],
          ["archive", "Archive"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {label}
            {key !== "active" && (
              <span>{items.filter((t) => t.storage_state === key).length}</span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="task-storage-error" role="alert">
          {error}
        </p>
      )}
      {view === "active" ? (
        children
      ) : (
        <section
          className="task-storage-list"
          aria-label={view === "bin" ? "Task Bin" : "Task Archive"}
        >
          <header>
            <h2>{view === "bin" ? "Bin" : "Archive"}</h2>
            <p>
              {view === "bin"
                ? "Automatically deleted after 30 days. Restore before then."
                : "Kept here until you restore it or move it to Bin."}
            </p>
          </header>
          {loading ? (
            <p>Loading tasks…</p>
          ) : (
            items
              .filter((t) => t.storage_state === view)
              .map((t) => (
                <article key={t.id}>
                  <div>
                    <strong>{t.title}</strong>
                    <small>
                      {t.stage}
                      {view === "bin"
                        ? " · Deletes " +
                          new Date(t.purge_after).toLocaleDateString()
                        : ""}
                    </small>
                  </div>
                  <div className="task-storage-actions">
                    <button
                      type="button"
                      disabled={!writable || !!busy}
                      onClick={() => void change(t, "restore")}
                    >
                      Restore
                    </button>
                    {view === "archive" && (
                      <button
                        type="button"
                        disabled={!writable || !!busy}
                        onClick={() => void change(t, "bin")}
                      >
                        Move to Bin
                      </button>
                    )}
                  </div>
                </article>
              ))
          )}
          {!loading && !items.some((t) => t.storage_state === view) && (
            <p className="task-storage-empty">
              {view === "bin" ? "Bin is empty." : "No archived tasks."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
