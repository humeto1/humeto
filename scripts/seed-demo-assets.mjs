// Explicit local-demo fixture generator. Contains no real applicant evidence.
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = resolve(process.env.HUMETO_DATA_DIR || ".data");
if (!existsSync(resolve(dir, "humeto.sqlite")))
  throw new Error("Initialize local demo through /login first.");
const db = new DatabaseSync(resolve(dir, "humeto.sqlite"));
if (!db.prepare("SELECT id FROM tenants WHERE id='northstar'").get())
  throw new Error("Known fictional demo workspace not found.");
mkdirSync(resolve(dir, "uploads"), { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
for (const [did, pid, title, category, section, description] of [
  [
    "demo-transcript",
    "amira",
    "Sample education summary",
    "Education",
    "education",
    "Fictional study record for testing the document library.",
  ],
  [
    "demo-language",
    "omar",
    "Sample language evidence note",
    "Language test",
    "tests",
    "Fictional evidence note. This is not a test-provider report.",
  ],
  [
    "demo-sop",
    "sofia",
    "Sample study intention draft",
    "Authored document",
    "statements",
    "A fictional student draft, ready for feedback.",
  ],
  [
    "demo-offer",
    "james",
    "Sample program planning note",
    "Education",
    "study-goals",
    "A fictional planning note, not an offer of admission.",
  ],
]) {
  if (db.prepare("SELECT id FROM documents WHERE id=?").get(did)) continue;
  const filename = randomUUID();
  const page = await browser.newPage({
    viewport: { width: 800, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;background:#fbfbf5;color:#193e32;font:17px Georgia;padding:60px"><div style="font-size:38px;font-weight:bold">humeto.</div><p style="font:10px Arial;letter-spacing:3px;margin-top:50px;color:#84956b">FICTIONAL DEVELOPMENT SAMPLE</p><h1 style="font-size:38px;font-weight:normal;margin-top:25px">${title}</h1><p style="line-height:1.8;color:#869773">${description}</p><div style="border:2px solid #c7d7aa;padding:24px;margin-top:50px;font:15px Arial;line-height:2">This page is a demo fixture.<br>It contains no real applicant values.<br>It is not valid evidence for admission or a visa.</div><h2 style="font-size:22px;margin-top:50px">A little more organized.</h2><p style="line-height:1.9;color:#8a9c77">Use this sample to explore versioning, private download, category assignment and group-level evidence links.</p><div style="border-top:1px solid #dce4cd;padding-top:25px;margin-top:70px;font:11px Arial;color:#91a17c">NOT AN OFFICIAL DOCUMENT · LOCAL DEMO ONLY</div></body></html>`,
  );
  await page.screenshot({
    path: resolve(dir, "uploads", filename),
    type: "png",
  });
  await page.close();
  const bytes = readFileSync(resolve(dir, "uploads", filename));
  db.prepare(
    "INSERT INTO documents(id,tenant_id,person_id,title,category,section_key,status) VALUES(?,?,?,?,?,?,?)",
  ).run(did, "northstar", pid, title, category, section, "Received");
  db.prepare(
    "INSERT INTO document_versions(id,tenant_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    "northstar",
    did,
    1,
    title.toLowerCase().replaceAll(" ", "-") + ".png",
    filename,
    "image/png",
    bytes.length,
    createHash("sha256").update(bytes).digest("hex"),
  );
}
await browser.close();
console.log("Fictional document fixtures ready.");
