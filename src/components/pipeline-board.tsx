"use client";
import { useTouchDrag } from "../../shared/touch-drag";
import { useState } from "react";
import { StageControls, type StageEditor } from "./stage-controls";
export default function PipelineBoard<T extends { id: string }>({
  items,
  stages,
  stageOf,
  render,
  move,
  editable,
  label,
  titles = {},
  stageEditor,
}: {
  items: T[];
  stages: readonly string[];
  stageOf: (item: T) => string;
  render: (item: T) => React.ReactNode;
  move: (item: T, stage: string) => Promise<void>;
  editable: boolean;
  label: string;
  titles?: Record<string, string>;
  stageEditor?: StageEditor;
}) {
  const [dragged, setDragged] = useState<string | null>(null),
    [over, setOver] = useState(""),
    [moving, setMoving] = useState(false);
  const run = async (item: T, stage: string) => {
    if (moving || !editable || stageOf(item) === stage) return;
    setMoving(true);
    try {
      await move(item, stage);
    } finally {
      setMoving(false);
      setDragged(null);
      setOver("");
    }
  };
  const touch = useTouchDrag({
    enabled: editable && !moving,
    onDrop: async (id, stage) => {
      const item = items.find((i) => i.id === id);
      if (item && stages.includes(stage)) await run(item, stage);
    },
  });
  return (
    <div
      ref={touch.boardRef}
      className="pipeline-board"
      aria-label={label}
      aria-busy={moving}
    >
      <span className="touch-drag-status" role="status">
        {touch.status}
      </span>
      {stages.map((stage) => (
        <section
          className={"pipeline-column " + (over === stage ? "drop-over" : "")}
          key={stage}
          {...touch.zone(stage, titles[stage] || stage)}
          aria-label={(titles[stage] || stage) + " column"}
          onDragOver={(e) => {
            if (editable && dragged) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(stage);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const item = items.find((i) => i.id === dragged);
            if (item) void run(item, stage);
          }}
        >
          {stageEditor?.enabled ? (
            <StageControls
              editor={stageEditor}
              stageKey={stage}
              count={items.filter((i) => stageOf(i) === stage).length}
            />
          ) : (
            <h2>
              <i />
              {titles[stage] || stage}
              <span>{items.filter((i) => stageOf(i) === stage).length}</span>
            </h2>
          )}
          {items
            .filter((i) => stageOf(i) === stage)
            .map((item) => (
              <div
                className="pipeline-item"
                key={item.id}
                draggable={editable && !moving}
                onDragStart={(e) => {
                  if (
                    (e.target as HTMLElement).closest("input,select,button,a")
                  ) {
                    e.preventDefault();
                    return;
                  }
                  setDragged(item.id);
                  e.dataTransfer.setData("text/plain", item.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver("");
                }}
              >
                {editable &&
                  touch.handle(
                    item.id,
                    (item as any).title ||
                      (item as any).name ||
                      [(item as any).person_name, (item as any).institution]
                        .filter(Boolean)
                        .join(" · ") ||
                      "Card " + item.id,
                  )}
                {render(item)}
                {editable && (
                  <label className="pipeline-stage">
                    Move stage
                    <select
                      aria-label={"Stage for " + item.id}
                      disabled={moving}
                      value={stageOf(item)}
                      onChange={(e) => void run(item, e.target.value)}
                    >
                      {stages.map((s) => (
                        <option key={s} value={s}>
                          {titles[s] || s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
          {!items.some((i) => stageOf(i) === stage) && (
            <p className="empty-column">Drop a card here</p>
          )}
        </section>
      ))}
      {stageEditor?.enabled && <StageControls editor={stageEditor} />}
    </div>
  );
}
