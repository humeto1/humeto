import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { unlinkSync } from "node:fs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
const clean = {
  imports: [],
  docs: [],
  requirements: [],
  users: [],
  tenants: [],
};
const contexts = [];
async function account(user) {
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
after(async () => {
  for (const c of contexts) await c.dispose();
  const db = new DatabaseSync(
    resolve(process.env.HUMETO_DATA_DIR || ".data", "humeto.sqlite"),
  );
  db.exec("PRAGMA foreign_keys=ON");
  for (const id of clean.imports) {
    db.prepare("DELETE FROM import_items WHERE run_id=?").run(id);
    db.prepare("DELETE FROM import_runs WHERE id=?").run(id);
  }
  for (const id of clean.docs) {
    const files = db
      .prepare("SELECT stored_name FROM document_versions WHERE document_id=?")
      .all(id);
    db.prepare("DELETE FROM document_versions WHERE document_id=?").run(id);
    db.prepare("DELETE FROM documents WHERE id=?").run(id);
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
  for (const id of clean.requirements)
    db.prepare("DELETE FROM requirements WHERE id=?").run(id);
  for (const id of clean.users) {
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    db.prepare("DELETE FROM memberships WHERE user_id=?").run(id);
    db.prepare("DELETE FROM users WHERE id=?").run(id);
  }
  for (const id of clean.tenants) {
    db.prepare("DELETE FROM subscriptions WHERE tenant_id=?").run(id);
    db.prepare("DELETE FROM tenants WHERE id=?").run(id);
  }
  db.close();
});
test("batch import records provenance and links duplicates within one applicant", async () => {
  const c = await account("ayesha");
  const run = await c.post("/api/workspace/imports", {
    data: { personId: "amira", name: "QA selected folder", count: 2 },
  });
  assert.equal(run.status(), 200);
  const r = await run.json();
  clean.imports.push(r.id);
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from("QA-import-" + Date.now()),
  ]);
  const first = await c.post("/api/workspace/documents", {
    multipart: {
      personId: "amira",
      title: "QA import fixture",
      category: "Other",
      importRunId: r.id,
      sourcePath: "folder/evidence.png",
      file: { name: "evidence.png", mimeType: "image/png", buffer: bytes },
    },
  });
  assert.equal(first.status(), 200, await first.text());
  const doc = await first.json();
  clean.docs.push(doc.id);
  const second = await c.post("/api/workspace/documents", {
    multipart: {
      personId: "amira",
      title: "QA duplicate",
      category: "Other",
      importRunId: r.id,
      sourcePath: "folder/copy.png",
      file: { name: "copy.png", mimeType: "image/png", buffer: bytes },
    },
  });
  assert.equal(second.status(), 200);
  const duplicate = await second.json();
  assert.equal(duplicate.id, doc.id);
  assert.equal(duplicate.duplicate, true);
  await c.patch("/api/workspace/imports/" + r.id, {
    data: { status: "Complete" },
  });
  const manifest = await (await c.get("/api/workspace/imports")).json();
  assert.equal(manifest.runs.find((x) => x.id === r.id).processed_count, 2);
  const other = await account("bright-owner");
  assert.equal(
    (
      await other.patch("/api/workspace/imports/" + r.id, {
        data: { status: "Complete" },
      })
    ).status(),
    404,
  );
});
test("application working checklist gates Ready and student cannot review or waive", async () => {
  const c = await account("ayesha");
  const created = await c.post("/api/workspace/requirements", {
    data: {
      applicationId: "app-amira",
      label: "QA mandatory review",
      sectionKey: "identity",
      required: true,
    },
  });
  assert.equal(created.status(), 200);
  const req = await created.json();
  clean.requirements.push(req.id);
  const data = await (await c.get("/api/workspace/bootstrap")).json();
  const app = data.applications.find((a) => a.id === "app-amira");
  assert.equal(
    (
      await c.patch("/api/workspace/applications/app-amira", {
        data: { status: "Ready", revision: app.revision },
      })
    ).status(),
    400,
  );
  const student = await account("amira");
  assert.equal(
    (
      await student.patch("/api/workspace/requirements/" + req.id, {
        data: { status: "Reviewed" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await c.patch("/api/workspace/requirements/" + req.id, {
        data: { status: "Waived", note: "" },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await c.patch("/api/workspace/requirements/" + req.id, {
        data: { status: "Reviewed" },
      })
    ).status(),
    200,
  );
  const reviewed = await (
    await c.get("/api/workspace/applications/app-amira")
  ).json();
  assert.equal(
    reviewed.requirements.find((r) => r.id === req.id).status,
    "Reviewed",
  );
});
test("super admin creates an isolated workspace and password sign-in works", async () => {
  const admin = await account("admin");
  const email = "qa-owner-" + Date.now() + "@example.com",
    password = "Local-QA-only-Password-123";
  const created = await admin.post("/api/workspace/platform", {
    data: {
      name: "QA temporary institute",
      ownerName: "QA Owner",
      ownerEmail: email,
      password,
      plan: "Institute",
      seats: 2,
      caseLimit: 3,
    },
  });
  assert.equal(created.status(), 200, await created.text());
  const { id } = await created.json();
  clean.tenants.push(id);
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  assert.equal(
    (await c.post("/api/auth/login", { data: { email, password } })).status(),
    200,
  );
  const data = await (await c.get("/api/workspace/bootstrap")).json();
  assert.equal(data.people.length, 0);
  assert.equal((await c.get("/api/workspace/students/amira")).status(), 404);
  const team = await (await c.get("/api/workspace/team")).json();
  clean.users.push(team.members[0].id);
});
