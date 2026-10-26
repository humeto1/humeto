"use client";
import { useState } from "react";
import { DailyTasks } from "./daily-tasks";
import PlanningHub, { webApi, type Transport } from "./planning-hub";
export function TaskPlanning({
  tasks,
  projects,
  goals,
  writable,
  refresh,
  request = webApi,
  onOpen,
  onAdd,
}: {
  tasks: any[];
  projects: any[];
  goals: any[];
  writable: boolean;
  refresh: () => Promise<void>;
  request?: Transport;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const [view, setView] = useState("today");
  return (
    <section aria-label="Home task views">
      <div className="home-task-views" role="group" aria-label="Home views">
        {[
          ["today", "Today"],
          ["calendar", "Calendar"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "today" ? (
        <DailyTasks
          tasks={tasks}
          writable={writable}
          request={request}
          refresh={refresh}
          onOpen={onOpen}
          onAdd={onAdd}
        />
      ) : (
        <PlanningHub
          tasks={tasks}
          projects={projects}
          goals={goals}
          writable={writable}
          refresh={refresh}
          request={request}
          view="calendar"
          onOpenTask={onOpen}
        />
      )}
    </section>
  );
}

export function PlanningDrawer(props: Parameters<typeof TaskPlanning>[0]) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="task-detail-group"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Daily tasks & plan calendar</summary>
      {open && <TaskPlanning {...props} />}
    </details>
  );
}
