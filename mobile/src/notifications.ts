import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
export async function enableNotifications() {
  if (!Capacitor.isNativePlatform()) return false;
  const permission = await LocalNotifications.requestPermissions();
  return permission.display === "granted";
}
export async function syncNotifications(
  reminders: { id: string; title: string; remind_at: string }[],
  focus?: {
    id: string;
    title: string;
    check_in_at: string;
    ended_at?: string;
    state: string;
  } | null,
) {
  if (!Capacitor.isNativePlatform()) return;
  if ((await LocalNotifications.checkPermissions()).display !== "granted")
    return;
  const desired = [
    ...reminders.map((r) => ({
      key: "reminder:" + r.id,
      title: "A little nudge",
      body: r.title,
      at: new Date(r.remind_at),
    })),
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
    .filter((r) => r.at.getTime() > Date.now())
    .slice(0, 60);
  function id(key: string) {
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h >>> 0) % 2000000000) + 1;
  }
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length)
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    });
  if (desired.length)
    await LocalNotifications.schedule({
      notifications: desired.map((r) => ({
        id: id(r.key),
        title: r.title,
        body: r.body,
        isExactNotification: false,
        schedule: { at: r.at, allowWhileIdle: true },
      })),
    });
}
export async function clearNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.removeAllDeliveredNotifications();
  const p = await LocalNotifications.getPending();
  if (p.notifications.length)
    await LocalNotifications.cancel({
      notifications: p.notifications.map((n) => ({ id: n.id })),
    });
}
