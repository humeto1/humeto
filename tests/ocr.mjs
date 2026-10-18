import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  docIds = [],
  snapshots = new Map();
let browser, scan, pdf, scannedPdf;
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
async function fixtures() {
  if (scan) return;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1200 },
  });
  await page.setContent(
    '<html><body style="margin:70px;font:32px Arial;background:white;color:black"><h1 style="font-size:42px">FICTIONAL TEST PASSPORT</h1><p>Surname: SHAH</p><p>Given names: AMIRA</p><p>Date of birth: 15 JAN 2001</p><p>Passport number: XTEST1234</p><p>Issuing country: Pakistan</p><p>Issue date: 10 JAN 2023</p><p>Expiry date: 09 JAN 2033</p></body></html>',
  );
  scan = await page.screenshot({ type: "png" });
  await page.setContent(
    '<html><body style="margin:70px;font:26px Arial"><h1>FICTIONAL EDUCATION RECORD</h1><p>Institution name: Example University</p><p>Qualification: Bachelor of Science</p><p>Major: Environmental Science</p><p>GPA: 3.8</p></body></html>',
  );
  pdf = await page.pdf({ format: "A4" });
  await page.setContent(
    `<html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${scan.toString("base64")}"></body></html>`,
  );
  await page.locator("img").evaluate((el) => el.decode());
  scannedPdf = await page.pdf({ format: "A4", printBackground: true });
  await page.close();
}
async function upload(c, bytes, mime = "image/png", section = "passports") {
  const r = await c.post("/api/workspace/documents", {
    multipart: {
      personId: "amira",
      title: "OCR QA " + randomUUID(),
      sectionKey: section,
      category: "Other",
      file: {
        name:
          "fictional-ocr." +
          (mime === "application/pdf"
            ? "pdf"
            : mime === "image/jpeg"
              ? "jpg"
              : "png"),
        mimeType: mime,
        buffer: bytes,
      },
      readInformation: "true",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const j = await r.json();
  docIds.push(j.id);
  assert.ok(j.readingJobId, j.readingError);
  return j;
}
const read = async (c, id) =>
  (
    await c.get("/api/workspace/reading?documentId=" + id + "&personId=amira")
  ).json();
async function wait(c, id) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    const j = await read(c, id);
    const job = j.jobs.find((j) => j.document_version === 1);
    if (["completed", "failed"].includes(job?.status)) return j;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Local OCR worker did not complete the fixture in time.");
}
const send = (c, body) => c.post("/api/workspace/reading", { data: body });
async function snapshot(section) {
  if (snapshots.has(section)) return;
  const d = database();
  snapshots.set(
    section,
    (await d
      .prepare(
        "SELECT * FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key=?",
      )
      .get(section)) || null,
  );
}
after(async () => {
  for (const c of contexts) await c.dispose();
  if (browser) await browser.close();
  const d = database();
  for (const id of docIds) {
    await d.prepare("DELETE FROM ocr_jobs WHERE document_id=?").run(id);
    await d
      .prepare("DELETE FROM document_versions WHERE document_id=?")
      .run(id);
    await d.prepare("DELETE FROM documents WHERE id=?").run(id);
  }
  for (const [key, row] of snapshots) {
    if (row)
      await d
        .prepare(
          "UPDATE intake SET data=?,state=?,revision=? WHERE tenant_id='northstar' AND person_id='amira' AND section_key=?",
        )
        .run(row.data, row.state, row.revision, key);
    else
      await d
        .prepare(
          "DELETE FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key=?",
        )
        .run(key);
  }
  await d.close();
});
test("real local image OCR creates source-linked suggestions; student/staff review is independent and form saves are explicit", async () => {
  await fixtures();
  const owner = await ctx("ayesha"),
    student = await ctx("amira");
  const uploaded = await upload(owner, scan);
  let result = await wait(owner, uploaded.id);
  assert.equal(result.jobs[0].status, "completed", result.jobs[0].error);
  assert.equal(result.pages[0].method, "tesseract");
  assert.match(result.pages[0].text_content, /XTEST1234/);
  let f = result.facts.find((f) => f.field_key === "number");
  assert.ok(f);
  assert.equal(f.chosen_value, "XTEST1234");
  assert.equal(f.applicant_review, "pending");
  assert.equal(f.staff_review, "pending");
  assert.ok(f.source_box);
  assert.equal(
    (
      await owner.get("/api/workspace/reading/page?id=" + result.pages[0].id)
    ).status(),
    200,
  );
  assert.equal(
    (
      await send(owner, {
        action: "review",
        factId: f.id,
        revision: f.revision,
        review: "confirm",
        value: f.chosen_value,
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await send(student, {
        action: "review",
        factId: f.id,
        revision: f.revision,
        review: "confirm",
        value: f.chosen_value,
      })
    ).status(),
    200,
  );
  result = await read(owner, uploaded.id);
  f = result.facts.find((x) => x.id === f.id);
  assert.equal(f.applicant_review, "confirmed");
  assert.equal(f.staff_review, "pending");
  await snapshot("passports");
  let original = result.intake.find((i) => i.section_key === "passports");
  assert.equal(
    (
      await send(owner, {
        action: "apply",
        factIds: [f.id],
        sectionKey: "passports",
        newRecord: true,
        intakeRevision: original?.revision || 0,
      })
    ).status(),
    409,
  );
  assert.equal(
    (
      await send(owner, {
        action: "review",
        factId: f.id,
        revision: f.revision,
        review: "staff-accept",
        value: f.chosen_value,
      })
    ).status(),
    200,
  );
  result = await read(owner, uploaded.id);
  f = result.facts.find((x) => x.id === f.id);
  assert.equal(f.applicant_review, "confirmed");
  assert.equal(f.staff_review, "accepted");
  assert.equal(
    (
      await send(student, {
        action: "apply",
        factIds: [f.id],
        sectionKey: "passports",
        intakeRevision: original?.revision || 0,
      })
    ).status(),
    400,
  );
  let applied = await send(student, {
    action: "apply",
    factIds: [f.id],
    sectionKey: "passports",
    newRecord: true,
    intakeRevision: original?.revision || 0,
  });
  assert.equal(applied.status(), 200, await applied.text());
  const application = await applied.json();
  result = await read(owner, uploaded.id);
  assert.equal(
    result.intake
      .find((i) => i.section_key === "passports")
      .data.items.find((r) => r._id === application.recordId).number,
    "XTEST1234",
  );
  assert.equal(result.applications[0].currentMatches, true);
  assert.equal(
    (
      await send(student, {
        action: "apply",
        factIds: [f.id],
        sectionKey: "passports",
        newRecord: true,
        intakeRevision: original?.revision || 0,
      })
    ).status(),
    409,
  );
  const token = await (
    await owner.post("/api/workspace/assist-tokens", {
      data: { personId: "amira", sectionKeys: ["passports"] },
    })
  ).json();
  const paired = await (
    await owner.get("/api/assist", {
      headers: { Authorization: "Bearer " + token.token },
    })
  ).json();
  assert.match(
    paired.facts.find((p) => p.value === "XTEST1234").status,
    /Student confirmed/,
  );
  assert.equal(
    paired.facts.find((p) => p.value === "XTEST1234").source.page,
    1,
  );
  // Staff correction invalidates a previous student's approval rather than attributing it to them.
  assert.equal(
    (
      await send(owner, {
        action: "review",
        factId: f.id,
        revision: f.revision,
        review: "staff-accept",
        value: "XTEST1235",
      })
    ).status(),
    200,
  );
  result = await read(owner, uploaded.id);
  f = result.facts.find((x) => x.id === f.id);
  assert.equal(f.applicant_review, "pending");
  assert.equal(f.staff_review, "accepted");
  // Replacing the original invalidates every old assertion and prevents reapplication.
  const replacement = await owner.post(
    "/api/workspace/documents/" + uploaded.id + "/version",
    {
      multipart: {
        personId: "amira",
        file: { name: "new.png", mimeType: "image/png", buffer: scan },
      },
    },
  );
  assert.equal(replacement.status(), 200, await replacement.text());
  result = await read(owner, uploaded.id);
  assert.ok(result.facts.every((f) => f.source_stale));
  assert.equal(
    (
      await send(owner, {
        action: "review",
        factId: f.id,
        revision: result.facts.find((x) => x.id === f.id).revision,
        review: "staff-accept",
        value: "XTEST1234",
      })
    ).status(),
    409,
  );
});
test("digital PDFs use embedded text and scanned PDFs use OCR, retaining page evidence", async () => {
  await fixtures();
  const c = await ctx("ayesha");
  let upload1 = await upload(c, pdf, "application/pdf", "education"),
    read1 = await wait(c, upload1.id);
  assert.equal(read1.jobs[0].status, "completed", read1.jobs[0].error);
  assert.equal(read1.pages[0].method, "pdf-text");
  assert.ok(
    read1.facts.some(
      (f) =>
        f.field_key === "institution" &&
        f.chosen_value === "Example University",
    ),
  );
  assert.equal(read1.facts[0].confidence, null);
  const upload2 = await upload(c, scannedPdf, "application/pdf");
  const read2 = await wait(c, upload2.id);
  assert.equal(read2.jobs[0].status, "completed", read2.jobs[0].error);
  assert.equal(read2.pages[0].method, "tesseract");
  assert.ok(read2.facts.some((f) => f.field_key === "number"));
  const same = await send(c, {
    action: "queue",
    documentId: upload1.id,
    version: 1,
  });
  assert.equal(same.status(), 200);
  assert.equal((await same.json()).id, upload1.readingJobId);
});
test("document reader UI reviews education facts and saves to an explicitly chosen new record", async () => {
  await snapshot("education");
  const context = await browser.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  try {
    await context.request.post("/api/auth/demo", {
      data: { userId: "ayesha" },
    });
    const page = await context.newPage({
      viewport: { width: 1300, height: 1000 },
    });
    await page.goto(base + "/workspace/reading?documentId=" + docIds[1]);
    await page
      .getByRole("heading", { name: "Education history", exact: true })
      .waitFor();
    const card = page
      .getByTestId("document-fact")
      .filter({ has: page.getByText("Institution name", { exact: true }) });
    await card
      .getByRole("button", { name: "Accept as staff", exact: true })
      .click();
    await card.getByText("Staff: accepted", { exact: true }).waitFor();
    await card.getByLabel("Select Institution name", { exact: true }).check();
    await page
      .getByLabel("Target record for Education history", { exact: true })
      .selectOption("new");
    await page
      .getByRole("button", { name: "Save selected facts to form", exact: true })
      .click();
    await page
      .getByText(
        "Reviewed facts saved to a draft section. Other fields and application statuses were preserved.",
        { exact: true },
      )
      .waitFor();
    const source = page.getByRole("img", {
      name: "Original document rendering, page 1",
    });
    assert.equal(await source.isVisible(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await card.getByRole("button", { name: "p. 1", exact: true }).click();
    await page
      .getByRole("button", { name: "Back to selected fact", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Back to selected fact", exact: true })
      .click();
    assert.equal(
      await card
        .getByLabel("Value for Institution name", { exact: true })
        .isVisible(),
      true,
    );
  } finally {
    await context.close();
  }
});
test("reading and source pages enforce student, tenant, restricted-document and read-only boundaries", async () => {
  const owner = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    student = await ctx("amira"),
    staff = await ctx("consultant");
  const original = docIds[0],
    data = await read(owner, original),
    page = data.pages[0];
  assert.equal(
    (await other.get("/api/workspace/reading?documentId=" + original)).status(),
    404,
  );
  assert.equal(
    (await other.get("/api/workspace/reading/page?id=" + page.id)).status(),
    404,
  );
  assert.equal(
    (await student.get("/api/workspace/reading?personId=fatima")).status(),
    404,
  );
  const restricted = await upload(owner, pdf, "application/pdf", "usa-health");
  assert.equal(
    (
      await staff.get("/api/workspace/reading?documentId=" + restricted.id)
    ).status(),
    404,
  );
  assert.equal(
    (
      await send(staff, {
        action: "queue",
        documentId: restricted.id,
        version: 1,
      })
    ).status(),
    404,
  );
  await wait(owner, restricted.id);
  const d = database();
  const originalStatus = await d
    .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
    .get();
  await d
    .prepare(
      "UPDATE subscriptions SET status='suspended' WHERE tenant_id='northstar'",
    )
    .run();
  try {
    assert.equal(
      (
        await send(owner, { action: "queue", documentId: original, version: 2 })
      ).status(),
      403,
    );
    assert.equal(
      (
        await owner.get("/api/workspace/reading?documentId=" + original)
      ).status(),
      200,
    );
  } finally {
    await d
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id='northstar'")
      .run(originalStatus.status);
  }
});
test("conflicting answers require replacement consent and later manual edits invalidate the profile link", async () => {
  const c = await ctx("ayesha");
  await snapshot("identity");
  let data = await read(c, docIds[2]),
    f = data.facts.find((f) => f.field_key === "givenNames");
  assert.ok(f);
  assert.equal(
    (
      await send(c, {
        action: "review",
        factId: f.id,
        revision: f.revision,
        review: "staff-accept",
        value: "AMIRA FROM SOURCE",
      })
    ).status(),
    200,
  );
  data = await read(c, docIds[2]);
  const original = data.intake.find((r) => r.section_key === "identity");
  const body = {
    action: "apply",
    factIds: [f.id],
    sectionKey: "identity",
    intakeRevision: original.revision,
  };
  assert.equal((await send(c, body)).status(), 409);
  assert.equal(
    (await send(c, { ...body, replaceExisting: true })).status(),
    200,
  );
  data = await read(c, docIds[2]);
  const current = data.intake.find((r) => r.section_key === "identity");
  const edited = { ...current.data, givenNames: "MANUALLY CORRECTED" };
  let r = await c.put("/api/workspace/students/amira/intake", {
    data: {
      sectionKey: "identity",
      data: edited,
      state: "draft",
      revision: current.revision,
    },
  });
  assert.equal(r.status(), 200, await r.text());
  data = await read(c, docIds[2]);
  assert.equal(
    data.applications.find((a) => a.fact_id === f.id).currentMatches,
    false,
  );
  assert.ok(
    data.events.some((e) => e.event === "applied" && e.fact_id === f.id),
  );
});
test("bad files produce a recoverable failed reading without inventing facts; manual mapping must quote real page text", async () => {
  const c = await ctx("ayesha");
  const broken = await upload(
    c,
    Buffer.from("%PDF-1.7\nbroken fixture"),
    "application/pdf",
  );
  let data = await wait(c, broken.id);
  assert.equal(data.jobs[0].status, "failed");
  assert.equal(data.facts.length, 0);
  assert.ok(data.jobs[0].error);
  assert.equal(
    (
      await send(c, {
        action: "queue",
        documentId: broken.id,
        version: 1,
        retryRevision: data.jobs[0].revision - 1,
      })
    ).status(),
    409,
  );
  const digital = docIds[1],
    page = (await read(c, digital)).pages[0];
  assert.equal(
    (
      await send(c, {
        action: "map",
        pageId: page.id,
        sectionKey: "identity",
        fieldKey: "givenNames",
        excerpt: "Text not on this page",
        value: "Invented",
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await send(c, {
        action: "map",
        pageId: page.id,
        sectionKey: "declarations",
        fieldKey: "criminal",
        excerpt: page.lines[0].text,
        value: "No",
      })
    ).status(),
    400,
  );
  const r = await send(c, {
    action: "map",
    pageId: page.id,
    sectionKey: "education",
    fieldKey: "institution",
    excerpt: page.lines.find((l) => l.text.includes("Example University")).text,
    value: "Example University",
  });
  assert.equal(r.status(), 200, await r.text());
});

test("JPEG images use the same local OCR pipeline", async () => {
  await fixtures();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1200 },
  });
  await page.setContent(
    `<html><body style="margin:0"><img style="width:1200px" src="data:image/png;base64,${scan.toString("base64")}"></body></html>`,
  );
  await page.locator("img").evaluate((el) => el.decode());
  const jpeg = await page.screenshot({
    type: "jpeg",
    quality: 95,
    fullPage: true,
  });
  await page.close();
  const c = await ctx("ayesha"),
    uploaded = await upload(c, jpeg, "image/jpeg"),
    data = await wait(c, uploaded.id);
  assert.equal(data.jobs[0].status, "completed", data.jobs[0].error);
  assert.equal(data.pages[0].method, "tesseract");
  assert.ok(data.facts.some((f) => f.field_key === "number"));
});
test("expired worker leases stop after the bounded retry count", async () => {
  const c = await ctx("ayesha"),
    d = database(),
    did = docIds[0],
    source = await d
      .prepare(
        "SELECT sha256 FROM document_versions WHERE tenant_id='northstar' AND document_id=? AND version=2",
      )
      .get(did),
    jid = randomUUID();
  await d
    .prepare(
      "INSERT INTO ocr_jobs(id,tenant_id,person_id,document_id,document_version,source_sha256,status,attempts,lease_token,lease_until,requested_by) VALUES(?,'northstar','amira',?,2,?,'running',3,'expired-test-lease',now()-interval '5 minutes','ayesha')",
    )
    .run(jid, did, source.sha256);
  const until = Date.now() + 10000;
  let job;
  while (Date.now() < until) {
    job = (await read(c, did)).jobs.find((j) => j.id === jid);
    if (job?.status === "failed") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(job.status, "failed");
  assert.match(job.error, /previous reader stopped/i);
  assert.equal(
    (await read(c, did)).facts.filter((f) => f.job_id === jid).length,
    0,
  );
});
