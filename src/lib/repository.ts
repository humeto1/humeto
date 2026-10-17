import "server-only";
import { db } from "./db";
import { sections } from "./sections";
import { scope, canSeePerson } from "./auth";
import type {
  Actor,
  Person,
  Application,
  Task,
  Intake,
  DocumentRow,
} from "./types";
export function people(a: Actor) {
  const s = scope(a, "id");
  return db()
    .prepare(
      "SELECT * FROM people WHERE tenant_id=?" +
        s.sql +
        " ORDER BY created_at DESC,name",
    )
    .all(a.tenantId, ...s.params) as unknown as Person[];
}
export function person(a: Actor, id: string) {
  if (!canSeePerson(a, id)) return null;
  return {
    ...db()
      .prepare("SELECT * FROM people WHERE id=? AND tenant_id=?")
      .get(id, a.tenantId),
  } as Person;
}
export function intake(a: Actor, id: string) {
  if (!canSeePerson(a, id)) return [];
  return db()
    .prepare("SELECT * FROM intake WHERE tenant_id=? AND person_id=?")
    .all(a.tenantId, id)
    .map((r) => ({
      ...r,
      data: JSON.parse(String(r.data)),
    })) as unknown as Intake[];
}
export function applications(a: Actor) {
  const s = scope(a, "a.person_id");
  return db()
    .prepare(
      "SELECT a.*,p.name AS person_name FROM applications a JOIN people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=?" +
        s.sql +
        " ORDER BY a.created_at DESC",
    )
    .all(a.tenantId, ...s.params) as unknown as Application[];
}
export function tasks(a: Actor) {
  const s = scope(a, "t.person_id");
  return db()
    .prepare(
      "SELECT t.*,p.name AS person_name FROM tasks t LEFT JOIN people p ON p.id=t.person_id AND p.tenant_id=t.tenant_id WHERE t.tenant_id=?" +
        s.sql +
        " ORDER BY t.created_at DESC",
    )
    .all(a.tenantId, ...s.params) as unknown as Task[];
}
export function documents(a: Actor) {
  const s = scope(a, "d.person_id");
  const list = db()
    .prepare(
      "SELECT d.*,p.name AS person_name,v.original_name,v.mime_type,v.byte_size FROM documents d JOIN people p ON p.id=d.person_id AND p.tenant_id=d.tenant_id JOIN document_versions v ON v.document_id=d.id AND v.tenant_id=d.tenant_id AND v.version=d.current_version WHERE d.tenant_id=?" +
        s.sql +
        " ORDER BY d.created_at DESC",
    )
    .all(a.tenantId, ...s.params) as unknown as DocumentRow[];
  return list.filter(
    (d) =>
      ["owner", "student"].includes(a.role) ||
      !sections.find((s) => s.key === d.section_key)?.restricted,
  );
}

export function requests(a: Actor) {
  const s = scope(a, "r.person_id");
  return db()
    .prepare(
      "SELECT r.*,p.name AS person_name FROM requests r JOIN people p ON p.id=r.person_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=?" +
        s.sql +
        " ORDER BY r.created_at DESC",
    )
    .all(a.tenantId, ...s.params);
}
export function activity(a: Actor) {
  if (a.role === "student" || a.role === "platform_admin") return [];
  return db()
    .prepare(
      "SELECT a.*,u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 30",
    )
    .all(a.tenantId);
}
export function subscription(a: Actor) {
  return db()
    .prepare("SELECT * FROM subscriptions WHERE tenant_id=?")
    .get(a.tenantId);
}
export function bootstrap(a: Actor) {
  return {
    leads: ["owner", "consultant"].includes(a.role)
      ? db()
          .prepare(
            "SELECT * FROM leads WHERE tenant_id=? ORDER BY created_at DESC,rowid DESC",
          )
          .all(a.tenantId)
          .map((r) => ({ ...r, extras: JSON.parse(String(r.extras)) }))
      : [],
    finance:
      a.role === "platform_admin" || a.role === "student"
        ? []
        : db()
            .prepare(
              "SELECT f.*,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.person_id=f.person_id AND p.tenant_id=f.tenant_id),0) AS paid FROM case_finance f WHERE f.tenant_id=?",
            )
            .all(a.tenantId)
            .map((r) => ({
              ...r,
              pending: Math.max(0, Number(r.expected_fee) - Number(r.paid)),
            })),
    people: people(a),
    applications: applications(a),
    tasks: tasks(a),
    documents: documents(a),
    requests: requests(a),
    activity: activity(a),
    subscription: subscription(a),
  };
}
