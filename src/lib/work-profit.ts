import "server-only";
import { db, withTransaction, audit } from "./db";
import type { Actor } from "./types";
import { z } from "zod";
import { worldCurrencies } from "../../shared/currencies";
export type WorkScope = "task" | "project" | "goal";
function relation(type: WorkScope) {
  return type === "task"
    ? "t.id=?"
    : type === "project"
      ? "t.project_id=?"
      : "(EXISTS(SELECT 1 FROM task_goals g WHERE g.task_id=t.id AND g.tenant_id=t.tenant_id AND g.goal_id=?) OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.tenant_id=t.tenant_id AND p.goal_id=?))";
}
function params(tenant: string, type: WorkScope, id: string) {
  return [tenant, id, ...(type === "goal" ? [id] : [])];
}
export async function workSummary(tenant: string, type: WorkScope, id: string) {
  const exists = await db()
    .prepare(
      `SELECT id FROM ${type === "task" ? "tasks" : type === "project" ? "projects" : "goals"} WHERE tenant_id=? AND id=?`,
    )
    .get(tenant, id);
  if (!exists) throw Error("Work item not found.");
  const tasks = await db()
    .prepare(
      `SELECT t.id,t.value_type,t.value_minor,t.value_currency FROM tasks t WHERE t.tenant_id=? AND ${relation(type)} AND t.storage_state IN ('active','planning') ${type === "task" ? "" : "AND NOT EXISTS(SELECT 1 FROM task_occurrences o WHERE o.task_id=t.id)"}`,
    )
    .all(...params(tenant, type, id));
  const seconds = await db()
    .prepare(
      `SELECT COALESCE(sum(GREATEST(0,extract(epoch FROM(COALESCE(w.ended_at,humeto_action_time())-w.started_at)))),0) AS n FROM focus_work_intervals w JOIN tasks t ON t.id=w.task_id AND t.tenant_id=w.tenant_id WHERE t.tenant_id=? AND ${relation(type)}`,
    )
    .get(...params(tenant, type, id));
  const receipts = await db()
    .prepare(
      `SELECT r.currency,sum(r.amount_minor)::bigint AS amount FROM task_profit_receipts r WHERE r.tenant_id=? AND ${type === "task" ? "r.task_id=?" : type === "project" ? "r.project_id=?" : "EXISTS(SELECT 1 FROM profit_receipt_goals g WHERE g.receipt_id=r.id AND g.goal_id=?)"} GROUP BY r.currency ORDER BY r.currency`,
    )
    .all(tenant, id);
  const estimates = new Map<string, number>();
  let basis = "project";
  const financial =
    type === "task"
      ? null
      : await db()
          .prepare(
            "SELECT * FROM plan_financial_targets WHERE tenant_id=? AND entity_type=? AND entity_id=?",
          )
          .get(tenant, type, id);
  if (financial) {
    estimates.set(
      String(financial.currency),
      Number(financial.upfront) + Number(financial.completion),
    );
    basis = String(financial.basis);
  } else if (type === "goal") {
    const targets = await db()
      .prepare(
        "SELECT f.* FROM plan_financial_targets f JOIN projects p ON p.id=f.entity_id AND p.tenant_id=f.tenant_id WHERE p.tenant_id=? AND p.goal_id=? AND f.entity_type='project'",
      )
      .all(tenant, id);
    // Estimates with different cadence cannot be added as one number.
    const grouped = new Map<
      string,
      { currency: string; amount: number; basis: string }
    >();
    for (const f of targets) {
      const key = f.currency + ":" + f.basis,
        old = grouped.get(key);
      grouped.set(key, {
        currency: String(f.currency),
        amount: (old?.amount || 0) + Number(f.upfront) + Number(f.completion),
        basis: String(f.basis),
      });
    }
    const uncovered = await db()
      .prepare(
        `SELECT t.id,t.value_type,t.value_minor,t.value_currency FROM tasks t WHERE t.tenant_id=? AND ${relation(type)} AND t.storage_state IN ('active','planning') AND NOT EXISTS(SELECT 1 FROM task_occurrences o WHERE o.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM plan_financial_targets f WHERE f.tenant_id=t.tenant_id AND f.entity_type='project' AND f.entity_id=t.project_id)`,
      )
      .all(...params(tenant, type, id));
    for (const t of uncovered)
      if (t.value_type === "profit" && t.value_minor !== null) {
        const key = t.value_currency + ":project",
          old = grouped.get(key);
        grouped.set(key, {
          currency: String(t.value_currency),
          amount: (old?.amount || 0) + Number(t.value_minor),
          basis: "project",
        });
      }
    return {
      estimated: [...grouped.values()],
      actual: receipts,
      focusSeconds: Number(seconds?.n || 0),
    };
  } else
    for (const t of tasks)
      if (t.value_type === "profit" && t.value_minor !== null)
        estimates.set(
          String(t.value_currency),
          (estimates.get(String(t.value_currency)) || 0) +
            Number(t.value_minor),
        );
  return {
    estimated: [...estimates].map(([currency, amount]) => ({
      currency,
      amount,
      basis,
    })),
    actual: receipts,
    focusSeconds: Number(seconds?.n || 0),
  };
}
const receipt = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().min(1).max(100),
    sessionId: z.string().max(100).optional(),
    amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
    currency: z.string().refine((c) => worldCurrencies.includes(c)),
    day: z.iso.date(),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
export async function recordProfit(a: Actor, input: unknown) {
  const v = receipt.parse(input),
    amount = Math.round(Number(v.amount) * 100);
  if (amount <= 0) throw Error("Enter a received amount greater than zero.");
  if (v.day > new Date(Date.now() + 14 * 3600000).toISOString().slice(0, 10))
    throw Error("Choose today or an earlier date.");
  return withTransaction(async () => {
    const t = await db()
      .prepare(
        "SELECT * FROM tasks WHERE tenant_id=? AND id=? AND storage_state IN ('active','planning') FOR UPDATE",
      )
      .get(a.tenantId, v.taskId);
    if (!t) throw Error("Task not found.");
    if (
      v.sessionId &&
      !(await db()
        .prepare(
          "SELECT id FROM focus_sessions WHERE id=? AND task_id=? AND tenant_id=? AND user_id=?",
        )
        .get(v.sessionId, t.id, a.tenantId, a.id))
    )
      throw Error("Focus session not found.");
    const prior = await db()
      .prepare("SELECT * FROM task_profit_receipts WHERE id=?")
      .get(v.id);
    if (prior) {
      if (
        prior.tenant_id !== a.tenantId ||
        prior.task_id !== t.id ||
        Number(prior.amount_minor) !== amount ||
        prior.currency !== v.currency ||
        String(prior.received_day) !== v.day
      )
        throw Error("This receipt changed.");
      return { id: v.id };
    }
    await db()
      .prepare(
        "INSERT INTO task_profit_receipts(id,tenant_id,task_id,session_id,amount_minor,currency,received_day,note,recorded_by,project_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        v.id,
        a.tenantId,
        t.id,
        v.sessionId || null,
        amount,
        v.currency,
        v.day,
        v.note,
        a.id,
        t.project_id || "",
      );
    await db()
      .prepare(
        "INSERT INTO profit_receipt_goals(receipt_id,goal_id) SELECT ?::uuid,goal_id FROM task_goals WHERE task_id=? AND tenant_id=? UNION SELECT ?::uuid,goal_id FROM projects WHERE id=? AND tenant_id=? AND goal_id<>''",
      )
      .run(v.id, t.id, a.tenantId, v.id, t.project_id, a.tenantId);
    await audit(
      a.tenantId,
      a.id,
      "profit_received",
      "task",
      String(t.id),
      "Recorded an actual profit receipt",
    );
    return { id: v.id };
  });
}
