"use client";
import { useState, useEffect } from "react";
type Series = {
  id: string;
  revision: number;
  frequency: string;
  interval_count: number;
  next_day: string;
  end_day: string;
  local_time: string;
  timezone: string;
};
export default function RecurrenceEditor({
  series: s,
  busy,
  writable,
  act,
}: {
  series: Series;
  busy: boolean;
  writable: boolean;
  act: (action: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [frequency, setFrequency] = useState(s.frequency),
    [interval, setInterval] = useState(s.interval_count),
    [day, setDay] = useState(s.next_day),
    [time, setTime] = useState(s.local_time),
    [timezone, setZone] = useState(s.timezone),
    [endDay, setEnd] = useState(s.end_day),
    [skip, setSkip] = useState(false);
  useEffect(() => {
    setFrequency(s.frequency);
    setInterval(s.interval_count);
    setDay(s.next_day);
    setTime(s.local_time);
    setZone(s.timezone);
    setEnd(s.end_day);
    setSkip(false);
  }, [s.id, s.revision]);
  return (
    <details style={{ width: "100%" }}>
      <summary style={{ cursor: "pointer" }}>Edit future occurrences</summary>
      <div style={{ display: "grid", gap: 10, paddingTop: 12 }}>
        <p style={{ fontSize: 12 }}>
          Existing tasks and history stay unchanged. The next date becomes the
          new monthly anchor. A paused series stays paused.
        </p>
        <label>
          Repeat frequency
          <select
            aria-label="Edit repeat frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          >
            {["daily", "weekdays", "weekly", "monthly"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Repeat every
          <input
            aria-label="Edit repeat interval"
            type="number"
            min={1}
            max={12}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
          />
        </label>
        <label>
          Next date
          <input
            aria-label="Edit next occurrence"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <label>
          Local time
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label>
          Timezone
          <input value={timezone} onChange={(e) => setZone(e.target.value)} />
        </label>
        <label>
          Last date (optional)
          <input
            type="date"
            value={endDay}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !writable}
          onClick={() =>
            void act("series-edit", {
              id: s.id,
              revision: s.revision,
              frequency,
              interval,
              nextDay: day,
              time,
              timezone,
              endDay,
            })
          }
        >
          Save future schedule
        </button>
        <hr />
        <p style={{ fontSize: 12 }}>
          Skip scheduled occurrence <strong>{s.next_day}</strong> in{" "}
          {s.timezone}. No task will be created for that day. Later occurrences
          continue.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
          />
          I want to skip {s.next_day}
        </label>
        <button
          disabled={busy || !writable || !skip}
          onClick={() =>
            void act("series-skip", { id: s.id, revision: s.revision })
          }
        >
          Confirm skip occurrence
        </button>
      </div>
    </details>
  );
}
