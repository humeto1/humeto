import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { db, withTransaction, audit } from "@/lib/db";
import { hasFeature } from "@/lib/feature-guard";
import { z } from "zod";
export const runtime = "nodejs";
const tables = {
  project: "projects",
  goal: "goals",
  routine: "task_recurrences",
} as const;
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine(
    (v) => /^\d{1,10}(\.\d{1,2})?$/.test(v),
    "Use a nonnegative amount with at most two decimals.",
  )
  .transform((v) => Math.round(Number(v) * 100));
const date = z
  .string()
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v),
  );
async function route(req: Request) {
  try {
    const a = await actor();
    if (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
      return Response.json({ error: "Not permitted." }, { status: 403 });
    const query = new URL(req.url).searchParams,
      type = z.enum(["project", "goal", "routine"]).parse(query.get("type")),
      id = z.string().min(1).max(100).parse(query.get("id"));
    if (
      !(await db()
        .prepare(`SELECT id FROM ${tables[type]} WHERE tenant_id=? AND id=?`)
        .get(a.tenantId, id))
    )
      return Response.json({ error: "Plan not found." }, { status: 404 });
    if (req.method === "GET") {
      const target = await db()
        .prepare(
          "SELECT * FROM plan_financial_targets WHERE tenant_id=? AND entity_type=? AND entity_id=?",
        )
        .get(a.tenantId, type, id);
      return Response.json(
        { target: target || null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    ensureOrigin(req);
    if (!(await canMutate(a)))
      return Response.json(
        { error: "Workspace is read-only." },
        { status: 403 },
      );
    if (Number(req.headers.get("content-length")) > 6000)
      return Response.json({ error: "Too large." }, { status: 413 });
    const v = z
      .object({
        revision: z.number().int().min(0),
        currency: z.string().regex(/^[A-Z]{3}$/),
        upfront: money,
        completion: money,
        conditional: money,
        upfront_date: date,
        completion_date: date,
        conditional_date: date,
        condition: z.string().trim().max(1000),
        basis: z.enum(["project", "occurrence", "month", "year"]),
      })
      .parse(await req.json());
    if (v.conditional && !v.condition)
      return Response.json(
        { error: "Describe the condition for this reward." },
        { status: 400 },
      );
    return await withTransaction(async () => {
      await db()
        .prepare(
          `SELECT id FROM ${tables[type]} WHERE tenant_id=? AND id=? FOR UPDATE`,
        )
        .get(a.tenantId, id);
      const old = await db()
        .prepare(
          "SELECT revision FROM plan_financial_targets WHERE tenant_id=? AND entity_type=? AND entity_id=?",
        )
        .get(a.tenantId, type, id);
      if (Number(old?.revision || 0) !== v.revision)
        return Response.json(
          { error: "Target changed elsewhere. Reload before saving." },
          { status: 409 },
        );
      await db()
        .prepare(
          "INSERT INTO plan_financial_targets(tenant_id,entity_type,entity_id,currency,upfront,completion,conditional,upfront_date,completion_date,conditional_date,condition,basis) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET currency=excluded.currency,upfront=excluded.upfront,completion=excluded.completion,conditional=excluded.conditional,upfront_date=excluded.upfront_date,completion_date=excluded.completion_date,conditional_date=excluded.conditional_date,condition=excluded.condition,basis=excluded.basis,revision=plan_financial_targets.revision+1",
        )
        .run(
          a.tenantId,
          type,
          id,
          v.currency,
          v.upfront,
          v.completion,
          v.conditional,
          v.upfront_date,
          v.completion_date,
          v.conditional_date,
          v.condition,
          v.basis,
        );
      await audit(
        a.tenantId,
        a.id,
        "target",
        type,
        id,
        "Updated estimated financial target; no accounting entries posted",
      );
      return Response.json({ saved: true });
    });
  } catch {
    return Response.json(
      { error: "Check dates, currency and amounts." },
      { status: 400 },
    );
  }
}
export const GET = route,
  POST = route;
