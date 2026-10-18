import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { db, audit, withTransaction } from "./db";
import { canMutate, isStaff } from "./auth";
import { leadStages, applicantStages, applicationStages } from "./pipeline";
import type { Actor } from "./types";
export const defaults = {
  leads: leadStages,
  applicants: applicantStages,
  applications: applicationStages,
};
export type PipelineKind = keyof typeof defaults;
export async function pipelineSettings(tenantId: string) {
  const rows = await db()
    .prepare("SELECT * FROM pipeline_settings WHERE tenant_id=?")
    .all(tenantId);
  return Object.fromEntries(
    Object.entries(defaults).map(([kind, stages]) => {
      const row = rows.find((r) => r.kind === kind);
      return [
        kind,
        {
          revision: row?.revision || 0,
          stages:
            row?.stages_json || stages.map((key) => ({ key, title: key })),
        },
      ];
    }),
  );
}
export async function validStage(
  tenantId: string,
  kind: PipelineKind,
  key: string,
) {
  const settings = await pipelineSettings(tenantId);
  return settings[kind].stages.some((s: { key: string }) => s.key === key);
}
export async function pipelineRead(a: Actor) {
  if (!isStaff(a))
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  return NextResponse.json(await pipelineSettings(a.tenantId));
}
export async function pipelineWrite(a: Actor, body: unknown) {
  if (a.role !== "owner" || !(await canMutate(a)))
    return NextResponse.json(
      { error: "Only a workspace owner can configure stages." },
      { status: 403 },
    );
  const v = z
    .object({
      kind: z.enum(["leads", "applicants", "applications"]),
      revision: z.number().int().min(0),
      stages: z
        .array(
          z.object({
            key: z.string().min(1).max(100),
            title: z.string().trim().min(1).max(60),
          }),
        )
        .min(1)
        .max(30),
      replacements: z.record(z.string(), z.string()).default({}),
    })
    .parse(body);
  if (
    new Set(v.stages.map((s) => s.key)).size !== v.stages.length ||
    new Set(v.stages.map((s) => s.title.toLowerCase())).size !== v.stages.length
  )
    return NextResponse.json(
      { error: "Stage keys and titles must be unique." },
      { status: 400 },
    );
  return withTransaction(async () => {
    await db()
      .prepare("SELECT id FROM tenants WHERE id=? FOR UPDATE")
      .get(a.tenantId);
    const settings = await pipelineSettings(a.tenantId),
      old = settings[v.kind];
    if (old.revision !== v.revision)
      return NextResponse.json(
        { error: "Stages changed elsewhere. Refresh before saving." },
        { status: 409 },
      );
    const keep = new Set(v.stages.map((s) => s.key));
    const deleted = old.stages.filter((s: { key: string }) => !keep.has(s.key));
    const existing = await db()
      .prepare(
        "SELECT redirects_json FROM pipeline_settings WHERE tenant_id=? AND kind=?",
      )
      .get(a.tenantId, v.kind);
    const redirects: Record<string, string> = {
      ...(existing?.redirects_json || {}),
    };
    // Do not reuse a retired key: future external events still need its unambiguous redirect.
    if (v.stages.some((s) => s.key in redirects))
      return NextResponse.json(
        {
          error:
            "A retired stage key cannot be reused. Add a new stage instead.",
        },
        { status: 400 },
      );
    for (const s of deleted) {
      const replacement = v.replacements[s.key];
      if (!replacement || !keep.has(replacement))
        return NextResponse.json(
          {
            error:
              "Choose a destination for every removed stage. Cards will be moved there.",
          },
          { status: 400 },
        );
      redirects[s.key] = replacement;
    }
    for (const key of Object.keys(redirects)) {
      let value = redirects[key],
        seen = new Set([key]);
      while (value in redirects) {
        if (seen.has(value))
          return NextResponse.json(
            { error: "Stage replacements form a loop." },
            { status: 400 },
          );
        seen.add(value);
        value = redirects[value];
      }
      if (!keep.has(value))
        return NextResponse.json(
          { error: "Every retired stage must lead to an active stage." },
          { status: 400 },
        );
      redirects[key] = value;
    }
    await db()
      .prepare(
        `INSERT INTO pipeline_settings(tenant_id,kind,stages_json,redirects_json) VALUES(?,?,?::jsonb,?::jsonb) ON CONFLICT(tenant_id,kind) DO UPDATE SET stages_json=excluded.stages_json,redirects_json=excluded.redirects_json,revision=pipeline_settings.revision+1`,
      )
      .run(
        a.tenantId,
        v.kind,
        JSON.stringify(v.stages),
        JSON.stringify(redirects),
      );
    const table = v.kind === "applicants" ? "people" : v.kind,
      column =
        v.kind === "applicants"
          ? "journey_stage"
          : v.kind === "leads"
            ? "stage"
            : "status";
    for (const s of deleted)
      await db()
        .prepare(
          `UPDATE ${table} SET ${column}=?,revision=revision+1 WHERE tenant_id=? AND ${column}=?`,
        )
        .run(redirects[s.key], a.tenantId, s.key);
    await audit(
      a.tenantId,
      a.id,
      "configured",
      "pipeline",
      v.kind,
      "Updated stage titles, ordering and card destinations",
    );
    return NextResponse.json({ ok: true });
  });
}
