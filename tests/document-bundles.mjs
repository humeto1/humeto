import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { bundleName, bundleZip, crc32 } from "../src/lib/bundle-zip.mjs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  docs = [];
const endpoint = "/api/document-bundles",
  hash = (b) => createHash("sha256").update(b).digest("hex");
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
async function pdf() {
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.setContent(
      "<h1>Fictional bundle fixture</h1><p>Original export only. " +
        randomUUID() +
        "</p>",
    );
    return await p.pdf();
  } finally {
    await b.close();
  }
}
async function upload(c, bytes, section = "identity", documentId = "") {
  const r = await c.post(
    "/api/workspace/documents" +
      (documentId ? "/" + documentId + "/version" : ""),
    {
      multipart: {
        personId: "amira",
        title: "Bundle QA ../Passport",
        category: "Identity",
        sectionKey: section,
        readLocally: "false",
        ...(documentId ? { documentId } : {}),
        file: {
          name: "../Original passport.pdf",
          mimeType: "application/pdf",
          buffer: bytes,
        },
      },
    },
  );
  assert.equal(r.status(), 200, await r.text());
  const v = await r.json();
  if (!docs.includes(v.id)) docs.push(v.id);
  return v.id;
}
function body(id, extra = {}) {
  return {
    action: "preview",
    personId: "amira",
    items: [{ id, version: 1 }],
    nameMode: "title",
    maxFileMB: 15,
    pdfOnly: false,
    ...extra,
  };
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const id of docs) {
    const files = await d
      .prepare("SELECT stored_name FROM document_versions WHERE document_id=?")
      .all(id);
    await d
      .prepare("DELETE FROM document_versions WHERE document_id=?")
      .run(id);
    await d.prepare("DELETE FROM documents WHERE id=?").run(id);
    for (const f of files)
      await unlink(
        resolve(
          process.env.HUMETO_DATA_DIR || ".data",
          "uploads",
          f.stored_name,
        ),
      ).catch(() => {});
  }
  await d.close();
});
test("bundle ZIP keeps original bytes, safe names and valid UTF-8 CRC metadata", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(bundleName("../../Passport: name?"), "-..-Passport- name-");
  const zip = bundleZip([
    { name: "01 - Résumé.pdf", bytes: Buffer.from("Original") },
    { name: "manifest.json", bytes: Buffer.from("{}") },
  ]);
  const report = execFileSync(
    "python3",
    [
      "-c",
      "import sys,zipfile,io,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))",
    ],
    { input: zip, encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(report), {
    "01 - Résumé.pdf": "Original",
    "manifest.json": "{}",
  });
  assert.throws(() =>
    bundleZip([{ name: "../escape.pdf", bytes: Buffer.from("x") }]),
  );
});
test("reviewed bundle preserves selected current originals and rejects altered previews, versions and source bytes", async () => {
  const c = await ctx("ayesha"),
    bytes = await pdf(),
    id = await upload(c, bytes),
    input = body(id);
  const r = await c.post(endpoint, { data: input });
  assert.equal(r.status(), 200, await r.text());
  const preview = await r.json();
  assert.equal(preview.manifest[0].id, id);
  assert.equal(preview.manifest[0].sha256, hash(bytes));
  assert.equal(preview.totalBytes, bytes.length);
  assert.ok(!preview.manifest[0].name.includes("/"));
  assert.equal(
    (
      await c.post(endpoint, { data: { ...input, action: "download" } })
    ).status(),
    409,
  );
  assert.equal(
    (
      await c.post(endpoint, {
        data: {
          ...input,
          action: "download",
          nameMode: "original",
          fingerprint: preview.fingerprint,
        },
      })
    ).status(),
    409,
  );
  const download = await c.post(endpoint, {
    data: { ...input, action: "download", fingerprint: preview.fingerprint },
  });
  assert.equal(download.status(), 200, await download.text());
  assert.equal(download.headers()["content-type"], "application/zip");
  assert.equal(download.headers()["cache-control"], "private, no-store");
  const result = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import sys,zipfile,io,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}))",
      ],
      { input: await download.body(), encoding: "utf8" },
    ),
  );
  assert.equal(result[preview.manifest[0].name], hash(bytes));
  assert.ok(result["manifest.json"]);
  const d = database(),
    source = await d
      .prepare(
        "SELECT stored_name FROM document_versions WHERE document_id=? AND version=1",
      )
      .get(id),
    path = resolve(
      process.env.HUMETO_DATA_DIR || ".data",
      "uploads",
      source.stored_name,
    ),
    original = await readFile(path);
  try {
    await writeFile(path, Buffer.from("modified"));
    assert.equal(
      (
        await c.post(endpoint, {
          data: {
            ...input,
            action: "download",
            fingerprint: preview.fingerprint,
          },
        })
      ).status(),
      409,
    );
  } finally {
    await writeFile(path, original);
  }
  await upload(c, await pdf(), "identity", id);
  assert.equal(
    (
      await c.post(endpoint, {
        data: {
          ...input,
          action: "download",
          fingerprint: preview.fingerprint,
        },
      })
    ).status(),
    409,
  );
});
test("bundle access stays private and portable under read-only subscriptions", async () => {
  const owner = await ctx("ayesha"),
    staff = await ctx("consultant"),
    student = await ctx("amira"),
    other = await ctx("bright-owner"),
    platform = await ctx("admin"),
    id = await upload(owner, await pdf(), "usa-health"),
    input = body(id);
  assert.equal((await owner.post(endpoint, { data: input })).status(), 200);
  assert.equal((await student.post(endpoint, { data: input })).status(), 200);
  assert.equal((await staff.post(endpoint, { data: input })).status(), 404);
  assert.equal((await other.post(endpoint, { data: input })).status(), 404);
  assert.equal((await platform.post(endpoint, { data: input })).status(), 403);
  assert.equal(
    (
      await owner.post(endpoint, {
        headers: { Origin: "https://foreign.example" },
        data: input,
      })
    ).status(),
    403,
  );
  const d = database(),
    before = await d
      .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
      .get();
  try {
    await d
      .prepare(
        "UPDATE subscriptions SET status='read_only' WHERE tenant_id='northstar'",
      )
      .run();
    assert.equal((await owner.post(endpoint, { data: input })).status(), 200);
  } finally {
    await d
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id='northstar'")
      .run(before.status);
  }
  assert.equal(
    (
      await owner.post(endpoint, {
        data: { ...input, items: [...input.items, ...input.items] },
      })
    ).status(),
    400,
  );
});
test("document bundle UI previews numbered names before download and fits a narrow screen", async () => {
  const c = await ctx("ayesha"),
    id = await upload(c, await pdf()),
    browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.request.post(base + "/api/auth/demo", {
      headers: { Origin: base },
      data: { userId: "ayesha" },
    });
    await page.goto(base + "/workspace/documents");
    await page
      .getByRole("button", { name: /Prepare a document bundle/ })
      .click();
    await page
      .getByLabel("Bundle applicant", { exact: true })
      .selectOption("amira");
    // Scope by the unique document ID's title stored for this fixture.
    const title = "Bundle UI " + id;
    await database()
      .prepare("UPDATE documents SET title=? WHERE id=?")
      .run(title, id);
    await page.reload();
    await page
      .getByRole("button", { name: /Prepare a document bundle/ })
      .click();
    await page
      .getByLabel("Bundle applicant", { exact: true })
      .selectOption("amira");
    await page.getByLabel("Bundle " + title, { exact: true }).check();
    await page
      .getByRole("button", { name: "Preview bundle", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Download reviewed ZIP", exact: true })
      .waitFor();
    await page
      .getByRole("region", { name: "Document bundle", exact: true })
      .screenshot({ path: "artifacts/document-bundle-review.jpg" });
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download reviewed ZIP", exact: true })
      .click();
    const download = await event;
    assert.equal(download.suggestedFilename(), "humeto-document-bundle.zip");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  } finally {
    await browser.close();
  }
});

test("bundle portal checks enforce content type, per-file size and selection limits", async () => {
  const c = await ctx("ayesha"),
    png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7eQAAAAASUVORK5CYII=",
      "base64",
    ),
    imageId = await upload(c, png);
  assert.equal(
    (
      await c.post(endpoint, { data: body(imageId, { pdfOnly: true }) })
    ).status(),
    400,
  );
  assert.equal(
    (
      await c.post(endpoint, {
        data: body(imageId, {
          items: Array(21).fill({ id: imageId, version: 1 }),
        }),
      })
    ).status(),
    400,
  );
  const largeId = await upload(
    c,
    Buffer.concat([await pdf(), Buffer.alloc(2 * 1024 * 1024)]),
  );
  assert.equal(
    (
      await c.post(endpoint, { data: body(largeId, { maxFileMB: 1 }) })
    ).status(),
    400,
  );
  assert.equal(
    (
      await c.post(endpoint, { data: body(largeId, { maxFileMB: 3 }) })
    ).status(),
    200,
  );
});
