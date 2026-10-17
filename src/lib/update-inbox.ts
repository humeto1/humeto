import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, id, audit } from "./db";
import { canMutate, canSeePerson, isStaff } from "./auth";
import { transaction } from "./crm";
import type { Actor, Application, Person } from "./types";
export class InboxError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const inboxStages = [
  "Offer received",
  "Conditional offer",
  "Decision received",
  "Visa approved",
  "Enrolled",
  "Failed",
  "Withdrawn",
] as const;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const url = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => !v || /^https?:\/\//i.test(v),
    "Use an http or https source link.",
  )
  .default("");
const capture = z.object({
  sender: z.string().trim().max(254).default(""),
  subject: z.string().trim().min(2).max(300),
  body: z.string().trim().min(10).max(12000),
  sourceAt: z.iso.datetime({ offset: true }),
  sourceMessageId: z.string().trim().max(300).default(""),
  sourceUrl: url,
  clientKey: z.uuid(),
});
export type InboxReview = {
  applicationId: string;
  applicationRevision: number;
  personId: string;
  personRevision: number;
  email: string;
  personName: string;
  institution: string;
  program: string;
  kind: string;
  country: string;
  fromStatus: string;
  toStatus: string;
  note: string;
  matchNote: string;
};
export type InboxRow = {
  id: string;
  sender: string;
  subject: string;
  body: string;
  source_at: string;
  source_message_id: string;
  source_url: string;
  status: string;
  revision: number;
  review: InboxReview | Record<string, never>;
  review_expires_at: number;
  decision_note: string;
  applied_at: string;
  created_at: string;
};
function own(a: Actor, messageId: string) {
  const r = db()
    .prepare(
      "SELECT * FROM update_inbox WHERE id=? AND tenant_id=? AND user_id=?",
    )
    .get(messageId, a.tenantId, a.id);
  if (!r) throw new InboxError("Message not found.", 404);
  return { ...r, review: JSON.parse(String(r.review)) } as unknown as InboxRow;
}
function sameRevision(r: InboxRow, expected: number) {
  if (r.revision !== expected)
    throw new InboxError(
      "This inbox item changed. Reload it before continuing.",
      409,
    );
}
function editable(r: InboxRow) {
  if (!["Pending", "Review"].includes(r.status))
    throw new InboxError(
      "Reopen an ignored item before reviewing it. Applied items retain their original decision.",
      409,
    );
}
function parsedAt(at: string) {
  return Date.parse(at.includes("T") ? at : at.replace(" ", "T") + "Z");
}
export function inboxAnalysis(a: Actor, r: InboxRow) {
  const text = r.subject + "\n" + r.body;
  const emails = [
    ...new Set(
      (
        text.match(
          /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi,
        ) || []
      ).map((x) => x.toLowerCase()),
    ),
  ];
  const candidates = (
    db()
      .prepare("SELECT * FROM people WHERE tenant_id=?")
      .all(a.tenantId) as unknown as Person[]
  ).filter((p) => emails.includes(p.email.toLowerCase()));
  const apps = db()
    .prepare(
      "SELECT a.*,p.name AS person_name FROM applications a JOIN people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=? ORDER BY a.created_at DESC",
    )
    .all(a.tenantId) as unknown as Application[];
  const referenceMatches = apps
    .filter((app) =>
      [app.id, app.submission_reference || ""].some(
        (ref) =>
          ref.length >= 4 &&
          new RegExp(
            "(^|[^a-z0-9_-])" +
              ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
              "($|[^a-z0-9_-])",
            "i",
          ).test(text),
      ),
    )
    .map((app) => app.id);
  // Conservative local hints, never instructions. Body/history remains visible for human review.
  const subject = r.subject.toLowerCase();
  const found: string[] = [];
  if (!/\?|\b(not|no|pending|awaiting|may|might|if)\b/.test(subject)) {
    if (/\bconditional offer\b/.test(subject) && !/unconditional/.test(subject))
      found.push("Conditional offer");
    if (
      /\b(unconditional offer|offer of admission|admission offer)\b/.test(
        subject,
      )
    )
      found.push("Offer received");
    if (/\b(visa approved|visa approval)\b/.test(subject))
      found.push("Visa approved");
    if (
      /\b(application rejected|visa refused|application unsuccessful|visa refusal)\b/.test(
        subject,
      )
    )
      found.push("Failed");
    if (
      /\b(visa decision|application decision)\b/.test(subject) &&
      !found.length
    )
      found.push("Decision received");
  }
  return {
    candidates: candidates.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
    })),
    applicationHints: referenceMatches,
    suggestedStatus: found.length === 1 ? found[0] : "",
    reason:
      candidates.length === 1
        ? "One registered email appears in the message. Confirm the original recipient and application."
        : candidates.length
          ? "Several registered emails appear. Choose the applicant and explain the match."
          : "No registered email matched. Select an applicant only after checking other evidence.",
    applications: apps,
  };
}
export function readInbox(a: Actor, messageId?: string, offset = 0) {
  if (!isStaff(a)) throw new InboxError("Inbox access is not permitted.", 403);
  if (messageId) {
    const message = own(a, messageId);
    return { message, analysis: inboxAnalysis(a, message) };
  }
  return {
    messages: db()
      .prepare(
        "SELECT id,sender,subject,source_at,status,revision,created_at FROM update_inbox WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100 OFFSET ?",
      )
      .all(a.tenantId, a.id, offset),
    total: Number(
      db()
        .prepare(
          "SELECT count(*) n FROM update_inbox WHERE tenant_id=? AND user_id=?",
        )
        .get(a.tenantId, a.id)!.n,
    ),
  };
}
function validateTarget(
  a: Actor,
  r: InboxRow,
  applicationId: string,
  applicationRevision: number,
  toStatus: string,
) {
  const app = db()
    .prepare("SELECT * FROM applications WHERE id=? AND tenant_id=?")
    .get(applicationId, a.tenantId) as unknown as Application | undefined;
  if (!app || !canSeePerson(a, app.person_id))
    throw new InboxError("Application not found.", 404);
  if (app.revision !== applicationRevision)
    throw new InboxError(
      "The application changed. Prepare a new review from its current state.",
      409,
    );
  if (["Failed", "Withdrawn", "Enrolled", "Visa approved"].includes(app.status))
    throw new InboxError(
      "This case has a recorded final outcome. Keep it here and use the Applications workspace to review any correction.",
      409,
    );
  if (app.status === toStatus)
    throw new InboxError(
      "This application already has that status. Ignore the duplicate update instead.",
    );
  if (toStatus === "Visa approved" && !/visa/i.test(app.kind))
    throw new InboxError("Choose a visa application for a visa approval.");
  if (
    ["Offer received", "Conditional offer", "Enrolled"].includes(toStatus) &&
    /visa/i.test(app.kind)
  )
    throw new InboxError(
      "Choose an admission or scholarship application for this outcome.",
    );
  const latest = db()
    .prepare(
      "SELECT created_at FROM application_events WHERE tenant_id=? AND application_id=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(a.tenantId, app.id);
  if (latest && parsedAt(r.source_at) < parsedAt(String(latest.created_at)))
    throw new InboxError(
      "This message predates the latest recorded case update. Keep it as evidence; review any correction from Applications instead.",
      409,
    );
  return app;
}
export function mutateInbox(a: Actor, input: unknown) {
  if (!isStaff(a) || !canMutate(a))
    throw new InboxError(
      "This workspace is read-only or inbox access is not permitted.",
      403,
    );
  const op = z
    .object({
      operation: z.enum([
        "capture",
        "preview",
        "apply",
        "clear",
        "ignore",
        "reopen",
      ]),
    })
    .parse(input).operation;
  if (op === "capture") {
    const v = capture.parse(input);
    if (Date.parse(v.sourceAt) > Date.now() + 300000)
      throw new InboxError(
        "The original received time cannot be in the future.",
      );
    const payloadHash = hash(v);
    const fingerprint = v.sourceMessageId
      ? hash(["message-id", v.sourceMessageId])
      : hash([
          v.sender.toLowerCase(),
          v.subject.replace(/\s+/g, " ").toLowerCase(),
          v.body.replace(/\s+/g, " ").toLowerCase(),
        ]);
    return transaction(() => {
      const replay = db()
        .prepare(
          "SELECT id,payload_hash FROM update_inbox WHERE tenant_id=? AND user_id=? AND client_key=?",
        )
        .get(a.tenantId, a.id, v.clientKey);
      if (replay) {
        if (replay.payload_hash !== payloadHash)
          throw new InboxError(
            "This capture key belongs to different content.",
            409,
          );
        return { id: replay.id, replayed: true };
      }
      const duplicate = db()
        .prepare(
          "SELECT id FROM update_inbox WHERE tenant_id=? AND user_id=? AND fingerprint=?",
        )
        .get(a.tenantId, a.id, fingerprint);
      if (duplicate) return { id: duplicate.id, duplicate: true };
      const recent = db()
        .prepare(
          "SELECT count(*) n FROM update_inbox WHERE tenant_id=? AND user_id=? AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute')",
        )
        .get(a.tenantId, a.id)!;
      if (Number(recent.n) >= 20)
        throw new InboxError("Please wait before adding more messages.", 429);
      const mid = id();
      db()
        .prepare(
          "INSERT INTO update_inbox(id,tenant_id,user_id,sender,subject,body,source_at,source_message_id,source_url,fingerprint,client_key,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          mid,
          a.tenantId,
          a.id,
          v.sender,
          v.subject,
          v.body,
          v.sourceAt,
          v.sourceMessageId,
          v.sourceUrl,
          fingerprint,
          v.clientKey,
          payloadHash,
        );
      audit(
        a.tenantId,
        a.id,
        "captured",
        "inbox",
        mid,
        "Captured an external update for private review",
      );
      return { id: mid };
    });
  }
  const v = z
    .object({
      messageId: z.string().min(1).max(100),
      revision: z.number().int().positive(),
    })
    .parse(input);
  return transaction(() => {
    const r = own(a, v.messageId);
    if (
      op === "apply" &&
      r.status === "Applied" &&
      r.revision === v.revision + 1
    )
      return { ok: true, replayed: true };
    sameRevision(r, v.revision);
    if (op === "preview") {
      editable(r);
      const p = z
        .object({
          applicationId: z.string().min(1).max(100),
          applicationRevision: z.number().int().positive(),
          status: z.enum(inboxStages),
          note: z.string().trim().min(10).max(2000),
          matchNote: z.string().trim().max(2000).default(""),
        })
        .parse(input);
      const app = validateTarget(
        a,
        r,
        p.applicationId,
        p.applicationRevision,
        p.status,
      );
      const person = db()
        .prepare("SELECT * FROM people WHERE id=? AND tenant_id=?")
        .get(app.person_id, a.tenantId) as unknown as Person;
      const analysis = inboxAnalysis(a, r);
      if (
        (analysis.candidates.length !== 1 ||
          analysis.candidates[0].id !== person.id) &&
        p.matchNote.length < 10
      )
        throw new InboxError(
          "Explain how you verified this applicant when the email match is absent, multiple or different.",
        );
      const review: InboxReview = {
        applicationId: app.id,
        applicationRevision: app.revision,
        personId: person.id,
        personRevision: person.revision,
        email: person.email,
        personName: person.name,
        institution: app.institution,
        program: app.program,
        kind: app.kind,
        country: app.country,
        fromStatus: app.status,
        toStatus: p.status,
        note: p.note,
        matchNote: p.matchNote,
      };
      db()
        .prepare(
          "UPDATE update_inbox SET status='Review',review=?,review_expires_at=?,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=?",
        )
        .run(
          JSON.stringify(review),
          Date.now() + 900000,
          r.id,
          a.tenantId,
          a.id,
        );
      return { ok: true };
    }
    if (op === "apply") {
      if (r.status !== "Review" || r.review_expires_at <= Date.now())
        throw new InboxError(
          "Prepare a fresh review before applying this message.",
          409,
        );
      const p = r.review as InboxReview;
      const app = validateTarget(
        a,
        r,
        p.applicationId,
        p.applicationRevision,
        p.toStatus,
      );
      const person = db()
        .prepare("SELECT revision,email FROM people WHERE id=? AND tenant_id=?")
        .get(p.personId, a.tenantId);
      if (
        !person ||
        person.revision !== p.personRevision ||
        person.email !== p.email ||
        app.person_id !== p.personId
      )
        throw new InboxError(
          "Applicant identity changed. Prepare a fresh review.",
          409,
        );
      db()
        .prepare(
          "UPDATE applications SET status=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
        )
        .run(p.toStatus, app.id, a.tenantId, p.applicationRevision);
      db()
        .prepare(
          "INSERT INTO application_events(id,tenant_id,application_id,from_status,to_status,note,source_url,created_by) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          a.tenantId,
          app.id,
          app.status,
          p.toStatus,
          `Reviewed inbox update ${r.id}: ${p.note}`,
          r.source_url,
          a.id,
        );
      db()
        .prepare(
          "UPDATE update_inbox SET status='Applied',applied_at=?,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=?",
        )
        .run(new Date().toISOString(), r.id, a.tenantId, a.id);
      audit(
        a.tenantId,
        a.id,
        "updated",
        "application",
        app.id,
        `Reviewed external update: ${p.toStatus}`,
      );
      return { ok: true, applicationId: app.id };
    }
    if (op === "ignore") {
      editable(r);
      const p = z
        .object({ note: z.string().trim().min(2).max(2000) })
        .parse(input);
      db()
        .prepare(
          "UPDATE update_inbox SET status='Ignored',decision_note=?,review='{}',review_expires_at=0,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=?",
        )
        .run(p.note, r.id, a.tenantId, a.id);
      return { ok: true };
    }
    if (op === "reopen") {
      if (r.status !== "Ignored")
        throw new InboxError("Only ignored messages can be reopened.", 409);
    } else if (op === "clear") editable(r);
    db()
      .prepare(
        "UPDATE update_inbox SET status='Pending',review='{}',review_expires_at=0,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=?",
      )
      .run(r.id, a.tenantId, a.id);
    return { ok: true };
  });
}
