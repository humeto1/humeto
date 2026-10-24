"use client";
import { useState } from "react";
import "./goal-field.css";
type Goal = { id: string; title: string; status?: string };
export function GoalField({
  goals,
  name = "goalIds",
  initialIds = [],
  value,
  onChange,
}: {
  goals: Goal[];
  name?: string;
  initialIds?: string[];
  value?: string[];
  onChange?: (ids: string[]) => void;
}) {
  const [saved, setSaved] = useState(initialIds);
  const selected = value ?? saved;
  const update = (ids: string[]) => {
    setSaved(ids);
    onChange?.(ids);
  };
  return (
    <div className="goal-field">
      <label>
        Goal
        <select
          aria-label="Goal"
          value={selected[0] || ""}
          onChange={(e) =>
            update(
              e.target.value
                ? [
                    e.target.value,
                    ...selected.slice(1).filter((id) => id !== e.target.value),
                  ]
                : [],
            )
          }
        >
          <option value="">No goal</option>
          {goals
            .filter((g) => g.status !== "Archived" || selected.includes(g.id))
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
                {g.status === "Archived" ? " · archived" : ""}
              </option>
            ))}
        </select>
      </label>
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {selected.length > 1 && (
        <div className="goal-field-existing">
          <small>Other saved goal links</small>
          {selected.slice(1).map((id) => (
            <div key={id}>
              <span>
                {goals.find((g) => g.id === id)?.title || "Saved goal"}
              </span>
              <button
                type="button"
                aria-label={
                  "Remove goal link: " +
                  (goals.find((g) => g.id === id)?.title || id)
                }
                onClick={() => update(selected.filter((g) => g !== id))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {!goals.length && (
        <small className="goal-field-empty">Add a goal in Plans.</small>
      )}
    </div>
  );
}
