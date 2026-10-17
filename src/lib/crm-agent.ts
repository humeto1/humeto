import "server-only";
import { db, id, audit, createChecklist } from "./db";
import { transaction } from "./crm";
import { applicationStages } from "./pipeline";
import type { Actor } from "./types";
export class CrmError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
type Payload = {
  kind: "open" | "move" | "close-applicant" | "draft";
  summary: string;
  personId: string;
  personName: string;
  email: string;
  revision: number;
  applicationId?: string;
  stage?: string;
  caseKind?: string;
  country?: string;
  subject?: string;
  body?: string;
  basis?: string;
  draftKind?: "fee" | "document";
};
function applicant(a: Actor, email: string) {
  const rows = db()
    .prepare(
      "SELECT * FROM people WHERE tenant_id=? AND email=? COLLATE NOCASE",
    )
    .all(a.tenantId, email);
  if (rows.length !== 1)
    throw new CrmError(
      rows.length
        ? "More than one applicant uses this email. Resolve the identity before applying a command."
        : "No registered applicant has that email in this workspace.",
    );
  return rows[0];
}
function basis(a: Actor, pid: string, kind: "fee" | "document") {
  if (kind === "fee") {
    const f = db()
      .prepare(
        "SELECT expected_fee FROM case_finance WHERE tenant_id=? AND person_id=?",
      )
      .get(a.tenantId, pid);
    if (!f)
      throw new CrmError("Agreed fees have not been set for this applicant.");
    const paid = Number(
      db()
        .prepare(
          "SELECT COALESCE(SUM(amount),0) n FROM payments WHERE tenant_id=? AND person_id=?",
        )
        .get(a.tenantId, pid)!.n,
    );
    const pending = Math.max(0, Number(f.expected_fee) - paid);
    return { key: String(pending), pending, items: [] as string[] };
  }
  const requests = db()
    .prepare(
      "SELECT id,title FROM requests WHERE tenant_id=? AND person_id=? AND status='Open' ORDER BY id",
    )
    .all(a.tenantId, pid);
  return {
    key: JSON.stringify(requests),
    pending: 0,
    items: requests.map((r) => String(r.title)),
  };
}
const help =
  "I can help with registered applicants and external application tracking. Try “Show cases for amira.shah@example.com”, “Open admission case for amira.shah@example.com in United Kingdom”, “Move application APP-ID to Offer received”, “Close application APP-ID”, “Close applicant amira.shah@example.com”, “Draft document reminder for amira.shah@example.com” or “Draft fee reminder for fatima.ahmed@example.com”. Changes need your review. Emails remain drafts; no mailbox is connected.";
function interpret(
  a: Actor,
  message: string,
): { content: string; payload?: Payload } {
  const text = message.trim().replace(/^(please\s+|can you\s+)/i, "");
  let match: RegExpMatchArray | null;
  if (
    (match = text.match(
      /^(?:show|list) (?:cases|applications) for ([^\s]+@[^\s]+)$/i,
    ))
  ) {
    const p = applicant(a, match[1]);
    const apps = db()
      .prepare(
        "SELECT * FROM applications WHERE tenant_id=? AND person_id=? ORDER BY created_at DESC",
      )
      .all(a.tenantId, p.id);
    return {
      content:
        `${p.name} has ${apps.length} application(s). Each has its own outcome.\n` +
        apps
          .map(
            (x) =>
              `${x.id} · ${x.kind} · ${x.country} · ${x.institution || "Institution to add"} · ${x.status}`,
          )
          .join("\n"),
    };
  }
  if (
    (match = text.match(
      /^(?:open|create) (admission|study visa|visit visa|visitor visa|schengen visa|scholarship) (?:case|application) for ([^\s]+@[^\s]+) in (.{2,100})$/i,
    ))
  ) {
    const p = applicant(a, match[2]);
    const kind = (
      {
        admission: "Admission",
        "study visa": "Study visa",
        "visit visa": "Visitor visa",
        "visitor visa": "Visitor visa",
        "schengen visa": "Schengen visa",
        scholarship: "Scholarship",
      } as Record<string, string>
    )[match[1].toLowerCase()];
    return {
      content:
        "Review the new tracking case. This creates a Draft in Humeto; actual portal submission is separate. Add institution/program/intake details from the Applications screen.",
      payload: {
        kind: "open",
        summary: `Open ${kind} draft for ${p.name} · ${match[3]}`,
        personId: String(p.id),
        personName: String(p.name),
        email: String(p.email),
        revision: Number(p.revision),
        country: match[3].trim(),
        caseKind: kind,
      },
    };
  }
  if (
    (match = text.match(
      /^(?:move|set) (?:application|case) ([A-Za-z0-9-]+) to (.+)$/i,
    )) ||
    (match = text.match(/^close (?:application|case) ([A-Za-z0-9-]+)$/i))
  ) {
    const app = db()
      .prepare(
        "SELECT a.*,p.name,p.email FROM applications a JOIN people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.id=?",
      )
      .get(a.tenantId, match[1]);
    if (!app)
      throw new CrmError(
        "Application not found. Ask “Show cases for EMAIL” to get an exact application ID.",
      );
    const desired = match[2]
      ? applicationStages.find(
          (s) => s.toLowerCase() === match![2].trim().toLowerCase(),
        )
      : "Withdrawn";
    if (!desired)
      throw new CrmError(
        "Unknown application stage. Use a stage shown on the application board.",
      );
    if (["Ready", "Submitted"].includes(desired))
      return {
        content:
          "Use Review preparation on the application card for this transition. Ready needs checklist review; Submitted needs the actual external portal reference.",
      };
    if (app.status === desired)
      return {
        content: `This application is already ${desired}. Nothing changed.`,
      };
    if (
      !match[2] &&
      ["Failed", "Withdrawn", "Visa approved", "Enrolled"].includes(
        String(app.status),
      )
    )
      return {
        content: `This application already has a recorded outcome (${app.status}). I will preserve it. Close the applicant relationship separately if needed.`,
      };
    return {
      content:
        "Review this one application’s stage change. Its applicant journey and sibling applications stay as they are.",
      payload: {
        kind: "move",
        summary: `${app.name} · ${app.country} · ${app.kind}: ${app.status} → ${desired}`,
        personId: String(app.person_id),
        personName: String(app.name),
        email: String(app.email),
        revision: Number(app.revision),
        applicationId: String(app.id),
        stage: desired,
      },
    };
  }
  if ((match = text.match(/^close applicant ([^\s]+@[^\s]+)$/i))) {
    const p = applicant(a, match[1]);
    if (p.journey_stage === "Closed")
      return {
        content:
          "This applicant relationship is already closed. Its applications are retained.",
      };
    return {
      content:
        "Review closing this applicant relationship. Existing application outcomes and documents are retained. You can resume the relationship later from the applicant board.",
      payload: {
        kind: "close-applicant",
        summary: `Close applicant journey for ${p.name}`,
        personId: String(p.id),
        personName: String(p.name),
        email: String(p.email),
        revision: Number(p.revision),
      },
    };
  }
  if (
    (match = text.match(
      /^(?:draft|send|prepare)(?: an?)? (fee|document) reminder(?: email)? for ([^\s]+@[^\s]+)$/i,
    ))
  ) {
    const p = applicant(a, match[2]);
    const kind = match[1].toLowerCase() as "fee" | "document";
    const b = basis(a, String(p.id), kind);
    if (kind === "fee" && !b.pending)
      return {
        content:
          "There is no outstanding agreed student fee in the ledger. I have not prepared a payment request.",
      };
    if (kind === "document" && !b.items.length)
      return {
        content:
          "There are no open information/document requests for this applicant. Create a specific request first so the reminder describes an actual pending item.",
      };
    const subject =
      kind === "fee"
        ? "Your pending service fee"
        : "A reminder about your pending information";
    const body =
      `Hello ${p.name},\n\n` +
      (kind === "fee"
        ? `Our records show a pending service fee of PKR ${new Intl.NumberFormat("en-PK").format(b.pending)}. Please contact ${a.tenantName} if you have already paid or need to discuss the next payment.`
        : `Could you please share an update on the following pending request(s)?\n${b.items.map((x) => "• " + x).join("\n")}\n\nIf an item is not available yet, please let us know when you expect to receive it.`) +
      `\n\nThank you,\n${a.tenantName}`;
    return {
      content:
        "I prepared a local draft using saved records. Review the recipient and wording. No mailbox is connected, so this will only save a draft and will not send an email.",
      payload: {
        kind: "draft",
        summary: `Save ${kind} reminder draft for ${p.name}`,
        personId: String(p.id),
        personName: String(p.name),
        email: String(p.email),
        revision: Number(p.revision),
        subject,
        body,
        basis: b.key,
        draftKind: kind,
      },
    };
  }
  return { content: help };
}
export function crmState(a: Actor) {
  return {
    engine: "Local command testing",
    messages: db()
      .prepare(
        "SELECT m.*,a.payload,a.status AS action_status,a.target_id,a.expires_at FROM crm_messages m LEFT JOIN crm_actions a ON a.id=m.action_id AND a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? ORDER BY m.rowid DESC LIMIT 100",
      )
      .all(a.tenantId, a.id)
      .reverse()
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
        action: m.action_id
          ? {
              id: m.action_id,
              status:
                m.action_status === "pending" &&
                Number(m.expires_at) < Date.now()
                  ? "expired"
                  : m.action_status,
              payload: JSON.parse(String(m.payload)),
              targetId: m.target_id,
            }
          : null,
      })),
    drafts: db()
      .prepare(
        "SELECT * FROM email_drafts WHERE tenant_id=? AND user_id=? ORDER BY rowid DESC LIMIT 30",
      )
      .all(a.tenantId, a.id),
  };
}
export function crmMessage(a: Actor, message: string, key: string) {
  return transaction(() => {
    if (
      db()
        .prepare(
          "SELECT id FROM crm_messages WHERE tenant_id=? AND user_id=? AND client_key=?",
        )
        .get(a.tenantId, a.id, key)
    )
      return crmState(a);
    const recent = db()
      .prepare(
        "SELECT count(*) n FROM crm_messages WHERE tenant_id=? AND user_id=? AND role='user' AND created_at>datetime('now','-1 minute')",
      )
      .get(a.tenantId, a.id)!;
    if (Number(recent.n) >= 30)
      throw new CrmError(
        "Please wait a moment before sending more commands.",
        429,
      );
    let result: { content: string; payload?: Payload };
    try {
      result = interpret(a, message);
    } catch (e) {
      if (e instanceof CrmError) result = { content: e.message };
      else throw e;
    }
    const aid = result.payload ? id() : "";
    if (result.payload)
      db()
        .prepare(
          "INSERT INTO crm_actions(id,tenant_id,user_id,payload,expires_at) VALUES(?,?,?,?,?)",
        )
        .run(
          aid,
          a.tenantId,
          a.id,
          JSON.stringify(result.payload),
          Date.now() + 15 * 60 * 1000,
        );
    db()
      .prepare(
        "INSERT INTO crm_messages(id,tenant_id,user_id,role,content,client_key) VALUES(?,?,?,'user',?,?)",
      )
      .run(id(), a.tenantId, a.id, message, key);
    db()
      .prepare(
        "INSERT INTO crm_messages(id,tenant_id,user_id,role,content,action_id) VALUES(?,?,?,'assistant',?,?)",
      )
      .run(id(), a.tenantId, a.id, result.content, aid);
    return crmState(a);
  });
}
export function crmDecide(
  a: Actor,
  actionId: string,
  decision: "apply" | "cancel",
) {
  return transaction(() => {
    const row = db()
      .prepare(
        "SELECT * FROM crm_actions WHERE id=? AND tenant_id=? AND user_id=?",
      )
      .get(actionId, a.tenantId, a.id);
    if (!row) throw new CrmError("Review action not found.", 404);
    if (row.status !== "pending") return crmState(a);
    if (decision === "cancel") {
      db()
        .prepare("UPDATE crm_actions SET status='cancelled' WHERE id=?")
        .run(actionId);
      return crmState(a);
    }
    if (Number(row.expires_at) < Date.now())
      throw new CrmError("This review expired. Request a fresh proposal.", 409);
    const p = JSON.parse(String(row.payload)) as Payload;
    const person = db()
      .prepare("SELECT * FROM people WHERE id=? AND tenant_id=?")
      .get(p.personId, a.tenantId);
    if (!person || person.email !== p.email)
      throw new CrmError(
        "Applicant identity changed. Request a fresh proposal.",
        409,
      );
    let targetId = p.personId;
    if (p.kind === "move") {
      const app = db()
        .prepare(
          "SELECT * FROM applications WHERE id=? AND tenant_id=? AND person_id=?",
        )
        .get(p.applicationId!, a.tenantId, p.personId);
      if (!app || app.revision !== p.revision)
        throw new CrmError(
          "Application changed since this review. Request a fresh proposal.",
          409,
        );
      db()
        .prepare(
          "UPDATE applications SET status=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
        )
        .run(p.stage!, p.applicationId!, a.tenantId, p.revision);
      db()
        .prepare(
          "INSERT INTO application_events(id,tenant_id,application_id,from_status,to_status,note,created_by) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          a.tenantId,
          p.applicationId!,
          app.status,
          p.stage!,
          "Reviewed local CRM command",
          a.id,
        );
      targetId = p.applicationId!;
    } else if (p.kind === "open") {
      if (person.revision !== p.revision)
        throw new CrmError(
          "Applicant changed since this review. Request a fresh proposal.",
          409,
        );
      targetId = id();
      db()
        .prepare(
          "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          targetId,
          a.tenantId,
          p.personId,
          p.caseKind!,
          p.country!,
          "",
          "",
          "",
        );
      createChecklist(targetId, a.tenantId, p.caseKind!);
    } else if (p.kind === "close-applicant") {
      if (person.revision !== p.revision)
        throw new CrmError(
          "Applicant journey changed. Request a fresh proposal.",
          409,
        );
      db()
        .prepare(
          "UPDATE people SET journey_stage='Closed',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND revision=?",
        )
        .run(p.personId, a.tenantId, p.revision);
    } else {
      const b = basis(a, p.personId, p.draftKind!);
      if (b.key !== p.basis)
        throw new CrmError(
          "Pending fees or requests changed. Prepare a fresh reminder draft.",
          409,
        );
      targetId = id();
      db()
        .prepare(
          "INSERT INTO email_drafts(id,tenant_id,user_id,person_id,recipient,subject,body) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          targetId,
          a.tenantId,
          a.id,
          p.personId,
          p.email,
          p.subject!,
          p.body!,
        );
    }
    db()
      .prepare("UPDATE crm_actions SET status='applied',target_id=? WHERE id=?")
      .run(targetId, actionId);
    audit(
      a.tenantId,
      a.id,
      p.kind === "draft" ? "draft saved" : "CRM command applied",
      p.kind === "draft"
        ? "email draft"
        : p.kind === "close-applicant"
          ? "person"
          : "application",
      targetId,
      p.summary + (p.kind === "draft" ? " · not sent" : ""),
    );
    return crmState(a);
  });
}
