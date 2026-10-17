import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { resolve } from "node:path";
import { unlinkSync } from "node:fs";
const createdDocIds = [];
let uploadedId = "";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
const contexts = [];
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  if (user) {
    const r = await c.post("/api/auth/demo", { data: { userId: user } });
    assert.equal(r.status(), 200, await r.text());
  }
  return c;
}
const endpoint = "/api/workspace/";
after(async () => {
  for (const c of contexts) await c.dispose();
  const db = database();
  for (const id of createdDocIds) {
    const files = await db
      .prepare("SELECT stored_name FROM document_versions WHERE document_id=?")
      .all(id);
    await db
      .prepare("DELETE FROM document_versions WHERE document_id=?")
      .run(id);
    await db.prepare("DELETE FROM documents WHERE id=?").run(id);
    await db
      .prepare("DELETE FROM audit WHERE entity_type='document' AND entity_id=?")
      .run(id);
    for (const f of files) {
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
  }
  await db.close();
});
test("unauthenticated and cross-origin requests are rejected", async () => {
  const c = await ctx();
  assert.equal((await c.get(endpoint + "bootstrap")).status(), 401);
  const r = await c.post("/api/auth/demo", {
    headers: { Origin: "https://untrusted.example" },
    data: { userId: "admin" },
  });
  assert.equal(r.status(), 403);
});
test("student, consultant, tenant and platform boundaries", async () => {
  const student = await ctx("amira");
  const data = await (await student.get(endpoint + "bootstrap")).json();
  assert.equal(data.people.length, 1);
  assert.equal(data.people[0].id, "amira");
  assert.equal((await student.get(endpoint + "students/omar")).status(), 404);
  assert.equal(
    (
      await student.post(endpoint + "students", {
        data: { name: "Denied Applicant", email: "denied@example.com" },
      })
    ).status(),
    403,
  );
  const other = await ctx("bright-owner");
  assert.equal((await other.get(endpoint + "students/amira")).status(), 404);
  assert.equal(
    (await other.get(endpoint + "documents/demo-transcript/download")).status(),
    404,
  );
  const consultant = await ctx("consultant");
  const r = await consultant.put(endpoint + "students/amira/intake", {
    data: {
      sectionKey: "declarations",
      data: { privateNotes: "Not permitted" },
      state: "draft",
      revision: 0,
    },
  });
  assert.equal(r.status(), 403);
  const admin = await ctx("admin");
  assert.equal((await admin.get(endpoint + "students/amira")).status(), 404);
  assert.equal((await admin.get(endpoint + "platform")).status(), 200);
});
test("partial answers persist, stale edits and unexpected fields fail", async () => {
  const c = await ctx("ayesha");
  let state = await (await c.get(endpoint + "students/amira")).json();
  const original = state.sections.find((s) => s.section_key === "identity");
  const changed = {
    ...original.data,
    preferredName: "Amira local persistence check",
  };
  const r = await c.put(endpoint + "students/amira/intake", {
    data: {
      sectionKey: "identity",
      data: changed,
      state: "draft",
      revision: original.revision,
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const saved = await r.json();
  const fresh = await (await c.get(endpoint + "students/amira")).json();
  assert.equal(
    fresh.sections.find((s) => s.section_key === "identity").data.preferredName,
    changed.preferredName,
  );
  const stale = await c.put(endpoint + "students/amira/intake", {
    data: {
      sectionKey: "identity",
      data: original.data,
      state: "draft",
      revision: original.revision,
    },
  });
  assert.equal(stale.status(), 409);
  const injection = await c.put(endpoint + "students/amira/intake", {
    data: {
      sectionKey: "identity",
      data: { tenantId: "brightpath" },
      state: "draft",
      revision: saved.revision,
    },
  });
  assert.equal(injection.status(), 400);
  await c.put(endpoint + "students/amira/intake", {
    data: {
      sectionKey: "identity",
      data: original.data,
      state: original.state,
      revision: saved.revision,
    },
  });
});
test("private file content, download authorization and preserved version history", async () => {
  const c = await ctx("ayesha");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  const r = await c.post(endpoint + "documents", {
    multipart: {
      personId: "amira",
      title: "QA private upload fixture",
      category: "Other",
      sectionKey: "identity",
      file: { name: "qa-fixture.png", mimeType: "image/png", buffer: png },
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  createdDocIds.push(id);
  uploadedId = id;
  const downloaded = await c.get(endpoint + `documents/${id}/download`);
  assert.equal(downloaded.status(), 200);
  assert.deepEqual(await downloaded.body(), png);
  assert.equal(downloaded.headers()["cache-control"], "private, no-store");
  const other = await ctx("bright-owner");
  assert.equal(
    (await other.get(endpoint + `documents/${id}/download`)).status(),
    404,
  );
  const v = await c.post(endpoint + `documents/${id}/version`, {
    multipart: {
      personId: "amira",
      file: { name: "qa-fixture-v2.png", mimeType: "image/png", buffer: png },
    },
  });
  assert.equal(v.status(), 200);
  assert.equal((await v.json()).version, 2);
  const bad = await c.post(endpoint + "documents", {
    multipart: {
      personId: "amira",
      file: {
        name: "bad.png",
        mimeType: "image/png",
        buffer: Buffer.from("<script>bad</script>"),
      },
    },
  });
  assert.equal(bad.status(), 400);
});
test("task priority is independent of stage, and submitted status needs evidence", async () => {
  const c = await ctx("ayesha");
  const data = await (await c.get(endpoint + "bootstrap")).json();
  const t = data.tasks.find((t) => t.id === "task-1");
  const r = await c.patch(endpoint + "tasks/" + t.id, {
    data: {
      stage: t.stage === "Done" ? "To do" : "Done",
      revision: t.revision,
    },
  });
  assert.equal(r.status(), 200);
  const fresh = await (await c.get(endpoint + "bootstrap")).json();
  const updated = fresh.tasks.find((x) => x.id === t.id);
  assert.equal(updated.important, t.important);
  assert.equal(updated.urgent, t.urgent);
  assert.equal(
    (
      await c.patch(endpoint + "tasks/" + t.id, {
        data: { stage: "To do", revision: t.revision },
      })
    ).status(),
    409,
  );
  await c.patch(endpoint + "tasks/" + t.id, {
    data: { stage: t.stage, revision: updated.revision },
  });
  const app = fresh.applications[0];
  assert.equal(
    (
      await c.patch(endpoint + "applications/" + app.id, {
        data: { status: "Submitted", revision: app.revision },
      })
    ).status(),
    400,
  );
  const snapshot = await c.post(
    endpoint + "applications/" + app.id + "/snapshot",
    { data: {} },
  );
  assert.equal(snapshot.status(), 200);
  assert.ok((await snapshot.json()).id);
});
test("read-only subscription blocks edits but preserves access", async () => {
  const admin = await ctx("admin"),
    owner = await ctx("bright-owner");
  const platform = await (await admin.get(endpoint + "platform")).json();
  const t = platform.tenants.find((t) => t.id === "brightpath");
  const payload = {
    plan: t.plan,
    status: "read-only",
    seats: t.seats,
    caseLimit: t.case_limit,
    storageMb: t.storage_mb,
    expiresAt: t.expires_at,
  };
  try {
    assert.equal(
      (
        await admin.patch(endpoint + "platform/brightpath", { data: payload })
      ).status(),
      200,
    );
    assert.equal(
      (
        await owner.post(endpoint + "students", {
          data: { name: "Should be blocked", email: "blocked@example.com" },
        })
      ).status(),
      403,
    );
    assert.equal(
      (await owner.get(endpoint + "students/bright-student")).status(),
      200,
    );
  } finally {
    await admin.patch(endpoint + "platform/brightpath", {
      data: { ...payload, status: t.status },
    });
  }
});
test("logout revokes the server session", async () => {
  const c = await ctx("ayesha");
  assert.equal((await c.post("/api/auth/logout", { data: {} })).status(), 200);
  assert.equal((await c.get(endpoint + "bootstrap")).status(), 401);
});
test("fact search is scoped and provides canonical DOB matches", async () => {
  const c = await ctx("amira");
  const r = await c.get(endpoint + "search?q=DOB");
  assert.equal(r.status(), 200);
  const data = await r.json();
  assert.ok(data.results.length > 0);
  assert.ok(data.results.every((r) => r.personId === "amira"));
  assert.ok(data.results.some((r) => r.label === "Date of birth"));
  const other = await ctx("bright-owner");
  const o = await (await other.get(endpoint + "search?q=Amira")).json();
  assert.equal(o.results.length, 0);
});
test("file-version listing is private and prior originals remain downloadable", async () => {
  const c = await ctx("ayesha");
  const data = await (await c.get(endpoint + "bootstrap")).json();
  const doc = data.documents.find((d) => d.id === uploadedId);
  assert.ok(doc);
  const versions = await (
    await c.get(endpoint + `documents/${doc.id}/versions`)
  ).json();
  assert.equal(versions.versions.length, 2);
  assert.equal(
    (await c.get(endpoint + `documents/${doc.id}/download?version=1`)).status(),
    200,
  );
  const other = await ctx("bright-owner");
  assert.equal(
    (await other.get(endpoint + `documents/${doc.id}/versions`)).status(),
    404,
  );
});
