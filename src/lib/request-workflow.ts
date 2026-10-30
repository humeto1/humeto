import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { db, id, audit } from "./db";
import { canSeePerson, isStaff } from "./auth";
import { sections } from "./sections";
import { transaction } from "./crm";
import { proposeExpectedDate } from "./request-dates";
import { localInstant, validTimezone } from "./agent/dates";
import type { Actor } from "./types";
export class RequestWorkflowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function timezone(value: string) {
  try {
    return validTimezone(value);
  } catch {
    throw new RequestWorkflowError("Choose a valid timezone.");
  }
}
function followupInstant(day: string, zone: string) {
  timezone(zone);
  try {
    return localInstant(day, 9, 0, zone);
  } catch (error) {
    throw new RequestWorkflowError((error as Error).message);
  }
}
export type RequestRow = {
  id: string;
  tenant_id: string;
  person_id: string;
  section_key: string;
  title: string;
  message: string;
  status: string;
  created_by: string;
  revision: number;
  requires_document: number;
  follow_up_at: string;
  follow_up_timezone: string;
  follow_up_task_id: string;
  document_id: string;
  document_version: number;
  review_note: string;
  person_name?: string;
  created_at: string;
};
export async function requestFor(a: Actor, rid: string) {
  const r = (await db()
    .prepare(
      "SELECT r.*,p.name AS person_name FROM requests r JOIN people p ON p.id=r.person_id AND p.tenant_id=r.tenant_id WHERE r.id=? AND r.tenant_id=?",
    )
    .get(rid, a.tenantId)) as unknown as RequestRow | undefined;
  if (
    !r ||
    !(await canSeePerson(a, r.person_id)) ||
    (sections.find((s) => s.key === r.section_key)?.restricted &&
      !["owner", "student"].includes(a.role))
  )
    throw new RequestWorkflowError("Request not found.", 404);
  return r;
}
function revision(r: RequestRow, expected: number) {
  if (r.revision !== expected)
    throw new RequestWorkflowError(
      "This request changed. Refresh and review the latest reply.",
      409,
    );
}
async function record(
  a: Actor,
  r: RequestRow,
  event: string,
  note = "",
  docId = r.document_id,
  version = r.document_version,
) {
  await db()
    .prepare(
      "INSERT INTO request_events(id,tenant_id,request_id,actor_id,event,note,document_id,document_version) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(id(), a.tenantId, r.id, a.id, event, note, docId, version);
  await audit(
    a.tenantId,
    a.id,
    event,
    "request",
    r.id,
    "Updated request conversation / follow-up",
  );
}
async function stopFollowup(a: Actor, r: RequestRow) {
  if (!r.follow_up_task_id) return;
  await db()
    .prepare(
      "UPDATE task_reminders SET status='completed' WHERE tenant_id=? AND task_id=? AND status='scheduled'",
    )
    .run(a.tenantId, r.follow_up_task_id);
  await db()
    .prepare(
      "UPDATE tasks SET stage='Done',last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=? AND stage!='Done'",
    )
    .run(a.id, r.follow_up_task_id, a.tenantId);
}
async function evidence(
  a: Actor,
  r: RequestRow,
  docId: string,
  version?: number,
) {
  const d = await db()
    .prepare(
      "SELECT * FROM documents WHERE id=? AND tenant_id=? AND person_id=?",
    )
    .get(docId, a.tenantId, r.person_id);
  if (
    !d ||
    (sections.find((s) => s.key === d.section_key)?.restricted &&
      !["owner", "student"].includes(a.role))
  )
    throw new RequestWorkflowError(
      "Choose a document belonging to this applicant that you can access.",
      404,
    );
  if (version !== undefined && d.current_version !== version)
    throw new RequestWorkflowError(
      "The file has a newer version. Review it before accepting.",
      409,
    );
  return d;
}
export async function requestRead(parts: string[], a: Actor) {
  if (parts[0] !== "requests" || !parts[1]) return null;
  const r = await requestFor(a, parts[1]);
  return NextResponse.json({
    request: r,
    replies: (
      await db()
        .prepare(
          "SELECT r.*,u.name AS actor_name FROM request_replies r JOIN users u ON u.id=r.actor_id WHERE r.tenant_id=? AND r.request_id=? ORDER BY r.created_at,r._rowid",
        )
        .all(a.tenantId, r.id)
    ).map((x) => ({ ...x, proposal: JSON.parse(String(x.proposal)) })),
    events: await db()
      .prepare(
        "SELECT e.*,u.name AS actor_name FROM request_events e JOIN users u ON u.id=e.actor_id WHERE e.tenant_id=? AND e.request_id=? ORDER BY e.created_at DESC,e._rowid DESC",
      )
      .all(a.tenantId, r.id),
  });
}
const replySchema = z
  .object({
    revision: z.number().int().positive(),
    message: z.string().trim().max(2000).default(""),
    documentId: z.string().max(100).default(""),
    timezone: z.string().min(1).max(100),
    clientKey: z.uuid(),
  })
  .refine((v) => v.message.length > 0 || v.documentId.length > 0, {
    message: "Add a reply or a supporting document.",
  });
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function existingReply(a: Actor, rid: string, key: string, hash: string) {
  const row = await db()
    .prepare(
      "SELECT * FROM request_replies WHERE tenant_id=? AND actor_id=? AND client_key=?",
    )
    .get(a.tenantId, a.id, key);
  if (row && (row.request_id !== rid || row.payload_hash !== hash))
    throw new RequestWorkflowError(
      "Reply key already belongs to different content.",
      409,
    );
  return row;
}
export async function saveReply(
  a: Actor,
  r: RequestRow,
  v: {
    message: string;
    documentId: string;
    documentVersion: number;
    timezone: string;
    clientKey: string;
    payloadHash: string;
  },
) {
  if (await existingReply(a, r.id, v.clientKey, v.payloadHash))
    throw new RequestWorkflowError(
      "This reply was already received. Refresh the conversation.",
      409,
    );
  const live = await requestFor(a, r.id);
  revision(live, r.revision);
  r = live;
  if (r.status === "Resolved")
    throw new RequestWorkflowError(
      "This request is resolved. Ask your consultant to reopen it before adding evidence.",
      409,
    );
  const recent = (await db()
    .prepare(
      "SELECT count(*) n FROM request_replies WHERE tenant_id=? AND actor_id=? AND created_at>to_char(clock_timestamp() AT TIME ZONE 'UTC' - INTERVAL '1 minute', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    )
    .get(a.tenantId, a.id))!;
  if (Number(recent.n) >= 20)
    throw new RequestWorkflowError(
      "Please wait a moment before sending more replies.",
      429,
    );
  timezone(v.timezone);
  const proposal = v.documentId
    ? { state: "none", day: "", at: "", reason: "" }
    : proposeExpectedDate(v.message, v.timezone);
  const rid = id(),
    newRevision = r.revision + 1;
  await db()
    .prepare(
      "INSERT INTO request_replies(id,tenant_id,request_id,actor_id,channel,message,client_key,payload_hash,timezone,proposal,proposal_state,request_revision,document_id,document_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      rid,
      a.tenantId,
      r.id,
      a.id,
      a.role === "student" ? "Student portal" : "Staff note",
      v.message,
      v.clientKey,
      v.payloadHash,
      v.timezone,
      JSON.stringify(proposal),
      proposal.state === "suggested"
        ? "Pending"
        : proposal.state === "clarify"
          ? "Needs clarification"
          : "None",
      newRevision,
      v.documentId,
      v.documentVersion,
    );
  if (v.documentId) {
    await stopFollowup(a, r);
    await db()
      .prepare(
        "UPDATE requests SET status='File received',document_id=?,document_version=?,follow_up_at='',follow_up_timezone='',review_note='',revision=? WHERE id=? AND tenant_id=?",
      )
      .run(v.documentId, v.documentVersion, newRevision, r.id, a.tenantId);
    await record(
      a,
      r,
      "file received",
      "File received; awaiting staff review.",
      v.documentId,
      v.documentVersion,
    );
  } else {
    await db()
      .prepare(
        "UPDATE requests SET status=CASE WHEN status='Open' THEN 'Responded' ELSE status END,revision=? WHERE id=? AND tenant_id=?",
      )
      .run(newRevision, r.id, a.tenantId);
    await record(a, r, "reply received");
  }
  return { replyId: rid, proposal, revision: newRevision };
}
// This hook runs inside the existing document-upload transaction after a file version is saved.
export async function prepareRequestUpload(
  a: Actor,
  form: FormData,
  pid: string,
  sha: string,
) {
  const rid = String(form.get("requestId") || "");
  if (!rid) return null;
  const data = z
    .object({
      revision: z.coerce.number().int().positive(),
      message: z.string().trim().max(2000),
      timezone: z.string().min(1).max(100),
      clientKey: z.uuid(),
    })
    .parse({
      revision: form.get("requestRevision"),
      message: String(form.get("replyMessage") || ""),
      timezone: form.get("replyTimezone"),
      clientKey: form.get("replyClientKey"),
    });
  timezone(data.timezone);
  const r = await requestFor(a, rid);
  if (
    r.person_id !== pid ||
    r.section_key !== String(form.get("sectionKey") || "")
  )
    throw new RequestWorkflowError(
      "Upload does not match the selected request.",
    );
  const hash = digest([data.message, sha, data.timezone]);
  const replay = await existingReply(a, rid, data.clientKey, hash);
  if (replay) return { r, data, hash, replay };
  revision(r, data.revision);
  if (r.status === "Resolved")
    throw new RequestWorkflowError(
      "This request has already been resolved.",
      409,
    );
  return { r, data, hash, replay: null };
}
export async function requestDocumentChanged(
  a: Actor,
  docId: string,
  newVersion: number,
) {
  const rows = (await db()
    .prepare(
      "SELECT * FROM requests WHERE tenant_id=? AND document_id=? AND document_version<>?",
    )
    .all(a.tenantId, docId, newVersion)) as unknown as RequestRow[];
  for (const r of rows) {
    await stopFollowup(a, r);
    await db()
      .prepare(
        "UPDATE requests SET status='File received',document_version=?,follow_up_at='',follow_up_timezone='',review_note='',revision=revision+1 WHERE id=? AND tenant_id=?",
      )
      .run(newVersion, r.id, a.tenantId);
    await record(
      a,
      r,
      "new file version",
      "Updated file requires a fresh review.",
      docId,
      newVersion,
    );
  }
}
export async function requestDocumentReviewChanged(
  a: Actor,
  docId: string,
  status: string,
  skipRequestId = "",
) {
  if (status === "Reviewed") return;
  const rows = (await db()
    .prepare(
      "SELECT * FROM requests WHERE tenant_id=? AND document_id=? AND status='Resolved' AND id!=?",
    )
    .all(a.tenantId, docId, skipRequestId)) as unknown as RequestRow[];
  for (const r of rows) {
    await db()
      .prepare(
        "UPDATE requests SET status=?,review_note=?,revision=revision+1 WHERE id=? AND tenant_id=?",
      )
      .run(
        status === "Changes requested" ? "Changes requested" : "File received",
        "Document review changed; request needs attention again.",
        r.id,
        a.tenantId,
      );
    await record(a, r, "review reopened", "Document review changed.");
  }
}
export async function requestMutation(
  req: Request,
  parts: string[],
  a: Actor,
  body: unknown,
  writable: boolean,
) {
  const [resource, rid, action] = parts;
  if (resource !== "requests" || !rid) return null;
  if (!writable || a.role === "platform_admin")
    throw new RequestWorkflowError("Workspace is read-only.", 403);
  if (action === "reply" && req.method === "POST") {
    const v = replySchema.parse(body);
    timezone(v.timezone);
    const r = await requestFor(a, rid),
      hash = digest([v.message, v.documentId, v.timezone]);
    const replay = await existingReply(a, rid, v.clientKey, hash);
    if (replay)
      return NextResponse.json({ replyId: replay.id, replayed: true });
    return await transaction(async () => {
      const duplicate = await existingReply(a, rid, v.clientKey, hash);
      if (duplicate)
        return NextResponse.json({ replyId: duplicate.id, replayed: true });
      revision(await requestFor(a, rid), v.revision);
      let version = 0;
      if (v.documentId)
        version = Number((await evidence(a, r, v.documentId)).current_version);
      return NextResponse.json(
        await saveReply(a, r, {
          message: v.message,
          documentId: v.documentId,
          documentVersion: version,
          timezone: v.timezone,
          clientKey: v.clientKey,
          payloadHash: hash,
        }),
      );
    });
  }
  if (!isStaff(a))
    throw new RequestWorkflowError(
      "Only your consultant can review evidence or change follow-up dates.",
      403,
    );
  if (action === "schedule" && req.method === "POST") {
    const v = z
      .object({
        revision: z.number().int().positive(),
        replyId: z.string().max(100).default(""),
        day: z.union([z.literal(""), z.iso.date()]).default(""),
        timezone: z.string().max(100).default("Asia/Karachi"),
      })
      .parse(body);
    return await transaction(async () => {
      const r = await requestFor(a, rid);
      if (
        v.replyId &&
        r.status === "Waiting for document" &&
        r.revision === v.revision + 1
      ) {
        const applied = await db()
          .prepare(
            "SELECT proposal FROM request_replies WHERE id=? AND tenant_id=? AND request_id=? AND proposal_state='Applied'",
          )
          .get(v.replyId, a.tenantId, rid);
        if (
          applied &&
          JSON.parse(String(applied.proposal)).at === r.follow_up_at
        )
          return NextResponse.json({
            ok: true,
            at: r.follow_up_at,
            taskId: r.follow_up_task_id,
            replayed: true,
          });
      }
      revision(r, v.revision);
      if (["Resolved", "File received"].includes(r.status))
        throw new RequestWorkflowError(
          "Review the received file first; another upload reminder is not needed.",
        );
      let at = "",
        zone = v.timezone,
        day = v.day;
      if (v.replyId) {
        const reply = await db()
          .prepare(
            "SELECT * FROM request_replies WHERE id=? AND tenant_id=? AND request_id=? AND proposal_state='Pending'",
          )
          .get(v.replyId, a.tenantId, rid);
        if (!reply || reply.request_revision !== r.revision)
          throw new RequestWorkflowError(
            "This date proposal is stale. Confirm a date from the latest conversation.",
            409,
          );
        const proposal = JSON.parse(String(reply.proposal));
        at = proposal.at;
        day = proposal.day;
        zone = String(reply.timezone);
      } else {
        at = followupInstant(day, zone);
      }
      if (Date.parse(at) <= Date.now())
        throw new RequestWorkflowError("Choose a future follow-up date.");
      const owner = await db()
        .prepare(
          "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role IN ('owner','consultant','platform_admin')",
        )
        .get(a.tenantId, r.created_by);
      if (!owner)
        throw new RequestWorkflowError(
          "The request owner is no longer available. Create a new request assigned to an active consultant.",
        );
      let taskId = r.follow_up_task_id;
      if (
        taskId &&
        !(await db()
          .prepare("SELECT id FROM tasks WHERE id=? AND tenant_id=?")
          .get(taskId, a.tenantId))
      )
        taskId = "";
      if (!taskId) {
        taskId = id();
        await db()
          .prepare(
            "INSERT INTO tasks(id,tenant_id,person_id,title,assignee,important,due_date,last_actor_id) VALUES(?,?,?,?,?,1,?,?)",
          )
          .run(
            taskId,
            a.tenantId,
            r.person_id,
            sections.find((s) => s.key === r.section_key)?.restricted
              ? "Follow up: private information request"
              : "Follow up: " + r.title,
            owner.name,
            day,
            a.id,
          );
      } else
        await db()
          .prepare(
            "UPDATE tasks SET stage='To do',due_date=?,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
          )
          .run(day, a.id, taskId, a.tenantId);
      await db()
        .prepare(
          "UPDATE task_reminders SET status='replaced' WHERE tenant_id=? AND task_id=? AND status='scheduled'",
        )
        .run(a.tenantId, taskId);
      await db()
        .prepare(
          "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone) VALUES(?,?,?,?,?,?)",
        )
        .run(id(), a.tenantId, owner.id, taskId, at, zone);
      await db()
        .prepare(
          "UPDATE requests SET status='Waiting for document',follow_up_at=?,follow_up_timezone=?,follow_up_task_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
        )
        .run(at, zone, taskId, rid, a.tenantId);
      if (v.replyId)
        await db()
          .prepare(
            "UPDATE request_replies SET proposal_state='Applied' WHERE id=? AND tenant_id=?",
          )
          .run(v.replyId, a.tenantId);
      await record(a, r, "follow-up scheduled", at + " · " + zone);
      return NextResponse.json({ ok: true, at, taskId });
    });
  }
  if (req.method === "PATCH" && !action) {
    const v = z
      .object({
        revision: z.number().int().positive(),
        status: z.enum(["Open", "Changes requested", "Resolved"]),
        note: z.string().trim().min(2).max(2000),
        acceptFile: z.boolean().default(false),
      })
      .parse(body);
    return await transaction(async () => {
      const r = await requestFor(a, rid);
      revision(r, v.revision);
      if (v.status === "Resolved") {
        if (r.requires_document && !r.document_id)
          throw new RequestWorkflowError(
            "A supporting document is required before resolving this request.",
          );
        if (r.document_id) {
          if (!v.acceptFile)
            throw new RequestWorkflowError(
              "Review and accept the linked file before resolving.",
            );
          const d = await evidence(a, r, r.document_id, r.document_version);
          if (r.status !== "File received")
            throw new RequestWorkflowError(
              "The latest file must be in the review queue before it is accepted.",
            );
          await db()
            .prepare(
              "UPDATE documents SET status='Reviewed' WHERE id=? AND tenant_id=? AND current_version=?",
            )
            .run(d.id, a.tenantId, r.document_version);
        }
        await stopFollowup(a, r);
      } else {
        await stopFollowup(a, r);
        if (v.status === "Changes requested" && r.document_id) {
          const d = await evidence(a, r, r.document_id, r.document_version);
          await db()
            .prepare(
              "UPDATE documents SET status='Changes requested' WHERE id=? AND tenant_id=?",
            )
            .run(d.id, a.tenantId);
          await requestDocumentReviewChanged(
            a,
            r.document_id,
            "Changes requested",
            r.id,
          );
        }
      }
      const current = await requestFor(a, rid);
      await db()
        .prepare(
          "UPDATE requests SET status=?,review_note=?,follow_up_at='',follow_up_timezone='',document_id=CASE WHEN ?='Open' THEN '' ELSE document_id END,document_version=CASE WHEN ?='Open' THEN 0 ELSE document_version END,revision=revision+1 WHERE id=? AND tenant_id=?",
        )
        .run(v.status, v.note, v.status, v.status, rid, a.tenantId);
      await record(
        a,
        current,
        v.status === "Resolved"
          ? "request resolved"
          : v.status === "Open"
            ? "request reopened"
            : "changes requested",
        v.note,
      );
      return NextResponse.json({ ok: true });
    });
  }
  throw new RequestWorkflowError("Request action not found.", 404);
}
