// Opt-in fictional data only. No real student files or task updates.
import { database } from "../src/lib/postgres.mjs";
import { chromium } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
if (process.env.HUMETO_LOCAL_DEMO !== "true")
  throw Error("This fixture is only available in local demo mode.");
const d = database(),
  nid = "22222222-2222-4222-8222-222222222222",
  root = resolve(process.env.HUMETO_DATA_DIR || ".data");
let browser,
  filename = "",
  saved = false;
try {
  if (
    !(await d
      .prepare(
        "SELECT user_id FROM memberships WHERE tenant_id='northstar' AND user_id='ayesha' AND role='owner'",
      )
      .get())
  )
    throw Error("Initialize the fictional demo workspace first.");
  if (await d.prepare("SELECT id FROM task_notebooks WHERE id=?").get(nid)) {
    console.log("Fictional notebook already available.");
  } else {
    filename = "notebook-" + randomUUID() + ".png";
    await mkdir(resolve(root, "uploads"), { recursive: true, mode: 0o700 });
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1100, height: 520 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<html><body style="margin:45px;font:30px Arial;color:#182617;background:white"><div style="font-size:18px;color:#66805a;margin-bottom:50px">HUMETO — FICTIONAL PRINTED NOTEBOOK SAMPLE</div><p>[ ] Review the scholarship checklist</p><p>[x] Send the partner welcome pack</p><p>[ ] Prepare the next application review</p><div style="font-size:17px;color:#66805a;margin-top:50px">Example only. Review every line; nothing has been created or completed.</div></body></html>',
    );
    await page.screenshot({
      path: resolve(root, "uploads", filename),
      type: "png",
    });
    const bytes = await readFile(resolve(root, "uploads", filename));
    const result = await d
      .prepare(
        "INSERT INTO task_notebooks(id,tenant_id,user_id,original_name,stored_name,mime_type,source_sha256) VALUES(?,'northstar','ayesha','DEMO - fictional printed notebook.png',?,'image/png',?) ON CONFLICT(id) DO NOTHING",
      )
      .run(nid, filename, createHash("sha256").update(bytes).digest("hex"));
    saved = !!result.changes;
    console.log(
      "Fictional notebook ready; local reading queued. No tasks changed.",
    );
  }
} finally {
  if (browser) await browser.close();
  if (filename && !saved)
    await rm(resolve(root, "uploads", filename), { force: true });
  await d.close();
}
