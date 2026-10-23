import { useState } from "react";
import "./birds-eye.css";
export default function BirdsEye({
  tasks,
  openTask,
  stageTitle = (stage: string) => stage,
}: {
  tasks: any[];
  openTask: (task: any) => void;
  stageTitle?: (stage: string) => string;
}) {
  const [group, setGroup] = useState("stage"),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const groups = new Map<string, any[]>();
  for (const t of tasks) {
    const key =
      group === "project"
        ? t.project_title || "No project"
        : group === "category"
          ? t.category || "Uncategorized"
          : group === "priority"
            ? t.important
              ? t.urgent
                ? "Do now"
                : "Schedule"
              : t.urgent
                ? "Delegate"
                : "Later"
            : stageTitle(t.stage);
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const done = tasks.filter((t) => t.stage === "Done").length;
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return (
    <section className="birds-eye" aria-label="Bird’s-eye task view">
      <header>
        <div>
          <h2>Your whole workload, at a glance.</h2>
          <p>
            {tasks.length} tasks · {done} done ·{" "}
            {
              tasks.filter(
                (t) => t.stage !== "Done" && t.due_date && t.due_date < day,
              ).length
            }{" "}
            overdue ·{" "}
            {tasks.filter((t) => t.important && t.stage !== "Done").length}{" "}
            important
          </p>
        </div>
        <label>
          Group by
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setCollapsed([]);
            }}
          >
            <option value="stage">Stage</option>
            <option value="project">Project</option>
            <option value="category">Category</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        <button
          onClick={() =>
            setCollapsed(collapsed.length ? [] : [...groups.keys()])
          }
        >
          {collapsed.length ? "Expand groups" : "Collapse groups"}
        </button>
      </header>
      <p>Uses your current filters. Tap any row for full details.</p>
      <div className="birds-groups">
        {[...groups].map(([name, items]) => (
          <section key={name}>
            <button
              className="birds-group-title"
              aria-expanded={!collapsed.includes(name)}
              onClick={() =>
                setCollapsed((old) =>
                  old.includes(name)
                    ? old.filter((n) => n !== name)
                    : [...old, name],
                )
              }
            >
              {name}
              <span>{items.length}</span>
            </button>
            {!collapsed.includes(name) &&
              items
                .sort((a, b) =>
                  (a.due_date || "9999").localeCompare(b.due_date || "9999"),
                )
                .map((t) => (
                  <button
                    className="birds-task"
                    key={t.id}
                    onClick={() => openTask(t)}
                  >
                    <span
                      className="birds-dot"
                      style={{
                        background:
                          t.stage === "Done"
                            ? "#527c60"
                            : t.important && t.urgent
                              ? "#ba5c42"
                              : "#a6b78d",
                      }}
                      aria-label={t.important ? "Important" : "Task"}
                    />
                    <span>
                      <strong>{t.display_title || t.title}</strong>
                      <small>
                        {group !== "project" &&
                          (t.project_title || "No project")}
                        {t.category ? " · " + t.category : ""}
                        {group !== "stage" ? " · " + stageTitle(t.stage) : ""}
                      </small>
                    </span>
                    <time
                      className={
                        t.stage !== "Done" && t.due_date && t.due_date < day
                          ? "birds-overdue"
                          : ""
                      }
                    >
                      {t.due_date || "No date"}
                    </time>
                  </button>
                ))}
          </section>
        ))}
      </div>
      {!tasks.length && <p>No tasks match your filters.</p>}
    </section>
  );
}
