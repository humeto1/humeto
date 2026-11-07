"use client";
import { useEffect, useState } from "react";
import { webApi, type Transport } from "./transport";
export function FocusAttendance({
  request = webApi,
  onUpdate,
}: {
  request?: Transport;
  onUpdate?: () => void;
}) {
  const [active, setActive] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const d = await request("/api/workspace/focus");
        if (alive) setActive(d.active?.attendance_prompt_at ? d.active : null);
      } catch {}
    };
    void load();
    const t = setInterval(load, 10000);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, [request]);
  useEffect(() => {
    if (active?.id) navigator.vibrate?.([150, 100, 150]);
  }, [active?.id, active?.attendance_prompt_at]);
  if (!active) return null;
  return (
    <aside className="focus-attendance" role="alert">
      <strong>Still working on {active.title}?</strong>
      <button
        type="button"
        disabled={busy}
        onClick={() => void action("confirm")}
      >
        Still working
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void action("pause")}
      >
        Pause
      </button>
      {error && <span>{error}</span>}
    </aside>
  );
  async function action(action: string) {
    setBusy(true);
    try {
      await request("/api/workspace/focus", {
        action,
        sessionId: active.id,
        revision: active.revision,
        taskRevision: active.task_revision,
      });
      setActive(null);
      onUpdate?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
}
