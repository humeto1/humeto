"use client";
import { TaskValueBadge } from "./task-value";
import React, { useState } from "react";
import "./planning.css";
const date = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export default function TaskCalendar({
  tasks,
  openTask,
}: {
  tasks: any[];
  openTask: (t: any) => void;
}) {
  const [month, setMonth] = useState(date().slice(0, 7)),
    [selected, setSelected] = useState(date());
  const first = new Date(month + "-01T12:00:00"),
    offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i - offset);
    return date(d);
  });
  return (
    <section className="planning-hub" aria-label="Filtered task calendar">
      <div className="planning-controls">
        <h2>Task calendar</h2>
        <label>
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </label>
        <span>{tasks.length} filtered tasks</span>
      </div>
      <div className="planning-calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => (
          <span className="calendar-weekday" key={n}>
            {n}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d}
            aria-label={"Task day " + d}
            aria-pressed={selected === d}
            className={
              d.slice(0, 7) !== month ? "outside" : d === date() ? "today" : ""
            }
            onClick={() => setSelected(d)}
          >
            <strong>{Number(d.slice(8))}</strong>
            <small>{tasks.filter((t) => t.due_date === d).length || ""}</small>
          </button>
        ))}
      </div>
      <h3>{selected}</h3>
      {tasks
        .filter((t) => t.due_date === selected)
        .map((t) => (
          <button
            className="planning-row"
            style={{ width: "100%", textAlign: "left", marginBottom: 8 }}
            key={t.id}
            onClick={() => openTask(t)}
          >
            <span>
              {t.display_title || t.title}
              <small>
                {t.display_title ? "Original: " + t.title + " · " : ""}
                {t.category || "Uncategorized"} · {t.stage}
              </small>
              <TaskValueBadge task={t} />
            </span>
          </button>
        ))}
      {!tasks.some((t) => t.due_date === selected) && (
        <p>No matching tasks on this date.</p>
      )}
      <details>
        <summary>
          No due date ({tasks.filter((t) => !t.due_date).length})
        </summary>
        {tasks
          .filter((t) => !t.due_date)
          .map((t) => (
            <button
              key={t.id}
              className="planning-row"
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => openTask(t)}
            >
              {t.title}
            </button>
          ))}
      </details>
    </section>
  );
}
