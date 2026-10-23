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
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  if (!path.startsWith("/api/")) throw Error("Invalid API path");
  const verb = method || (body ? "POST" : "GET");
  let status: number, data: any;
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({
      url: SERVER + path,
      method: verb,
      headers: {
        Origin: SERVER,
        Accept: "application/json",
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
      headers: body ? { "Content-Type": "application/json" } : {},
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
export const timezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
