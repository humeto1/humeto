import { hasFeature } from "@/lib/feature-guard";
import { actor, isStaff, ensureOrigin, canMutate } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import {
  defaultPreferences,
  quietUntil,
  localDay,
} from "@/lib/scheduling-clock.mjs";
import {
  notificationCandidates,
  selectNotifications,
} from "../../../../shared/notification-policy.mjs";
import { z } from "zod";
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await actor();
    if (!a || !isStaff(a))
      return Response.json(
        { error: "Sign in to view notifications." },
        { status: 403 },
      );
    const v = z
      .object({
        deviceId: z.string().uuid(),
        platform: z.enum(["web", "native"]),
        activeProjectId: z.string().max(100).optional(),
        release: z.boolean().optional(),
      })
      .strict()
      .parse(await req.json());
    return await withTransaction(async () => {
      const d = db();
      await d.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":" + a.id + ":notifications",
      ]);
      if (v.release) {
        await d
          .prepare(
            "UPDATE notification_dispatches SET device_id='' WHERE tenant_id=? AND user_id=? AND device_id=? AND at>now()",
          )
          .run(a.tenantId, a.id, v.deviceId);
        return Response.json({ events: [] });
      }
      const prefs = {
        ...defaultPreferences,
        ...(await d
          .prepare(
            "SELECT * FROM task_followup_preferences WHERE tenant_id=? AND user_id=?",
          )
          .get(a.tenantId, a.id)),
      };
      if (!(await canMutate(a)) || !(await hasFeature(a.tenantId, "tasks")))
        prefs.enabled = false;
      const now = new Date();
      const reminders = await d
        .prepare(
          "SELECT r.*,t.title,t.important,t.urgent,t.stage,t.storage_state FROM task_reminders r JOIN tasks t ON t.id=r.task_id AND t.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.user_id=? AND r.status='scheduled' AND t.stage!='Done' AND t.storage_state='active' AND ((r.origin='manual' AND r.remind_at::timestamptz>=now()-interval '1 minute') OR (r.origin='automatic' AND r.remind_at::timestamptz>=now()-interval '2 days')) ORDER BY r.remind_at LIMIT 200",
        )
        .all(a.tenantId, a.id);
      const series = await d
        .prepare(
          "SELECT r.*,t.title,t.important,t.urgent,t.storage_state FROM task_recurrences r JOIN tasks t ON t.id=r.template_task_id AND t.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.user_id=? AND r.status='active' AND t.storage_state='active'",
        )
        .all(a.tenantId, a.id);
      const focus = await d
        .prepare(
          "SELECT f.*,t.title FROM focus_sessions f JOIN tasks t ON t.id=f.task_id AND t.tenant_id=f.tenant_id WHERE f.tenant_id=? AND f.user_id=? AND f.ended_at IS NULL AND t.storage_state='active'",
        )
        .get(a.tenantId, a.id);
      await d
        .prepare(
          "DELETE FROM notification_dispatches WHERE tenant_id=? AND user_id=? AND at<now()-interval '32 days'",
        )
        .run(a.tenantId, a.id);
      const history = await d
        .prepare(
          "SELECT * FROM notification_dispatches WHERE tenant_id=? AND user_id=? ORDER BY at",
        )
        .all(a.tenantId, a.id);
      if (v.activeProjectId)
        await d
          .prepare(
            "UPDATE project_chat_preferences SET last_seen_at=now() WHERE tenant_id=? AND project_id=? AND user_id=?",
          )
          .run(a.tenantId, v.activeProjectId, a.id);
      const chats = prefs.enabled
        ? await d
            .prepare(
              "SELECT p.id,p.title,GREATEST((SELECT max(c.created_at) FROM project_comments c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id AND c.author<>?),(SELECT max(f.created_at) FROM project_attachments f WHERE f.project_id=p.id AND f.tenant_id=p.tenant_id AND f.author<>?)) AS latest FROM project_chat_preferences cp JOIN projects p ON p.id=cp.project_id AND p.tenant_id=cp.tenant_id WHERE cp.tenant_id=? AND cp.user_id=? AND NOT cp.muted AND p.id<>? AND cp.last_alerted_at<now()-interval '30 minutes' AND (?='owner' OR EXISTS(SELECT 1 FROM work_assignments w WHERE w.tenant_id=p.tenant_id AND w.entity_type='project' AND w.entity_id=p.id AND w.user_id=?)) AND GREATEST((SELECT max(c.created_at) FROM project_comments c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id),(SELECT max(f.created_at) FROM project_attachments f WHERE f.project_id=p.id AND f.tenant_id=p.tenant_id))>GREATEST(cp.last_seen_at,cp.last_alerted_at)",
            )
            .all(
              a.name,
              a.name,
              a.tenantId,
              a.id,
              v.activeProjectId || "",
              a.role,
              a.id,
            )
        : [];
      const candidates = notificationCandidates({
        reminders,
        series,
        focus,
        prefs,
        now,
      });
      if (!quietUntil(now, prefs))
        for (const c of chats) {
          if (c.latest)
            candidates.push({
              key: "project:" + c.id + ":" + new Date(c.latest).toISOString(),
              kind: "project",
              projectId: c.id,
              title: "Project chat update",
              body: c.title + " has new messages or files.",
              taskIds: [],
              tier: "gentle",
              at: now.toISOString(),
              day: localDay(now, prefs.timezone),
            });
        }
      for (const old of history.filter(
        (h) =>
          prefs.enabled &&
          !quietUntil(now, prefs) &&
          h.kind === "project" &&
          Date.parse(h.at) > now.getTime(),
      )) {
        const projectId = old.payload?.projectId;
        if (
          projectId &&
          projectId !== v.activeProjectId &&
          !candidates.some((c) => c.key === old.key) &&
          (await d
            .prepare(
              "SELECT p.id FROM project_chat_preferences cp JOIN projects p ON p.id=cp.project_id AND p.tenant_id=cp.tenant_id WHERE cp.tenant_id=? AND cp.user_id=? AND cp.project_id=? AND NOT cp.muted AND (?='owner' OR EXISTS(SELECT 1 FROM work_assignments w WHERE w.tenant_id=p.tenant_id AND w.entity_type='project' AND w.entity_id=p.id AND w.user_id=?))",
            )
            .get(a.tenantId, a.id, projectId, a.role, a.id))
        )
          candidates.push({ ...old.payload, at: old.at });
      }
      const selected = selectNotifications(
        candidates,
        history,
        prefs,
        now,
      ).slice(0, 60);
      const valid = new Set(selected.map((r) => r.key));
      for (const old of history) {
        if (Date.parse(old.at) > now.getTime() && !valid.has(old.key))
          await d
            .prepare(
              "DELETE FROM notification_dispatches WHERE tenant_id=? AND user_id=? AND key=?",
            )
            .run(a.tenantId, a.id, old.key);
      }
      const events = [];
      for (const e of selected) {
        const prior = history.find((h) => h.key === e.key);
        if (prior?.device_id && Date.parse(prior.at) <= now.getTime()) continue;
        const at =
          Date.parse(e.at) <= now.getTime()
            ? new Date(now.getTime() + 3000).toISOString()
            : e.at;
        const owner =
          prior?.device_id ||
          (v.platform === "native" || Date.parse(e.at) <= now.getTime()
            ? v.deviceId
            : "");
        await d
          .prepare(
            "INSERT INTO notification_dispatches(tenant_id,user_id,key,kind,day,at,tier,payload,device_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,user_id,key) DO UPDATE SET at=excluded.at,tier=excluded.tier,payload=excluded.payload,device_id=excluded.device_id",
          )
          .run(
            a.tenantId,
            a.id,
            e.key,
            e.kind,
            e.day,
            prior?.at || at,
            e.tier,
            JSON.stringify(e),
            owner,
          );
        if (owner && e.kind === "project")
          await d
            .prepare(
              "UPDATE project_chat_preferences SET last_alerted_at=now() WHERE tenant_id=? AND project_id=? AND user_id=?",
            )
            .run(a.tenantId, e.projectId, a.id);
        if (owner === v.deviceId) events.push({ ...e, at: prior?.at || at });
      }
      return Response.json(
        {
          events,
          preferences: prefs,
          actorKey: a.tenantId + ":" + a.id,
          serverNow: now.toISOString(),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ORIGIN")
      return Response.json({ error: "Origin not allowed." }, { status: 403 });
    return Response.json(
      { error: "Unable to prepare notifications." },
      { status: e instanceof z.ZodError ? 400 : 503 },
    );
  }
}
