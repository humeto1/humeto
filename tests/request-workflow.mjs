import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { unlinkSync } from "node:fs";
import { dayOffset, localInstant } from "../src/lib/agent/dates.ts";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
const api = "/api/workspace/";
const contexts = [],
  requests = [],
  documents = [];
const zone = "Asia/Karachi";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
    200,
  );
  return c;
}
async function json(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function create(c, extra = {}) {
  const x = await json(
    await c.post(api + "requests", {
      data: {
        personId: "amira",
        sectionKey: "passports",
        title: "QA passport request",
        message: "Share a clear copy or expected date.",
        requiresDocument: true,
        ...extra,
      },
    }),
  );
  requests.push(x.id);
  return x.id;
}
async function read(c, id) {
  return json(await c.get(api + "requests/" + id));
}
async function reply(c, id, revision, message, extra = {}) {
  return c.post(api + `requests/${id}/reply`, {
    data: {
      revision,
      message,
      timezone: zone,
      clientKey: randomUUID(),
      ...extra,
    },
  });
}
async function change(c, id, revision, status, extra = {}) {
  return c.patch(api + "requests/" + id, {
    data: {
      revision,
      status,
      note: "Checked the current evidence for this request.",
      ...extra,
    },
  });
}
function inspect() {
  return new DatabaseSync(
    resolve(process.env.HUMETO_DATA_DIR || ".data", "humeto.sqlite"),
  );
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = inspect();
  for (const rid of requests) {
    const r = d
      .prepare("SELECT follow_up_task_id FROM requests WHERE id=?")
      .get(rid);
    if (r?.follow_up_task_id) {
      d.prepare("DELETE FROM task_reminders WHERE task_id=?").run(
        r.follow_up_task_id,
      );
      d.prepare("DELETE FROM tasks WHERE id=?").run(r.follow_up_task_id);
      d.prepare("DELETE FROM task_events WHERE task_id=?").run(
        r.follow_up_task_id,
      );
      d.prepare(
        "DELETE FROM audit WHERE entity_type='task' AND entity_id=?",
      ).run(r.follow_up_task_id);
    }
    for (const table of ["request_events", "request_replies"])
      d.prepare(`DELETE FROM ${table} WHERE request_id=?`).run(rid);
    d.prepare("DELETE FROM requests WHERE id=?").run(rid);
    d.prepare(
      "DELETE FROM audit WHERE entity_type='request' AND entity_id=?",
    ).run(rid);
  }
  for (const did of documents) {
    for (const f of d
      .prepare("SELECT stored_name FROM document_versions WHERE document_id=?")
      .all(did)) {
      try {
        unlinkSync(
          resolve(
            process.env.HUMETO_DATA_DIR || ".data",
            "uploads",
            f.stored_name,
          ),
        );
      } catch {}
    }
    d.prepare("DELETE FROM document_versions WHERE document_id=?").run(did);
    d.prepare("DELETE FROM documents WHERE id=?").run(did);
    d.prepare(
      "DELETE FROM audit WHERE entity_type='document' AND entity_id=?",
    ).run(did);
  }
  d.close();
});
test("student dates are anchored to receipt, reviewed once, and old reminders are replaced", async () => {
  const owner = await ctx("ayesha"),
    student = await ctx("amira"),
    rid = await create(owner);
  const key = randomUUID();
  const input = {
    revision: 1,
    message: "I'll receive my passport after 20 days.",
    timezone: zone,
    clientKey: key,
  };
  const saved = await json(
    await student.post(api + `requests/${rid}/reply`, { data: input }),
  );
  let thread = await read(owner, rid);
  const row = thread.replies[0];
  assert.equal(saved.proposal.state, "suggested");
  assert.equal(
    saved.proposal.day,
    dayOffset(new Date(row.created_at), zone, 20),
  );
  assert.equal(saved.proposal.at, localInstant(saved.proposal.day, 9, 0, zone));
  assert.equal(thread.request.status, "Responded");
  assert.equal(
    (
      await json(
        await student.post(api + `requests/${rid}/reply`, { data: input }),
      )
    ).replayed,
    true,
  );
  assert.equal(
    (
      await student.post(api + `requests/${rid}/reply`, {
        data: { ...input, message: "Changed content" },
      })
    ).status(),
    409,
  );
  const schedule = { revision: 2, replyId: saved.replyId };
  assert.equal(
    (
      await student.post(api + `requests/${rid}/schedule`, { data: schedule })
    ).status(),
    403,
  );
  const confirmed = await json(
    await owner.post(api + `requests/${rid}/schedule`, { data: schedule }),
  );
  assert.equal(
    (
      await json(
        await owner.post(api + `requests/${rid}/schedule`, { data: schedule }),
      )
    ).replayed,
    true,
  );
  thread = await read(owner, rid);
  assert.equal(thread.request.status, "Waiting for document");
  assert.equal(thread.request.follow_up_at, saved.proposal.at);
  const d = inspect();
  assert.equal(
    d
      .prepare(
        "SELECT count(*) n FROM task_reminders WHERE task_id=? AND status='scheduled'",
      )
      .get(confirmed.taskId).n,
    1,
  );
  const next = dayOffset(new Date(), zone, 21);
  await json(
    await owner.post(api + `requests/${rid}/schedule`, {
      data: { revision: 3, day: next, timezone: zone },
    }),
  );
  assert.equal(
    d
      .prepare(
        "SELECT count(*) n FROM task_reminders WHERE task_id=? AND status='scheduled'",
      )
      .get(confirmed.taskId).n,
    1,
  );
  assert.equal(
    d
      .prepare(
        "SELECT count(*) n FROM task_reminders WHERE task_id=? AND status='replaced'",
      )
      .get(confirmed.taskId).n,
    1,
  );
  d.close();
  assert.equal((await change(owner, rid, 4, "Resolved")).status(), 400);
});
test("ambiguous or negative replies need clarification and stale proposals cannot schedule", async () => {
  const owner = await ctx("ayesha"),
    student = await ctx("amira"),
    rid = await create(owner);
  let revision = 1;
  for (const message of [
    "Maybe I'll receive it tomorrow.",
    "I cannot send it tomorrow.",
    "I will send it on 12/11/2027.",
    "I will receive it after 2 days or after 3 days.",
    "I can upload it 2027-02-30.",
  ]) {
    const p = await json(await reply(student, rid, revision++, message));
    assert.equal(p.proposal.state, "clarify");
    assert.equal(p.proposal.at, "");
  }
  const suggestion = await json(
    await reply(student, rid, revision++, "I will upload it tomorrow."),
  );
  await json(
    await reply(student, rid, revision++, "Thank you, I will confirm."),
  );
  assert.equal(
    (
      await owner.post(api + `requests/${rid}/schedule`, {
        data: { revision, replyId: suggestion.replyId },
      })
    ).status(),
    409,
  );
  assert.equal(
    (
      await reply(student, rid, revision, "I will send it tomorrow.", {
        timezone: "Not/A_Zone",
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await owner.post(api + `requests/${rid}/schedule`, {
        data: {
          revision,
          day: dayOffset(new Date(), zone, 2),
          timezone: "Invalid/Timezone",
        },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await owner.post(api + `requests/${rid}/schedule`, {
        data: { revision, timezone: zone },
      })
    ).status(),
    400,
  );
});
test("request uploads stop follow-ups, require review, retain history, and reopen on replacement", async () => {
  const owner = await ctx("ayesha"),
    student = await ctx("amira"),
    rid = await create(owner);
  await json(
    await owner.post(api + `requests/${rid}/schedule`, {
      data: {
        revision: 1,
        day: dayOffset(new Date(), zone, 5),
        timezone: zone,
      },
    }),
  );
  const multipart = {
    personId: "amira",
    sectionKey: "passports",
    title: "QA supporting file",
    category: "Identity",
    requestId: rid,
    requestRevision: "2",
    replyMessage: "Here is my document.",
    replyTimezone: zone,
    replyClientKey: randomUUID(),
    file: {
      name: "fictional-document.png",
      mimeType: "image/png",
      buffer: png,
    },
  };
  const upload = await json(
    await student.post(api + "documents", { multipart }),
  );
  documents.push(upload.id);
  const replay = await json(
    await student.post(api + "documents", { multipart }),
  );
  assert.equal(replay.id, upload.id);
  assert.equal(replay.replayed, true);
  assert.equal(
    (
      await student.post(api + "documents", {
        multipart: { ...multipart, replyMessage: "Different content" },
      })
    ).status(),
    409,
  );
  let thread = await read(owner, rid);
  assert.equal(thread.request.status, "File received");
  assert.equal(thread.request.document_version, 1);
  assert.equal(thread.request.follow_up_at, "");
  assert.equal(thread.replies.length, 1);
  const d = inspect();
  assert.equal(
    d
      .prepare("SELECT stage FROM tasks WHERE id=?")
      .get(thread.request.follow_up_task_id).stage,
    "Done",
  );
  assert.equal(
    d
      .prepare(
        "SELECT count(*) n FROM task_reminders WHERE task_id=? AND status='scheduled'",
      )
      .get(thread.request.follow_up_task_id).n,
    0,
  );
  assert.equal(
    (await change(student, rid, 3, "Resolved", { acceptFile: true })).status(),
    403,
  );
  assert.equal((await change(owner, rid, 3, "Resolved")).status(), 400);
  assert.equal(
    (
      await change(owner, rid, 3, "Resolved", { acceptFile: true, note: "" })
    ).status(),
    400,
  );
  await json(await change(owner, rid, 3, "Resolved", { acceptFile: true }));
  assert.equal((await read(owner, rid)).request.status, "Resolved");
  assert.equal(
    d.prepare("SELECT status FROM documents WHERE id=?").get(upload.id).status,
    "Reviewed",
  );
  const replacement = await json(
    await student.post(api + `documents/${upload.id}/version`, {
      multipart: {
        personId: "amira",
        file: { name: "fictional-v2.png", mimeType: "image/png", buffer: png },
      },
    }),
  );
  assert.equal(replacement.version, 2);
  thread = await read(owner, rid);
  assert.equal(thread.request.status, "File received");
  assert.equal(thread.request.document_version, 2);
  assert.ok(
    thread.events.some(
      (x) => x.event === "request resolved" && x.document_version === 1,
    ),
  );
  assert.ok(
    thread.events.some(
      (x) => x.event === "new file version" && x.document_version === 2,
    ),
  );
  assert.equal(
    (
      await owner.get(api + `documents/${upload.id}/download?version=1`)
    ).status(),
    200,
  );
  assert.equal(
    (await change(owner, rid, 4, "Resolved", { acceptFile: true })).status(),
    409,
  );
  await json(await change(owner, rid, 5, "Resolved", { acceptFile: true }));
  await json(
    await owner.patch(api + "documents/" + upload.id, {
      data: {
        status: "Changes requested",
        title: "QA supporting file",
        category: "Identity",
        sectionKey: "passports",
      },
    }),
  );
  assert.equal((await read(owner, rid)).request.status, "Changes requested");
  const count = d.prepare("SELECT count(*) n FROM documents").get().n;
  assert.equal(
    (
      await student.post(api + "documents", {
        multipart: {
          ...multipart,
          requestRevision: "1",
          replyClientKey: randomUUID(),
        },
      })
    ).status(),
    409,
  );
  assert.equal(d.prepare("SELECT count(*) n FROM documents").get().n, count);
  d.close();
});
test("request threads and attachment links respect person, tenant and restricted-section boundaries", async () => {
  const owner = await ctx("ayesha"),
    student = await ctx("amira"),
    consultant = await ctx("consultant"),
    other = await ctx("bright-owner"),
    platform = await ctx("admin");
  const rid = await create(owner, { personId: "omar" });
  assert.equal((await student.get(api + "requests/" + rid)).status(), 404);
  assert.equal(
    (await reply(student, rid, 1, "I will send it tomorrow.")).status(),
    404,
  );
  assert.equal((await other.get(api + "requests/" + rid)).status(), 404);
  assert.equal((await platform.get(api + "requests/" + rid)).status(), 404);
  const privateId = await create(owner, {
    sectionKey: "declarations",
    title: "QA confidential request",
  });
  assert.equal(
    (await consultant.get(api + "requests/" + privateId)).status(),
    404,
  );
  assert.equal((await read(student, privateId)).request.id, privateId);
  const data = await json(await consultant.get(api + "bootstrap"));
  assert.ok(!data.requests.some((x) => x.id === privateId));
  await json(
    await owner.post(api + `requests/${privateId}/schedule`, {
      data: {
        revision: 1,
        day: dayOffset(new Date(), zone, 10),
        timezone: zone,
      },
    }),
  );
  const refreshed = await json(await consultant.get(api + "bootstrap"));
  assert.ok(!JSON.stringify(refreshed).includes("QA confidential request"));
  const own = await create(owner);
  assert.equal(
    (
      await reply(student, own, 1, "Attached", {
        documentId: "demo-omar-passport",
      })
    ).status(),
    404,
  );
});
test("information-only requests can resolve with notes; reopening preserves conversation", async () => {
  const owner = await ctx("ayesha"),
    student = await ctx("amira"),
    rid = await create(owner, {
      requiresDocument: false,
      sectionKey: "identity",
    });
  await json(await reply(student, rid, 1, "My preferred name is Amira."));
  await json(await change(owner, rid, 2, "Resolved"));
  assert.equal((await read(student, rid)).request.status, "Resolved");
  assert.equal((await reply(student, rid, 3, "Another reply")).status(), 409);
  await json(await change(owner, rid, 3, "Open"));
  const reopened = await read(student, rid);
  assert.equal(reopened.request.status, "Open");
  assert.equal(reopened.replies.length, 1);
  assert.equal(reopened.events.length, 3);
});

test("read-only subscriptions preserve request reads but reject replies and scheduling", async () => {
  const admin = await ctx("admin"),
    owner = await ctx("bright-owner");
  const rid = await create(owner, { personId: "bright-student" });
  const platform = await json(await admin.get(api + "platform"));
  const t = platform.tenants.find((x) => x.id === "brightpath");
  const subscription = {
    plan: t.plan,
    status: "read-only",
    seats: t.seats,
    caseLimit: t.case_limit,
    storageMb: t.storage_mb,
    expiresAt: t.expires_at,
  };
  try {
    await json(
      await admin.patch(api + "platform/brightpath", { data: subscription }),
    );
    assert.equal((await read(owner, rid)).request.id, rid);
    assert.equal(
      (await reply(owner, rid, 1, "I will send it tomorrow.")).status(),
      403,
    );
    assert.equal(
      (
        await owner.post(api + `requests/${rid}/schedule`, {
          data: {
            revision: 1,
            day: dayOffset(new Date(), zone, 3),
            timezone: zone,
          },
        })
      ).status(),
      403,
    );
  } finally {
    await json(
      await admin.patch(api + "platform/brightpath", {
        data: { ...subscription, status: t.status },
      }),
    );
  }
});
