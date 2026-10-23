import { useState } from "react";
import { Coffee, Timer } from "lucide-react";
import "./focus-controls.css";
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
    [minutes, setMinutes] = useState(5);
  const continuous = active.running_since
    ? Math.max(0, Math.floor((now - Date.parse(active.running_since)) / 60000))
    : 0;
  const checkDue = active.check_in_at && Date.parse(active.check_in_at) <= now;
  const breaking = active.state !== "running" && active.break_until;
  const remaining = breaking
    ? Math.max(0, Math.ceil((Date.parse(active.break_until) - now) / 1000))
    : 0;
  return (
    <section className="focus-rest" aria-label="Work sessions and breaks">
      <div className="focus-rest-stats">
        <Timer size={14} />
        <strong>
          {Math.floor(totalSeconds / 3600)}h{" "}
          {Math.floor((totalSeconds % 3600) / 60)}m total
        </strong>
        <span>· {sessions} sessions</span>
      </div>
      {breaking ? (
        <div className="focus-break-status" role="status">
          <Coffee size={19} />
          <div>
            <strong>
              {remaining
                ? `Break · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                : "Break finished"}
            </strong>
            <small>Work paused · Start when ready</small>
          </div>
        </div>
      ) : (
        <>
          {(continuous >= 25 || checkDue) && (
            <p className="focus-coach-prompt" role="status">
              {continuous >= 50
                ? "Time for a break or a switch?"
                : "Still working? Check in when ready."}
            </p>
          )}
          <details>
            <summary>
              <Coffee size={15} />
              Take a break
            </summary>
            <div className="focus-break-fields">
              <label>
                Type
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="quiet">Quiet rest</option>
                  <option value="stretch">Stretch</option>
                  <option value="walk">Walk</option>
                  <option value="jog">Jog</option>
                </select>
              </label>
              <label>
                Minutes
                <input
                  aria-label="Break minutes"
                  type="number"
                  min={1}
                  max={120}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                className="focus-ui-primary"
                disabled={
                  busy ||
                  !Number.isInteger(minutes) ||
                  minutes < 1 ||
                  minutes > 120
                }
                onClick={() => onAction("break", { minutes, breakKind: kind })}
              >
                <Coffee size={15} />
                Start break
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
