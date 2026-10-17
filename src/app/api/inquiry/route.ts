import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db, id, audit } from "@/lib/db";
import { ensureOrigin } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    if (Number(req.headers.get("content-length") || 0) > 10000)
      return NextResponse.json(
        { error: "Inquiry is too large." },
        { status: 413 },
      );
    const v = z
      .object({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        name: z.string().trim().min(2).max(100),
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        phone: z.string().max(50).default(""),
        destination: z.string().max(100).default(""),
        course: z.string().max(200).default(""),
        consent: z.literal(true),
        website: z.string().max(100).default(""),
      })
      .parse(await req.json());
    const d = db();
    const link = d
      .prepare(
        "SELECT l.*,s.status,s.expires_at AS subscription_expiry FROM inquiry_links l JOIN subscriptions s ON s.tenant_id=l.tenant_id WHERE token_hash=? AND revoked=0 AND l.expires_at>?",
      )
      .get(createHash("sha256").update(v.token).digest("hex"), Date.now());
    if (
      !link ||
      !["trial", "active", "grace"].includes(String(link.status)) ||
      (link.subscription_expiry &&
        String(link.subscription_expiry) <
          new Date().toISOString().slice(0, 10))
    )
      return NextResponse.json(
        { error: "This inquiry link is unavailable. Contact the institute." },
        { status: 404 },
      );
    // Link-wide limit is persistent and needs no proxy/IP trust; production adds edge bot controls.
    const window = Math.floor(Date.now() / 60000);
    const limit = d
      .prepare("SELECT * FROM inquiry_limits WHERE link_id=?")
      .get(link.id);
    if (
      limit &&
      Number(limit.window_start) === window &&
      Number(limit.count) >= 15
    )
      return NextResponse.json(
        { error: "Too many inquiries. Please try again in a minute." },
        { status: 429 },
      );
    d.prepare(
      "INSERT INTO inquiry_limits(link_id,window_start,count) VALUES(?,?,1) ON CONFLICT(link_id) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start",
    ).run(link.id, window);
    if (!v.website) {
      const exists =
        d
          .prepare(
            "SELECT id FROM leads WHERE tenant_id=? AND email=? COLLATE NOCASE",
          )
          .get(link.tenant_id, v.email) ||
        d
          .prepare(
            "SELECT id FROM people WHERE tenant_id=? AND email=? COLLATE NOCASE",
          )
          .get(link.tenant_id, v.email);
      if (!exists) {
        const lid = id();
        d.prepare(
          "INSERT INTO leads(id,tenant_id,name,email,phone,destination,course,source,notes) VALUES(?,?,?,?,?,?,?,'Inquiry',?)",
        ).run(
          lid,
          link.tenant_id,
          v.name,
          v.email,
          v.phone,
          v.destination,
          v.course,
          "Applicant consented to contact via public inquiry form. Email is self-reported, not verified.",
        );
        audit(
          String(link.tenant_id),
          String(link.created_by),
          "inquiry received",
          "lead",
          lid,
          "Received public inquiry; identity not verified",
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "ORIGIN")
      return NextResponse.json(
        { error: "Origin not allowed." },
        { status: 403 },
      );
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { error: "Check your name, email and consent." },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Unable to send inquiry. Please try again." },
      { status: 500 },
    );
  }
}
