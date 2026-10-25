// Explicit fictional OCR example. Never reads or modifies real applicant evidence.
import { database } from "../src/lib/postgres.mjs";
import { chromium } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { putObject, deleteObject } from "../src/lib/storage.mjs";
if (process.env.HUMETO_LOCAL_DEMO !== "true")
  throw Error("This fixture is only available in local demo mode.");
const d = database(),
  docId = "demo-ocr-passport";
let browser,
  stored = "",
  saved = false;
try {
  if (
    !(await d
      .prepare(
        "SELECT id FROM people WHERE id='amira' AND tenant_id='northstar'",
      )
      .get())
  )
    throw Error("Initialize the fictional demo workspace first.");
  if (!(await d.prepare("SELECT id FROM documents WHERE id=?").get(docId))) {
    stored = randomUUID();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1000, height: 1150 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<html><body style="margin:65px;font:28px Arial;background:white;color:#263d31"><div style="font-size:18px;letter-spacing:2px;color:#7a8c6a">HUMETO · FICTIONAL OCR SAMPLE</div><h1 style="font:42px Georgia;margin-top:40px">Passport details</h1><p>Given names: AMIRA</p><p>Surname: SHAH</p><p>Date of birth: 15 JAN 2001</p><p>Passport number: XTEST1234</p><p>Issuing country: Pakistan</p><p>Issue date: 10 JAN 2023</p><p>Expiry date: 09 JAN 2033</p><div style="margin-top:55px;padding:20px;border:1px solid #ccd7c4;font-size:20px;line-height:1.7">Illustrative values only. This is not a passport or identity document. Use it to test reading, source review and conflict handling.</div></body></html>',
    );
    const bytes = await page.screenshot({ type: "png" });
    await browser.close();
    browser = null;
    await putObject("uploads/" + stored, bytes, "image/png");
    await d.transaction(async () => {
      await d
        .prepare(
          "INSERT INTO documents(id,tenant_id,person_id,title,category,section_key,status) VALUES(?,'northstar','amira','Demo passport details (fictional)','Identity','passports','Received')",
        )
        .run(docId);
      await d
        .prepare(
          "INSERT INTO document_versions(id,tenant_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256) VALUES(?,'northstar',?,1,'fictional-ocr-sample.png',?,'image/png',?,?)",
        )
        .run(
          randomUUID(),
          docId,
          stored,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
        );
    });
    saved = true;
  }
  const source = await d
    .prepare(
      "SELECT sha256 FROM document_versions WHERE document_id=? AND version=1 AND tenant_id='northstar'",
    )
    .get(docId);
  await d
    .prepare(
      "INSERT INTO ocr_jobs(id,tenant_id,person_id,document_id,document_version,source_sha256,requested_by) VALUES(?,'northstar','amira',?,1,?,'ayesha') ON CONFLICT(tenant_id,document_id,document_version) DO NOTHING",
    )
    .run(randomUUID(), docId, source.sha256);
  console.log("Fictional OCR sample ready; local reading queued.");
} finally {
  if (browser) await browser.close();
  if (stored && !saved) await deleteObject("uploads/" + stored).catch(() => {});
  await d.close();
}
