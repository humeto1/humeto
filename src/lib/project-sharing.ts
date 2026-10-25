import "server-only";
import { prepareProjectMedia } from "./project-media";
import { randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db, id, withTransaction, audit } from "./db";
import { actor, isStaff, canMutate, ensureOrigin } from "./auth";
import { hasFeature } from "./feature-guard";
import { emailLimit } from "./email-auth";
import { publicAppUrl, tokenHash, sendEmail } from "./email-delivery.mjs";
import { subscriptionAccess } from "./subscription-access.mjs";

class ShareError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const text = z.string().trim().min(1).max(2000);
const key = z.string().min(1).max(100);
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const secret = () => randomBytes(32).toString("base64url");
const cookieName = (share: any) => "humeto-guest-" + share.id;
async function shareLimit(shareId: string, purpose: string, max: number) {
  const row = await db()
    .prepare(
      "INSERT INTO auth_email_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_email_limits.window_start=excluded.window_start THEN auth_email_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count",
    )
    .get(
      "task-share-" + purpose + ":" + shareId,
      Math.floor(Date.now() / 3600000),
    );
  return Number(row?.count) <= max;
}
async function boundedJson(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new ShareError("Missing request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2900000) {
      await reader.cancel();
      throw new ShareError("Upload too large. Maximum 2 MB.", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function shared(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ShareError("Shared project not found.", 404);
  const share = await db()
    .prepare(
      "SELECT * FROM project_shares WHERE token_hash=? AND revoked=0 AND expires_at>?",
    )
    .get(tokenHash(token), Date.now());
  if (!share || !(await hasFeature(String(share.tenant_id), "tasks")))
    throw new ShareError("This link has expired or been revoked.", 404);
  return share;
}
async function guestAllowed(share: any) {
  if (!share.email) return true;
  const token = (await cookies()).get(cookieName(share))?.value;
  return (
    !!token &&
    !!(await db()
      .prepare(
        "SELECT token_hash FROM project_guest_sessions WHERE token_hash=? AND share_id=? AND expires_at>?",
      )
      .get(tokenHash(token), share.id, Date.now()))
  );
}
async function snapshot(
  tenant: string,
  projectId: string,
  before: string | null,
) {
  const task = await db()
    .prepare(
      "SELECT id,title,status AS stage,target_date AS due_date FROM projects WHERE id=? AND tenant_id=?",
    )
    .get(projectId, tenant);
  if (!task) throw new ShareError("Project not found.", 404);

  const links = await db()
    .prepare(
      "SELECT id,label,url FROM project_links WHERE tenant_id=? AND project_id=? ORDER BY created_at,id LIMIT 50",
    )
    .all(tenant, projectId);
  const commentRows = await db()
    .prepare(
      "SELECT id,author,content,created_at FROM project_comments WHERE tenant_id=? AND project_id=?" +
        (before
          ? " AND (created_at,id)<(SELECT created_at,id FROM project_comments WHERE id=? AND tenant_id=? AND project_id=?)"
          : "") +
        " ORDER BY created_at DESC,id DESC LIMIT 101",
    )
    .all(tenant, projectId, ...(before ? [before, tenant, projectId] : []));
  const comments = commentRows.slice(0, 100).reverse();
  const attachments = await db()
    .prepare(
      "SELECT id,name,mime,size,status,author,created_at FROM project_attachments WHERE tenant_id=? AND project_id=? ORDER BY created_at DESC,id LIMIT 20",
    )
    .all(tenant, projectId);
  return {
    project: { ...task, stageTitle: task.stage },
    links,
    comments,
    nextCursor: commentRows.length > 100 ? comments[0].id : null,
    attachments,
  };
}
function safeUrl(value: unknown) {
  const url = new URL(z.string().max(2000).parse(value));
  if (url.protocol !== "https:" || url.username || url.password)
    throw new ShareError("Use an HTTPS link without credentials.");
  return url.href;
}
function officeContainer(bytes: Buffer, required: string) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new ShareError("Invalid Office document container.");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16),
    total = 0;
  const names = [];
  if (count < 1 || count > 2000)
    throw new ShareError("Office document is too complex.");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new ShareError("Invalid Office document.");
    const flags = bytes.readUInt16LE(offset + 8),
      length = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32);
    total += bytes.readUInt32LE(offset + 24);
    if (
      flags & 1 ||
      total > 40 * 1024 * 1024 ||
      offset + 46 + length + extra + comment > bytes.length
    )
      throw new ShareError(
        "Encrypted or oversized Office documents are not accepted.",
      );
    const name = bytes
      .subarray(offset + 46, offset + 46 + length)
      .toString("utf8");
    if (
      name.includes("..") ||
      name.startsWith("/") ||
      /\.(exe|dll|js|vbs|ps1|bat|cmd|com|scr)$|vbaProject\.bin$/i.test(name)
    )
      throw new ShareError(
        "Active content is not accepted in Office documents.",
      );
    names.push(name);
    offset += 46 + length + extra + comment;
  }
  if (!names.includes("[Content_Types].xml") || !names.includes(required))
    throw new ShareError("This file does not match its Office document type.");
}
function fileType(name: string, bytes: Buffer) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf" && bytes.subarray(0, 5).toString() === "%PDF-")
    return "application/pdf";
  if (
    ext === "png" &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    ["jpg", "jpeg"].includes(ext || "") &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    ext === "webp" &&
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (
    ["docx", "xlsx"].includes(ext || "") &&
    bytes.readUInt32LE(0) === 0x04034b50
  ) {
    officeContainer(
      bytes,
      ext === "docx" ? "word/document.xml" : "xl/workbook.xml",
    );
    return ext === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  throw new ShareError(
    "Choose a PDF, DOCX, XLSX, PNG, JPEG or WebP with matching file contents.",
  );
}
export async function taskSharing(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const token = query.get("token");
    const share = token ? await shared(token) : null;
    const a = share ? null : await actor();
    const projectId = share
      ? String(share.project_id)
      : key.parse(query.get("projectId"));
    const tenant = share ? String(share.tenant_id) : a?.tenantId;
    if (
      !share &&
      (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
    )
      throw new ShareError("Sign in to manage project sharing.", 403);
    if (!tenant) throw new ShareError("Not permitted.", 403);
    await db()
      .prepare("SELECT id FROM projects WHERE id=? AND tenant_id=?")
      .get(projectId, tenant)
      .then((t) => {
        if (!t) throw new ShareError("Project not found.", 404);
      });
    if (
      a &&
      a.role !== "owner" &&
      !(await db()
        .prepare(
          "SELECT user_id FROM work_assignments WHERE tenant_id=? AND entity_type='project' AND entity_id=? AND user_id=?",
        )
        .get(tenant, projectId, a.id))
    )
      throw new ShareError(
        "Only this project's team and invited clients can open its conversation.",
        403,
      );
    const allowed = !share || (await guestAllowed(share));
    if (req.method === "GET") {
      if (!allowed)
        return Response.json(
          { locked: true, emailRequired: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      if (query.has("attachment")) {
        const file = await db()
          .prepare(
            "SELECT name,mime,bytes,status FROM project_attachments WHERE id=? AND project_id=? AND tenant_id=?",
          )
          .get(query.get("attachment"), projectId, tenant);
        if (!file || file.status !== "clean")
          throw new ShareError(
            "This file is awaiting a security scan or was rejected.",
            403,
          );
        if (query.get("media") === "1") {
          if (!/^(image\/(png|jpeg|webp)|audio\/wav)$/.test(String(file.mime)))
            throw new ShareError("Preview unavailable.");
          return Response.json(
            {
              mime: file.mime,
              bytes: Buffer.from(file.bytes as Buffer).toString("base64"),
            },
            { headers: { "Cache-Control": "private, no-store" } },
          );
        }
        return new Response(new Uint8Array(file.bytes as Buffer), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(file.name))}`,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "sandbox; default-src 'none'",
          },
        });
      }
      const state = await snapshot(tenant, projectId, query.get("before"));
      if (share) {
        const challenge = id();
        await db()
          .prepare("DELETE FROM project_share_challenges WHERE issued_at<?")
          .run(Date.now() - 3600000);
        // Bound anonymous form issuance as well as submissions.
        if (!(await shareLimit(share.id, "read", 240)))
          throw new ShareError("Please try again later.", 429);
        await db()
          .prepare(
            "INSERT INTO project_share_challenges(id,share_id,issued_at) VALUES(?,?,?)",
          )
          .run(challenge, share.id, Date.now());
        return Response.json(
          { ...state, permission: share.permission, challenge },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const chatPref = await db()
        .prepare(
          "UPDATE project_chat_preferences SET last_seen_at=now() WHERE tenant_id=? AND project_id=? AND user_id=? RETURNING muted",
        )
        .get(tenant, projectId, a!.id);
      const shares = await db()
        .prepare(
          "SELECT id,email,permission,expires_at,revoked FROM project_shares WHERE tenant_id=? AND project_id=? ORDER BY created_at DESC LIMIT 50",
        )
        .all(tenant, projectId);
      return Response.json(
        {
          ...state,
          shares: a?.role === "owner" ? shares : [],
          canManage: a?.role === "owner",
          chatMuted: chatPref?.muted ?? true,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    ensureOrigin(req);
    const body = await boundedJson(req);
    let createdUrl: string | undefined;
    const operation = z.string().parse(body.operation);
    if (a && a.role !== "owner" && ["share", "revoke"].includes(operation))
      throw new ShareError(
        "Only workspace owners can manage client invitations.",
        403,
      );
    if (share && operation === "request-code") {
      if (!share.email || email.parse(body.email) !== share.email)
        throw new ShareError("Use the invited email address.", 403);
      if (!(await emailLimit(String(share.email), "task-share-code")))
        throw new ShareError("Please try again later.", 429);
      const code = String(randomInt(10000000, 100000000));
      await db()
        .prepare(
          "INSERT INTO project_share_codes(id,share_id,code_hash,expires_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0",
        )
        .run(share.id, share.id, tokenHash(code), Date.now() + 600000);
      await sendEmail({
        to: String(share.email),
        subject: "Your Humeto project access code",
        text: `Your project access code is ${code}. It expires in 10 minutes.`,
        category: "account",
        key: "task-code-" + id(),
      });
      return Response.json({ sent: true });
    }
    if (share && operation === "verify-code") {
      const code = z
        .string()
        .regex(/^\d{8}$/)
        .parse(body.code);
      const verified = await withTransaction(async () => {
        const row = await db()
          .prepare(
            "UPDATE project_share_codes SET attempts=attempts+1 WHERE id=? AND expires_at>? AND attempts<5 RETURNING code_hash",
          )
          .get(share.id, Date.now());
        if (!row || row.code_hash !== tokenHash(code)) return false;
        await db()
          .prepare("DELETE FROM project_share_codes WHERE id=?")
          .run(share.id);
        return true;
      });
      if (!verified) throw new ShareError("Incorrect or expired code.", 403);
      const session = secret();
      await db()
        .prepare(
          "INSERT INTO project_guest_sessions(token_hash,share_id,expires_at) VALUES(?,?,?)",
        )
        .run(
          tokenHash(session),
          share.id,
          Math.min(Number(share.expires_at), Date.now() + 86400000),
        );
      (await cookies()).set(cookieName(share), session, {
        httpOnly: true,
        secure:
          process.env.NODE_ENV === "production" &&
          process.env.HUMETO_ISOLATED_QA !== "true",
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
      });
      return Response.json({ verified: true });
    }
    if (!allowed) throw new ShareError("Verify your invited email first.", 403);
    if (a && !(await canMutate(a)))
      throw new ShareError("Workspace is read-only.", 403);
    if (share) {
      const subscription = await db()
        .prepare(
          "SELECT status,expires_at FROM subscriptions WHERE tenant_id=?",
        )
        .get(tenant);
      if (!subscriptionAccess(subscription))
        throw new ShareError("Workspace is read-only.", 403);
      if (share.permission !== "contribute")
        throw new ShareError("This link is view-only.", 403);
      if (body.website) throw new ShareError("Unable to accept submission.");
      if (!(await shareLimit(share.id, "write", 20)))
        throw new ShareError(
          "Submission limit reached. Please try later.",
          429,
        );
      const challenge = await db()
        .prepare(
          "DELETE FROM project_share_challenges WHERE id=? AND share_id=? AND issued_at<? AND issued_at>? RETURNING id",
        )
        .get(
          key.parse(body.challenge),
          share.id,
          Date.now() - 1500,
          Date.now() - 3600000,
        );
      if (!challenge)
        throw new ShareError(
          "Please wait a moment, refresh, then try again.",
          429,
        );
    }
    const author = share
      ? share.email
        ? String(share.email)
        : z
            .string()
            .trim()
            .min(2)
            .max(80)
            .parse(body.author || "Guest") + " (guest)"
      : a!.name;
    await withTransaction(async () => {
      await db()
        .prepare("SELECT id FROM tenants WHERE id=? FOR UPDATE")
        .get(tenant);
      await db()
        .prepare(
          "SELECT id FROM projects WHERE id=? AND tenant_id=? FOR UPDATE",
        )
        .get(projectId, tenant);
      if (a && operation === "chat-alerts") {
        const muted = z.boolean().parse(body.muted);
        await db()
          .prepare(
            "INSERT INTO project_chat_preferences(tenant_id,project_id,user_id,muted,last_seen_at) VALUES(?,?,?,?,now()) ON CONFLICT(tenant_id,project_id,user_id) DO UPDATE SET muted=excluded.muted,last_seen_at=now()",
          )
          .run(tenant, projectId, a.id, muted);
      } else if (operation === "link") {
        const count = await db()
          .prepare(
            "SELECT count(*)::int AS n FROM project_links WHERE project_id=? AND tenant_id=?",
          )
          .get(projectId, tenant);
        if (Number(count?.n) >= 50)
          throw new ShareError("Maximum 50 links per project.");
        await db()
          .prepare(
            "INSERT INTO project_links(id,tenant_id,project_id,label,url) VALUES(?,?,?,?,?)",
          )
          .run(
            id(),
            tenant,
            projectId,
            z.string().trim().min(1).max(120).parse(body.label),
            safeUrl(body.url),
          );
      } else if (operation === "comment") {
        await db()
          .prepare(
            "INSERT INTO project_comments(id,tenant_id,project_id,share_id,author,content) VALUES(?,?,?,?,?,?)",
          )
          .run(
            id(),
            tenant,
            projectId,
            share?.id || null,
            author,
            text.parse(body.content),
          );
      } else if (operation === "upload") {
        const name = z
          .string()
          .min(1)
          .max(150)
          .regex(/^[^/\\\x00-\x1f]+$/)
          .parse(body.name);
        const encoded = z
          .string()
          .max(2800000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/)
          .parse(body.bytes);
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length < 12 || bytes.length > 2 * 1024 * 1024)
          throw new ShareError("Choose a file up to 2 MB.");
        let media;
        try {
          media = await prepareProjectMedia(name, bytes);
        } catch (e) {
          throw new ShareError((e as Error).message);
        }
        const mime = media?.mime || fileType(name, bytes);
        const storedBytes = media?.bytes || bytes;
        const usage = await db()
          .prepare(
            "SELECT count(*)::int AS n,coalesce(sum(size),0) AS size FROM project_attachments WHERE project_id=? AND tenant_id=?",
          )
          .get(projectId, tenant);
        const total = await db()
          .prepare(
            "SELECT coalesce(sum(size),0) AS size FROM project_attachments WHERE tenant_id=?",
          )
          .get(tenant);
        if (
          Number(usage?.n) >= 20 ||
          Number(usage?.size) + storedBytes.length > 20 * 1024 * 1024 ||
          Number(total?.size) + storedBytes.length > 100 * 1024 * 1024
        )
          throw new ShareError(
            "Project or workspace attachment limit reached.",
          );
        await db()
          .prepare(
            "INSERT INTO project_attachments(id,tenant_id,project_id,share_id,author,name,mime,bytes,size,status) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            tenant,
            projectId,
            share?.id || null,
            author,
            name,
            mime,
            storedBytes,
            storedBytes.length,
            media?.clean ? "clean" : "quarantined",
          );
      } else if (a && operation === "share") {
        const count = await db()
          .prepare(
            "SELECT count(*)::int AS n FROM project_shares WHERE tenant_id=? AND project_id=? AND revoked=0 AND expires_at>?",
          )
          .get(tenant, projectId, Date.now());
        if (Number(count?.n) >= 50)
          throw new ShareError("Maximum 50 active share links per project.");
        const target = body.email ? email.parse(body.email) : "";
        const permission = z
          .enum(["view", "contribute"])
          .parse(body.permission);
        const days = z
          .number()
          .int()
          .min(1)
          .max(90)
          .parse(body.days || 30);
        const shareToken = secret(),
          sid = id();
        await db()
          .prepare(
            "INSERT INTO project_shares(id,tenant_id,project_id,token_hash,email,permission,created_by,expires_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            sid,
            tenant,
            projectId,
            tokenHash(shareToken),
            target,
            permission,
            a.id,
            Date.now() + days * 86400000,
          );
        createdUrl = publicAppUrl() + "/shared-project/" + shareToken;
      } else if (a && operation === "revoke") {
        await db()
          .prepare(
            "UPDATE project_shares SET revoked=1 WHERE id=? AND tenant_id=? AND project_id=?",
          )
          .run(key.parse(body.id), tenant, projectId);
      } else if (a && operation === "remove-link") {
        await db()
          .prepare(
            "DELETE FROM project_links WHERE id=? AND tenant_id=? AND project_id=?",
          )
          .run(key.parse(body.id), tenant, projectId);
      } else if (a && operation === "remove-file") {
        await db()
          .prepare(
            "DELETE FROM project_attachments WHERE id=? AND tenant_id=? AND project_id=?",
          )
          .run(key.parse(body.id), tenant, projectId);
      } else throw new ShareError("Action not permitted.", 403);
      await audit(
        tenant,
        a?.id || "guest",
        operation,
        "project",
        projectId,
        "Project collaboration updated",
      );
    });
    return Response.json({
      saved: true,
      ...(createdUrl ? { url: createdUrl } : {}),
    });
  } catch (error) {
    if (error instanceof ShareError)
      return Response.json({ error: error.message }, { status: error.status });
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === "Invalid URL")
    )
      return Response.json(
        { error: "Check the supplied details." },
        { status: 400 },
      );
    if (error instanceof Error && error.message === "ORIGIN")
      return Response.json({ error: "Origin not allowed." }, { status: 403 });
    console.error(
      "Project sharing failed",
      error instanceof Error ? error.name : "Unknown",
    );
    return Response.json(
      { error: "Unable to update this shared project." },
      { status: 500 },
    );
  }
}
