import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
import { tokenHash } from "../src/lib/email-delivery.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  d = database(),
  contexts = [],
  ids = [];
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  if (user)
    assert.equal(
      (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
      200,
    );
  return c;
}
async function create(c) {
  const id = randomUUID();
  ids.push(id);
  await d
    .prepare(
      "INSERT INTO projects(id,tenant_id,title,status,created_by) VALUES(?,?,?,?,?)",
    )
    .run(id, "northstar", "Client collaboration QA", "To do", "Ayesha Khan");
  return "/api/project-sharing?projectId=" + id;
}
async function post(c, path, data, status = 200) {
  const r = await c.post(path, { data });
  assert.equal(r.status(), status, await r.text());
  return r.json();
}
async function challenge(c, path) {
  const s = await (await c.get(path)).json();
  await d
    .prepare("UPDATE project_share_challenges SET issued_at=? WHERE id=?")
    .run(Date.now() - 2500, s.challenge);
  return s.challenge;
}
after(async () => {
  for (const id of ids) {
    const shares = await d
      .prepare("SELECT id FROM project_shares WHERE project_id=?")
      .all(id);
    for (const s of shares) {
      for (const table of [
        "project_share_codes",
        "project_guest_sessions",
        "project_share_challenges",
      ])
        await d.prepare(`DELETE FROM ${table} WHERE share_id=?`).run(s.id);
    }
    for (const table of [
      "project_shares",
      "project_links",
      "project_comments",
      "project_attachments",
    ])
      await d.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id);
    await d.prepare("DELETE FROM projects WHERE id=?").run(id);
  }
  for (const c of contexts) await c.dispose();
  await d.close();
});
test("task sharing scopes client data, accepts limited contributions, quarantines files and revokes access", async () => {
  const c = await ctx("ayesha"),
    guest = await ctx(),
    other = await ctx("bright-owner"),
    path = await create(c);
  await post(c, path, {
    operation: "link",
    label: "Drive",
    url: "https://drive.google.com/example",
  });
  await post(
    c,
    path,
    { operation: "link", label: "Bad", url: "javascript:alert(1)" },
    400,
  );
  const { url } = await post(c, path, {
    operation: "share",
    permission: "contribute",
    days: 1,
  });
  const token = url.split("/").at(-1),
    publicPath = "/api/project-sharing?token=" + token;
  let s = await (await guest.get(publicPath)).json();
  assert.equal(s.project.title, "Client collaboration QA");
  assert.equal(s.links.length, 1);
  assert.ok(!s.shares && !s.project.assignee && !s.project.tenant_id);
  await post(guest, publicPath, {
    operation: "comment",
    content: "Here are my details",
    author: "Client",
    challenge: await challenge(guest, publicPath),
  });
  const pdf = Buffer.from("%PDF-1.7\nfictional test document\n%%EOF").toString(
    "base64",
  );
  await post(guest, publicPath, {
    operation: "upload",
    name: "client.pdf",
    bytes: pdf,
    author: "Client",
    challenge: await challenge(guest, publicPath),
  });
  s = await (await guest.get(publicPath)).json();
  assert.equal(s.comments.length, 1);
  assert.equal(s.attachments[0].status, "quarantined");
  assert.equal(
    (
      await guest.get(publicPath + "&attachment=" + s.attachments[0].id)
    ).status(),
    403,
  );
  await post(
    guest,
    publicPath,
    {
      operation: "upload",
      name: "virus.exe",
      bytes: pdf,
      author: "Client",
      challenge: await challenge(guest, publicPath),
    },
    400,
  );
  await post(
    guest,
    publicPath,
    {
      operation: "upload",
      name: "fake.pdf",
      bytes: Buffer.from("this is not a real pdf file").toString("base64"),
      author: "Client",
      challenge: await challenge(guest, publicPath),
    },
    400,
  );
  await post(
    guest,
    publicPath,
    {
      operation: "comment",
      content: "No challenge",
      author: "Bot",
      challenge: randomUUID(),
    },
    429,
  );
  assert.equal((await other.get(path)).status(), 404);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(url);
    await page
      .getByRole("heading", { name: "Client collaboration QA", exact: true })
      .waitFor();
    await page.getByText("Here are my details", { exact: true }).waitFor();
    const teammate = await ctx("consultant");
    assert.equal((await teammate.get(path)).status(), 403);
    await d
      .prepare(
        "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) VALUES(?,'project',?,?,?)",
      )
      .run("northstar", path.split("projectId=")[1], "consultant", "ayesha");
    await post(teammate, path, {
      operation: "comment",
      content: "Team reply from another account",
    });
    await page
      .getByText("Team reply from another account", { exact: true })
      .waitFor({ timeout: 16000 });
    const ownerView = await (await c.get(path)).json();
    assert.ok(
      ownerView.comments.some(
        (m) => m.content === "Team reply from another account",
      ),
    );

    assert.ok(
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .isVisible(),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  } finally {
    await browser.close();
  }
  const owner = await (await c.get(path)).json();
  await post(c, path, { operation: "revoke", id: owner.shares[0].id });
  assert.equal((await guest.get(publicPath)).status(), 404);
});
test("restricted task links require email proof; view links cannot post; access codes stop after five guesses", async () => {
  const c = await ctx("ayesha"),
    guest = await ctx(),
    path = await create(c);
  const { url } = await post(c, path, {
    operation: "share",
    permission: "contribute",
    email: "client@example.com",
    days: 1,
  });
  const token = url.split("/").at(-1),
    p = "/api/project-sharing?token=" + token;
  assert.equal((await (await guest.get(p)).json()).locked, true);
  await post(
    guest,
    p,
    { operation: "request-code", email: "wrong@example.com" },
    403,
  );
  const share = await d
    .prepare("SELECT id FROM project_shares WHERE token_hash=?")
    .get(tokenHash(token));
  await d
    .prepare(
      "INSERT INTO project_share_codes(id,share_id,code_hash,expires_at) VALUES(?,?,?,?)",
    )
    .run(share.id, share.id, tokenHash("12345678"), Date.now() + 600000);
  for (let i = 0; i < 5; i++)
    await post(guest, p, { operation: "verify-code", code: "00000000" }, 403);
  await post(guest, p, { operation: "verify-code", code: "12345678" }, 403);
  await d
    .prepare("UPDATE project_share_codes SET attempts=0 WHERE id=?")
    .run(share.id);
  await post(guest, p, { operation: "verify-code", code: "12345678" });
  assert.ok((await (await guest.get(p)).json()).project);
  const view = await post(c, path, {
    operation: "share",
    permission: "view",
    days: 1,
  });
  await post(
    guest,
    "/api/project-sharing?token=" + view.url.split("/").at(-1),
    { operation: "comment", content: "No", author: "Client" },
    403,
  );
});
