"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
export default function ReminderBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.hidden) return;
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
      fetch("/api/agent?summary=1&timezone=" + encodeURIComponent(timezone), {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (live && d)
            setCount(d.reminders.filter((r: { due: boolean }) => r.due).length);
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
      href="/workspace/assistant#reminders"
      aria-label={`Task reminders${count ? `: ${count} due` : ""}`}
      title={count ? `${count} reminders due` : "Task reminders"}
    >
      <Bell size={18} />
      {count > 0 && <span />}
    </a>
  );
}
