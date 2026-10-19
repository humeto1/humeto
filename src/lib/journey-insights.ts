import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actor, isStaff, canMutate, ensureOrigin } from "./auth";
import { db, audit, withTransaction } from "./db";
import { localDay, validDay } from "./scheduling-clock.mjs";
import { pipelineSettings } from "./pipeline-settings";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const configs = {
  leads: { table: "leads", stage: "stage" },
  applicants: { table: "people", stage: "journey_stage" },
  applications: { table: "applications", stage: "status" },
} as const;
class InsightError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function journeyRoute(req: Request) {
  try {
    const a = await actor();
    if (!a) return fail("Sign in to continue.", 401);
    if (!isStaff(a)) return fail("Not permitted.", 403);
    if (req.method === "GET") {
      const settings = await pipelineSettings(a.tenantId);
      const [leads, people, apps, visits, deadlines, finance, commissions] =
        await Promise.all([
          db()
            .prepare(
              "SELECT id,name,email,stage,destination,expected_fee,incentive,person_id,revision FROM leads WHERE tenant_id=?",
            )
            .all(a.tenantId),
          db()
            .prepare(
              "SELECT id,name,email,journey_stage,destination,revision FROM people WHERE tenant_id=?",
            )
            .all(a.tenantId),
          db()
            .prepare(
              "SELECT a.id,a.person_id,p.name,a.institution,a.program,a.country,a.intake,a.status,a.revision FROM applications a JOIN people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=?",
            )
            .all(a.tenantId),
          db()
            .prepare(
              "SELECT * FROM journey_stage_visits WHERE tenant_id=? ORDER BY entered_at DESC,id DESC",
            )
            .all(a.tenantId),
          db()
            .prepare("SELECT * FROM journey_deadlines WHERE tenant_id=?")
            .all(a.tenantId),
          db()
            .prepare(
              "SELECT f.person_id,f.expected_fee,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.person_id=f.person_id AND p.tenant_id=f.tenant_id),0)-COALESCE((SELECT SUM(r.amount) FROM finance_adjustments r JOIN payments p ON p.id=r.source_id AND p.tenant_id=r.tenant_id WHERE p.person_id=f.person_id AND p.tenant_id=f.tenant_id AND r.kind='refund'),0) AS paid FROM case_finance f WHERE f.tenant_id=?",
            )
            .all(a.tenantId),
          db()
            .prepare(
              "SELECT application_id,SUM(amount) AS earned FROM finance_commissions WHERE tenant_id=? GROUP BY application_id",
            )
            .all(a.tenantId),
        ]);
      const now = Date.now(),
        records = [];
      for (const [kind, items] of [
        ["leads", leads],
        ["applicants", people],
        ["applications", apps],
      ] as const) {
        for (const item of items) {
          const current = visits.find(
              (v) => v.kind === kind && v.entity_id === item.id && !v.exited_at,
            ),
            deadline = deadlines.find(
              (d) => d.kind === kind && d.entity_id === item.id,
            ),
            f = finance.find((f) => f.person_id === item.id);
          const stage = item[configs[kind].stage];
          const today = localDay(now, deadline?.timezone || "Asia/Karachi");
          const daysUntil = deadline?.due_date
            ? Math.round(
                (Date.parse(deadline.due_date + "T12:00:00Z") -
                  Date.parse(today + "T12:00:00Z")) /
                  86400000,
              )
            : null;
          records.push({
            id: item.id,
            kind,
            name: item.name,
            title:
              kind === "applications"
                ? `${item.institution} · ${item.program}`
                : item.name,
            country: item.destination || item.country || "",
            intake: item.intake || "",
            personId: kind === "applicants" ? item.id : item.person_id || "",
            stage,
            stageTitle:
              settings[kind].stages.find(
                (s: { key: string }) => s.key === stage,
              )?.title || stage,
            revision: item.revision,
            enteredAt: current?.entered_at || null,
            observedDays: current
              ? Math.max(0, (now - Date.parse(current.entered_at)) / 86400000)
              : null,
            baseline: current?.baseline ?? true,
            deadline: deadline
              ? {
                  dueDate: deadline.due_date,
                  timezone: deadline.timezone,
                  label: deadline.label,
                  revision: deadline.revision,
                }
              : {
                  dueDate: "",
                  timezone: "Asia/Karachi",
                  label: "",
                  revision: 0,
                },
            daysUntil,
            fee:
              kind === "leads"
                ? item.person_id
                  ? null
                  : Number(item.expected_fee)
                : kind === "applicants" && f
                  ? Number(f.expected_fee)
                  : null,
            paid: kind === "applicants" && f ? Number(f.paid) : null,
            pending:
              kind === "applicants" && f
                ? Math.max(0, Number(f.expected_fee) - Number(f.paid))
                : null,
            contingentIncentive:
              kind === "leads" && !item.person_id
                ? Number(item.incentive)
                : null,
            earnedCommission:
              kind === "applications"
                ? Number(
                    commissions.find((c) => c.application_id === item.id)
                      ?.earned || 0,
                  )
                : null,
          });
        }
      }
      const metrics = [];
      for (const kind of Object.keys(configs) as (keyof typeof configs)[]) {
        const stages = new Set(
          visits.filter((v) => v.kind === kind).map((v) => v.stage),
        );
        for (const stage of stages) {
          const completed = visits.filter(
              (v) =>
                v.kind === kind &&
                v.stage === stage &&
                v.exited_at &&
                !v.baseline,
            ),
            days = completed.map((v) =>
              Math.max(
                0,
                (Date.parse(v.exited_at) - Date.parse(v.entered_at)) / 86400000,
              ),
            );
          metrics.push({
            kind,
            stage,
            title:
              settings[kind].stages.find(
                (s: { key: string }) => s.key === stage,
              )?.title || stage,
            visits: days.length,
            averageDays: days.length
              ? days.reduce((a, b) => a + b, 0) / days.length
              : null,
          });
        }
      }
      return NextResponse.json({
        records,
        metrics,
        generatedAt: new Date(now).toISOString(),
        currency: "PKR",
      });
    }
    ensureOrigin(req);
    if (!(await canMutate(a)))
      return fail("A writable subscription is required.", 403);
    const v = z
      .object({
        kind: z.enum(["leads", "applicants", "applications"]),
        id: z.string().min(1).max(100),
        entityRevision: z.number().int().positive(),
        revision: z.number().int().nonnegative(),
        dueDate: z
          .string()
          .refine((s) => !s || validDay(s), "Choose a valid date."),
        timezone: z.string().max(100),
        label: z.string().trim().max(140),
      })
      .parse(await req.json());
    try {
      new Intl.DateTimeFormat("en", { timeZone: v.timezone }).format();
    } catch {
      return fail("Choose a valid timezone.");
    }
    return await withTransaction(async () => {
      const config = configs[v.kind],
        entity = await db()
          .prepare(
            `SELECT revision FROM ${config.table} WHERE id=? AND tenant_id=? FOR UPDATE`,
          )
          .get(v.id, a.tenantId);
      if (!entity) throw new InsightError("Record not found.", 404);
      if (entity.revision !== v.entityRevision)
        throw new InsightError(
          "This case changed. Refresh before saving.",
          409,
        );
      const old = await db()
        .prepare(
          "SELECT revision FROM journey_deadlines WHERE tenant_id=? AND kind=? AND entity_id=? FOR UPDATE",
        )
        .get(a.tenantId, v.kind, v.id);
      if ((old?.revision || 0) !== v.revision)
        throw new InsightError(
          "Deadline changed elsewhere. Refresh before saving.",
          409,
        );
      await db()
        .prepare(
          "INSERT INTO journey_deadlines(tenant_id,kind,entity_id,due_date,timezone,label,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,kind,entity_id) DO UPDATE SET due_date=excluded.due_date,timezone=excluded.timezone,label=excluded.label,updated_by=excluded.updated_by,revision=journey_deadlines.revision+1,updated_at=now()",
        )
        .run(a.tenantId, v.kind, v.id, v.dueDate, v.timezone, v.label, a.id);
      await audit(
        a.tenantId,
        a.id,
        v.dueDate ? "deadline_saved" : "deadline_cleared",
        v.kind,
        v.id,
        "Updated a structured journey deadline",
      );
      return NextResponse.json({ ok: true });
    });
  } catch (e) {
    if (e instanceof InsightError) return fail(e.message, e.status);
    if (e instanceof z.ZodError)
      return fail(e.issues[0]?.message || "Invalid input.");
    if (e instanceof Error && e.message === "ORIGIN")
      return fail("Origin not allowed.", 403);
    console.error("Journey insights request failed.");
    return fail("Unable to load or save journey insights.", 500);
  }
}
