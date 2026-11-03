import { actor, ensureOrigin, isStaff, canMutate } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { db, withTransaction } from "@/lib/db";
import { POST as dispatch } from "../workspace/[...path]/route";
import { createHash } from "node:crypto";
import { z } from "zod";
export const runtime = "nodejs";
const schema = z.object({
  id: z.uuid(),
  owner: z.string().min(1).max(300),
  path: z.string().max(300),
  method: z.enum(["POST", "PATCH"]),
  at: z.iso.datetime(),
  body: z.record(z.string(), z.unknown()),
});
class SyncFailure extends Error {
  constructor(public response: Response) {
    super("Sync declined");
  }
}
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await actor();
    if (!a)
      return Response.json(
        {
          error:
            "Sign in again to sync. Your offline changes remain on this device.",
        },
        { status: 401 },
      );
    if (
      !isStaff(a) ||
      !(await canMutate(a)) ||
      !(await hasFeature(a.tenantId, "tasks"))
    )
      return Response.json(
        {
          error:
            "This workspace is read-only. Your offline changes have been kept.",
        },
        { status: 403 },
      );
    const raw = await req.text();
    if (raw.length > 64000)
      return Response.json(
        { error: "This saved change is too large." },
        { status: 413 },
      );
    const v = schema.parse(JSON.parse(raw));
    if (v.owner !== a.tenantId + ":" + a.id)
      return Response.json(
        { error: "Sign in to the account that made these changes." },
        { status: 403 },
      );
    if (
      !/^\/api\/workspace\/(tasks|task-links|task-storage|projects|goals|focus)(\/[A-Za-z0-9_-]+)?$/.test(
        v.path,
      )
    )
      return Response.json(
        { error: "This action needs a live connection." },
        { status: 400 },
      );
    const parts = v.path.slice("/api/workspace/".length).split("/");
    if (parts[0] === "focus" && parts.length !== 1)
      return Response.json(
        { error: "Unsupported focus operation." },
        { status: 400 },
      );
    const at = Date.parse(v.at);
    if (at > Date.now() + 300000 || at < Date.now() - 366 * 86400000)
      return Response.json(
        { error: "Check the phone date and time before syncing." },
        { status: 409 },
      );
    const hash = createHash("sha256").update(JSON.stringify(v)).digest("hex");
    const result = await withTransaction(async () => {
      await db()
        .prepare(
          "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
        )
        .get(a.tenantId, a.id);
      const previous = await db()
        .prepare(
          "SELECT payload_hash,result FROM mobile_sync_commands WHERE tenant_id=? AND user_id=? AND command_id=?",
        )
        .get(a.tenantId, a.id, v.id);
      if (previous) {
        if (previous.payload_hash !== hash)
          throw new SyncFailure(
            Response.json(
              {
                error:
                  "This saved change has a different payload. Review sync.",
              },
              { status: 409 },
            ),
          );
        return previous.result;
      }
      const active = await db()
        .prepare(
          "SELECT id,task_id,started_at,running_since FROM focus_sessions WHERE tenant_id=? AND user_id=? AND ended_at IS NULL FOR UPDATE",
        )
        .get(a.tenantId, a.id);
      if (
        parts[0] === "focus" &&
        active &&
        at < Date.parse(String(active.running_since || active.started_at))
      )
        throw new SyncFailure(
          Response.json(
            {
              error:
                "Focus changed on another device, or the phone clock changed. Review before syncing.",
            },
            { status: 409 },
          ),
        );
      const affectedTask =
        parts[0] === "focus"
          ? v.body.taskId || active?.task_id || null
          : ["tasks", "task-storage"].includes(parts[0])
            ? parts[1]
            : null;
      if (
        affectedTask &&
        (v.body.stage === "Done" ||
          v.body.action === "complete" ||
          parts[0] === "task-storage")
      ) {
        const later = await db()
          .prepare(
            "SELECT id FROM focus_sessions WHERE tenant_id=? AND task_id=? AND ended_at IS NULL AND COALESCE(running_since,started_at)>? LIMIT 1",
          )
          .get(a.tenantId, affectedTask, v.at);
        if (later)
          throw new SyncFailure(
            Response.json(
              {
                error:
                  "Someone started working on this task after your offline change. Review the current task before syncing.",
              },
              { status: 409 },
            ),
          );
      }
      await db().query("SELECT set_config('humeto.action_time',$1,true)", [
        v.at,
      ]);
      const forwarded = new Request(new URL(v.path, req.url), {
        method: v.method,
        headers: req.headers,
        body: JSON.stringify(v.body),
      });
      const response = await dispatch(forwarded, {
        params: Promise.resolve({ path: parts }),
      });
      const output = await response.json();
      if (!response.ok)
        throw new SyncFailure(
          Response.json(output, { status: response.status }),
        );
      await db().query("SELECT set_config('humeto.action_time','',true)");
      await db()
        .prepare(
          "INSERT INTO mobile_sync_commands(tenant_id,user_id,command_id,payload_hash,result,client_at) VALUES(?,?,?,?,?::jsonb,?)",
        )
        .run(a.tenantId, a.id, v.id, hash, JSON.stringify(output), v.at);
      return output;
    });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof SyncFailure) return error.response;
    if (error instanceof z.ZodError)
      return Response.json({ error: "Invalid saved change." }, { status: 400 });
    if (error instanceof Error && error.message === "ORIGIN")
      return Response.json({ error: "Origin not allowed." }, { status: 403 });
    console.error(
      "Mobile sync failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.json(
      {
        error:
          "Sync is temporarily unavailable. Changes remain on this device.",
      },
      { status: 500 },
    );
  }
}
