"use client";
import { useState } from "react";
export default function PipelineBoard<T extends { id: string }>({
  items,
  stages,
  stageOf,
  render,
  move,
  editable,
  label,
}: {
  items: T[];
  stages: readonly string[];
  stageOf: (item: T) => string;
  render: (item: T) => React.ReactNode;
  move: (item: T, stage: string) => Promise<void>;
  editable: boolean;
  label: string;
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
  return (
    <div className="pipeline-board" aria-label={label} aria-busy={moving}>
      {stages.map((stage) => (
        <section
          className={"pipeline-column " + (over === stage ? "drop-over" : "")}
          key={stage}
          aria-label={stage + " column"}
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
          <h2>
            <i />
            {stage}
            <span>{items.filter((i) => stageOf(i) === stage).length}</span>
          </h2>
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
                        <option key={s}>{s}</option>
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
    </div>
  );
}
