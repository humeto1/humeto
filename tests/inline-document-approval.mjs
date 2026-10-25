import { test } from "node:test";
import { spawnSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";

test("passport details automatically persist in the main form and manual corrections survive repeated fills", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  const d = database();
  const snapshots = await d
    .prepare(
      "SELECT * FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key IN ('identity','passports','education')",
    )
    .all();
  let documentId;
  try {
    await d
      .prepare(
        "DELETE FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key IN ('identity','passports','education')",
      )
      .run();
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    const page = await context.newPage();
    await page.setContent(
      "<html><body><h1>FICTIONAL PASSPORT</h1><p>Given names: TEST PERSON</p><p>Surname: EXAMPLE</p><p>Date of birth: 15 JAN 2001</p><p>Passport number: INLINE1234</p></body></html>",
    );
    const pdf = await page.pdf();
    const upload = await context.request.post("/api/workspace/documents", {
      multipart: {
        personId: "amira",
        title: "Inline approval fictional passport",
        sectionKey: "passports",
        category: "Other",
        file: {
          name: "fictional.pdf",
          mimeType: "application/pdf",
          buffer: pdf,
        },
        readInformation: "true",
      },
    });
    assert.equal(upload.status(), 200, await upload.text());
    const uploaded = await upload.json();
    documentId = uploaded.id;
    const read = async () =>
      (
        await context.request.get(
          `/api/workspace/reading?personId=amira&documentId=${documentId}`,
        )
      ).json();
    await expect
      .poll(async () => (await read()).jobs[0]?.status, { timeout: 90000 })
      .toBe("completed");
    // Simulate a completed job produced by the old parser, then recover saved text.
    await d
      .prepare("DELETE FROM document_facts WHERE job_id=?")
      .run(uploaded.readingJobId);
    for (const flags of [[], ["--apply"]]) {
      const recovery = spawnSync(
        process.execPath,
        ["scripts/reparse-document-job.mjs", uploaded.readingJobId, ...flags],
        { env: process.env, encoding: "utf8" },
      );
      assert.equal(recovery.status, 0, recovery.stderr);
      assert.ok(JSON.parse(recovery.stdout).factCount >= 3);
      if (!flags.length) assert.equal((await read()).facts.length, 0);
    }
    await page.goto("/workspace/students/amira");
    await expect(page.getByLabel("Given names", { exact: true })).toHaveValue(
      "TEST PERSON",
    );
    const filled = await read();
    assert.equal(
      filled.intake.find((row) => row.section_key === "identity").data
        .givenNames,
      "TEST PERSON",
    );
    assert.ok(
      filled.facts.every(
        (f) => f.staff_review === "pending" && f.applicant_review === "pending",
      ),
    );
    await expect(
      page.getByRole("link", {
        name: /Given names.*Inline approval fictional passport/,
      }),
    ).toHaveAttribute("href", `/workspace/reading?documentId=${documentId}`);
    await page
      .getByLabel("Given names", { exact: true })
      .fill("CORRECTED PERSON");
    await expect
      .poll(
        async () =>
          (await read()).intake.find((row) => row.section_key === "identity")
            .data.givenNames,
      )
      .toBe("CORRECTED PERSON");
    const refreshReading = spawnSync(
      process.execPath,
      [
        "scripts/reparse-document-job.mjs",
        uploaded.readingJobId,
        "--refresh-unreviewed",
        "--apply",
      ],
      { env: process.env, encoding: "utf8" },
    );
    assert.equal(refreshReading.status, 0, refreshReading.stderr);
    assert.ok(JSON.parse(refreshReading.stdout).supersededFacts >= 3);
    const afterRefresh = await read();
    assert.equal(
      afterRefresh.intake.find((row) => row.section_key === "identity").data
        .givenNames,
      "CORRECTED PERSON",
    );
    assert.ok(afterRefresh.facts.every((f) => !f.source_stale));
    const repeated = await context.request.post("/api/workspace/reading", {
      data: { action: "autofill", personId: "amira" },
    });
    assert.equal(repeated.status(), 200);
    assert.equal(
      (
        await context.request.post("/api/workspace/reading", {
          headers: { Origin: "https://untrusted.example" },
          data: { action: "autofill", personId: "amira" },
        })
      ).status(),
      403,
    );
    const other = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
    try {
      await other.request.post("/api/auth/demo", {
        data: { userId: "bright-owner" },
      });
      assert.equal(
        (
          await other.request.post("/api/workspace/reading", {
            data: { action: "autofill", personId: "amira" },
          })
        ).status(),
        404,
      );
    } finally {
      await other.close();
    }
    const saved = await read();
    assert.equal(
      saved.intake.find((row) => row.section_key === "identity").data
        .givenNames,
      "CORRECTED PERSON",
    );
    assert.ok(
      saved.applications.some(
        (link) => link.field_key === "familyName" && link.currentMatches,
      ),
    );
    await page.reload();
    await expect(page.getByLabel("Given names", { exact: true })).toHaveValue(
      "CORRECTED PERSON",
    );
    await page
      .locator(".section-navigation")
      .getByRole("button", { name: /Passports & identity/ })
      .click();
    await expect(
      page.getByLabel("Passport / identity number", { exact: true }),
    ).toHaveValue("INLINE1234");
    const after = await read();
    assert.equal(
      after.intake.find((row) => row.section_key === "passports").data.items
        .length,
      1,
    );
    assert.equal(
      after.intake.find((row) => row.section_key === "passports").data.items[0]
        .number,
      "INLINE1234",
    );
    await page.reload();
    await page
      .locator(".section-navigation")
      .getByRole("button", { name: /Passports & identity/ })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Approve document details",
        exact: true,
      }),
    ).toHaveCount(0);
    // Bulk uploads use the same automatic profile fill, with one record per document group.
    await page.setContent(
      "<html><body><h1>FICTIONAL EDUCATION RECORD</h1><p>Institution name: Bulk Example University</p><p>Qualification: Bachelor of Science</p></body></html>",
    );
    const educationPdf = await page.pdf();
    await page.goto("/workspace/documents");
    await page
      .getByRole("button", { name: "Upload document", exact: true })
      .click();
    await page.locator('select[name="personId"]').selectOption("amira");
    await page.locator('input[name="file"]').setInputFiles([
      { name: "bulk-identity.pdf", mimeType: "application/pdf", buffer: pdf },
      {
        name: "bulk-education.pdf",
        mimeType: "application/pdf",
        buffer: educationPdf,
      },
    ]);
    await page
      .getByRole("button", { name: "Upload private documents", exact: true })
      .click();
    await expect
      .poll(async () =>
        Number(
          (
            await d
              .prepare(
                "SELECT COUNT(*) AS n FROM documents WHERE person_id='amira' AND tenant_id='northstar' AND title IN ('bulk-identity.pdf','bulk-education.pdf')",
              )
              .get()
          ).n,
        ),
      )
      .toBe(2);
    await expect
      .poll(
        async () =>
          Number(
            (
              await d
                .prepare(
                  "SELECT COUNT(*) AS n FROM ocr_jobs j JOIN documents doc ON doc.id=j.document_id WHERE doc.person_id='amira' AND doc.tenant_id='northstar' AND doc.title IN ('bulk-identity.pdf','bulk-education.pdf') AND j.status='completed'",
                )
                .get()
            ).n,
          ),
        { timeout: 90000 },
      )
      .toBe(2);
    await page.goto("/workspace/students/amira");
    await expect(page.getByLabel("Given names", { exact: true })).toHaveValue(
      "CORRECTED PERSON",
    );
    await expect
      .poll(
        async () =>
          (await read()).intake.find((row) => row.section_key === "education")
            ?.data.items[0]?.institution,
      )
      .toBe("Bulk Example University");
    assert.equal(
      (await read()).intake.find((row) => row.section_key === "passports").data
        .items.length,
      1,
    );
    await page.goto(`/workspace/reading?documentId=${documentId}`);
    await page.getByTestId("document-fact").first().waitFor();
    const accessibility = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    assert.deepEqual(
      accessibility.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
      [],
    );
  } finally {
    const cleanupDocs = await d
      .prepare(
        "SELECT id FROM documents WHERE person_id='amira' AND tenant_id='northstar' AND (id=? OR title IN ('bulk-identity.pdf','bulk-education.pdf'))",
      )
      .all(documentId || "");
    for (const doc of cleanupDocs) {
      await d.prepare("DELETE FROM ocr_jobs WHERE document_id=?").run(doc.id);
      await d
        .prepare("DELETE FROM document_versions WHERE document_id=?")
        .run(doc.id);
      await d.prepare("DELETE FROM documents WHERE id=?").run(doc.id);
    }
    await context.close();
    await browser.close();
    await d
      .prepare(
        "DELETE FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key IN ('identity','passports','education')",
      )
      .run();
    for (const row of snapshots)
      await d
        .prepare(
          "INSERT INTO intake(tenant_id,person_id,section_key,data,state,revision,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          row.tenant_id,
          row.person_id,
          row.section_key,
          row.data,
          row.state,
          row.revision,
          row.updated_at,
        );
    await d.close();
  }
});
