import { useEffect, useRef, useState } from "react";
import { Shuffle, Wind } from "lucide-react";
import "./focus-controls.css";

export function RandomTaskPicker({
  tasks,
  onChoose,
}: {
  tasks: { id: string; title: string; display_title?: string }[];
  onChoose: (id: string) => void;
}) {
  const [rolling, setRolling] = useState(false);
  const [candidate, setCandidate] = useState<(typeof tasks)[number] | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  function spin() {
    if (!tasks.length || rolling) return;
    setRolling(true);
    let ticks = 0;
    timer.current = setInterval(() => {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      setCandidate(tasks[random[0] % tasks.length]);
      if (
        ++ticks >=
        (matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 12)
      ) {
        clearInterval(timer.current!);
        timer.current = null;
        setRolling(false);
      }
    }, 90);
  }
  const available = candidate && tasks.some((t) => t.id === candidate.id);
  return (
    <section
      aria-label="Random focus task"
      className="focus-random"
      style={{ padding: 10, border: 0, background: "transparent" }}
    >
      <button
        type="button"
        aria-label="Pick a random task"
        disabled={!tasks.length || rolling}
        onClick={spin}
      >
        <Shuffle size={14} />
        {rolling ? "Shuffling…" : "Shuffle"}
      </button>
      {available && (
        <>
          <p aria-live="polite">{candidate.display_title || candidate.title}</p>
          <button
            type="button"
            disabled={rolling}
            onClick={() => onChoose(candidate.id)}
          >
            Choose this task
          </button>
        </>
      )}
    </section>
  );
}

export function FocusTransition({ onReady }: { onReady: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (remaining === null || remaining === 0) return;
    const timer = setTimeout(
      () => setRemaining((n) => (n === null ? null : Math.max(0, n - 1))),
      1000,
    );
    return () => clearTimeout(timer);
  }, [remaining]);
  return (
    <details className="focus-transition" aria-label="Gentle task transition">
      <summary>
        <Wind size={15} />
        Reset & switch
      </summary>
      <div>
        <p>Look away. Breathe. Ready for the next task?</p>
        {remaining === null ? (
          <button type="button" onClick={() => setRemaining(10)}>
            Take a 10-second reset
          </button>
        ) : (
          <p role="timer">
            {remaining > 0
              ? `${remaining} seconds · a moment to reset`
              : "Ready when you are."}
          </p>
        )}
        <button type="button" onClick={onReady}>
          Select task
        </button>
      </div>
    </details>
  );
}
