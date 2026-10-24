export type Transport = (
  path: string,
  body?: any,
  method?: string,
) => Promise<any>;
export const webApi: Transport = async (path, body, method) => {
  const r = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error || "Unable to save.");
  return v;
};
