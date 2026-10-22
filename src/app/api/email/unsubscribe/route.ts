import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tokenHash } from "@/lib/email-delivery.mjs";
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    return NextResponse.json(
      { error: "Invalid unsubscribe link." },
      { status: 400 },
    );
  const p = await db()
    .prepare(
      "UPDATE email_preferences SET optional_notifications=0,marketing=0,updated_at=? WHERE email=(SELECT email FROM email_unsubscribe_tokens WHERE token_hash=?) RETURNING email",
    )
    .get(Date.now(), tokenHash(token));
  if (!p)
    return NextResponse.json(
      { error: "Invalid unsubscribe link." },
      { status: 400 },
    );
  return NextResponse.json({ ok: true });
}
