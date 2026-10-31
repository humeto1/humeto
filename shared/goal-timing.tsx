"use client";
import { useState } from "react";
import type { Transport } from "./transport";
import {
  addDays,
  localDate,
  computeGoalTiming,
  extendGoalTarget,
} from "./goal-clock";
import "./goal-timing.css";
export { computeGoalTiming } from "./goal-clock";

export function GoalDeadlineFields({
  value = "",
  required = true,
}: {
  value?: string;
  required?: boolean;
}) {
  const [date, setDate] = useState(value);
  return (
    <div className="goal-presets-row">
      <label>
        Deadline
        <input
          name="targetDate"
          type="date"
          required={required}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <div
        className="goal-presets-chips"
        role="group"
        aria-label="Goal timeframe"
      >
        {[30, 90, 180, 365].map((days) => (
          <button
            key={days}
            type="button"
            className="goal-preset-chip"
            onClick={() => setDate(addDays(localDate(), days))}
          >
            {days} days
          </button>
        ))}
      </div>
      <label>
        Or set a number of days
        <input
          type="number"
          min="1"
          max="3650"
          aria-label="Goal duration in days"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0 && n <= 3650)
              setDate(addDays(localDate(), n));
          }}
        />
      </label>
    </div>
  );
}
export function GoalTimerCardWidget({
  goal,
  writable,
  request,
  onUpdate,
}: {
  goal: any;
  writable: boolean;
  request: Transport;
  onUpdate: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [newCycle, setNewCycle] = useState(false);
  const timing = computeGoalTiming(goal);
  async function save(days: number) {
    setBusy(true);
    setError("");
    try {
      await request(
        `/api/workspace/goals/${goal.id}`,
        {
          title: goal.title,
          description: goal.description,
          category: goal.category,
          successMetric: goal.success_metric,
          status: goal.status,
          targetDate: extendGoalTarget(goal.target_date, days),
          revision: goal.revision,
        },
        "PATCH",
      );
      await onUpdate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="goal-timer-widget">
      <strong>{timing.summary}</strong>
      {timing.total !== null && (
        <small>
          {timing.total} day timeframe · {timing.elapsed ?? "Unknown"} days
          elapsed · target {goal.target_date}
        </small>
      )}
      {timing.hasTarget && !timing.completed && (
        <progress
          value={timing.percent}
          max={100}
          aria-label="Goal timeframe elapsed"
        />
      )}
      {error && <p role="alert">{error}</p>}
      {writable && (
        <div className="goal-timer-actions">
          {!timing.completed && (
            <>
              <span>Extend target:</span>
              {[30, 90].map((days) => (
                <button
                  key={days}
                  className="goal-action-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void save(days)}
                >
                  +{days} days
                </button>
              ))}
            </>
          )}
          <button
            className="goal-action-btn"
            type="button"
            disabled={busy}
            onClick={() => setNewCycle(!newCycle)}
          >
            New goal cycle
          </button>
        </div>
      )}
      {newCycle && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await request("/api/workspace/goals", {
                title: f.get("title"),
                description: goal.description,
                category: goal.category,
                successMetric: goal.success_metric,
                targetDate: f.get("targetDate"),
                status: "Active",
              });
              setNewCycle(false);
              await onUpdate();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            A new goal keeps this cycle and its linked tasks in history. Extend
            the target to continue this goal instead.
          </p>
          <label>
            New cycle name
            <input
              name="title"
              required
              minLength={2}
              maxLength={160}
              defaultValue={`${goal.title.slice(0, 145)} · next cycle`}
            />
          </label>
          <GoalDeadlineFields value={addDays(localDate(), 90)} />
          <button disabled={busy}>Create goal cycle</button>
          <button type="button" onClick={() => setNewCycle(false)}>
            Cancel new cycle
          </button>
        </form>
      )}
    </div>
  );
}
