"use client";
import { ActivityBadges, ActivityTags } from "./activity-markers";
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  X,
  Network,
  ListTree,
  Maximize2,
  Minus,
  ChevronDown,
  ChevronRight,
  Check,
  Repeat2,
  Focus,
  Search,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { webApi, type Transport } from "./transport";
import {
  descendants,
  layoutWbs,
  wbsDone,
  WBS_ROOT,
  type WbsNode,
} from "./wbs-model";
import "./project-wbs.css";
type Data = {
  project: { id: string; title: string };
  revision: number;
  nodes: WbsNode[];
  available: { id: string; title: string }[];
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function ProjectWbs({
  projectId,
  planType = "project",
  writable,
  request = webApi,
  onUpdate,
}: {
  projectId: string;
  planType?: "project" | "goal";
  writable: boolean;
  request?: Transport;
  onUpdate?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="wbs-launch"
        onClick={() => setOpen(true)}
      >
        <Network size={19} />
        <span>
          <strong>{planType === "goal" ? "Goal map" : "Project map"}</strong>
          <small>Brainstorm, break down, choose what to work on</small>
        </span>
        <ChevronRight size={18} />
      </button>
      {open &&
        createPortal(
          <WbsEditor
            projectId={projectId}
            planType={planType}
            writable={writable}
            request={request}
            onUpdate={onUpdate}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}
export function WbsEditor({
  projectId,
  planType = "project",
  writable,
  request,
  onUpdate,
  onClose,
}: {
  projectId: string;
  planType?: "project" | "goal";
  writable: boolean;
  request: Transport;
  onUpdate?: () => Promise<void>;
  onClose: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [focus, setFocus] = useState<string | null>(null),
    [view, setView] = useState<"map" | "outline">("map"),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [adding, setAdding] = useState<{ parent: string | null } | null>(null),
    [linking, setLinking] = useState(false),
    [ideas, setIdeas] = useState("");
  const [linkParent, setLinkParent] = useState<string | null>(null);
  const [scale, setScale] = useState(1),
    [offset, setOffset] = useState({ x: 0, y: 0 });
  const canvas = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    busyRef = useRef(false),
    id = useId();
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; scale: number } | null>(null);
  const nodes = data?.nodes || [];
  const selectedNode = nodes.find((n) => n.id === selected);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deleteNode = nodes.find((n) => n.id === deleting);
  const load = useCallback(async () => {
    const d = await request(
      "/api/project-wbs?projectId=" +
        encodeURIComponent(projectId) +
        "&type=" +
        planType,
    );
    setData(d);
    return d as Data;
  }, [request, projectId, planType]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      d?.close();
    };
  }, []);
  const visibleNodes = useMemo(() => {
    if (!query.trim()) return nodes;
    const keep = new Set<string>();
    for (const n of nodes)
      if (n.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
        let at: WbsNode | undefined = n;
        while (at && !keep.has(at.id)) {
          keep.add(at.id);
          at = nodes.find((p) => p.id === at?.parent_id);
        }
      }
    return nodes.filter((n) => keep.has(n.id));
  }, [nodes, query]);
  const layout = useMemo(
    () =>
      layoutWbs(
        visibleNodes,
        query ? new Set() : collapsed,
        query ? null : focus,
      ),
    [visibleNodes, collapsed, focus, query],
  );
  const fit = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const s = Math.max(
      0.12,
      Math.min(
        1,
        (el.clientWidth - 32) / layout.width,
        (el.clientHeight - 32) / layout.height,
      ),
    );
    setScale(s);
    setOffset({
      x: (el.clientWidth - layout.width * s) / 2,
      y: Math.max(16, (el.clientHeight - layout.height * s) / 2),
    });
  }, [layout.width, layout.height]);
  useEffect(() => {
    if (!data || view !== "map") return;
    const el = canvas.current;
    if (!el) return;
    const r = new ResizeObserver(fit);
    r.observe(el);
    fit();
    return () => r.disconnect();
  }, [!!data, view, fit]);
  async function mutate(command: Record<string, unknown>, message: string) {
    if (!data || busyRef.current || !writable) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/project-wbs", {
        projectId,
        type: planType,
        revision: data.revision,
        ...command,
      });
      await load();
      setNotice(message);
      try {
        await onUpdate?.();
      } catch {
        setNotice(message + " Refresh Tasks when your connection returns.");
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function toggleBranch(id: string) {
    setCollapsed((old) => {
      const n = new Set(old);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function zoom(next: number, center?: { x: number; y: number }) {
    const el = canvas.current;
    if (!el) return;
    const s = Math.max(0.12, Math.min(2, next));
    const c = center || { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    setOffset((o) => ({
      x: c.x - ((c.x - o.x) * s) / scale,
      y: c.y - ((c.y - o.y) * s) / scale,
    }));
    setScale(s);
  }
  function add(parent: string | null) {
    setSelected(null);
    setLinking(false);
    setAdding({ parent });
    setIdeas("");
  }
  function openDelete(id: string) {
    setSelected(null);
    setAdding(null);
    setLinking(false);
    setDeleting(id);
    setError("");
  }
  async function remove(mode: "box" | "branch") {
    if (!deleteNode) return;
    const removed =
      mode === "branch"
        ? descendants(nodes, deleteNode.id)
        : new Set([deleteNode.id]);
    const parent = deleteNode.parent_id;
    if (
      await mutate(
        {
          action: "remove",
          id: deleteNode.id,
          taskRevision: deleteNode.revision,
          removeMode: mode,
        },
        mode === "branch"
          ? "Branch deleted. Activities and history are in Archive."
          : "Box deleted. Its children are connected to its parent.",
      )
    ) {
      setDeleting(null);
      setCollapsed((old) => new Set([...old].filter((id) => !removed.has(id))));
      if (focus && removed.has(focus)) setFocus(parent);
    }
  }
  function nodeBox(n: WbsNode, outline = false) {
    const root = n.id === WBS_ROOT,
      children = nodes.filter((c) => c.parent_id === n.id).length,
      done = wbsDone(n),
      active = n.storage_state === "active";
    return (
      <div
        className={`wbs-box ${root ? "wbs-root" : ""} ${done ? "wbs-done" : ""} ${selected === n.id ? "wbs-selected" : ""} ${outline ? "wbs-outline-box" : ""}`}
      >
        {!root && (
          <div className="wbs-box-top">
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-label={`Show ${n.title} in Tasks`}
              disabled={
                !writable ||
                busy ||
                !["active", "planning"].includes(n.storage_state)
              }
              onClick={() =>
                void mutate(
                  {
                    action: "select",
                    id: n.id,
                    taskRevision: n.revision,
                    selected: !active,
                  },
                  active
                    ? "Removed from Tasks. The activity stays in your map."
                    : "Added to Tasks.",
                )
              }
              className={active ? "wbs-in-tasks" : ""}
            >
              {active ? <Check size={13} /> : <Plus size={13} />}{" "}
              {active ? "In Tasks" : "Add to Tasks"}
            </button>
            <button
              type="button"
              className="wbs-more"
              aria-label={`Activity options for ${n.title}`}
              aria-haspopup="dialog"
              disabled={!writable || busy}
              onClick={() => openDelete(n.id)}
            >
              <MoreVertical size={17} />
            </button>
          </div>
        )}
        <button
          type="button"
          className="wbs-box-title"
          onClick={() =>
            root
              ? add(null)
              : (setSelected(n.id), setAdding(null), setLinking(false))
          }
          aria-label={root ? "Add activity to project" : `Edit ${n.title}`}
        >
          <span className="wbs-box-kicker">
            {root ? (
              planType.toUpperCase()
            ) : n.frequency ? (
              <>
                <Repeat2 size={12} /> Repeating
              </>
            ) : done ? (
              <>
                <Check size={12} /> Completed
              </>
            ) : active ? (
              "In Tasks"
            ) : (
              "Category"
            )}
            {!root && <ActivityBadges activity={n} />}
          </span>
          <strong>{root ? data?.project.title : n.title}</strong>
        </button>
        <div className="wbs-box-actions">
          <button
            type="button"
            className="wbs-add-activity"
            disabled={!writable || busy}
            aria-label={
              root ? "Add Activity to project" : `Add Activity under ${n.title}`
            }
            onClick={() => add(root ? null : n.id)}
          >
            <Plus size={14} /> Add Activity
          </button>
          {!!children && (
            <button
              type="button"
              className="wbs-collapse"
              aria-label={`${collapsed.has(n.id) ? "Expand" : "Collapse"} ${n.title}`}
              aria-expanded={!collapsed.has(n.id)}
              onClick={() => toggleBranch(n.id)}
            >
              {collapsed.has(n.id) ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}{" "}
              {children}
            </button>
          )}
        </div>
      </div>
    );
  }
  const positions = new Map(layout.boxes.map((b) => [b.node.id, b]));
  function outline(parent: string | null, depth = 0): React.ReactNode {
    return visibleNodes
      .filter((n) => n.parent_id === parent)
      .sort((a, b) => a.position - b.position)
      .map((n) => (
        <li key={n.id}>
          {nodeBox(n, true)}
          {!collapsed.has(n.id) && depth < 21 && (
            <ul>{outline(n.id, depth + 1)}</ul>
          )}
        </li>
      ));
  }
  const selectedDesc = selected
    ? descendants(nodes, selected)
    : new Set<string>();
  const ancestors: WbsNode[] = [];
  let ancestor = nodes.find((n) => n.id === focus);
  while (ancestor && ancestors.length < 22) {
    ancestors.unshift(ancestor);
    ancestor = nodes.find((n) => n.id === ancestor?.parent_id);
  }
  return (
    <dialog
      ref={dialog}
      className="wbs-dialog"
      aria-labelledby={id + "-title"}
      onCancel={(e) => {
        e.preventDefault();
        if (selected || adding || linking || deleting) {
          setDeleting(null);
          setSelected(null);
          setAdding(null);
          setLinking(false);
        } else onClose();
      }}
    >
      <div className="wbs-shell">
        <div
          className="wbs-main"
          inert={!!(adding || selectedNode || linking || deleteNode)}
        >
          <header className="wbs-header">
            <div>
              <span className="wbs-eyebrow">SPACE TO THINK</span>
              <h2 id={id + "-title"}>{data?.project.title || "Project map"}</h2>
            </div>
            <button
              type="button"
              className="wbs-icon"
              aria-label="Close project map"
              onClick={onClose}
            >
              <X size={22} />
            </button>
          </header>
          <div className="wbs-toolbar">
            <div
              className="wbs-view-switch"
              role="group"
              aria-label="Project view"
            >
              <button
                type="button"
                aria-pressed={view === "map"}
                onClick={() => setView("map")}
              >
                <Network size={16} /> Map
              </button>
              <button
                type="button"
                aria-pressed={view === "outline"}
                onClick={() => setView("outline")}
              >
                <ListTree size={16} /> Outline
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setCollapsed(new Set());
                setFocus(null);
                setQuery("");
              }}
            >
              <Maximize2 size={16} /> All branches
            </button>
            <button
              type="button"
              className="wbs-icon"
              disabled={busy}
              aria-label="Reload project map"
              onClick={() =>
                void load()
                  .then(() => {
                    setError("");
                    setNotice("Project map refreshed.");
                  })
                  .catch((e) => setError(e.message))
              }
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <div className="wbs-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setFocus(null);
              }}
              placeholder="Find an activity…"
              aria-label="Find an activity"
            />
            {query && (
              <button
                type="button"
                className="wbs-icon"
                aria-label="Clear activity search"
                onClick={() => setQuery("")}
              >
                <X size={16} />
              </button>
            )}
            <span>{nodes.length} activities</span>
          </div>
          {focus && (
            <nav className="wbs-breadcrumb" aria-label="Branch path">
              <button type="button" onClick={() => setFocus(null)}>
                Whole project
              </button>
              {ancestors.map((n) => (
                <React.Fragment key={n.id}>
                  <ChevronRight size={12} />
                  <button type="button" onClick={() => setFocus(n.id)}>
                    {n.title}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}
          {error && (
            <div className="wbs-error" role="alert">
              {error}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void load()
                    .then(() => setError(""))
                    .catch((e) => setError(e.message))
                }
              >
                Reload tree
              </button>
            </div>
          )}
          {view === "map" && (
            <p className="wbs-map-hint">
              Pinch to explore · Tap a box to edit · Drag the background to pan
            </p>
          )}
          <p className="wbs-announcement" role="status" aria-live="polite">
            {busy ? "Saving…" : notice}
          </p>
          {!data ? (
            <div className="wbs-loading">
              {error
                ? "Connect to the internet to load this project."
                : "Opening your project…"}
            </div>
          ) : (
            <>
              {view === "map" ? (
                <div
                  className="wbs-canvas"
                  ref={canvas}
                  aria-label="Project activity tree. Drag to pan, pinch to zoom, or use the zoom controls."
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    pointers.current.set(e.pointerId, {
                      x: e.clientX,
                      y: e.clientY,
                    });
                    gesture.current = null;
                  }}
                  onPointerMove={(e) => {
                    const prev = pointers.current.get(e.pointerId);
                    if (!prev) return;
                    pointers.current.set(e.pointerId, {
                      x: e.clientX,
                      y: e.clientY,
                    });
                    const ps = [...pointers.current.values()];
                    if (ps.length === 2) {
                      const distance = Math.hypot(
                        ps[0].x - ps[1].x,
                        ps[0].y - ps[1].y,
                      );
                      if (!gesture.current)
                        gesture.current = { distance, scale };
                      else {
                        const bounds = e.currentTarget.getBoundingClientRect();
                        zoom(
                          (gesture.current.scale * distance) /
                            gesture.current.distance,
                          {
                            x: (ps[0].x + ps[1].x) / 2 - bounds.left,
                            y: (ps[0].y + ps[1].y) / 2 - bounds.top,
                          },
                        );
                      }
                    } else {
                      setOffset((o) => ({
                        x: o.x + e.clientX - prev.x,
                        y: o.y + e.clientY - prev.y,
                      }));
                    }
                  }}
                  onPointerUp={(e) => {
                    pointers.current.delete(e.pointerId);
                    gesture.current = null;
                  }}
                  onPointerCancel={(e) => {
                    pointers.current.delete(e.pointerId);
                    gesture.current = null;
                  }}
                >
                  <div
                    className="wbs-world"
                    style={{
                      width: layout.width,
                      height: layout.height,
                      transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
                    }}
                  >
                    <svg
                      width={layout.width}
                      height={layout.height}
                      aria-hidden="true"
                    >
                      {layout.edges.map((edge) => {
                        const a = positions.get(edge.from),
                          b = positions.get(edge.to);
                        if (!a || !b) return null;
                        const y = a.y + 140;
                        return (
                          <path
                            key={edge.to}
                            d={`M${a.x},${y} V${y + 20} H${b.x} V${b.y}`}
                          />
                        );
                      })}
                    </svg>
                    {layout.boxes.map((b) => (
                      <div
                        className="wbs-position"
                        key={b.node.id}
                        style={{ left: b.x - 92, top: b.y }}
                      >
                        {nodeBox(b.node)}
                      </div>
                    ))}
                  </div>
                  {!nodes.length && (
                    <div className="wbs-empty">
                      <span>Start with the big pieces.</span>
                      <p>
                        Add a few activities, then break them into smaller
                        ideas. Choose what appears in Tasks whenever you’re
                        ready.
                      </p>
                      {writable && (
                        <button
                          type="button"
                          onClick={() => {
                            setFocus(null);
                            setQuery("");
                            add(null);
                          }}
                        >
                          <Plus size={18} /> Add Category
                        </button>
                      )}
                    </div>
                  )}
                  {query && !visibleNodes.length && (
                    <div className="wbs-empty">
                      No activities match “{query}”.
                    </div>
                  )}
                </div>
              ) : (
                <div className="wbs-outline">
                  <div className="wbs-outline-root">{data.project.title}</div>
                  {focus &&
                    nodes.find((n) => n.id === focus) &&
                    nodeBox(
                      nodes.find((n) => n.id === focus)!,
                      true,
                    )}
                  <ul>{outline(focus)}</ul>
                  {!visibleNodes.length && (
                    <p>Add your first ideas to start the project.</p>
                  )}
                </div>
              )}
              <footer className="wbs-footer">
                <button
                  type="button"
                  className="wbs-primary"
                  disabled={!writable || busy}
                  onClick={() => {
                    setFocus(null);
                    setQuery("");
                    add(null);
                  }}
                >
                  <Plus size={18} /> Add Category
                </button>
                <div className="wbs-zoom">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => zoom(scale / 1.25)}
                    disabled={view !== "map"}
                  >
                    <Minus size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={fit}
                    disabled={view !== "map"}
                    aria-label="Fit project to screen"
                  >
                    {Math.round(scale * 100)}% · Fit
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => zoom(scale * 1.25)}
                    disabled={view !== "map"}
                  >
                    <Plus size={17} />
                  </button>
                </div>
              </footer>
            </>
          )}
        </div>
        {deleteNode && (
          <div
            className="wbs-sheet-scrim"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) setDeleting(null);
            }}
          >
            <section
              className="wbs-sheet wbs-delete-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Delete activity or branch"
            >
              <div className="wbs-sheet-handle" />
              <span className="wbs-eyebrow">ACTIVITY OPTIONS</span>
              <h3>Delete “{deleteNode.title}”?</h3>
              <p>
                Deleted activities and linked tasks move to Archive. Saved
                history is kept.
              </p>
              {nodes.some((n) => n.parent_id === deleteNode.id) ? (
                <>
                  <button
                    type="button"
                    className="wbs-delete-option"
                    disabled={busy}
                    onClick={() => void remove("box")}
                    aria-label="Delete only this box"
                  >
                    <strong>Delete only this box</strong>
                    <small>
                      Reconnect its child activities to{" "}
                      {nodes.find((n) => n.id === deleteNode.parent_id)
                        ?.title || "the project / goal"}
                      .
                    </small>
                  </button>
                  <button
                    type="button"
                    className="wbs-delete-option wbs-delete-danger"
                    disabled={busy}
                    onClick={() => void remove("branch")}
                    aria-label="Delete full branch"
                  >
                    <strong>
                      <Trash2 size={15} /> Delete full branch
                    </strong>
                    <small>
                      {descendants(nodes, deleteNode.id).size} activities,
                      including everything below this box.
                    </small>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="wbs-delete-option wbs-delete-danger"
                  disabled={busy}
                  onClick={() => void remove("box")}
                >
                  <Trash2 size={16} /> Delete activity
                </button>
              )}
              <button
                type="button"
                autoFocus
                className="wbs-delete-cancel"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              {error && (
                <p role="alert" className="wbs-error">
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
                    Reload tree
                  </button>
                </p>
              )}
            </section>
          </div>
        )}
        {(adding || selectedNode || linking) && (
          <div
            className="wbs-sheet-scrim"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setAdding(null);
                setSelected(null);
                setLinking(false);
              }
            }}
          >
            <section
              className="wbs-sheet"
              role="region"
              aria-label={
                adding
                  ? "Add project ideas"
                  : linking
                    ? "Link existing task"
                    : "Activity details"
              }
            >
              <div className="wbs-sheet-handle" />
              <button
                type="button"
                className="wbs-sheet-close wbs-icon"
                aria-label="Close activity details"
                onClick={() => {
                  setAdding(null);
                  setSelected(null);
                  setLinking(false);
                }}
              >
                <X size={20} />
              </button>
              {adding ? (
                <>
                  <span className="wbs-eyebrow">GROW YOUR PROJECT</span>
                  <h3>
                    {adding.parent
                      ? `Ideas under ${nodes.find((n) => n.id === adding.parent)?.title}`
                      : "What does this project involve?"}
                  </h3>
                  <p>
                    One idea per line. These stay in your map until you add them
                    to Tasks.
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const titles = ideas
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      if (
                        await mutate(
                          { action: "add", parentId: adding.parent, titles },
                          `${titles.length} ${titles.length === 1 ? "activity" : "activities"} added.`,
                        )
                      ) {
                        setAdding(null);
                        setIdeas("");
                      }
                    }}
                  >
                    <label htmlFor={id + "-ideas"}>
                      Activities or categories
                    </label>
                    <textarea
                      autoFocus
                      id={id + "-ideas"}
                      value={ideas}
                      onChange={(e) => setIdeas(e.target.value)}
                      rows={5}
                      maxLength={8000}
                      placeholder={
                        "Research the market\nFind potential institutes\nPlan a demo"
                      }
                      required
                    />
                    <button
                      type="submit"
                      className="wbs-primary"
                      disabled={busy || !writable || !ideas.trim()}
                    >
                      Add{" "}
                      {ideas.split("\n").filter((s) => s.trim()).length || ""}{" "}
                      {ideas.split("\n").filter((s) => s.trim()).length === 1
                        ? "activity"
                        : "activities"}
                    </button>
                  </form>
                  <button
                    type="button"
                    className="wbs-text"
                    disabled={busy}
                    onClick={() => {
                      setLinkParent(adding.parent);
                      setAdding(null);
                      setLinking(true);
                    }}
                  >
                    Use an existing project activity
                  </button>
                </>
              ) : linking ? (
                <>
                  <h3>Use an existing activity</h3>
                  <p>
                    The same task will appear in your map. Its history stays
                    intact.
                  </p>
                  <div className="wbs-existing">
                    {data?.available.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        disabled={busy || !writable}
                        onClick={async () => {
                          if (
                            await mutate(
                              {
                                action: "link",
                                id: t.id,
                                parentId: linkParent,
                              },
                              "Task added to the map.",
                            )
                          )
                            setLinking(false);
                        }}
                      >
                        <Plus size={16} />
                        {t.title}
                      </button>
                    ))}
                    {!data?.available.length && (
                      <p>
                        All eligible project activities are already in the map.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                selectedNode && (
                  <ActivityDetails
                    key={selectedNode.id}
                    node={selectedNode}
                    nodes={nodes}
                    busy={busy}
                    writable={
                      writable &&
                      ["active", "planning"].includes(
                        selectedNode.storage_state,
                      )
                    }
                    descendants={selectedDesc}
                    onSave={async (values) => {
                      if (
                        await mutate(
                          {
                            action: "edit",
                            id: selectedNode.id,
                            taskRevision: selectedNode.revision,
                            ...values,
                          },
                          "Activity saved.",
                        )
                      )
                        setSelected(null);
                    }}
                    onMove={async (parentId, beforeId) => {
                      await mutate(
                        {
                          action: "move",
                          id: selectedNode.id,
                          parentId,
                          beforeId,
                        },
                        "Activity moved.",
                      );
                    }}
                    onAddChild={() => add(selectedNode.id)}
                    onAddSibling={() => add(selectedNode.parent_id)}
                    onFocus={() => {
                      setFocus(selectedNode.id);
                      setCollapsed((old) => {
                        const n = new Set(old);
                        n.delete(selectedNode.id);
                        return n;
                      });
                      setSelected(null);
                      setQuery("");
                    }}
                    onRemove={async () => openDelete(selectedNode.id)}
                  />
                )
              )}
              {error && (
                <p role="alert" className="wbs-error">
                  {error}{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void load()
                        .then(() => setError(""))
                        .catch((e) => setError(e.message))
                    }
                  >
                    Reload tree
                  </button>
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}
function ActivityDetails({
  node,
  nodes,
  busy,
  writable,
  descendants: excluded,
  onSave,
  onMove,
  onAddChild,
  onAddSibling,
  onFocus,
  onRemove,
}: {
  node: WbsNode;
  nodes: WbsNode[];
  busy: boolean;
  writable: boolean;
  descendants: Set<string>;
  onSave: (v: Record<string, unknown>) => Promise<void>;
  onMove: (p: string | null, b?: string | null) => Promise<void>;
  onAddChild: () => void;
  onAddSibling: () => void;
  onFocus: () => void;
  onRemove: () => Promise<void>;
}) {
  const [title, setTitle] = useState(node.title),
    [frequency, setFrequency] = useState(node.frequency || "once"),
    [firstDay, setFirstDay] = useState(node.first_day || today()),
    [parent, setParent] = useState(node.parent_id || "");
  const siblings = nodes
      .filter((n) => n.parent_id === node.parent_id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    index = siblings.findIndex((n) => n.id === node.id);
  return (
    <>
      <span className="wbs-eyebrow">
        {node.storage_state === "active" ? "IN TASKS" : "PROJECT ACTIVITY"}
      </span>
      <h3>Shape this activity</h3>
      <div className="wbs-quick-actions">
        <button type="button" disabled={busy || !writable} onClick={onAddChild}>
          <Plus size={16} /> Add child
        </button>
        <button
          type="button"
          disabled={busy || !writable}
          onClick={onAddSibling}
        >
          <Plus size={16} /> Add beside
        </button>
        <button type="button" onClick={onFocus}>
          <Focus size={16} /> Focus branch
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await onSave({
            title,
            isCsf: f.get("isCsf") === "on",
            isKpi: f.get("isKpi") === "on",
            activityNote: f.get("activityNote") || "",
            frequency,
            firstDay,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dueDate: f.get("dueDate") || "",
            ...(!node.frequency && frequency === "once"
              ? { stage: f.get("stage") }
              : {}),
          });
        }}
      >
        <label>
          Activity name
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            disabled={!writable}
          />
        </label>
        <ActivityTags
          isCsf={!!node.is_csf}
          isKpi={!!node.is_kpi}
          disabled={!writable || busy}
        />
        <label>
          Activity note
          <textarea
            name="activityNote"
            defaultValue={node.activity_note || ""}
            maxLength={1000}
            rows={2}
            disabled={!writable}
          />
        </label>
        <div className="wbs-fields">
          <label>
            Repeat
            <select
              value={frequency}
              disabled={!writable || !!node.frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="once">One time</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          {frequency === "once" ? (
            <label>
              Status
              <select
                name="stage"
                defaultValue={node.stage}
                disabled={!writable}
              >
                {["To do", "In progress", "Review", "Done"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Starts
              <input
                type="date"
                value={firstDay}
                onChange={(e) => setFirstDay(e.target.value)}
                disabled={!writable || !!node.frequency}
                required
              />
            </label>
          )}
        </div>
        {frequency === "once" && (
          <label>
            Due date (optional)
            <input
              type="date"
              name="dueDate"
              defaultValue={node.due_date}
              disabled={!writable}
            />
          </label>
        )}
        {frequency !== "once" && (
          <p className="wbs-help">
            Repeating activities stay visible and never turn gray. Complete each
            occurrence in Tasks.
            {node.frequency
              ? " Manage an existing repeat schedule in task scheduling."
              : ""}
          </p>
        )}
        <button
          type="submit"
          className="wbs-primary"
          disabled={busy || !writable || !title.trim()}
        >
          Save activity
        </button>
      </form>
      <details className="wbs-organize">
        <summary>Organize this branch</summary>
        <label>
          Move under
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            disabled={!writable || busy}
          >
            <option value="">Project root</option>
            {nodes
              .filter((n) => !excluded.has(n.id))
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !writable || parent === (node.parent_id || "")}
          onClick={() => void onMove(parent || null)}
        >
          Move activity
        </button>
        <div className="wbs-quick-actions">
          <button
            type="button"
            disabled={busy || !writable || index <= 0}
            onClick={() => void onMove(node.parent_id, siblings[index - 1].id)}
          >
            <ArrowUp size={16} /> Move up
          </button>
          <button
            type="button"
            disabled={
              busy || !writable || index < 0 || index >= siblings.length - 1
            }
            onClick={() =>
              void onMove(node.parent_id, siblings[index + 2]?.id || null)
            }
          >
            <ArrowDown size={16} /> Move down
          </button>
        </div>
        <button
          type="button"
          className="wbs-remove"
          disabled={busy || !writable}
          onClick={() => void onRemove()}
        >
          Delete activity or branch
        </button>
      </details>
    </>
  );
}
