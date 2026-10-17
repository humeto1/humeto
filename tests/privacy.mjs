import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { resolve } from "node:path";
import { unlinkSync } from "node:fs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
let documentId = "";
async function signIn(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  await c.post("/api/auth/demo", { data: { userId: user } });
  return c;
}
after(async () => {
  const db = database();
  await db
    .prepare(
      "DELETE FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key='usa-health' AND data LIKE '%QA private disclosure marker%'",
    )
    .run();
  if (documentId) {
    for (const f of await db
      .prepare("SELECT stored_name FROM document_versions WHERE document_id=?")
      .all(documentId)) {
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
    await db
      .prepare("DELETE FROM document_versions WHERE document_id=?")
      .run(documentId);
    await db.prepare("DELETE FROM documents WHERE id=?").run(documentId);
  }
  await db.close();
});
test("private disclosure values and evidence are excluded from ordinary consultant access", async () => {
  const owner = await signIn("ayesha"),
    consultant = await signIn("consultant"),
    student = await signIn("amira");
  try {
    const current = await (
      await owner.get("/api/workspace/students/amira")
    ).json();
    const row = current.sections.find((s) => s.section_key === "usa-health");
    const saved = await owner.put("/api/workspace/students/amira/intake", {
      data: {
        sectionKey: "usa-health",
        data: {
          communicable: "I don’t know",
          explanation: "QA private disclosure marker",
        },
        state: "draft",
        revision: row?.revision || 0,
      },
    });
    assert.equal(saved.status(), 200, await saved.text());
    const consulData = await (
      await consultant.get("/api/workspace/students/amira")
    ).json();
    assert.ok(!consulData.sections.some((s) => s.section_key === "usa-health"));
    const ownData = await (
      await student.get("/api/workspace/students/amira")
    ).json();
    assert.ok(ownData.sections.some((s) => s.section_key === "usa-health"));
    assert.equal(
      (
        await consultant.put("/api/workspace/students/amira/intake", {
          data: {
            sectionKey: "usa-health",
            data: { explanation: "Not allowed" },
            state: "draft",
            revision: 1,
          },
        })
      ).status(),
      403,
    );
    const search = await (
      await consultant.get("/api/workspace/search?q=QA%20private%20disclosure")
    ).json();
    assert.equal(search.results.length, 0);
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
      "base64",
    );
    const doc = await owner.post("/api/workspace/documents", {
      multipart: {
        personId: "amira",
        sectionKey: "usa-health",
        category: "Other",
        title: "QA private evidence",
        file: {
          name: "private-fixture.png",
          mimeType: "image/png",
          buffer: bytes,
        },
      },
    });
    assert.equal(doc.status(), 200);
    documentId = (await doc.json()).id;
    assert.equal(
      (
        await consultant.get(
          "/api/workspace/documents/" + documentId + "/download",
        )
      ).status(),
      404,
    );
    assert.equal(
      (
        await consultant.get(
          "/api/workspace/documents/" + documentId + "/versions",
        )
      ).status(),
      404,
    );
    const bootstrap = await (
      await consultant.get("/api/workspace/bootstrap")
    ).json();
    assert.ok(!bootstrap.documents.some((d) => d.id === documentId));
    assert.equal(
      (
        await student.get(
          "/api/workspace/documents/" + documentId + "/download",
        )
      ).status(),
      200,
    );
  } finally {
    await owner.dispose();
    await consultant.dispose();
    await student.dispose();
  }
});
