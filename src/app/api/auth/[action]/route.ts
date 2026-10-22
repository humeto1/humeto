import { emailAuthAction, emailReady, sendAuthEmail } from "@/lib/email-auth";
import { createHash } from "node:crypto";
import { withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, hashPassword, id, audit } from "@/lib/db";
import {
  newSession,
  endSession,
  verifyPassword,
  demoAllowed,
  ensureOrigin,
} from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      action: string;
    }>;
  },
) {
  try {
    ensureOrigin(req);
    const { action } = await params;
    if (Number(req.headers.get("content-length") || 0) > 10000)
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    const body = await req.json();
    const emailResult = await emailAuthAction(action, body);
    if (emailResult) return emailResult;
    if (action === "logout") {
      await endSession();
      return NextResponse.json({ ok: true });
    }
    if (action === "demo") {
      if (!(await demoAllowed()))
        return NextResponse.json(
          { error: "Local demo entry is disabled." },
          { status: 403 },
        );
      const userId = z
        .enum([
          "admin",
          "ayesha",
          "consultant",
          "amira",
          "bright-owner",
          "solo",
        ])
        .parse(body.userId);
      const m = (await db()
        .prepare("SELECT tenant_id FROM memberships WHERE user_id=?")
        .get(userId)) as {
        tenant_id: string;
      };
      await newSession(userId, m.tenant_id);
      return NextResponse.json({ ok: true });
    }
    if (action === "login") {
      const input = z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(256),
        })
        .parse(body);
      const key = input.email.toLowerCase();
      const limit = (await db()
        .prepare("SELECT count,window_start FROM login_attempts WHERE key=?")
        .get(key)) as
        | {
            count: number;
            window_start: number;
          }
        | undefined;
      if (limit && limit.count >= 8 && Date.now() - limit.window_start < 900000)
        return NextResponse.json(
          { error: "Too many attempts. Try again in 15 minutes." },
          { status: 429 },
        );
      const user = (await db()
        .prepare("SELECT * FROM users WHERE email=?")
        .get(key)) as
        | {
            id: string;
            password_hash: string;
            email_verified_at: number | null;
            verification_required: number;
          }
        | undefined;
      const valid = verifyPassword(
        input.password,
        user?.password_hash ||
          "00000000000000000000000000000000:" + "00".repeat(64),
      );
      if (!user || !valid) {
        if (!limit || Date.now() - limit.window_start >= 900000)
          await db()
            .prepare(
              "INSERT INTO login_attempts(key,count,window_start) VALUES(?,1,?) ON CONFLICT (key) DO UPDATE SET count=EXCLUDED.count,window_start=EXCLUDED.window_start",
            )
            .run(key, Date.now());
        else
          await db()
            .prepare("UPDATE login_attempts SET count=count+1 WHERE key=?")
            .run(key);
        return NextResponse.json(
          { error: "Email or password is incorrect." },
          { status: 401 },
        );
      }
      if (user.verification_required && !user.email_verified_at)
        return NextResponse.json(
          {
            error: "Verify your email before signing in.",
            verificationRequired: true,
            email: key,
          },
          { status: 403 },
        );
      if (
        user.email_verified_at &&
        key ===
          (process.env.HUMETO_SUPER_ADMIN_EMAIL || "").trim().toLowerCase()
      ) {
        await withTransaction(async () => {
          const r = await db()
            .prepare(
              "UPDATE memberships SET role='platform_admin' WHERE user_id=? AND role='owner'",
            )
            .run(user.id);
          if (r.changes)
            await db()
              .prepare(
                "INSERT INTO audit(id,tenant_id,actor_id,action,entity_type,entity_id,summary) SELECT ?,tenant_id,?,'granted','platform_admin',?,'Granted designated super-admin access to verified account' FROM memberships WHERE user_id=? AND role='platform_admin' LIMIT 1",
              )
              .run(id(), user.id, user.id, user.id);
        });
      }
      await db().prepare("DELETE FROM login_attempts WHERE key=?").run(key);
      const m = (await db()
        .prepare("SELECT tenant_id FROM memberships WHERE user_id=? LIMIT 1")
        .get(user.id)) as {
        tenant_id: string;
      };
      await newSession(user.id, m.tenant_id);
      return NextResponse.json({ ok: true });
    }
    if (action === "register") {
      if (process.env.HUMETO_SIGNUP_ENABLED === "false")
        return NextResponse.json(
          { error: "New registrations are temporarily paused." },
          { status: 403 },
        );
      if (!emailReady())
        return NextResponse.json(
          {
            error:
              "Signup email delivery is being configured. Please try again shortly.",
          },
          { status: 503 },
        );
      const input = z
        .object({
          name: z.string().trim().min(2).max(100),
          email: z.email().max(254),
          password: z.string().min(12).max(128),
          accountType: z.enum(["individual", "company"]).default("individual"),
          companyName: z.string().trim().max(100).default(""),
          industry: z
            .enum(["consultant", "lawyer", "agency"])
            .default("consultant"),
        })
        .parse(body);
      if (input.accountType === "company" && input.companyName.length < 2)
        return NextResponse.json(
          { error: "Enter your company name." },
          { status: 400 },
        );
      const email = input.email.trim().toLowerCase();
      const permitted = await withTransaction(async () => {
        for (const [key, max] of [
          ["signup:global", 300],
          ["signup:" + createHash("sha256").update(email).digest("hex"), 5],
        ] as const) {
          const r = await db()
            .prepare(
              "INSERT INTO signup_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN signup_limits.window_start=excluded.window_start THEN signup_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count",
            )
            .get(key, Math.floor(Date.now() / 3600000));
          if (Number(r?.count || 0) > max) return false;
        }
        return true;
      });
      if (!permitted)
        return NextResponse.json(
          { error: "Too many signup attempts. Please try again later." },
          { status: 429 },
        );
      if (
        await db()
          .prepare("SELECT id FROM users WHERE email=?")
          .get(input.email.toLowerCase())
      )
        return NextResponse.json(
          { error: "This email is already registered." },
          { status: 409 },
        );
      const uid = id(),
        tid = id(),
        pid = id();
      try {
        const transactionResult = await withTransaction(async () => {
          await db()
            .prepare(
              "INSERT INTO tenants(id,name,type,industry) VALUES(?,?,?,?)",
            )
            .run(
              tid,
              input.accountType === "company"
                ? input.companyName
                : input.name + "’s workspace",
              input.accountType === "company" ? "institute" : "individual",
              input.accountType === "company" ? input.industry : "individual",
            );
          await db()
            .prepare(
              "INSERT INTO users(id,name,email,password_hash,verification_required) VALUES(?,?,?,?,1)",
            )
            .run(
              uid,
              input.name,
              input.email.toLowerCase(),
              hashPassword(input.password),
            );
          await db()
            .prepare(
              "INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)",
            )
            .run(uid, tid, "owner");
          await db()
            .prepare(
              "INSERT INTO subscriptions(tenant_id,plan,status,seats,case_limit,expires_at,trial_started_at) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              tid,
              input.accountType === "company" ? "Institute" : "Individual",
              "pending",
              input.accountType === "company" ? 5 : 1,
              input.accountType === "company" ? 100 : 1,
              "",
              0,
            );
          if (input.accountType === "individual")
            await db()
              .prepare(
                "INSERT INTO people(id,tenant_id,name,email,initials) VALUES(?,?,?,?,?)",
              )
              .run(
                pid,
                tid,
                input.name,
                input.email,
                input.name
                  .split(" ")
                  .map((x) => x[0])
                  .join("")
                  .slice(0, 2),
              );
        });
        if (transactionResult !== undefined) return transactionResult;
      } catch (e) {
        throw e;
      }
      await audit(
        tid,
        uid,
        "created",
        "workspace",
        tid,
        "Created a " + input.accountType + " workspace with a 15-day trial",
      );
      let delivered = true;
      try {
        await sendAuthEmail(
          { id: uid, email: input.email.toLowerCase() },
          "verify",
        );
      } catch {
        delivered = false;
        console.error("Signup verification email failed");
      }
      return NextResponse.json({
        ok: true,
        verificationRequired: true,
        email: input.email.toLowerCase(),
        message: delivered
          ? "Check your email to verify your account."
          : "Account created, but email delivery failed. Please use Resend verification to try again.",
      });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { error: e.issues[0]?.message || "Invalid input." },
        { status: 400 },
      );
    if (e instanceof Error && e.message === "ORIGIN")
      return NextResponse.json(
        { error: "Origin not allowed." },
        { status: 403 },
      );
    if (e && typeof e === "object" && "code" in e && e.code === "23505")
      return NextResponse.json(
        { error: "This email is already registered. Please sign in." },
        { status: 409 },
      );
    console.error("Auth request failed");
    return NextResponse.json(
      { error: "Unable to complete this request." },
      { status: 500 },
    );
  }
}
