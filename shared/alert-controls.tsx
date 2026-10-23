"use client";
import React, { useState, useEffect } from "react";
import { webApi, type Transport } from "./planning-hub";
export type DeviceAlerts = {
  status: () => Promise<any>;
  enable: () => Promise<any>;
  settings: () => Promise<any>;
  precise?: () => Promise<any>;
  test: (prefs: any) => Promise<any>;
};
export async function playTone(tone: string) {
  if (tone === "silent") return;
  const audio = new Audio(
    "/audio/" + (tone === "bell" ? "humeto_bell" : "humeto_chime") + ".wav",
  );
  await audio.play();
}
export const browserAlerts: DeviceAlerts = {
  status: async () => ({
    platform: "Browser",
    permission:
      typeof Notification === "undefined"
        ? "unavailable"
        : Notification.permission,
    notes:
      "Browser and OS controls decide sound, banners and vibration. Browser reminders require Humeto to remain open.",
  }),
  enable: async () => {
    if (typeof Notification === "undefined")
      throw Error("This browser does not support desktop notifications.");
    return Notification.requestPermission();
  },
  settings: async () => {
    throw Error(
      "Open the site controls beside the address bar → Notifications. Then check your operating system notification and Do Not Disturb settings.",
    );
  },
  test: async (p) => {
    if (typeof Notification === "undefined")
      throw Error("Desktop notifications are unavailable.");
    if (Notification.permission !== "granted") {
      const r = await Notification.requestPermission();
      if (r !== "granted")
        throw Error("Enable notifications in browser site settings.");
    }
    new Notification("Humeto test reminder", {
      body: "Your next small step is ready.",
      silent: true,
    });
    await playTone(p.tone);
    if (p.vibration && "vibrate" in navigator)
      navigator.vibrate([200, 100, 200]);
  },
};
export default function AlertControls({
  request = webApi,
  writable,
  device = browserAlerts,
  onSaved,
}: {
  request?: Transport;
  writable: boolean;
  device?: DeviceAlerts;
  onSaved?: () => Promise<void> | void;
}) {
  const [prefs, setPrefs] = useState<any>(null),
    [health, setHealth] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const [s, h] = await Promise.all([
      request("/api/workspace/scheduling"),
      device.status(),
    ]);
    setPrefs(s.preferences);
    setHealth(h);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [request, device]);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="planning-hub">
      <h2>Sounds, vibration & timing</h2>
      <p>
        Preferences sync to your account. Permission, volume, notification
        channels, battery restrictions and Do Not Disturb are controlled
        separately on each device.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {health && (
        <div className="planning-row">
          <div>
            <strong>
              {health.platform} · {health.permission}
            </strong>
            <small>
              {health.exact !== undefined
                ? "Precise alarms: " + health.exact + " · "
                : ""}
              {health.doNotDisturb
                ? "Do Not Disturb: " + health.doNotDisturb + " · "
                : ""}
              {health.ringer !== undefined
                ? "Ringer mode: " + health.ringer + " · "
                : ""}
              {health.notificationVolume !== undefined
                ? "Notification volume " + health.notificationVolume + " · "
                : ""}
              {health.batteryUnrestricted !== undefined
                ? "Battery unrestricted: " + health.batteryUnrestricted
                : ""}
            </small>
            <small>{health.notes}</small>
          </div>
        </div>
      )}
      {health?.channels?.length > 0 && (
        <details>
          <summary>Android notification channels</summary>
          {health.channels
            .filter((c: any) => c.id.startsWith("humeto-"))
            .map((c: any) => (
              <p key={c.id}>
                {c.name} · importance {c.importance} · vibration{" "}
                {String(c.vibration)} ·{" "}
                {c.sound ? "sound set" : "no channel sound"}
              </p>
            ))}
        </details>
      )}
      {prefs && (
        <form
          className="planning-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await request("/api/workspace/planning", {
                action: "alerts",
                revision: prefs.revision,
                tone: prefs.tone || "chime",
                vibration: !!prefs.vibration,
                precise: !!prefs.precise,
              });
              await onSaved?.();
              setNotice(
                "Alert preferences saved. Device channel settings may override them.",
              );
            });
          }}
        >
          <label>
            Tone
            <select
              aria-label="Reminder tone"
              value={prefs.tone || "chime"}
              onChange={(e) => setPrefs({ ...prefs, tone: e.target.value })}
            >
              <option value="chime">Gentle chime</option>
              <option value="bell">Clear bell</option>
              <option value="silent">Silent</option>
            </select>
          </label>
          <label className="planning-check">
            <input
              type="checkbox"
              checked={!!prefs.vibration}
              onChange={(e) =>
                setPrefs({ ...prefs, vibration: e.target.checked })
              }
            />
            Vibrate when supported
          </label>
          <label className="planning-check">
            <input
              type="checkbox"
              checked={!!prefs.precise}
              onChange={(e) =>
                setPrefs({ ...prefs, precise: e.target.checked })
              }
            />
            Prefer precise timing on Android (device permission required)
          </label>
          <button disabled={busy || !writable}>Save alert preferences</button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await device.test(prefs);
                setNotice(
                  "Test sent. Check the banner, sound and vibration on this device.",
                );
              })
            }
          >
            Send test alert
          </button>
        </form>
      )}
      <div className="planning-controls">
        <button disabled={busy} onClick={() => void run(() => device.enable())}>
          Enable notifications
        </button>
        <button
          disabled={busy}
          onClick={() => void run(() => device.settings())}
        >
          Device notification settings
        </button>
        {device.precise && (
          <button
            disabled={busy}
            onClick={() => void run(() => device.precise!())}
          >
            Precise alarm permission
          </button>
        )}
        <button disabled={busy} onClick={() => void run(async () => {})}>
          Recheck device settings
        </button>
      </div>
      <p>
        For a phone test: save your tone, send a test alert, then schedule a
        reminder a few minutes ahead and lock the phone. Check sound volume,
        notification channels, battery restrictions and Do Not Disturb if it is
        late or silent. Precise alarms require Android approval. These are
        reminders, not a replacement for a safety-critical alarm; Humeto does
        not bypass silent mode or Do Not Disturb.
      </p>
    </section>
  );
}
