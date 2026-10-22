import { hasFeature } from "@/lib/feature-guard";
import { actor, canMutate, ensureOrigin, isStaff } from "@/lib/auth";
import { db, id, audit } from "@/lib/db";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET() {
  const a = await actor();
  if (a && !(await hasFeature(a.tenantId, "crm")))
    return Response.json(
      { error: "This feature is not included in your workspace access." },
      { status: 403 },
    );
  if (!a || !isStaff(a))
    return Response.json(
      { error: "Company staff access required" },
      { status: 403 },
    );
  const connection = await db()
    .prepare(
      "SELECT status,phone,qr,qr_expires,heartbeat,error FROM whatsapp_connections WHERE tenant_id=?",
    )
    .get(a.tenantId);
  if (
    connection &&
    (a.role !== "owner" || Number(connection.qr_expires) < Date.now())
  )
    connection.qr = null;
  const messages = await db()
    .prepare(
      "SELECT id,remote,body,direction,status,created_at FROM whatsapp_messages WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",
    )
    .all(a.tenantId);
  return Response.json(
    { connection: connection || null, messages, owner: a.role === "owner" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await actor();
    if (a && !(await hasFeature(a.tenantId, "crm")))
      return Response.json(
        { error: "This feature is not included in your workspace access." },
        { status: 403 },
      );
    if (!a || !(await canMutate(a)))
      return Response.json(
        { error: "Active company staff access required" },
        { status: 403 },
      );
    const b = z
      .object({
        action: z.enum(["connect", "disconnect", "draft", "send"]),
        remote: z.string().optional(),
        body: z.string().max(4000).optional(),
        id: z.string().optional(),
      })
      .parse(await req.json());
    if (["connect", "disconnect"].includes(b.action)) {
      if (a.role !== "owner")
        return Response.json(
          { error: "Only the company owner can pair or disconnect" },
          { status: 403 },
        );
      await db()
        .prepare(
          "INSERT INTO whatsapp_connections(tenant_id,desired,updated_at) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET desired=excluded.desired,updated_at=excluded.updated_at,qr=NULL",
        )
        .run(a.tenantId, b.action === "connect" ? "on" : "off", Date.now());
      if (b.action === "disconnect")
        await db()
          .prepare(
            "UPDATE whatsapp_messages SET status='cancelled' WHERE tenant_id=? AND status='queued'",
          )
          .run(a.tenantId);
    } else if (b.action === "draft") {
      const phone = z
        .string()
        .regex(/^\+[1-9]\d{7,14}$/)
        .parse(b.remote);
      const body = z.string().trim().min(1).max(4000).parse(b.body);
      const c = await db()
        .prepare("SELECT tenant_id FROM whatsapp_connections WHERE tenant_id=?")
        .get(a.tenantId);
      if (!c)
        return Response.json(
          { error: "Ask your company owner to configure WhatsApp first" },
          { status: 409 },
        );
      await db()
        .prepare(
          "INSERT INTO whatsapp_messages(id,tenant_id,remote,body,direction,status,created_at,author_id) VALUES(?,?,?,?,'out','draft',?,?)",
        )
        .run(
          id(),
          a.tenantId,
          phone.slice(1) + "@s.whatsapp.net",
          body,
          Date.now(),
          a.id,
        );
    } else {
      const c = await db()
        .prepare(
          "SELECT tenant_id FROM whatsapp_connections WHERE tenant_id=? AND status='connected' AND desired='on' AND heartbeat>?",
        )
        .get(a.tenantId, Date.now() - 30000);
      if (!c)
        return Response.json(
          { error: "WhatsApp worker must be connected before sending" },
          { status: 409 },
        );
      const r = await db()
        .prepare(
          "UPDATE whatsapp_messages SET status='queued' WHERE id=? AND tenant_id=? AND direction='out' AND status='draft'",
        )
        .run(b.id || "", a.tenantId);
      if (!r.changes)
        return Response.json(
          { error: "Draft unavailable or already sent" },
          { status: 409 },
        );
    }
    await audit(
      a.tenantId,
      a.id,
      "whatsapp." + b.action,
      "whatsapp",
      a.tenantId,
      "Company WhatsApp " + b.action,
    );
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      {
        error:
          "Invalid request. Use an international phone number and a message.",
      },
      { status: 400 },
    );
  }
}
