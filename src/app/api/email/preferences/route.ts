import { NextResponse } from "next/server";
import { z } from "zod";
import { actor, ensureOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
export async function GET() {
  const a = await actor();
  if (!a)
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401 },
    );
  const p = await db()
    .prepare(
      "SELECT optional_notifications,marketing FROM email_preferences WHERE email=?",
    )
    .get(a.email.toLowerCase());
  return NextResponse.json({
    optionalNotifications: p ? !!p.optional_notifications : true,
    marketing: p ? !!p.marketing : false,
  });
}
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await actor();
    if (!a)
      return NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 },
      );
    const v = z
      .object({ optionalNotifications: z.boolean(), marketing: z.boolean() })
      .parse(await req.json());
    await db()
      .prepare(
        "INSERT INTO email_preferences(email,optional_notifications,marketing,updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET optional_notifications=excluded.optional_notifications,marketing=excluded.marketing,updated_at=excluded.updated_at",
      )
      .run(
        a.email.toLowerCase(),
        Number(v.optionalNotifications),
        Number(v.marketing),
        Date.now(),
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "Unable to update email preferences." },
      { status: e instanceof z.ZodError ? 400 : 403 },
    );
  }
}
