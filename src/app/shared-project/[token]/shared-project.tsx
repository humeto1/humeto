"use client";
import { ProjectCollaboration } from "../../../../shared/project-collaboration";
async function request(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  return data;
}
export default function SharedTask({ token }: { token: string }) {
  return <ProjectCollaboration token={token} request={request} />;
}
