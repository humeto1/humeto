"use client";
import { useState } from "react";
import { MoreHorizontal, Plus, X } from "lucide-react";
export type StageConfig = {
  revision: number;
  stages: { key: string; title: string }[];
};
export type StageEditor = {
  kind: string;
  config: StageConfig;
  onChange: () => Promise<void>;
  enabled: boolean;
};
export function StageControls({
  editor,
  stageKey,
  count = 0,
}: {
  editor: StageEditor;
  stageKey?: string;
  count?: number;
}) {
  const [mode, setMode] = useState("");
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = editor.config.stages.find((s) => s.key === stageKey);
  const index = editor.config.stages.findIndex((s) => s.key === stageKey);
  const protectedStage = editor.kind === "tasks" && stageKey === "Done";
  async function save(action: string) {
    setBusy(true);
    setError("");
    let stages = [...editor.config.stages];
    const replacements: Record<string, string> = {};
    if (action === "rename")
      stages = stages.map((s) =>
        s.key === stageKey ? { ...s, title: title.trim() } : s,
      );
    if (action === "add")
      stages.push({
        key: "custom-" + crypto.randomUUID(),
        title: title.trim(),
      });
    if (action === "delete") {
      stages = stages.filter((s) => s.key !== stageKey);
      replacements[stageKey!] = destination;
    }
    if (action === "left" || action === "right") {
      const next = index + (action === "left" ? -1 : 1);
      [stages[index], stages[next]] = [stages[next], stages[index]];
    }
    try {
      const r = await fetch(
        "/api/workspace/pipelines?kind=" + encodeURIComponent(editor.kind),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: editor.kind,
            revision: editor.config.revision,
            stages,
            replacements,
          }),
        },
      );
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      await editor.onChange();
      setMode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(value: string) {
    setTitle(stage?.title || "");
    setError("");
    setMode(value);
  }
  if (!editor.enabled)
    return stage ? (
      <div className="inline-stage-heading">
        <span className="stage-title-button">{stage.title}</span>
        <span className="stage-card-count">{count}</span>
      </div>
    ) : null;
  return (
    <div className={stage ? "inline-stage-heading" : "inline-stage-add"}>
      {stage ? (
        <>
          <button
            className="stage-title-button"
            title="Rename stage"
            onClick={() => edit("rename")}
          >
            {stage.title}
          </button>
          <span className="stage-card-count">{count}</span>
          <button
            className="stage-menu-button"
            aria-label={`Options for ${stage.title}`}
            onClick={() => edit(mode === "menu" ? "" : "menu")}
          >
            <MoreHorizontal size={16} />
          </button>
        </>
      ) : (
        <button
          className="add-stage-button"
          onClick={() => {
            setTitle("");
            setMode("add");
            setError("");
          }}
        >
          <Plus size={15} /> Add stage
        </button>
      )}
      {mode && (
        <div
          className="stage-popover"
          role="group"
          aria-label={stage ? `Edit ${stage.title}` : "Add stage"}
        >
          <button
            className="stage-popover-close"
            aria-label="Close stage editor"
            onClick={() => setMode("")}
          >
            <X size={14} />
          </button>
          {mode === "menu" ? (
            <>
              <strong>{stage?.title}</strong>
              <button onClick={() => edit("rename")}>Rename stage</button>
              <button
                disabled={busy || index === 0}
                onClick={() => void save("left")}
              >
                Move left
              </button>
              <button
                disabled={busy || index === editor.config.stages.length - 1}
                onClick={() => void save("right")}
              >
                Move right
              </button>
              <button
                disabled={protectedStage || editor.config.stages.length === 1}
                onClick={() => edit("delete")}
              >
                Delete stage
              </button>
              {protectedStage && (
                <small>
                  Required for task creation, focus or completion. You can
                  rename or move it.
                </small>
              )}
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(mode);
              }}
            >
              <strong>
                {mode === "delete"
                  ? "Delete stage"
                  : mode === "add"
                    ? "New stage"
                    : "Rename stage"}
              </strong>
              {mode === "delete" ? (
                <>
                  <p>
                    Move existing cards to another stage before removing this
                    column.
                  </p>
                  <select
                    aria-label="Move cards to"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    required
                  >
                    <option value="">Choose destination</option>
                    {editor.config.stages
                      .filter((s) => s.key !== stageKey)
                      .map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.title}
                        </option>
                      ))}
                  </select>
                </>
              ) : (
                <input
                  autoFocus
                  aria-label="Stage name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={60}
                  required
                />
              )}
              <button
                className="btn primary small"
                disabled={
                  busy || (mode === "delete" ? !destination : !title.trim())
                }
              >
                {busy
                  ? "Saving…"
                  : mode === "delete"
                    ? "Move cards & delete"
                    : "Save"}
              </button>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
