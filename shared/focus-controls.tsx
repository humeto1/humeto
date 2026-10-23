import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import "./focus-controls.css";

export function HoldToComplete({
  onComplete,
  disabled = false,
}: {
  onComplete: () => void;
  disabled?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const consumed = useRef(false);
  const [holding, setHolding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (disabled) {
      cancel();
      setConfirm(false);
    }
  }, [disabled]);
  return (
    <div className="focus-completion">
      <button
        type="button"
        className={`focus-ui-button focus-complete ${holding ? "is-holding" : ""}`}
        disabled={disabled}
        title="Hold for one second to complete, or tap to confirm"
        aria-label="Mark task complete"
        onKeyDown={() => {
          consumed.current = false;
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 || disabled) return;
          consumed.current = false;
          origin.current = { x: e.clientX, y: e.clientY };
          cancel();
          setHolding(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          timer.current = setTimeout(() => {
            timer.current = null;
            consumed.current = true;
            setHolding(false);
            setConfirm(false);
            onComplete();
          }, 1000);
        }}
        onPointerMove={(e) => {
          if (
            timer.current &&
            Math.hypot(
              e.clientX - origin.current.x,
              e.clientY - origin.current.y,
            ) > 12
          ) {
            consumed.current = true;
            cancel();
          }
        }}
        onPointerUp={cancel}
        onPointerCancel={() => {
          consumed.current = true;
          cancel();
        }}
        onLostPointerCapture={cancel}
        onClick={() => {
          if (consumed.current) {
            consumed.current = false;
            return;
          }
          setConfirm(true);
        }}
      >
        <Check size={16} />
        <span>
          Complete<small>Hold 1 sec</small>
        </span>
      </button>
      {confirm && (
        <div
          className="focus-complete-confirm"
          role="group"
          aria-label="Confirm completion"
        >
          <span>Complete task?</span>
          <button
            type="button"
            className="focus-ui-button focus-ui-primary"
            disabled={disabled}
            onKeyDown={() => {
              consumed.current = false;
            }}
            onClick={() => {
              setConfirm(false);
              onComplete();
            }}
          >
            <Check size={14} />
            Confirm
          </button>
          <button
            type="button"
            className="focus-ui-button"
            onClick={() => setConfirm(false)}
            aria-label="Cancel completion"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
