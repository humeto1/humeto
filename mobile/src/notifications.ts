import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { browserAlerts, type DeviceAlerts } from "../../shared/alert-controls";
import {
  quietUntil,
  nextDay,
  scheduledAt,
} from "../../src/lib/scheduling-clock.mjs";
const Device = registerPlugin<{
  status: () => Promise<any>;
  settings: () => Promise<void>;
}>("HumetoDevice");
type Prefs = {
  enabled?: boolean;
  tone?: string;
  vibration?: boolean;
  precise?: boolean;
  quiet_enabled?: boolean;
  quiet_start?: string;
  quiet_end?: string;
  timezone?: string;
};
export async function enableNotifications() {
  if (!Capacitor.isNativePlatform())
    return (await browserAlerts.enable()) === "granted";
  return (await LocalNotifications.requestPermissions()).display === "granted";
}
async function channel(p: Prefs) {
  const tone = p.tone || "chime",
    id = "humeto-" + tone + "-" + (p.vibration ? "vibrate" : "still") + "-v1";
  if (Capacitor.getPlatform() === "android")
    await LocalNotifications.createChannel({
      id,
      name: "Humeto " + tone + (p.vibration ? " + vibration" : ""),
      description: "Task reminders and focus check-ins",
      sound: tone === "silent" ? undefined : "humeto_" + tone + ".wav",
      importance: tone === "silent" ? 3 : 4,
      visibility: 0,
      vibration: !!p.vibration,
    });
  return id;
}
export const deviceAlerts: DeviceAlerts = {
  status: async () => {
    if (!Capacitor.isNativePlatform()) return browserAlerts.status();
    const p = await LocalNotifications.checkPermissions();
    if (Capacitor.getPlatform() === "android")
      return {
        ...(await Device.status()),
        channels: (await LocalNotifications.listChannels()).channels,
        exact: (await LocalNotifications.checkExactNotificationSetting())
          .exact_alarm,
      };
    return { platform: "iOS", permission: p.display };
  },
  enable: enableNotifications,
  settings: async () => {
    if (Capacitor.getPlatform() === "android") return Device.settings();
    return browserAlerts.settings();
  },
  precise: async () => {
    if (Capacitor.getPlatform() !== "android")
      throw Error("Precise-alarm permission is an Android setting.");
    return LocalNotifications.changeExactNotificationSetting();
  },
  test: async (p) => {
    if (!Capacitor.isNativePlatform()) return browserAlerts.test(p);
    if (!(await enableNotifications()))
      throw Error(
        "Notifications are blocked. Open device notification settings.",
      );
    const channelId = await channel(p);
    const exact =
      Capacitor.getPlatform() === "android" &&
      (await LocalNotifications.checkExactNotificationSetting()).exact_alarm ===
        "granted";
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 2000000001,
          title: "Humeto test reminder",
          body: "Check your sound, banner and vibration.",
          channelId,
          isExactNotification: !!p.precise && exact,
          schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true },
        },
      ],
    });
  },
};
export async function syncNotifications(
  reminders: { id: string; title: string; remind_at: string }[],
  focus?: {
    id: string;
    title: string;
    check_in_at: string;
    break_until?: string;
    ended_at?: string;
    state: string;
  } | null,
  prefs: Prefs = { enabled: true, tone: "chime", vibration: true },
  series: any[] = [],
) {
  if (!Capacitor.isNativePlatform()) return;
  const pending = await LocalNotifications.getPending();
  if ((await LocalNotifications.checkPermissions()).display !== "granted")
    return;
  const seenKey = "humeto-device-alerts-seen";
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(seenKey) || "[]");
  } catch {}
  const protectedIds = new Set<number>();
  function nativeId(key: string) {
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h >>> 0) % 2000000000) + 1;
  }
  const futureRoutines: {
    key: string;
    title: string;
    body: string;
    at: Date;
  }[] = [];
  for (const r of series.filter(
    (r) => r.track_occurrences && r.status === "active",
  )) {
    let day = r.next_day;
    for (let i = 0; i < 8; i++) {
      if (r.end_day && day > r.end_day) break;
      const at = new Date(scheduledAt(day, r.local_time, r.timezone));
      if (at.getTime() > Date.now())
        futureRoutines.push({
          key: "routine:" + r.id + ":" + day,
          title: "Humeto · " + r.routine_kind,
          body: r.title,
          at,
        });
      day = nextDay(
        day,
        r.frequency,
        r.interval_count,
        Number(r.first_day.slice(8)),
      );
    }
  }
  const desired = [
    ...futureRoutines,
    ...reminders.map((r) => ({
      key: "reminder:" + r.id,
      title: "A little nudge",
      body: r.title,
      at: new Date(r.remind_at),
    })),
    ...(focus &&
    !focus.ended_at &&
    focus.state !== "running" &&
    focus.break_until
      ? [
          {
            key: "break:" + focus.id,
            title: "Break finished. Ready to return?",
            body: focus.title,
            at: new Date(focus.break_until),
          },
        ]
      : []),
    ...(focus &&
    !focus.ended_at &&
    focus.state === "running" &&
    focus.check_in_at
      ? [
          {
            key: "focus:" + focus.id,
            title: "How is your focus task going?",
            body: focus.title,
            at: new Date(focus.check_in_at),
          },
        ]
      : []),
  ]
    .sort(
      (a, b) =>
        Number(!/^(focus|break):/.test(a.key)) -
          Number(!/^(focus|break):/.test(b.key)) ||
        a.at.getTime() - b.at.getTime(),
    )
    .filter((r) => Number.isFinite(r.at.getTime()))
    .filter((r) => prefs.enabled !== false)
    .map((r) => {
      const due = r.at.getTime() <= Date.now();
      const stamp = r.key + ":" + r.at.toISOString();
      if (due && seen.includes(stamp)) {
        if (pending.notifications.some((n) => n.id === nativeId(r.key)))
          protectedIds.add(nativeId(r.key));
        return null;
      }
      let at = due ? new Date(Date.now() + 5000) : r.at;
      if (prefs.quiet_enabled && prefs.timezone) {
        const until = quietUntil(at, {
          ...prefs,
          quiet_start: prefs.quiet_start || "22:00",
          quiet_end: prefs.quiet_end || "08:00",
        });
        if (until) at = new Date(until);
      }
      return { ...r, at, stamp, due };
    })
    .filter(Boolean)
    .slice(0, 60) as {
    key: string;
    title: string;
    body: string;
    at: Date;
    stamp: string;
    due: boolean;
  }[];
  // Preserve a manually requested diagnostic test while reconciling real reminders.
  const cancellable = pending.notifications.filter(
    (n) => n.id !== 2000000001 && !protectedIds.has(n.id),
  );
  if (cancellable.length)
    await LocalNotifications.cancel({
      notifications: cancellable.map((n) => ({ id: n.id })),
    });
  if (!desired.length) return;
  const channelId = await channel(prefs),
    exact =
      Capacitor.getPlatform() === "android" &&
      (await LocalNotifications.checkExactNotificationSetting()).exact_alarm ===
        "granted";
  function id(key: string) {
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h >>> 0) % 2000000000) + 1;
  }
  await LocalNotifications.schedule({
    notifications: desired.map((r) => ({
      id: id(r.key),
      title: r.title,
      body: r.body,
      channelId,
      isExactNotification: !!prefs.precise && exact,
      schedule: { at: r.at, allowWhileIdle: true },
    })),
  });
  for (const r of desired) if (r.due) seen.push(r.stamp);
  localStorage.setItem(seenKey, JSON.stringify(seen.slice(-300)));
}
export async function clearNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.removeAllDeliveredNotifications();
  const p = await LocalNotifications.getPending();
  if (p.notifications.length)
    await LocalNotifications.cancel({
      notifications: p.notifications.map((n) => ({ id: n.id })),
    });
  localStorage.removeItem("humeto-device-alerts-seen");
}
