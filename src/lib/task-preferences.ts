import "server-only";
import { z } from "zod";
import { db, withTransaction } from "./db";
import { isStaff } from "./auth";
import type { Actor } from "./types";
import { worldCurrencies } from "../../shared/currencies";
export async function taskPreferences(a: Actor, body?: unknown) {
  if (!isStaff(a) || a.role === "platform_admin")
    return Response.json(
      { error: "Task settings are not permitted." },
      { status: 403 },
    );
  if (body === undefined) {
    const r = await db()
      .prepare(
        "SELECT default_currency,revision FROM task_preferences WHERE tenant_id=? AND user_id=?",
      )
      .get(a.tenantId, a.id);
    return Response.json(r || { default_currency: "PKR", revision: 0 });
  }
  const v = z
    .object({
      currency: z
        .string()
        .refine(
          (c) => worldCurrencies.includes(c),
          "Choose a supported currency.",
        ),
      revision: z.number().int().nonnegative(),
    })
    .parse(body);
  return withTransaction(async () => {
    await db().query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":" + a.id + ":task-currency",
    ]);
    const old = await db()
      .prepare(
        "SELECT revision FROM task_preferences WHERE tenant_id=? AND user_id=?",
      )
      .get(a.tenantId, a.id);
    if ((old?.revision || 0) !== v.revision)
      return Response.json(
        { error: "Settings changed on another device. Refresh and retry." },
        { status: 409 },
      );
    await db()
      .prepare(
        "INSERT INTO task_preferences(tenant_id,user_id,default_currency) VALUES(?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET default_currency=excluded.default_currency,revision=task_preferences.revision+1",
      )
      .run(a.tenantId, a.id, v.currency);
    return Response.json({
      default_currency: v.currency,
      revision: v.revision + 1,
    });
  });
}
