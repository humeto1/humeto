"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
export default function ReminderBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.hidden) return;
      fetch("/api/workspace/scheduling?summary=1", {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (live && d) setCount(d.readyCount);
        })
        .catch(() => {});
    };
    refresh();
    const poll = window.setInterval(refresh, 15000);
    window.addEventListener("humeto-reminders", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      window.clearInterval(poll);
      window.removeEventListener("humeto-reminders", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <a
      className="notification-button"
      href="/workspace/tasks#task-followups"
      aria-label={`Task reminders${count ? `: ${count} due` : ""}`}
      title={count ? `${count} reminders due` : "Task reminders"}
    >
      <Bell size={18} />
      {count > 0 && <span />}
    </a>
  );
}
