import { test } from "node:test";
import { spawnSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";

test("passport details fill the profile for inline correction and explicit source-linked approval", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  const d = database();
  const snapshots = await d
    .prepare(
      "SELECT * FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key IN ('identity','passports')",
    )
    .all();
  let documentId;
  try {
    await d
      .prepare(
        "DELETE FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key IN ('identity','passports')",
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
    assert.equal(
      await d
        .prepare(
          "SELECT * FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key='identity'",
        )
        .get(),
      undefined,
    );
    await expect(
      page.getByRole("link", { name: /View source document/ }).first(),
    ).toHaveAttribute("href", `/workspace/reading?documentId=${documentId}`);
    await page
      .getByLabel("Given names", { exact: true })
      .fill("CORRECTED PERSON");
    await page
      .getByRole("button", { name: "Approve document details", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Approved document details saved" }),
    ).toBeVisible();
    const saved = await read();
    assert.equal(
      saved.intake.find((row) => row.section_key === "identity").data
        .givenNames,
      "CORRECTED PERSON",
    );
    assert.ok(
      saved.applications.some(
        (link) => link.field_key === "givenNames" && link.currentMatches,
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
    await page
      .getByRole("button", { name: "Approve document details", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Approved document details saved" }),
    ).toBeVisible();
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
    if (documentId) {
      await d
        .prepare("DELETE FROM ocr_jobs WHERE document_id=?")
        .run(documentId);
      await d
        .prepare("DELETE FROM document_versions WHERE document_id=?")
        .run(documentId);
      await d.prepare("DELETE FROM documents WHERE id=?").run(documentId);
    }
    await context.close();
    await browser.close();
    await d
      .prepare(
        "DELETE FROM intake WHERE tenant_id='northstar' AND person_id='amira' AND section_key IN ('identity','passports')",
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
