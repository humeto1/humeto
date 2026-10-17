import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
import { resolve } from "node:path";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  mids = new Set(),
  pids = [];
const endpoint = "/api/update-inbox";
async function json(r, status = 200) {
  assert.equal(r.status(), status, await r.text());
  return r.json();
}
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  await json(await c.post("/api/auth/demo", { data: { userId: user } }));
  return c;
}
async function applicant(c) {
  const email = "inbox-" + randomUUID() + "@example.com";
  const p = await json(
    await c.post("/api/workspace/students", {
      data: { name: "QA Inbox Student", email },
    }),
  );
  pids.push(p.id);
  return { ...p, email };
}
async function app(c, pid, kind = "Admission", country = "United Kingdom") {
  return json(
    await c.post("/api/workspace/applications", {
      data: {
        personId: pid,
        kind,
        country,
        institution: "QA University",
        program: "Test programme",
        intake: "September 2027",
      },
    }),
  );
}
async function capture(c, email, extra = {}) {
  const body = {
    operation: "capture",
    sender: "university@example.edu",
    subject: "Conditional offer for your application",
    body:
      "Applicant: " +
      email +
      "\nPlease review your conditional offer in the university portal. " +
      randomUUID(),
    sourceAt: new Date().toISOString(),
    clientKey: randomUUID(),
    ...extra,
  };
  const result = await json(await c.post(endpoint, { data: body }));
  mids.add(result.id);
  return { ...result, input: body };
}
async function detail(c, mid) {
  return json(await c.get(endpoint + "?id=" + mid));
}
async function prepare(c, mid, aid, extra = {}) {
  return c.post(endpoint, {
    data: {
      operation: "preview",
      messageId: mid,
      revision: 1,
      applicationId: aid,
      applicationRevision: 1,
      status: "Conditional offer",
      note: "The message confirms this conditional offer.",
      ...extra,
    },
  });
}
function inspect() {
  return database();
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = inspect();
  for (const mid of mids) {
    await d.prepare("DELETE FROM update_inbox WHERE id=?").run(mid);
    await d
      .prepare("DELETE FROM audit WHERE entity_type='inbox' AND entity_id=?")
      .run(mid);
  }
  for (const pid of pids) {
    for (const a of await d
      .prepare("SELECT id FROM applications WHERE person_id=?")
      .all(pid)) {
      for (const table of [
        "requirements",
        "application_events",
        "application_snapshots",
      ]) {
        const exists = await d
          .prepare(
            "SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_name=?",
          )
          .get(table);
        if (exists)
          await d
            .prepare(`DELETE FROM ${table} WHERE application_id=?`)
            .run(a.id);
      }
      await d.prepare("DELETE FROM audit WHERE entity_id=?").run(a.id);
    }
    await d.prepare("DELETE FROM applications WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM case_finance WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM intake WHERE person_id=?").run(pid);
    await d.prepare("DELETE FROM people WHERE id=?").run(pid);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(pid);
  }
  await d.close();
});
test("email capture is private, idempotent, and matches exact registered email and case reference", async () => {
  const owner = await ctx("ayesha"),
    staff = await ctx("consultant"),
    other = await ctx("bright-owner");
  const p = await applicant(owner),
    a = await app(owner, p.id);
  const m = await capture(owner, p.email.toUpperCase(), {
    body: `Forwarded message\nTo: ${p.email.toUpperCase()}\nApplication reference: ${a.id}\nYour offer is ready.`,
  });
  const privateResponse = await owner.get(endpoint + "?id=" + m.id);
  assert.equal(privateResponse.headers()["cache-control"], "private, no-store");
  const firstPage = await json(await owner.get(endpoint));
  const secondPage = await json(await owner.get(endpoint + "?offset=1"));
  assert.equal(secondPage.total, firstPage.total);
  assert.equal(
    secondPage.messages.length,
    Math.max(0, firstPage.messages.length - 1),
  );
  assert.equal((await owner.get(endpoint + "?offset=-1")).status(), 400);
  const r = await detail(owner, m.id);
  assert.deepEqual(
    r.analysis.candidates.map((p) => p.id),
    [p.id],
  );
  assert.deepEqual(r.analysis.applicationHints, [a.id]);
  assert.equal(r.analysis.suggestedStatus, "Conditional offer");
  assert.equal(
    (await json(await owner.post(endpoint, { data: m.input }))).replayed,
    true,
  );
  assert.equal(
    (
      await json(
        await owner.post(endpoint, {
          data: { ...m.input, clientKey: randomUUID() },
        }),
      )
    ).duplicate,
    true,
  );
  assert.equal(
    (
      await owner.post(endpoint, {
        data: { ...m.input, subject: "Changed content" },
      })
    ).status(),
    409,
  );
  assert.equal((await staff.get(endpoint + "?id=" + m.id)).status(), 404);
  assert.equal((await other.get(endpoint + "?id=" + m.id)).status(), 404);
  assert.ok(
    !(await json(await staff.get(endpoint))).messages.some(
      (x) => x.id === m.id,
    ),
  );
  const noPartial = await capture(owner, p.email + "extra", {
    body: `Wrong identifier: ${p.email}suffix. Reference ${a.id}extra.`,
  });
  const n = await detail(owner, noPartial.id);
  assert.equal(n.analysis.candidates.length, 0);
  assert.equal(n.analysis.applicationHints.length, 0);
  const ref = await capture(owner, p.email, {
    sourceMessageId: "<qa-" + randomUUID() + "@example.com>",
  });
  const repeated = await json(
    await owner.post(endpoint, {
      data: {
        ...ref.input,
        clientKey: randomUUID(),
        body: "Reformatted body from the same source identifier.",
      },
    }),
  );
  assert.equal(repeated.id, ref.id);
  assert.equal(repeated.duplicate, true);
});
test("preview changes no case; apply changes one application, preserves siblings, and safely replays", async () => {
  const c = await ctx("ayesha"),
    p = await applicant(c),
    a = await app(c, p.id),
    sibling = await app(c, p.id, "Study visa", "United States");
  const m = await capture(c, p.email);
  await json(await prepare(c, m.id, a.id));
  const d = inspect();
  assert.equal(
    (await d.prepare("SELECT status FROM applications WHERE id=?").get(a.id))
      .status,
    "Draft",
  );
  assert.equal((await detail(c, m.id)).message.status, "Review");
  const apply = { operation: "apply", messageId: m.id, revision: 2 };
  await json(await c.post(endpoint, { data: apply }));
  assert.equal(
    (await json(await c.post(endpoint, { data: apply }))).replayed,
    true,
  );
  assert.equal(
    (await d.prepare("SELECT status FROM applications WHERE id=?").get(a.id))
      .status,
    "Conditional offer",
  );
  assert.equal(
    (
      await d
        .prepare("SELECT status FROM applications WHERE id=?")
        .get(sibling.id)
    ).status,
    "Draft",
  );
  assert.equal(
    (await d.prepare("SELECT journey_stage FROM people WHERE id=?").get(p.id))
      .journey_stage,
    "Planning",
  );
  const events = await d
    .prepare("SELECT * FROM application_events WHERE application_id=?")
    .all(a.id);
  assert.equal(events.length, 1);
  assert.match(events[0].note, new RegExp(m.id));
  assert.equal(events[0].created_by, "ayesha");
  assert.equal((await detail(c, m.id)).message.review.email, p.email);
  await d.close();
});
test("ambiguous forwarded identity needs a written match check and inbox cannot bypass submission gates", async () => {
  const c = await ctx("ayesha"),
    p = await applicant(c),
    q = await applicant(c),
    a = await app(c, p.id);
  const m = await capture(c, p.email, {
    body: `Forwarded thread includes ${p.email} and ${q.email}. Read carefully before choosing a student.`,
  });
  assert.equal((await detail(c, m.id)).analysis.candidates.length, 2);
  assert.equal((await prepare(c, m.id, a.id)).status(), 400);
  assert.equal(
    (
      await prepare(c, m.id, a.id, {
        matchNote:
          "Checked the original recipient and exact application reference.",
      })
    ).status(),
    200,
  );
  const manual = await capture(c, "unknown@example.com");
  assert.equal((await prepare(c, manual.id, a.id)).status(), 400);
  for (const status of ["Submitted", "Ready"])
    assert.equal(
      (
        await prepare(c, manual.id, a.id, {
          status,
          matchNote: "Confirmed with the student in the original portal.",
        })
      ).status(),
      400,
    );
  const visa = await app(c, p.id, "Visitor visa");
  assert.equal(
    (
      await prepare(c, manual.id, visa.id, {
        matchNote: "Confirmed the original student and case in the portal.",
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await prepare(c, manual.id, a.id, {
        status: "Visa approved",
        matchNote: "Confirmed the original student and case in the portal.",
      })
    ).status(),
    400,
  );
});
test("stale application/identity, expired reviews, terminal outcomes and older messages never silently apply", async () => {
  const c = await ctx("ayesha"),
    p = await applicant(c),
    a = await app(c, p.id),
    m = await capture(c, p.email);
  await json(await prepare(c, m.id, a.id));
  const d = inspect();
  await d
    .prepare("UPDATE applications SET revision=revision+1 WHERE id=?")
    .run(a.id);
  assert.equal(
    (
      await c.post(endpoint, {
        data: { operation: "apply", messageId: m.id, revision: 2 },
      })
    ).status(),
    409,
  );
  await json(
    await c.post(endpoint, {
      data: { operation: "clear", messageId: m.id, revision: 2 },
    }),
  );
  await json(
    await prepare(c, m.id, a.id, { revision: 3, applicationRevision: 2 }),
  );
  await d.prepare("UPDATE people SET revision=revision+1 WHERE id=?").run(p.id);
  assert.equal(
    (
      await c.post(endpoint, {
        data: { operation: "apply", messageId: m.id, revision: 4 },
      })
    ).status(),
    409,
  );
  await d
    .prepare("UPDATE update_inbox SET review_expires_at=0 WHERE id=?")
    .run(m.id);
  assert.equal(
    (
      await c.post(endpoint, {
        data: { operation: "apply", messageId: m.id, revision: 4 },
      })
    ).status(),
    409,
  );
  const final = await app(c, p.id);
  await d
    .prepare("UPDATE applications SET status='Failed' WHERE id=?")
    .run(final.id);
  const f = await capture(c, p.email);
  assert.equal((await prepare(c, f.id, final.id)).status(), 409);
  const newer = await app(c, p.id);
  await d
    .prepare(
      "INSERT INTO application_events(id,tenant_id,application_id,from_status,to_status,note,created_by) VALUES(?,'northstar',?,'Draft','Review','A newer update','ayesha')",
    )
    .run(randomUUID(), newer.id);
  const old = await capture(c, p.email, {
    sourceAt: "2025-01-01T10:00:00.000Z",
  });
  assert.equal((await prepare(c, old.id, newer.id)).status(), 409);
  assert.equal(
    (
      await d
        .prepare("SELECT status FROM applications WHERE id=?")
        .get(newer.id)
    ).status,
    "Draft",
  );
  await d.close();
});
test("ignore/reopen retains evidence and negated/uncertain subjects produce no outcome hint", async () => {
  const c = await ctx("ayesha"),
    p = await applicant(c);
  const m = await capture(c, p.email, {
    subject: "Your visa is not approved yet?",
  });
  assert.equal((await detail(c, m.id)).analysis.suggestedStatus, "");
  await json(
    await c.post(endpoint, {
      data: {
        operation: "ignore",
        messageId: m.id,
        revision: 1,
        note: "Unrelated status enquiry; keep as evidence.",
      },
    }),
  );
  let r = await detail(c, m.id);
  assert.equal(r.message.status, "Ignored");
  assert.equal(r.message.body, m.input.body);
  await json(
    await c.post(endpoint, {
      data: { operation: "reopen", messageId: m.id, revision: 2 },
    }),
  );
  r = await detail(c, m.id);
  assert.equal(r.message.status, "Pending");
  assert.equal(r.message.revision, 3);
  const future = await c.post(endpoint, {
    data: {
      ...m.input,
      clientKey: randomUUID(),
      sourceAt: "2099-01-01T00:00:00.000Z",
    },
  });
  assert.equal(future.status(), 400);
});
test("inbox rejects student/platform/cross-origin and read-only edits while preserving authorized reads", async () => {
  for (const user of ["amira", "admin"]) {
    const c = await ctx(user);
    assert.equal((await c.get(endpoint)).status(), 403);
    assert.equal(
      (await c.post(endpoint, { data: { operation: "capture" } })).status(),
      403,
    );
  }
  const owner = await ctx("bright-owner"),
    admin = await ctx("admin");
  assert.equal(
    (
      await owner.post(endpoint, {
        headers: { Origin: "https://untrusted.example" },
        data: { operation: "capture" },
      })
    ).status(),
    403,
  );
  const p = await applicant(owner),
    m = await capture(owner, p.email);
  const platform = await json(await admin.get("/api/workspace/platform")),
    t = platform.tenants.find((x) => x.id === "brightpath");
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
      await admin.patch("/api/workspace/platform/brightpath", {
        data: subscription,
      }),
    );
    assert.equal((await detail(owner, m.id)).message.id, m.id);
    assert.equal(
      (
        await owner.post(endpoint, {
          data: {
            operation: "ignore",
            messageId: m.id,
            revision: 1,
            note: "Denied",
          },
        })
      ).status(),
      403,
    );
  } finally {
    await json(
      await admin.patch("/api/workspace/platform/brightpath", {
        data: { ...subscription, status: t.status },
      }),
    );
  }
});
