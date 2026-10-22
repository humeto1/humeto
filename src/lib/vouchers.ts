import { industryKeys, industryLabel, audienceMatches } from "./industries.mjs";
import { sendEmail, emailConfigured, publicAppUrl } from "./email-delivery.mjs";
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import type { Actor } from "./types";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const normalize = (s: string) => s.trim().toUpperCase();
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
export async function voucherRead(a: Actor) {
  if (a.role === "platform_admin")
    return NextResponse.json({
      vouchers: await db()
        .prepare(
          "SELECT id,code_hint,label,audience,recipient_email,features_json,seats,case_limit,storage_mb,duration_days,starts_at,expires_at,max_uses,uses,revoked,created_at,email_status,emailed_at FROM access_vouchers ORDER BY created_at DESC LIMIT 200",
        )
        .all(),
      redemptions: await db()
        .prepare(
          "SELECT r.*,v.label,t.name AS workspace FROM voucher_redemptions r JOIN access_vouchers v ON v.id=r.voucher_id JOIN tenants t ON t.id=r.tenant_id ORDER BY redeemed_at DESC LIMIT 100",
        )
        .all(),
    });
  if (a.role !== "owner")
    return fail("Only workspace owners can manage vouchers.", 403);
  return NextResponse.json({
    redemptions: await db()
      .prepare(
        "SELECT r.id,r.redeemed_at,r.access_until,v.label FROM voucher_redemptions r JOIN access_vouchers v ON v.id=r.voucher_id WHERE r.tenant_id=? ORDER BY redeemed_at DESC",
      )
      .all(a.tenantId),
  });
}
export async function voucherWrite(a: Actor, body: unknown) {
  const action = z
    .object({ action: z.enum(["create", "revoke", "redeem", "email"]) })
    .parse(body).action;
  if (action === "email") {
    if (a.role !== "platform_admin")
      return fail("Super admin access required.", 403);
    const v = z
      .object({ id: z.string().uuid(), code: z.string().trim().min(8).max(40) })
      .parse(body);
    return NextResponse.json(await emailVoucher(a, v.id, v.code));
  }
  if (action === "create") {
    if (a.role !== "platform_admin")
      return fail("Super admin access required.", 403);
    const v = z
      .object({
        label: z.string().trim().min(2).max(100),
        code: z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9-]{8,40}$/)
          .optional(),
        audience: z.enum(["any", ...industryKeys]),
        recipientEmail: z.union([z.email(), z.literal("")]).default(""),
        features: z
          .array(z.enum(["crm", "tasks", "forms"]))
          .min(1)
          .max(3),
        seats: z.number().int().min(1).max(1000),
        caseLimit: z.number().int().min(1).max(100000),
        storageMb: z.number().int().min(1).max(1000000),
        durationDays: z.number().int().min(1).max(730),
        startsAt: z.number().int().min(0),
        expiresAt: z.number().int().positive(),
        maxUses: z.number().int().min(1).max(100000),
        emailVoucher: z.boolean().default(false),
      })
      .parse(body);
    if (v.expiresAt <= Math.max(v.startsAt, Date.now()))
      return fail(
        "Redemption expiry must be after the start date and in the future.",
      );
    if (v.emailVoucher && !v.recipientEmail)
      return fail(
        "Enter a restricted owner email before requesting email delivery.",
      );
    const code = v.code
        ? normalize(v.code)
        : randomBytes(12).toString("hex").toUpperCase(),
      vid = id();
    await withTransaction(async () => {
      await db()
        .prepare(
          "INSERT INTO access_vouchers(id,code_hash,code_hint,label,audience,recipient_email,features_json,seats,case_limit,storage_mb,duration_days,starts_at,expires_at,max_uses,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          vid,
          hash(code),
          "••••" + code.slice(-4),
          v.label,
          v.audience,
          v.recipientEmail.toLowerCase(),
          JSON.stringify([...new Set(v.features)]),
          v.seats,
          v.caseLimit,
          v.storageMb,
          v.durationDays,
          v.startsAt,
          v.expiresAt,
          v.maxUses,
          a.id,
          Date.now(),
        );
      await audit(
        a.tenantId,
        a.id,
        "created",
        "voucher",
        vid,
        "Created an access voucher: " + v.label,
      );
    });
    const delivery = v.emailVoucher
      ? await emailVoucher(a, vid, code)
      : { emailStatus: "not_requested", message: "" };
    return NextResponse.json({
      id: vid,
      code,
      ...delivery,
      message: v.emailVoucher
        ? `Voucher created. ${delivery.message || ""} Save the code before leaving this page.`
        : "Save this code now. It will not be shown again.",
    });
  }
  if (action === "revoke") {
    if (a.role !== "platform_admin")
      return fail("Super admin access required.", 403);
    const v = z.object({ id: z.string().uuid() }).parse(body);
    await withTransaction(async () => {
      const r = await db()
        .prepare("UPDATE access_vouchers SET revoked=1 WHERE id=?")
        .run(v.id);
      if (!r.changes) throw Error("VOUCHER_NOT_FOUND");
      await audit(
        a.tenantId,
        a.id,
        "revoked",
        "voucher",
        v.id,
        "Revoked future voucher redemptions; existing grants preserved",
      );
    });
    return NextResponse.json({ ok: true });
  }
  if (a.role !== "owner")
    return fail("Only a workspace owner can redeem a voucher.", 403);
  const { code } = z
    .object({ code: z.string().trim().min(8).max(40) })
    .parse(body);
  const allowed = await withTransaction(async () => {
    const r = await db()
      .prepare(
        "INSERT INTO voucher_attempts(tenant_id,window_start,count) VALUES(?,?,1) ON CONFLICT(tenant_id) DO UPDATE SET count=CASE WHEN voucher_attempts.window_start=excluded.window_start THEN voucher_attempts.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count",
      )
      .get(a.tenantId, Math.floor(Date.now() / 3600000));
    return Number(r?.count || 0) <= 15;
  });
  if (!allowed)
    return fail("Too many voucher attempts. Please try again in an hour.", 429);
  return withTransaction(async () => {
    const v = await db()
      .prepare("SELECT * FROM access_vouchers WHERE code_hash=? FOR UPDATE")
      .get(hash(normalize(code)));
    const invalid = () =>
      fail("This voucher is unavailable or is not valid for this workspace.");
    if (
      !v ||
      v.revoked ||
      Number(v.starts_at) > Date.now() ||
      Number(v.expires_at) <= Date.now() ||
      Number(v.uses) >= Number(v.max_uses)
    )
      return invalid();
    const t = await db()
      .prepare("SELECT industry FROM tenants WHERE id=? FOR UPDATE")
      .get(a.tenantId);
    if (
      !audienceMatches(v.audience, t?.industry) ||
      (v.recipient_email && v.recipient_email !== a.email.toLowerCase())
    )
      return invalid();
    if (
      await db()
        .prepare(
          "SELECT id FROM voucher_redemptions WHERE voucher_id=? AND tenant_id=?",
        )
        .get(v.id, a.tenantId)
    )
      return fail("This workspace has already redeemed this voucher.", 409);
    const s = await db()
      .prepare("SELECT * FROM subscriptions WHERE tenant_id=? FOR UPDATE")
      .get(a.tenantId);
    if (!s) return fail("Subscription not found.", 404);
    const seats = Number(
        (
          await db()
            .prepare("SELECT count(*) AS n FROM memberships WHERE tenant_id=?")
            .get(a.tenantId)
        )?.n || 0,
      ),
      cases = Number(
        (
          await db()
            .prepare("SELECT count(*) AS n FROM people WHERE tenant_id=?")
            .get(a.tenantId)
        )?.n || 0,
      ),
      storage = Number(
        (
          await db()
            .prepare(
              "SELECT COALESCE(sum(byte_size),0) AS n FROM document_versions WHERE tenant_id=?",
            )
            .get(a.tenantId)
        )?.n || 0,
      );
    if (
      seats > Number(v.seats) ||
      cases > Number(v.case_limit) ||
      storage > Number(v.storage_mb) * 1024 * 1024
    )
      return fail(
        "This voucher’s limits are below your current usage. Ask the administrator for a suitable voucher.",
      );
    if (s.status === "active" && !s.expires_at)
      return fail(
        "This workspace already has active access without an expiry.",
      );
    const oldExpiry = Date.parse(String(s.expires_at || "")),
      base = Number.isFinite(oldExpiry)
        ? Math.max(Date.now(), oldExpiry)
        : Date.now(),
      until = new Date(base + Number(v.duration_days) * 86400000).toISOString();
    await db()
      .prepare(
        "UPDATE subscriptions SET status='active',features_json=?,seats=?,case_limit=?,storage_mb=?,expires_at=?,updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE tenant_id=?",
      )
      .run(
        v.features_json,
        v.seats,
        v.case_limit,
        v.storage_mb,
        until,
        a.tenantId,
      );
    await db()
      .prepare("UPDATE access_vouchers SET uses=uses+1 WHERE id=?")
      .run(v.id);
    await db()
      .prepare(
        "INSERT INTO voucher_redemptions(id,voucher_id,tenant_id,user_id,redeemed_at,access_until) VALUES(?,?,?,?,?,?)",
      )
      .run(id(), v.id, a.tenantId, a.id, Date.now(), until);
    await db()
      .prepare(
        "UPDATE upgrade_requests SET status='resolved' WHERE tenant_id=?",
      )
      .run(a.tenantId);
    await audit(
      a.tenantId,
      a.id,
      "redeemed",
      "voucher",
      String(v.id),
      "Redeemed access voucher: " + v.label,
    );
    return NextResponse.json({
      ok: true,
      accessUntil: until,
      features: JSON.parse(String(v.features_json)),
    });
  });
}

async function emailVoucher(a: Actor, voucherId: string, code: string) {
  const v = await db()
    .prepare("SELECT * FROM access_vouchers WHERE id=? AND code_hash=?")
    .get(voucherId, hash(normalize(code)));
  if (!v)
    return {
      emailStatus: "unavailable",
      message: "Voucher code could not be verified.",
    };
  if (!v.recipient_email)
    return {
      emailStatus: "unavailable",
      message: "This voucher has no restricted owner email.",
    };
  if (
    v.revoked ||
    Number(v.expires_at) <= Date.now() ||
    Number(v.uses) >= Number(v.max_uses)
  )
    return {
      emailStatus: "unavailable",
      message: "This voucher is revoked, expired or fully used.",
    };
  if (v.email_status === "accepted")
    return {
      emailStatus: "accepted",
      message:
        "Email was already accepted by the provider. Check delivery with the recipient.",
    };
  if (!emailConfigured()) {
    await db()
      .prepare(
        "UPDATE access_vouchers SET email_status='failed' WHERE id=? AND email_status!='accepted'",
      )
      .run(voucherId);
    return {
      emailStatus: "failed",
      message:
        "Email delivery is not configured. The voucher remains valid; copy it or retry later.",
    };
  }
  const claim = await db()
    .prepare(
      "UPDATE access_vouchers SET email_status='sending',email_attempt_at=?,email_attempts=email_attempts+1 WHERE id=? AND email_status!='accepted' AND email_attempts<8 AND (email_status!='sending' OR email_attempt_at<?) RETURNING id",
    )
    .get(Date.now(), voucherId, Date.now() - 120000);
  if (!claim)
    return {
      emailStatus: String(v.email_status),
      message:
        "Email is already being sent or the retry limit has been reached.",
    };
  let status = "failed";
  try {
    const result = await sendEmail({
      to: String(v.recipient_email),
      subject: "Your Humeto access voucher",
      text: `You have received an access voucher from Humeto.

${v.label}
Voucher code: ${normalize(code)}

For: ${industryLabel(v.audience)}
Included features: ${JSON.parse(String(v.features_json)).join(", ")}
Access days: ${v.duration_days}
Seats: ${v.seats}
Cases: ${v.case_limit}
Storage: ${v.storage_mb} MB
Redeem from: ${new Date(Number(v.starts_at)).toISOString()}
Redeem before: ${new Date(Number(v.expires_at)).toISOString()}

Sign in or create an account using this email address, then open Settings and choose Redeem a voucher.
${publicAppUrl()}/workspace/settings

Redeeming replaces feature and capacity limits. Access days are added after any remaining finite access. No payment is taken.`,
      category: "optional",
      key: "voucher-email-" + voucherId,
    });
    status = result.suppressed ? "suppressed" : "accepted";
  } catch {
    status = "failed";
  }
  await db()
    .prepare(
      "UPDATE access_vouchers SET email_status=?,emailed_at=? WHERE id=?",
    )
    .run(status, status === "accepted" ? Date.now() : 0, voucherId);
  await audit(
    a.tenantId,
    a.id,
    "email_" + status,
    "voucher",
    voucherId,
    "Voucher email " + status + " for restricted owner",
  );
  return {
    emailStatus: status,
    message:
      status === "accepted"
        ? "Email accepted for sending to the restricted owner."
        : status === "suppressed"
          ? "Email was not sent because the recipient unsubscribed from optional emails."
          : "Email delivery failed. The voucher is still valid; copy the code or retry.",
  };
}
