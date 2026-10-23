import { runTaskScheduler } from "./task-scheduler.mjs";
import { featureAllowed } from "./feature-access.mjs";
import "server-only";
import { pipelineSettings } from "./pipeline-settings";
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
export async function people(a: Actor) {
  const s = scope(a, "id");
  return (await db()
    .prepare(
      "SELECT * FROM people WHERE tenant_id=?" +
        s.sql +
        " ORDER BY created_at DESC,name",
    )
    .all(a.tenantId, ...s.params)) as unknown as Person[];
}
export async function person(a: Actor, id: string) {
  if (!(await canSeePerson(a, id))) return null;
  return {
    ...(await db()
      .prepare("SELECT * FROM people WHERE id=? AND tenant_id=?")
      .get(id, a.tenantId)),
  } as Person;
}
export async function intake(a: Actor, id: string) {
  if (!(await canSeePerson(a, id))) return [];
  return (
    await db()
      .prepare("SELECT * FROM intake WHERE tenant_id=? AND person_id=?")
      .all(a.tenantId, id)
  ).map((r) => ({
    ...r,
    data: JSON.parse(String(r.data)),
  })) as unknown as Intake[];
}
export async function applications(a: Actor) {
  const s = scope(a, "a.person_id");
  return (await db()
    .prepare(
      "SELECT a.*,p.name AS person_name FROM applications a JOIN people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=?" +
        s.sql +
        " ORDER BY a.created_at DESC",
    )
    .all(a.tenantId, ...s.params)) as unknown as Application[];
}
export async function tasks(a: Actor) {
  const s = scope(a, "t.person_id");
  return (
    await db()
      .prepare(
        "SELECT t.*,COALESCE((SELECT json_agg(json_build_object('id',g.id,'title',g.title) ORDER BY g.id) FROM task_goals l JOIN goals g ON g.id=l.goal_id AND g.tenant_id=l.tenant_id WHERE l.tenant_id=t.tenant_id AND l.task_id=t.id),'[]'::json) AS goals,pf.currency AS project_target_currency,pf.basis AS project_target_basis,pf.upfront AS project_target_upfront,pf.completion AS project_target_completion,pf.conditional AS project_target_conditional,(SELECT o.series_id FROM task_occurrences o WHERE o.task_id=t.id LIMIT 1) AS routine_id,(SELECT CASE WHEN o.canonical_title=t.title THEN o.display_title ELSE '' END FROM task_occurrences o WHERE o.task_id=t.id LIMIT 1) AS display_title,EXISTS(SELECT 1 FROM task_recurrences r WHERE r.template_task_id=t.id AND r.track_occurrences=TRUE) AS routine_template,p.name AS person_name,(SELECT title FROM projects x WHERE x.id=t.project_id AND x.tenant_id=t.tenant_id) AS project_title FROM tasks t LEFT JOIN people p ON p.id=t.person_id AND p.tenant_id=t.tenant_id LEFT JOIN plan_financial_targets pf ON pf.tenant_id=t.tenant_id AND pf.entity_type='project' AND pf.entity_id=t.project_id WHERE t.tenant_id=? AND NOT EXISTS(SELECT 1 FROM task_recurrences r WHERE r.template_task_id=t.id AND r.track_occurrences=TRUE)" +
          s.sql +
          " ORDER BY t.created_at DESC",
      )
      .all(a.tenantId, ...s.params)
  ).map((t) => ({
    ...t,
    ...(!["owner", "consultant"].includes(a.role)
      ? {
          project_id: "",
          project_title: "",
          last_actor_id: "",
          project_target_currency: undefined,
          project_target_basis: undefined,
          project_target_upfront: undefined,
          project_target_completion: undefined,
          project_target_conditional: undefined,
        }
      : {}),
    goals: !["owner", "consultant"].includes(a.role) ? [] : t.goals,
  })) as unknown as Task[];
}
export async function documents(a: Actor) {
  const s = scope(a, "d.person_id");
  const list = (await db()
    .prepare(
      "SELECT d.*,p.name AS person_name,v.original_name,v.mime_type,v.byte_size FROM documents d JOIN people p ON p.id=d.person_id AND p.tenant_id=d.tenant_id JOIN document_versions v ON v.document_id=d.id AND v.tenant_id=d.tenant_id AND v.version=d.current_version WHERE d.tenant_id=?" +
        s.sql +
        " ORDER BY d.created_at DESC",
    )
    .all(a.tenantId, ...s.params)) as unknown as DocumentRow[];
  return list.filter(
    (d) =>
      ["owner", "student"].includes(a.role) ||
      !sections.find((s) => s.key === d.section_key)?.restricted,
  );
}
export async function requests(a: Actor) {
  const s = scope(a, "r.person_id");
  return (
    await db()
      .prepare(
        "SELECT r.*,p.name AS person_name FROM requests r JOIN people p ON p.id=r.person_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=?" +
          s.sql +
          " ORDER BY r.created_at DESC",
      )
      .all(a.tenantId, ...s.params)
  ).filter(
    (r) =>
      ["owner", "student"].includes(a.role) ||
      !sections.find((s) => s.key === r.section_key)?.restricted,
  );
}
export async function activity(a: Actor) {
  if (a.role === "student" || a.role === "platform_admin") return [];
  return await db()
    .prepare(
      "SELECT a.*,u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=? ORDER BY a.created_at DESC,a._rowid DESC LIMIT 30",
    )
    .all(a.tenantId);
}
export async function subscription(a: Actor) {
  return await db()
    .prepare("SELECT * FROM subscriptions WHERE tenant_id=?")
    .get(a.tenantId);
}
export async function bootstrap(a: Actor) {
  if (["owner", "consultant"].includes(a.role))
    await runTaskScheduler({
      d: db(),
      tenantId: a.tenantId,
      userId: a.id,
      routineOnly: true,
      heartbeat: false,
    });
  const result = {
    projects: ["owner", "consultant"].includes(a.role)
      ? await db()
          .prepare(
            "SELECT * FROM projects WHERE tenant_id=? ORDER BY created_at DESC,_rowid DESC",
          )
          .all(a.tenantId)
      : [],
    goals: ["owner", "consultant"].includes(a.role)
      ? await db()
          .prepare(
            "SELECT * FROM goals WHERE tenant_id=? ORDER BY created_at DESC,_rowid DESC",
          )
          .all(a.tenantId)
      : [],
    leads: ["owner", "consultant"].includes(a.role)
      ? (
          await db()
            .prepare(
              "SELECT * FROM leads WHERE tenant_id=? ORDER BY created_at DESC,_rowid DESC",
            )
            .all(a.tenantId)
        ).map((r) => ({ ...r, extras: JSON.parse(String(r.extras)) }))
      : [],
    pipelines:
      a.role === "platform_admin" ? {} : await pipelineSettings(a.tenantId),
    finance:
      a.role === "platform_admin" || a.role === "student"
        ? []
        : (
            await db()
              .prepare(
                "SELECT f.*,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.person_id=f.person_id AND p.tenant_id=f.tenant_id),0)-COALESCE((SELECT SUM(a.amount) FROM finance_adjustments a JOIN payments p ON p.id=a.source_id AND p.tenant_id=a.tenant_id WHERE p.person_id=f.person_id AND p.tenant_id=f.tenant_id AND a.kind='refund'),0) AS paid FROM case_finance f WHERE f.tenant_id=?",
              )
              .all(a.tenantId)
          ).map((r) => ({
            ...r,
            pending: Math.max(0, Number(r.expected_fee) - Number(r.paid)),
          })),
    people: await people(a),
    applications: await applications(a),
    tasks: await tasks(a),
    documents: await documents(a),
    requests: await requests(a),
    activity: await activity(a),
    subscription: await subscription(a),
  };
  if (a.role !== "platform_admin") {
    if (!featureAllowed(result.subscription, "crm")) {
      result.leads = [];
      result.applications = [];
      result.finance = [];
      result.pipelines = featureAllowed(result.subscription, "tasks")
        ? { tasks: result.pipelines.tasks }
        : {};
    }
    if (!featureAllowed(result.subscription, "tasks")) {
      delete result.pipelines.tasks;
      result.tasks = [];
      result.projects = [];
      result.goals = [];
    }
    if (!featureAllowed(result.subscription, "forms")) result.documents = [];
    if (!featureAllowed(result.subscription, "shared")) result.people = [];
  }
  return result;
}
