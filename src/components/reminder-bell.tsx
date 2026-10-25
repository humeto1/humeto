"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { playTone } from "../../shared/alert-controls";
export default function ReminderBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true,
      polling = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let device = localStorage.getItem("humeto-web-notification-device");
    if (!device) {
      device = crypto.randomUUID();
      localStorage.setItem("humeto-web-notification-device", device);
    }
    const refresh = async () => {
      if (document.hidden || polling) return;
      polling = true;
      try {
        const summary = await fetch("/api/workspace/scheduling", {
          cache: "no-store",
        });
        if (summary.ok) {
          const s = await summary.json();
          if (live)
            setCount(s.reminders?.filter((r: any) => r.due).length || 0);
        }
        if (
          typeof Notification === "undefined" ||
          Notification.permission !== "granted"
        )
          return;
        const response = await fetch("/api/notification-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: device,
            platform: "web",
            activeProjectId:
              document.documentElement.dataset.humetoActiveProject,
          }),
        });
        if (!response.ok) return;
        const plan = await response.json();
        if (!live) return;
        const valid = new Set(plan.events.map((e: any) => e.key));
        for (const [key, timer] of timers)
          if (!valid.has(key)) {
            clearTimeout(timer);
            timers.delete(key);
          }
        for (const e of plan.events) {
          const store = "humeto-alert:" + plan.actorKey + ":" + e.key;
          if (localStorage.getItem(store) || timers.has(e.key)) continue;
          const delay = Math.max(0, Date.parse(e.at) - Date.now());
          if (delay > 60000) continue;
          timers.set(
            e.key,
            setTimeout(() => {
              timers.delete(e.key);
              if (!live || localStorage.getItem(store)) return;
              localStorage.setItem(store, "sent");
              new Notification(
                e.kind === "focus"
                  ? "Humeto · Focus"
                  : "Humeto · Task reminder",
                { body: e.body || e.title, tag: e.key, silent: true },
              );
              if (
                e.tier !== "silent" &&
                plan.preferences.vibration &&
                "vibrate" in navigator
              )
                navigator.vibrate(100);
              if (e.tier === "audible")
                void playTone(plan.preferences.tone || "chime").catch(() => {});
            }, delay),
          );
        }
      } catch {
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("humeto-reminders", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      for (const t of timers.values()) clearTimeout(t);
      window.removeEventListener("humeto-reminders", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <a
      className="notification-button"
      href="/workspace/tasks#task-followups"
      aria-label={`Task reminders${count ? `: ${count} due` : ""}`}
      title="Task reminders"
    >
      <Bell size={18} />
      {count > 0 && <span />}
    </a>
  );
}
