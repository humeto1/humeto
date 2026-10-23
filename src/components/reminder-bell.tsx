"use client";
import { playTone } from "../../shared/alert-controls";
import { localDay } from "@/lib/scheduling-clock.mjs";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
export default function ReminderBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.hidden) return;
      fetch("/api/workspace/scheduling", {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (live && d) {
            setCount(d.reminders?.filter((r: any) => r.ready).length || 0);
            if (
              typeof Notification === "undefined" ||
              Notification.permission !== "granted" ||
              !d.preferences?.enabled ||
              d.quietUntil
            )
              return;
            const store =
              "humeto-browser-nudges:" +
              d.actorKey +
              ":" +
              localDay(new Date(), d.preferences.timezone);
            let sent: string[] = [];
            try {
              sent = JSON.parse(localStorage.getItem(store) || "[]");
            } catch {}
            for (const r of d.reminders || []) {
              const key = r.id + ":" + r.remind_at;
              if (
                !r.due ||
                sent.includes(key) ||
                sent.length >= d.preferences.daily_limit
              )
                continue;
              new Notification("Humeto · Task reminder", {
                body: r.title,
                tag: r.id,
                silent: true,
              });
              if (d.preferences.vibration && "vibrate" in navigator)
                navigator.vibrate([200, 100, 200]);
              void playTone(d.preferences.tone || "chime").catch(() => {});
              sent.push(key);
              localStorage.setItem(store, JSON.stringify(sent));
            }
          }
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
