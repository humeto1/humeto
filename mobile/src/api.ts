import { getSavedToken } from "./session";
import {
  initOffline,
  cached,
  cacheResponse,
  cacheable,
  queueable,
  enqueue,
  flush,
  resolvedId,
  pending,
  lockOffline,
  setConnection,
  prepareLogin,
  clearOffline,
  syncStatus,
} from "./offline";
export { getSavedToken, saveToken, clearSavedToken } from "./session";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
const qaServer =
  import.meta.env.MODE === "qa"
    ? import.meta.env.VITE_HUMETO_QA_API
    : undefined;
if (
  import.meta.env.MODE === "qa" &&
  (!qaServer || !/^http:\/\/10\.0\.2\.2:\d+$/.test(qaServer))
)
  throw Error("Android QA requires an emulator-only API URL.");
export const SERVER: string = qaServer || "https://www.humeto.com";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function networkApi<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  if (!path.startsWith("/api/")) throw Error("Invalid API path");
  const verb = method || (body ? "POST" : "GET");
  const token = Capacitor.isNativePlatform() ? await getSavedToken() : null;
  const authHeaders: Record<string, string> = token
    ? { "x-humeto-session": token }
    : {};
  let status: number, data: any;
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({
      url: SERVER + path,
      method: verb,
      headers: {
        Origin: SERVER,
        Accept: "application/json",
        ...authHeaders,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { data: body } : {}),
      connectTimeout: 15000,
      readTimeout: 35000,
      responseType: "json",
    });
    status = r.status;
    data = r.data;
  } else {
    const r = await fetch(path, {
      method: verb,
      credentials: "include",
      headers: {
        ...authHeaders,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    status = r.status;
    data = await r.json();
  }
  if (status < 200 || status >= 300)
    throw new ApiError(
      data?.error || "Could not connect to Humeto. Please try again.",
      status,
    );
  return data;
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  await initOffline();
  const verb = method || (body ? "POST" : "GET");
  if (path === "/api/auth/logout") {
    if (await pending())
      throw Error(
        "Sync your pending changes before signing out. They are saved on this device.",
      );
    const result = await networkApi<T>(path, body, verb);
    await clearOffline();
    return result;
  }
  if (path.startsWith("/api/auth/")) {
    const result = await networkApi<T>(path, body, verb);
    if (path === "/api/auth/login" || path === "/api/auth/demo")
      await prepareLogin();
    return result;
  }
  if (queueable(path, verb, body)) {
    const result = await enqueue(path, body, verb);
    if (navigator.onLine && !syncStatus().offline) await flush(networkApi);
    return { ...result, id: await resolvedId(result.id) } as T;
  }
  if (verb === "GET" && cacheable(path)) {
    if (navigator.onLine) {
      if (path === "/api/mobile") {
        try {
          // Establish the authenticated account before replaying any queued work.
          const verified = await networkApi<T>(path);
          setConnection(true);
          await cacheResponse(path, verified);
          const hadPending = await pending();
          await flush(networkApi);
          if (await pending()) return (await cached(path)) as T;
          const fresh = hadPending ? await networkApi<T>(path) : verified;
          await cacheResponse(path, fresh);
          return fresh;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await lockOffline();
            throw error;
          }
          if (error instanceof ApiError && error.status < 500) throw error;
          setConnection(false);
        }
      }
      if (!syncStatus().offline) await flush(networkApi);
      if (!syncStatus().offline && !(await pending())) {
        try {
          const result = await networkApi<T>(path);
          setConnection(true);
          await cacheResponse(path, result);
          if (await pending()) return (await cached(path)) || result;
          return result;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await lockOffline();
            throw error;
          }
          if (error instanceof ApiError && error.status < 500) throw error;
          setConnection(false);
        }
      }
    } else setConnection(false);
    const saved = await cached(path);
    if (saved !== undefined) {
      if (Capacitor.getPlatform() === "android" && !(await getSavedToken()))
        throw new ApiError("Sign in to open this saved workspace.", 401);
      return saved as T;
    }
    throw Error(
      "This information has not been downloaded yet. Connect once to make it available offline.",
    );
  }
  if (!navigator.onLine)
    throw Error(
      "This feature needs internet. Your saved tasks and focus timer are available offline.",
    );
  try {
    return await networkApi<T>(path, body, verb);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await lockOffline();
      throw error;
    }
    if (!(error instanceof ApiError))
      throw Error(
        "Unable to connect. Your saved tasks and pending changes are safe on this device.",
      );
    throw error;
  }
}

export const timezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
