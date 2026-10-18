import { validStage } from "./pipeline-settings";
import { randomBytes, createHash } from "node:crypto";
import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { db, id, audit } from "./db";
import { canMutate } from "./auth";
import { leadStages, applicantStages } from "./pipeline";
import type { Actor } from "./types";
const text = z.string().trim().max(500).default("");
const cash = z.number().int().min(0).max(100000000).default(0);
const date = z
  .string()
  .regex(/^$|^\d{4}-\d{2}-\d{2}$/)
  .default("");
const leadSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    phone: text,
    source: z
      .enum(["Manual", "CSV", "Inquiry", "Email", "WhatsApp", "AI command"])
      .default("Manual"),
    destination: text,
    course: text,
    notes: z.string().max(5000).default(""),
    follow_up: date,
    timeline: text,
    expected_fee: cash,
    upfront_fee: cash,
    incentive: cash,
    extras: z.record(z.string().max(80), z.string().max(1000)).default({}),
  })
  .refine((v) => v.upfront_fee <= v.expected_fee, {
    message: "Upfront amount cannot exceed the agreed fee.",
  })
  .refine((v) => Object.keys(v.extras).length <= 50, {
    message: "Use at most 50 custom fields.",
  });
function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
export { withTransaction as transaction } from "./db";
import { withTransaction as transaction } from "./db";
async function insertLead(a: Actor, input: z.infer<typeof leadSchema>) {
  const lid = id();
  await db()
    .prepare(
      "INSERT INTO leads(id,tenant_id,name,email,phone,source,destination,course,notes,follow_up,timeline,expected_fee,upfront_fee,incentive,extras) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      lid,
      a.tenantId,
      input.name,
      input.email,
      input.phone,
      input.source,
      input.destination,
      input.course,
      input.notes,
      input.follow_up,
      input.timeline,
      input.expected_fee,
      input.upfront_fee,
      input.incentive,
      JSON.stringify(input.extras),
    );
  await audit(
    a.tenantId,
    a.id,
    "created",
    "lead",
    lid,
    `Created lead from ${input.source}`,
  );
  return lid;
}
export async function crmMutation(
  req: Request,
  parts: string[],
  a: Actor,
  body: unknown,
) {
  const [resource, rid, action] = parts;
  if (
    !["leads", "case-finance", "applicant-stage", "inquiry-links"].includes(
      resource,
    )
  )
    return null;
  if (!(await canMutate(a)))
    return error("CRM management is not permitted.", 403);
  if (resource === "inquiry-links" && req.method === "POST") {
    if (rid === "revoke") {
      await db()
        .prepare("UPDATE inquiry_links SET revoked=1 WHERE tenant_id=?")
        .run(a.tenantId);
      await audit(
        a.tenantId,
        a.id,
        "revoked",
        "inquiry",
        "all",
        "Revoked all inquiry links",
      );
      return NextResponse.json({ ok: true });
    }
    const token = randomBytes(32).toString("base64url");
    const lid = id();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await db()
      .prepare(
        "INSERT INTO inquiry_links(id,tenant_id,token_hash,created_by,expires_at) VALUES(?,?,?,?,?)",
      )
      .run(
        lid,
        a.tenantId,
        createHash("sha256").update(token).digest("hex"),
        a.id,
        expiresAt,
      );
    await audit(
      a.tenantId,
      a.id,
      "created",
      "inquiry",
      lid,
      "Created 30-day public inquiry link",
    );
    return NextResponse.json({ path: "/inquiry/" + token, expiresAt });
  }
  if (resource === "applicant-stage" && req.method === "PATCH") {
    const input = z
      .object({
        stage: z.string().min(1).max(100),
        revision: z.number().int().positive(),
      })
      .parse(body);
    if (!(await validStage(a.tenantId, "applicants", input.stage)))
      return error("Choose an active applicant stage.");
    const result = await db()
      .prepare(
        "UPDATE people SET journey_stage=?,revision=revision+1,updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id=? AND tenant_id=? AND revision=?",
      )
      .run(input.stage, rid, a.tenantId, input.revision);
    if (result.changes !== 1)
      return error(
        "Applicant changed elsewhere or is unavailable. Refresh before moving.",
        409,
      );
    await audit(
      a.tenantId,
      a.id,
      "stage changed",
      "person",
      rid,
      `Applicant journey moved to ${input.stage}; individual applications unchanged`,
    );
    return NextResponse.json({ ok: true });
  }
  if (resource === "case-finance") {
    if (
      !(await db()
        .prepare("SELECT id FROM people WHERE id=? AND tenant_id=?")
        .get(rid, a.tenantId))
    )
      return error("Applicant not found.", 404);
    if (action === "payment" && req.method === "POST") {
      const input = z
        .object({
          amount: z.number().int().positive().max(100000000),
          reference: z.string().trim().min(2).max(200),
          clientKey: z.uuid(),
        })
        .parse(body);
      return await transaction(async () => {
        const exists = await db()
          .prepare(
            "SELECT person_id,amount,reference FROM payments WHERE tenant_id=? AND client_key=?",
          )
          .get(a.tenantId, input.clientKey);
        if (exists) {
          if (
            exists.person_id !== rid ||
            exists.amount !== input.amount ||
            exists.reference !== input.reference
          )
            return error("Receipt key already used for different data.", 409);
          return NextResponse.json({ ok: true, replayed: true });
        }
        const inserted = await db()
          .prepare(
            "INSERT INTO payments(id,tenant_id,person_id,amount,reference,client_key,created_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT (tenant_id,client_key) DO NOTHING",
          )
          .run(
            id(),
            a.tenantId,
            rid,
            input.amount,
            input.reference,
            input.clientKey,
            a.id,
          );
        if (inserted.changes === 0) {
          const previous = await db()
            .prepare(
              "SELECT person_id,amount,reference FROM payments WHERE tenant_id=? AND client_key=?",
            )
            .get(a.tenantId, input.clientKey);
          if (
            !previous ||
            previous.person_id !== rid ||
            previous.amount !== input.amount ||
            previous.reference !== input.reference
          )
            return error("Receipt key already used for different data.", 409);
          return NextResponse.json({ ok: true, replayed: true });
        }
        await audit(
          a.tenantId,
          a.id,
          "payment recorded",
          "person",
          rid,
          `Recorded PKR ${input.amount} · ${input.reference}`,
        );
        return NextResponse.json({ ok: true });
      });
    }

    if (req.method === "PATCH") {
      const input = z
        .object({
          expected_fee: cash,
          upfront_fee: cash,
          incentive: cash,
          timeline: text,
          revision: z.number().int().nonnegative(),
        })
        .refine((v) => v.upfront_fee <= v.expected_fee, {
          message: "Upfront amount cannot exceed the agreed fee.",
        })
        .parse(body);
      const d = db();
      return await transaction(async () => {
        const current = await d
          .prepare(
            "SELECT revision FROM case_finance WHERE person_id=? AND tenant_id=?",
          )
          .get(rid, a.tenantId);
        if (Number(current?.revision || 0) !== input.revision)
          return error("Fees changed elsewhere. Refresh first.", 409);

        await d
          .prepare(
            "INSERT INTO case_finance(person_id,tenant_id,expected_fee,upfront_fee,incentive,timeline,revision) VALUES(?,?,?,?,?,?,1) ON CONFLICT(person_id) DO UPDATE SET expected_fee=excluded.expected_fee,upfront_fee=excluded.upfront_fee,incentive=excluded.incentive,timeline=excluded.timeline,revision=case_finance.revision+1",
          )
          .run(
            rid,
            a.tenantId,
            input.expected_fee,
            input.upfront_fee,
            input.incentive,
            input.timeline,
          );
        await audit(
          a.tenantId,
          a.id,
          "fees updated",
          "person",
          rid,
          "Updated agreed fee, upfront target and contingent incentive",
        );
        return NextResponse.json({ ok: true });
      });
    }
  }
  if (resource === "leads") {
    if (action === "follow-up" && rid && req.method === "POST") {
      const { revision } = z
        .object({ revision: z.number().int().positive() })
        .parse(body);
      return await transaction(async () => {
        const l = await db()
          .prepare("SELECT * FROM leads WHERE id=? AND tenant_id=?")
          .get(rid, a.tenantId);
        if (!l) return error("Lead not found.", 404);
        if (l.revision !== revision)
          return error("Lead changed elsewhere. Refresh first.", 409);
        if (l.person_id || l.stage === "Lost")
          return error(
            "Use applicant tasks for a registered lead; lost leads do not need follow-up.",
          );
        if (!l.follow_up)
          return error("Set a follow-up date on the lead first.");
        const existing = await db()
          .prepare(
            "SELECT f.task_id FROM lead_followups f JOIN tasks t ON t.id=f.task_id AND t.tenant_id=f.tenant_id WHERE f.tenant_id=? AND f.lead_id=? AND f.follow_up=?",
          )
          .get(a.tenantId, rid, l.follow_up);
        if (existing)
          return NextResponse.json({
            taskId: existing.task_id,
            replayed: true,
          });
        const tid = id();
        await db()
          .prepare(
            "INSERT INTO tasks(id,tenant_id,title,due_date,assignee,important,last_actor_id) VALUES(?,?,?,?,?,1,?)",
          )
          .run(
            tid,
            a.tenantId,
            "Follow up with " + l.name,
            l.follow_up,
            a.name,
            a.id,
          );
        await db()
          .prepare(
            "INSERT INTO lead_followups(tenant_id,lead_id,follow_up,task_id) VALUES(?,?,?,?)",
          )
          .run(a.tenantId, rid, l.follow_up, tid);
        await audit(
          a.tenantId,
          a.id,
          "follow-up scheduled",
          "lead",
          rid,
          "Created follow-up task for " +
            l.follow_up +
            "; no external message sent",
        );
        return NextResponse.json({ taskId: tid });
      });
    }
    if (req.method === "POST" && !rid) {
      const input = leadSchema.parse(body);
      if (
        (await db()
          .prepare(
            "SELECT id FROM leads WHERE tenant_id=? AND lower(email)=lower(?)",
          )
          .get(a.tenantId, input.email)) ||
        (await db()
          .prepare(
            "SELECT id FROM people WHERE tenant_id=? AND lower(email)=lower(?)",
          )
          .get(a.tenantId, input.email))
      )
        return error(
          "This email already belongs to a lead or applicant in this workspace.",
          409,
        );
      return NextResponse.json({
        id: await transaction(async () => await insertLead(a, input)),
      });
    }
    if (rid === "bulk" && req.method === "POST") {
      const { rows, preview } = z
        .object({
          rows: z.array(leadSchema).min(1).max(500),
          preview: z.boolean().default(true),
        })
        .parse(body);
      const seen = new Set<string>();
      const duplicates: number[] = [];
      const accepted: typeof rows = [];
      for (const [i, r] of rows.entries()) {
        const found =
          seen.has(r.email) ||
          !!(await db()
            .prepare(
              "SELECT id FROM leads WHERE tenant_id=? AND lower(email)=lower(?)",
            )
            .get(a.tenantId, r.email)) ||
          !!(await db()
            .prepare(
              "SELECT id FROM people WHERE tenant_id=? AND lower(email)=lower(?)",
            )
            .get(a.tenantId, r.email));
        seen.add(r.email);
        if (found) duplicates.push(i + 2);
        if (!found) accepted.push(r);
      }
      if (preview)
        return NextResponse.json({
          accepted: accepted.length,
          duplicates,
          total: rows.length,
        });
      const ids = await transaction(
        async () =>
          await Promise.all(accepted.map(async (r) => await insertLead(a, r))),
      );
      return NextResponse.json({ created: ids.length, duplicates });
    }
    if (req.method === "PATCH") {
      const input = z
        .object({
          stage: z.string().min(1).max(100),
          revision: z.number().int().positive(),
          details: leadSchema.optional(),
        })
        .parse(body);
      if (
        input.stage === "Registered" ||
        !(await validStage(a.tenantId, "leads", input.stage))
      )
        return error(
          "Choose an active lead stage; use Register to convert a lead.",
        );
      const lead = await db()
        .prepare("SELECT * FROM leads WHERE id=? AND tenant_id=?")
        .get(rid, a.tenantId);
      if (!lead) return error("Lead not found.", 404);
      if (lead.person_id)
        return error(
          "Registered leads are linked to an applicant and cannot be moved back.",
          409,
        );
      if (input.details && input.details.email !== lead.email)
        return error(
          "Email changes require an identity review; keep the current address for now.",
        );
      const result = await transaction(async () => {
        const changes = await db()
          .prepare(
            "UPDATE leads SET stage=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
          )
          .run(input.stage, rid, a.tenantId, input.revision);
        if (changes.changes === 1) {
          if (input.details) {
            const v = input.details;
            await db()
              .prepare(
                "UPDATE leads SET name=?,phone=?,destination=?,course=?,notes=?,follow_up=?,timeline=?,expected_fee=?,upfront_fee=?,incentive=?,extras=? WHERE id=? AND tenant_id=?",
              )
              .run(
                v.name,
                v.phone,
                v.destination,
                v.course,
                v.notes,
                v.follow_up,
                v.timeline,
                v.expected_fee,
                v.upfront_fee,
                v.incentive,
                JSON.stringify(v.extras),
                rid,
                a.tenantId,
              );
          }
          await audit(
            a.tenantId,
            a.id,
            "updated",
            "lead",
            rid,
            `Lead moved to ${input.stage}`,
          );
        }
        return changes;
      });
      return result.changes === 1
        ? NextResponse.json({ ok: true })
        : error("Lead changed elsewhere. Refresh first.", 409);
    }
    if (action === "register" && req.method === "POST") {
      const { revision } = z
        .object({ revision: z.number().int().positive() })
        .parse(body);
      return await transaction(async () => {
        const lead = await db()
          .prepare("SELECT * FROM leads WHERE id=? AND tenant_id=?")
          .get(rid, a.tenantId);
        if (!lead) return error("Lead not found.", 404);
        if (lead.person_id)
          return NextResponse.json({
            personId: lead.person_id,
            replayed: true,
          });
        if (lead.revision !== revision)
          return error(
            "Lead changed elsewhere. Refresh before registration.",
            409,
          );
        const existing = await db()
          .prepare(
            "SELECT id FROM people WHERE tenant_id=? AND lower(email)=lower(?)",
          )
          .all(a.tenantId, String(lead.email));
        if (existing.length)
          return error(
            "An applicant with this email exists. Resolve the identity before registration.",
            409,
          );
        const sub = (await db()
          .prepare("SELECT case_limit FROM subscriptions WHERE tenant_id=?")
          .get(a.tenantId))!;
        const count = (await db()
          .prepare("SELECT count(*) n FROM people WHERE tenant_id=?")
          .get(a.tenantId))!;
        if (Number(count.n) >= Number(sub.case_limit))
          return error("Applicant allowance reached.", 403);
        const pid = id();
        await db()
          .prepare(
            "INSERT INTO people(id,tenant_id,name,email,destination,course,initials) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            pid,
            a.tenantId,
            lead.name,
            lead.email,
            lead.destination,
            lead.course,
            String(lead.name)
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2),
          );
        await db()
          .prepare(
            "INSERT INTO case_finance(person_id,tenant_id,expected_fee,upfront_fee,incentive,timeline) VALUES(?,?,?,?,?,?)",
          )
          .run(
            pid,
            a.tenantId,
            lead.expected_fee,
            lead.upfront_fee,
            lead.incentive,
            lead.timeline,
          );
        await db()
          .prepare(
            "UPDATE leads SET stage='Registered',person_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
          )
          .run(pid, rid, a.tenantId);
        await audit(
          a.tenantId,
          a.id,
          "registered",
          "lead",
          rid,
          "Converted lead to applicant; original inquiry and commercial details retained",
        );
        return NextResponse.json({ personId: pid });
      });
    }
  }
  return error("CRM action not found.", 404);
}
