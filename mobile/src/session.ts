import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor, registerPlugin } from "@capacitor/core";
const Device = registerPlugin<{
  readSession: () => Promise<{ token?: string }>;
  saveSession: (options: { token: string }) => Promise<void>;
  clearSession: () => Promise<void>;
}>("HumetoDevice");
let current: string | null = null;
let loaded = false;
const android = () => Capacitor.getPlatform() === "android";
export async function getSavedToken() {
  if (!loaded) {
    if (android()) current = (await Device.readSession()).token || null;
    loaded = true;
    // Remove the previous draft's plaintext storage. Passwords are never saved.
    localStorage.removeItem("humeto-auth-token");
  }
  return current;
}
export async function saveToken(token: string, remember = true) {
  if (android()) {
    if (remember) await Device.saveSession({ token });
    else await Device.clearSession();
  }
  current = token;
  loaded = true;
  localStorage.removeItem("humeto-auth-token");
}
export async function clearSavedToken() {
  if (android()) await Device.clearSession();
  if (Capacitor.isNativePlatform()) {
    try {
      const exports = await Filesystem.readdir({
        path: "humeto-share",
        directory: Directory.Cache,
      });
      await Promise.all(
        exports.files.map((file) =>
          Filesystem.deleteFile({
            path: "humeto-share/" + file.name,
            directory: Directory.Cache,
          }).catch(() => {}),
        ),
      );
    } catch {
      /* No shared exports on this device. */
    }
  }
  current = null;
  loaded = true;
  localStorage.removeItem("humeto-auth-token");
}
