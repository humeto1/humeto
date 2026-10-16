import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db } from "./db";
import type { Actor } from "./types";
const cookieName = "humeto_session";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export async function actor(): Promise<Actor | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id,u.name,u.email,m.tenant_id AS tenantId,t.name AS tenantName,t.type AS workspaceType,m.role,m.person_id AS personId FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id AND m.tenant_id=s.tenant_id JOIN tenants t ON t.id=m.tenant_id WHERE s.token_hash=? AND s.expires_at>?`,
    )
    .get(digest(token), Date.now());
  return row ? ({ ...row } as Actor) : null;
}
export async function requireActor() {
  const a = await actor();
  if (!a) redirect("/login");
  return a;
}
export async function newSession(userId: string, tenantId: string) {
  const token = randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
  db()
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES(?,?,?,?)",
    )
    .run(digest(token), userId, tenantId, Date.now() + 1000 * 60 * 60 * 12);
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.HUMETO_HTTPS === "true",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}
export async function endSession() {
  const jar = await cookies(),
    token = jar.get(cookieName)?.value;
  if (token)
    db().prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
  jar.delete(cookieName);
}
export function verifyPassword(password: string, stored: string) {
  try {
    const [salt, hash] = stored.split(":");
    const actual = scryptSync(password, salt, 64),
      expected = Buffer.from(hash, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
export async function demoAllowed() {
  const host = (await headers()).get("host") || "";
  return (
    process.env.HUMETO_LOCAL_DEMO === "true" &&
    /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
  );
}
export function isStaff(a: Actor) {
  return ["owner", "consultant"].includes(a.role);
}
export function canSeePerson(a: Actor, personId: string) {
  if (a.role === "platform_admin") return false;
  if (a.role === "student" && a.personId !== personId) return false;
  return !!db()
    .prepare("SELECT id FROM people WHERE id=? AND tenant_id=?")
    .get(personId, a.tenantId);
}
export function canMutate(a: Actor) {
  if (!isStaff(a)) return false;
  const s = db()
    .prepare("SELECT status,expires_at FROM subscriptions WHERE tenant_id=?")
    .get(a.tenantId) as { status: string; expires_at: string } | undefined;
  return (
    !!s &&
    ["active", "trial", "grace"].includes(s.status) &&
    (!s.expires_at || s.expires_at >= new Date().toISOString().slice(0, 10))
  );
}
export function scope(a: Actor, column = "person_id") {
  return a.role === "student"
    ? { sql: ` AND ${column}=?`, params: [a.personId || ""] }
    : a.role === "platform_admin"
      ? { sql: " AND 0=1", params: [] }
      : { sql: "", params: [] };
}
export function ensureOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || new URL(origin).host !== host) throw new Error("ORIGIN");
}
