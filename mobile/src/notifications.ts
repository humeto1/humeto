import { api } from "./api";
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
  quietChannel: (options: {
    id: string;
    name: string;
    vibration: boolean;
  }) => Promise<void>;
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
  if (Capacitor.getPlatform() === "android" && tone === "silent") {
    const quietId =
      "humeto-quiet-" + (p.vibration ? "vibrate" : "still") + "-v2";
    await Device.quietChannel({
      id: quietId,
      name: p.vibration ? "Gentle task nudges" : "Quiet reminders",
      vibration: !!p.vibration,
    });
    return quietId;
  }
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
  let device = localStorage.getItem("humeto-native-notification-device");
  if (!device) {
    device = crypto.randomUUID();
    localStorage.setItem("humeto-native-notification-device", device);
  }
  if ((await LocalNotifications.checkPermissions()).display !== "granted")
    return;
  const plan = await api("/api/notification-plan", {
    deviceId: device,
    platform: "native",
    activeProjectId: document.hidden
      ? undefined
      : document.documentElement.dataset.humetoActiveProject,
  });
  const pending = await LocalNotifications.getPending();
  const cancellable = pending.notifications.filter((n) => n.id !== 2000000001);
  if (cancellable.length)
    await LocalNotifications.cancel({
      notifications: cancellable.map((n) => ({ id: n.id })),
    });
  if (!plan.events.length) return;
  const p = plan.preferences;
  const channels = {
    audible: await channel({ ...p, tone: p.tone || "chime" }),
    gentle: await channel({ ...p, tone: "silent" }),
    silent: await channel({ ...p, tone: "silent", vibration: false }),
  };
  const exact =
    Capacitor.getPlatform() === "android" &&
    (await LocalNotifications.checkExactNotificationSetting()).exact_alarm ===
      "granted";
  const nativeId = (key: string) => {
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h >>> 0) % 2000000000) + 1;
  };
  await LocalNotifications.schedule({
    notifications: plan.events
      .filter((e: any) => Date.parse(e.at) > Date.now())
      .map((e: any) => ({
        id: nativeId(e.key),
        title: e.kind === "focus" ? "Humeto · Focus" : e.title,
        body: e.body || e.title,
        channelId: channels[e.tier as keyof typeof channels],
        isExactNotification: !!p.precise && exact,
        schedule: { at: new Date(e.at), allowWhileIdle: true },
      })),
  });
}

export async function clearNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  const device = localStorage.getItem("humeto-native-notification-device");
  if (device)
    try {
      await api("/api/notification-plan", {
        deviceId: device,
        platform: "native",
        release: true,
      });
    } catch {}
  await LocalNotifications.removeAllDeliveredNotifications();
  const p = await LocalNotifications.getPending();
  if (p.notifications.length)
    await LocalNotifications.cancel({
      notifications: p.notifications.map((n) => ({ id: n.id })),
    });
  localStorage.removeItem("humeto-device-alerts-seen");
}
