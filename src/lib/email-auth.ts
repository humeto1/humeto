import "server-only";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, withTransaction, id, hashPassword } from "./db";
import {
  emailConfigured,
  publicAppUrl,
  sendEmail,
  tokenHash,
} from "./email-delivery.mjs";
import { trialExpiry } from "./subscription-access.mjs";
export const emailReady = emailConfigured;
export async function emailLimit(email: string, purpose: string) {
  return withTransaction(async () => {
    for (const [key, max] of [
      [purpose + ":global", 150],
      [purpose + ":" + tokenHash(email), 5],
    ] as const) {
      const r = await db()
        .prepare(
          "INSERT INTO auth_email_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_email_limits.window_start=excluded.window_start THEN auth_email_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count",
        )
        .get(key, Math.floor(Date.now() / 3600000));
      if (Number(r?.count || 0) > max) return false;
    }
    return true;
  });
}
export async function sendAuthEmail(
  user: { id: string; email: string },
  purpose: "verify" | "reset",
) {
  const token = randomBytes(32).toString("base64url"),
    tid = id();
  await db()
    .prepare(
      "INSERT INTO auth_email_tokens(id,user_id,purpose,token_hash,expires_at) VALUES(?,?,?,?,?)",
    )
    .run(
      tid,
      user.id,
      purpose,
      tokenHash(token),
      Date.now() + (purpose === "verify" ? 86400000 : 3600000),
    );
  const link =
    publicAppUrl() +
    (purpose === "verify" ? "/verify-email" : "/reset-password") +
    "?token=" +
    token;
  try {
    await sendEmail({
      to: user.email,
      subject:
        purpose === "verify"
          ? "Verify your Humeto email"
          : "Reset your Humeto password",
      text:
        purpose === "verify"
          ? `Welcome to Humeto. Verify your email to start your 15-day free trial:\n\n${link}\n\nThis link expires in 24 hours. If you did not request this, you can ignore it.`
          : `Reset your Humeto password:\n\n${link}\n\nThis link expires in one hour. If you did not request this, you can ignore it.`,
      category: "account",
      key: "auth-" + tid,
    });
  } catch (e) {
    await db().prepare("DELETE FROM auth_email_tokens WHERE id=?").run(tid);
    throw e;
  }
}
export async function emailAuthAction(action: string, body: unknown) {
  if (["forgot-password", "resend-verification"].includes(action)) {
    const input = z.object({ email: z.email().max(254) }).parse(body),
      email = input.email.toLowerCase();
    if (!emailReady())
      return NextResponse.json(
        {
          error:
            "Email service is temporarily unavailable. Please try again later.",
        },
        { status: 503 },
      );
    if (await emailLimit(email, action)) {
      const user = await db()
        .prepare(
          "SELECT id,email,verification_required,email_verified_at FROM users WHERE email=?",
        )
        .get(email);
      if (
        user &&
        (action === "forgot-password" ||
          (user.verification_required && !user.email_verified_at))
      ) {
        try {
          await sendAuthEmail(
            { id: String(user.id), email: String(user.email) },
            action === "forgot-password" ? "reset" : "verify",
          );
        } catch {
          console.error("Account email delivery failed");
        }
      }
    }
    return NextResponse.json({
      ok: true,
      message:
        "If your account is eligible, an email will arrive shortly. Check your inbox and spam folder.",
    });
  }
  if (!["verify-email", "reset-password"].includes(action)) return null;
  const input = z
    .object({
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      password: z.string().min(12).max(128).optional(),
    })
    .parse(body);
  if (action === "reset-password" && !input.password)
    return NextResponse.json(
      { error: "Enter a password of at least 12 characters." },
      { status: 400 },
    );
  const passwordHash = input.password ? hashPassword(input.password) : null;
  const changed = await withTransaction(async () => {
    const t = await db()
      .prepare(
        "SELECT * FROM auth_email_tokens WHERE token_hash=? AND purpose=? FOR UPDATE",
      )
      .get(
        tokenHash(input.token),
        action === "verify-email" ? "verify" : "reset",
      );
    if (!t || t.used_at || Number(t.expires_at) <= Date.now()) return false;
    await db()
      .prepare("SELECT id FROM users WHERE id=? FOR UPDATE")
      .get(t.user_id);
    if (action === "verify-email") {
      const identity = await db()
        .prepare("SELECT email FROM users WHERE id=?")
        .get(t.user_id);
      const designated = (process.env.HUMETO_SUPER_ADMIN_EMAIL || "")
        .trim()
        .toLowerCase();
      if (designated && identity?.email === designated) {
        await db()
          .prepare(
            "UPDATE memberships SET role='platform_admin' WHERE user_id=? AND role='owner'",
          )
          .run(t.user_id);
        await db()
          .prepare(
            "INSERT INTO audit(id,tenant_id,actor_id,action,entity_type,entity_id,summary) SELECT ?,tenant_id,?,'granted','platform_admin',?,'Granted designated super-admin access after email verification' FROM memberships WHERE user_id=? AND role='platform_admin' LIMIT 1",
          )
          .run(id(), t.user_id, t.user_id, t.user_id);
      }

      const result = await db()
        .prepare(
          "UPDATE users SET email_verified_at=? WHERE id=? AND email_verified_at IS NULL",
        )
        .run(Date.now(), t.user_id);
      if (result.changes)
        await db()
          .prepare(
            "UPDATE subscriptions SET status='trial',trial_started_at=?,expires_at=? WHERE tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id=? AND role='owner') AND status='pending'",
          )
          .run(Date.now(), trialExpiry(), t.user_id);
    } else {
      await db()
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(passwordHash, t.user_id);
      await db().prepare("DELETE FROM sessions WHERE user_id=?").run(t.user_id);
      await db()
        .prepare(
          "DELETE FROM login_attempts WHERE key=(SELECT email FROM users WHERE id=?)",
        )
        .run(t.user_id);
    }
    await db()
      .prepare(
        "UPDATE auth_email_tokens SET used_at=? WHERE user_id=? AND purpose=? AND used_at=0",
      )
      .run(Date.now(), t.user_id, t.purpose);
    return true;
  });
  if (!changed)
    return NextResponse.json(
      {
        error:
          "This link is invalid, expired or already used. Request a new one.",
      },
      { status: 400 },
    );
  return NextResponse.json({
    ok: true,
    message:
      action === "verify-email"
        ? "Email verified. Your 15-day trial is ready. You can now sign in."
        : "Password updated. Please sign in with your new password.",
  });
}
