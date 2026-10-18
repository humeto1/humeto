import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import { canMutate } from "./auth";
import type { Actor } from "./types";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
export const announcementImages = [
  "",
  "/assets/campus.webp",
  "/assets/library.webp",
  "/assets/consultant.webp",
  "/assets/hero-tasks.webp",
  "/assets/hero-assistant.webp",
] as const;
const content = z.object({
  title: z.string().trim().min(2).max(150),
  body: z.string().trim().min(1).max(4000),
  audience: z.enum(["all", "staff", "students", "selected"]),
  userIds: z.array(z.string().max(100)).max(1000).default([]),
  popup: z.boolean(),
  image: z.enum(announcementImages).default(""),
  ctaLabel: z.string().trim().max(60).default(""),
  ctaPath: z
    .string()
    .max(250)
    .default("")
    .refine(
      (v) =>
        !v || /^\/workspace(?:\/[A-Za-z0-9_-]+)*(?:#[A-Za-z0-9_-]+)?$/.test(v),
      "Use an internal workspace link.",
    ),
  startsAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
const command = z.discriminatedUnion("action", [
  content.extend({ action: z.literal("draft") }),
  z.object({
    action: z.enum(["publish", "retract"]),
    id: z.string().uuid(),
    revision: z.number().int().positive(),
  }),
  z.object({ action: z.enum(["read", "dismiss"]), id: z.string().uuid() }),
]);
export async function announcementsRead(a: Actor) {
  if (a.role === "platform_admin")
    return fail("Company announcements are private to company accounts.", 403);
  const d = db();
  const inbox = await d
    .prepare(
      "SELECT n.id,n.title,n.body,n.popup,n.image,n.cta_label,n.cta_path,n.starts_at,n.expires_at,r.read_at,r.popup_dismissed_at FROM announcement_recipients r JOIN company_announcements n ON n.id=r.announcement_id AND n.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.user_id=? AND n.status='published' AND n.starts_at<=clock_timestamp() AND n.expires_at>clock_timestamp() ORDER BY n.published_at DESC LIMIT 100",
    )
    .all(a.tenantId, a.id);
  const campaigns =
    a.role === "owner"
      ? await d
          .prepare(
            "SELECT n.*,(SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=n.id) AS recipient_count,(SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=n.id AND r.read_at IS NOT NULL) AS read_count,(SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=n.id AND r.popup_dismissed_at IS NOT NULL) AS dismissed_count FROM company_announcements n WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",
          )
          .all(a.tenantId)
      : [];
  const members =
    a.role === "owner"
      ? await d
          .prepare(
            "SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('owner','consultant','student') ORDER BY u.name",
          )
          .all(a.tenantId)
      : [];
  return NextResponse.json(
    { inbox, campaigns, members, canPublish: a.role === "owner" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function announcementsWrite(a: Actor, body: unknown) {
  if (a.role === "platform_admin") return fail("Company access required.", 403);
  const v = command.parse(body),
    d = db();
  if (v.action === "read" || v.action === "dismiss") {
    const result = await d
      .prepare(
        `UPDATE announcement_recipients r SET read_at=COALESCE(r.read_at,clock_timestamp())${v.action === "dismiss" ? ",popup_dismissed_at=COALESCE(r.popup_dismissed_at,clock_timestamp())" : ""} FROM company_announcements n WHERE r.announcement_id=? AND r.tenant_id=? AND r.user_id=? AND n.id=r.announcement_id AND n.tenant_id=r.tenant_id AND n.status='published' AND n.starts_at<=clock_timestamp() AND n.expires_at>clock_timestamp()`,
      )
      .run(v.id, a.tenantId, a.id);
    return result.changes
      ? NextResponse.json({ ok: true })
      : fail("Notification not found.", 404);
  }
  if (a.role !== "owner" || !(await canMutate(a)))
    return fail("Only an active company admin can publish announcements.", 403);
  return withTransaction(async () => {
    if (v.action === "draft") {
      if (
        Date.parse(v.expiresAt) <= Math.max(Date.parse(v.startsAt), Date.now())
      )
        return fail("Expiry must be after the start and in the future.");
      if (!!v.ctaLabel !== !!v.ctaPath)
        return fail(
          "Add both a button label and a workspace link, or leave both empty.",
        );
      const users = [...new Set(v.userIds)];
      if (v.audience === "selected" && !users.length)
        return fail("Select at least one recipient.");
      for (const user of users)
        if (
          !(await d
            .prepare(
              "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? AND role IN ('owner','consultant','student')",
            )
            .get(a.tenantId, user))
        )
          return fail("Choose recipients from this company.", 400);
      const nid = id();
      await d
        .prepare(
          "INSERT INTO company_announcements(id,tenant_id,author_id,title,body,audience,popup,image,cta_label,cta_path,starts_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          nid,
          a.tenantId,
          a.id,
          v.title,
          v.body,
          v.audience,
          v.popup,
          v.image,
          v.ctaLabel,
          v.ctaPath,
          v.startsAt,
          v.expiresAt,
        );
      // Selected recipients are frozen at draft time; broad audiences are resolved on publication.
      if (v.audience === "selected")
        for (const user of users)
          await d
            .prepare(
              "INSERT INTO announcement_recipients(announcement_id,tenant_id,user_id) VALUES(?,?,?)",
            )
            .run(nid, a.tenantId, user);
      await audit(
        a.tenantId,
        a.id,
        "draft",
        "announcement",
        nid,
        "Prepared a company announcement",
      );
      return NextResponse.json({ ok: true, id: nid });
    }
    const n = await d
      .prepare(
        "SELECT * FROM company_announcements WHERE id=? AND tenant_id=? FOR UPDATE",
      )
      .get(v.id, a.tenantId);
    if (!n) return fail("Announcement not found.", 404);
    if (!("revision" in v) || n.revision !== v.revision)
      return fail("Announcement changed. Refresh before continuing.", 409);
    if (v.action === "publish") {
      if (n.status !== "draft")
        return fail("Only a draft can be published.", 409);
      if (Date.parse(n.expires_at) <= Date.now())
        return fail("This draft has expired. Create a new one.", 409);
      if (n.audience !== "selected")
        await d
          .prepare(
            "INSERT INTO announcement_recipients(announcement_id,tenant_id,user_id) SELECT ?,tenant_id,user_id FROM memberships WHERE tenant_id=? AND role IN ('owner','consultant','student') AND (?='all' OR (?='staff' AND role IN ('owner','consultant')) OR (?='students' AND role='student')) ON CONFLICT DO NOTHING",
          )
          .run(n.id, a.tenantId, n.audience, n.audience, n.audience);
      await d
        .prepare(
          "DELETE FROM announcement_recipients r WHERE announcement_id=? AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=r.tenant_id AND m.user_id=r.user_id)",
        )
        .run(n.id);
      const count = await d
        .prepare(
          "SELECT count(*) AS n FROM announcement_recipients WHERE announcement_id=?",
        )
        .get(n.id);
      if (!Number(count!.n))
        return fail("No current recipients match this audience.");
      await d
        .prepare(
          "UPDATE company_announcements SET status='published',published_at=clock_timestamp(),revision=revision+1 WHERE id=?",
        )
        .run(n.id);
    } else {
      if (n.status !== "published")
        return fail("Only a published announcement can be retracted.", 409);
      await d
        .prepare(
          "UPDATE company_announcements SET status='retracted',revision=revision+1 WHERE id=?",
        )
        .run(n.id);
    }
    await audit(
      a.tenantId,
      a.id,
      v.action,
      "announcement",
      n.id,
      "Updated company announcement publication",
    );
    return NextResponse.json({ ok: true });
  });
}
