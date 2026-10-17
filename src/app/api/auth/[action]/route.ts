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
    const body = await req.json();
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
      if (!(await demoAllowed()))
        return NextResponse.json(
          { error: "Registration is currently limited to local development." },
          { status: 403 },
        );
      const input = z
        .object({
          name: z.string().trim().min(2).max(100),
          email: z.email().max(254),
          password: z.string().min(12).max(128),
        })
        .parse(body);
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
            .prepare("INSERT INTO tenants(id,name,type) VALUES(?,?,?)")
            .run(tid, input.name + "’s workspace", "individual");
          await db()
            .prepare(
              "INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)",
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
              "INSERT INTO subscriptions(tenant_id,plan,status,seats,case_limit) VALUES(?,?,?,?,?)",
            )
            .run(tid, "Individual", "trial", 1, 1);
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
      await newSession(uid, tid);
      await audit(
        tid,
        uid,
        "created",
        "workspace",
        tid,
        "Created an individual workspace",
      );
      return NextResponse.json({ ok: true });
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
    console.error("Auth request failed");
    return NextResponse.json(
      { error: "Unable to complete this request." },
      { status: 500 },
    );
  }
}
