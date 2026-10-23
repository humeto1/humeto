import { useState } from "react";
export function FocusRest({
  active,
  now,
  totalSeconds,
  sessions,
  onAction,
  busy = false,
}: {
  active: any;
  now: number;
  totalSeconds: number;
  sessions: number;
  onAction: (action: string, extra?: any) => void;
  busy?: boolean;
}) {
  const [kind, setKind] = useState("quiet"),
    [minutes, setMinutes] = useState(5),
    [note, setNote] = useState("");
  const continuous = active.running_since
    ? Math.max(0, Math.floor((now - Date.parse(active.running_since)) / 60000))
    : 0;
  const checkDue = active.check_in_at && Date.parse(active.check_in_at) <= now;
  const breaking = active.state !== "running" && active.break_until;
  return (
    <section
      className="focus-rest"
      aria-label="Work sessions and breaks"
      style={{
        padding: 16,
        border: "1px solid #dce5ce",
        borderRadius: 14,
        marginBlock: 12,
      }}
    >
      <p>
        <strong>
          {Math.floor(totalSeconds / 3600)}h{" "}
          {Math.floor((totalSeconds % 3600) / 60)}m
        </strong>{" "}
        worked on this task · {sessions} sessions across days. The task stays
        open until you mark it complete.
      </p>
      {breaking ? (
        <div role="status">
          <h3>
            {Date.parse(active.break_until) > now
              ? "A little space to recharge."
              : "Break finished. Ready to return?"}
          </h3>
          <p>
            {Math.max(
              0,
              Math.ceil((Date.parse(active.break_until) - now) / 1000),
            )}{" "}
            seconds remaining · {active.break_kind || "quiet"} break. The work
            timer is paused.
          </p>
          <p>
            Use Resume when you are ready. The clock never resumes
            automatically.
          </p>
        </div>
      ) : (
        <>
          {(continuous >= 25 || checkDue) && (
            <p role="status">
              <strong>
                {continuous >= 50
                  ? "You have been on this for a while. Ready for a break or a different task?"
                  : "Still working on this? How is it going?"}
              </strong>{" "}
              Based on your tracked session,{" "}
              {continuous >= 90
                ? "a ten-minute reset may be useful."
                : "try a short pause, save progress, or choose to continue."}
            </p>
          )}
          <details open={continuous >= 50}>
            <summary>Take a break</summary>
            <p>
              Choose a quiet rest, stretch, walk, or jog if you prefer. No
              activity is inferred from your keyboard or other apps.
            </p>
            <label>
              Break type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="quiet">Quiet rest</option>
                <option value="stretch">Stretch</option>
                <option value="walk">Walk</option>
                <option value="jog">Jog</option>
              </select>
            </label>
            <label>
              Break minutes
              <input
                type="number"
                min={1}
                max={120}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !Number.isInteger(minutes) ||
                minutes < 1 ||
                minutes > 120
              }
              onClick={() => onAction("break", { minutes, breakKind: kind })}
            >
              Start break · pause work timer
            </button>
          </details>
        </>
      )}
      <details>
        <summary>Finish working for now · keep task open</summary>
        <label>
          Where did you stop?
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="What should you pick up next time?"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("stop", { note, nextStep: note })}
        >
          Save & end work session
        </button>
      </details>
    </section>
  );
}
