import AxeBuilder from "@axe-core/playwright";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = process.env.HUMETO_TEST_URL,
  d = database(),
  contexts = [],
  project = randomUUID();
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  if (user) await c.post("/api/auth/demo", { data: { userId: user } });
  return c;
}
async function post(c, path, data, status = 200) {
  const r = await c.post(path, { data });
  assert.equal(r.status(), status, await r.text());
  return r.json();
}
after(async () => {
  await d.query("DELETE FROM projects WHERE id=$1", [project]);
  await d.query("DELETE FROM work_assignments WHERE entity_id=$1", [project]);
  for (const c of contexts) await c.dispose();
  await d.close();
});
function wav(seconds) {
  const b = Buffer.alloc(44 + seconds * 32000);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
test("global break chat hides account/workspace identity, rejects media and abuse, reports and blocks across workspaces", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    guest = await ctx();
  assert.equal((await guest.get("/api/break-chat")).status(), 401);
  await post(c, "/api/break-chat", { action: "join", agree: true });
  await post(other, "/api/break-chat", { action: "join", agree: true });
  const members = await d.query(
    "SELECT id,user_id,alias FROM break_members WHERE user_id IN ('ayesha','bright-owner')",
  );
  assert.equal(members.rows.length, 2);
  const sender = members.rows.find((m) => m.user_id === "ayesha"),
    recipient = members.rows.find((m) => m.user_id === "bright-owner");
  assert.match(
    sender.alias,
    /Otter|Panda|Dolphin|Koala|Penguin|Owl|Butterfly|Turtle|Deer|Rabbit|Squirrel|Lynx/,
  );
  const mid = randomUUID();
  await d.query(
    "INSERT INTO break_messages(id,member_id,client_id,content) VALUES($1,$2,$3,$4)",
    [mid, sender.id, randomUUID(), "A friendly fictional test greeting"],
  );
  const feed = await (await other.get("/api/break-chat")).json();
  const message = feed.messages.find((m) => m.id === mid);
  assert.ok(message, "room is shared across workspace boundaries");
  assert.equal(message.alias, sender.alias);
  for (const key of ["user_id", "email", "tenant_id", "name"])
    assert.equal(message[key], undefined);
  await post(
    c,
    "/api/break-chat",
    { action: "send", text: "hello", clientId: randomUUID(), bytes: "fake" },
    400,
  );
  await post(
    c,
    "/api/break-chat",
    { action: "send", text: "f.u.c.k off", clientId: randomUUID() },
    422,
  );
  await post(
    c,
    "/api/break-chat",
    {
      action: "send",
      text: "visit https://spam.example.com",
      clientId: randomUUID(),
    },
    422,
  );
  await post(
    c,
    "/api/break-chat",
    { action: "send", text: "madarchod", clientId: randomUUID() },
    422,
  );
  assert.ok(
    (await (await c.get("/api/break-chat")).json()).bannedUntil > Date.now(),
  );
  await post(
    c,
    "/api/break-chat",
    { action: "send", text: "a benign message", clientId: randomUUID() },
    403,
  );
  await post(
    other,
    "/api/break-chat",
    { action: "moderate", messageId: mid, decision: "ban" },
    403,
  );
  await post(other, "/api/break-chat", {
    action: "report",
    messageId: mid,
    reason: "abuse",
  });
  assert.ok(
    !(await (await other.get("/api/break-chat")).json()).messages.some(
      (m) => m.id === mid,
    ),
  );
  await post(other, "/api/break-chat", {
    action: "block",
    memberId: sender.id,
  });
  const another = randomUUID();
  await d.query(
    "INSERT INTO break_messages(id,member_id,client_id,content) VALUES($1,$2,$3,$4)",
    [another, sender.id, randomUUID(), "Another test greeting"],
  );
  assert.ok(
    !(await (await other.get("/api/break-chat")).json()).messages.some(
      (m) => m.id === another,
    ),
  );
  const admin = await ctx("admin");
  await post(admin, "/api/break-chat", { action: "join", agree: true });
  const review = await (await admin.get("/api/break-chat")).json();
  assert.ok(review.review.some((r) => r.id === mid));
  await post(admin, "/api/break-chat", {
    action: "moderate",
    messageId: mid,
    decision: "ban",
  });
  assert.equal(
    (await d.query("SELECT hidden FROM break_messages WHERE id=$1", [mid]))
      .rows[0].hidden,
    true,
  );
  const expired = randomUUID();
  await d.query(
    "INSERT INTO break_messages(id,member_id,client_id,content,created_at) VALUES($1,$2,$3,'Expired evidence',now()-interval '31 days')",
    [expired, sender.id, randomUUID()],
  );
  await d.query("SELECT humeto_purge_break_chat()");
  assert.equal(
    (await d.query("SELECT id FROM break_messages WHERE id=$1", [expired])).rows
      .length,
    0,
  );
});
test("project chat enforces assigned members and validates one-minute voice notes and image previews", async () => {
  const owner = await ctx("ayesha"),
    team = await ctx("consultant"),
    foreign = await ctx("bright-owner");
  await d.query(
    "INSERT INTO projects(id,tenant_id,title,status,created_by) VALUES($1,'northstar','Social chat QA','To do','Ayesha Khan')",
    [project],
  );
  const path = "/api/project-sharing?projectId=" + project;
  assert.equal((await team.get(path)).status(), 403);
  assert.equal((await foreign.get(path)).status(), 404);
  await d.query(
    "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) VALUES('northstar','project',$1,'consultant','ayesha')",
    [project],
  );
  assert.equal((await team.get(path)).status(), 200);
  const listing = await (await team.get("/api/project-chat")).json();
  assert.ok(listing.projects.some((p) => p.id === project));
  await post(team, path, {
    operation: "upload",
    name: "Voice note.wav",
    bytes: wav(60).toString("base64"),
  });
  let state = await (await owner.get(path)).json();
  const audio = state.attachments.find((f) => f.mime === "audio/wav");
  assert.equal(audio.status, "clean");
  const preview = await (
    await team.get(path + "&attachment=" + audio.id + "&media=1")
  ).json();
  assert.equal(Buffer.from(preview.bytes, "base64").length, 1920044);
  await post(
    team,
    path,
    {
      operation: "upload",
      name: "too-long.wav",
      bytes: wav(61).toString("base64"),
    },
    400,
  );
  const fake = wav(1);
  fake.writeUInt32LE(1, 40);
  await post(
    team,
    path,
    { operation: "upload", name: "fake.wav", bytes: fake.toString("base64") },
    400,
  );
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  await post(team, path, {
    operation: "upload",
    name: "image.png",
    bytes: png.toString("base64"),
  });
  state = await (await owner.get(path)).json();
  assert.equal(
    state.attachments.find((f) => f.mime === "image/png").status,
    "clean",
  );
  await post(
    team,
    path,
    { operation: "share", days: 7, permission: "contribute" },
    403,
  );
  await d.query(
    "DELETE FROM work_assignments WHERE entity_id=$1 AND user_id='consultant'",
    [project],
  );
  assert.equal(
    (await team.get(path + "&attachment=" + audio.id + "&media=1")).status(),
    403,
  );
  // A long conversation remains usable rather than stopping at 100 replies.
  for (let n = 0; n < 102; n++)
    await post(owner, path, { operation: "comment", content: "Message " + n });
  state = await (await owner.get(path)).json();
  assert.equal(state.comments.length, 100);
  assert.ok(state.nextCursor);
  const older = await (
    await owner.get(path + "&before=" + state.nextCursor)
  ).json();
  assert.equal(older.comments.length, 2);
});
test("Chat exposes separate AI, project and opt-in text-only break sections on web", async () => {
  const c = await ctx("consultant"),
    browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies((await c.storageState()).cookies);
    const p = await context.newPage();
    await p.goto(base + "/workspace/assistant");
    await p.getByRole("button", { name: "Project chats", exact: true }).click();
    await p.getByLabel("Project chat", { exact: true }).waitFor();
    await p.getByRole("button", { name: "Break chat", exact: true }).click();
    await p.getByText("Keep this a kind place", { exact: true }).waitFor();
    assert.equal(
      await p
        .locator('[aria-label="Anonymous break chat"] input[type=file]')
        .count(),
      0,
    );
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: /Join as/ }).click();
    await p.getByLabel("Break chat message").waitFor();
    const audit = await new AxeBuilder({ page: p })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      audit.violations.map((v) => v.id),
      [],
    );
    assert.equal(
      await p.getByRole("button", { name: "Record voice note" }).count(),
      0,
    );
  } finally {
    await browser.close();
  }
});
test("project voice recording requests microphone access and automatically sends at the one-minute timer", async () => {
  const c = await ctx("ayesha"),
    browser = await chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
  try {
    const context = await browser.newContext({
      baseURL: base,
      permissions: ["microphone"],
    });
    await context.addCookies((await c.storageState()).cookies);
    const p = await context.newPage();
    await p.clock.install();
    await p.goto(base + "/workspace/assistant");
    await p.getByRole("button", { name: "Project chats", exact: true }).click();
    await p.getByLabel("Project chat", { exact: true }).selectOption(project);
    await p
      .getByRole("button", { name: "Record voice note", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Send voice note", exact: true })
      .waitFor();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const sent = p.waitForResponse(
      (r) =>
        r.url().includes("/api/project-sharing") &&
        r.request().method() === "POST",
    );
    await p.clock.fastForward(61000);
    const response = await sent;
    assert.equal(response.status(), 200, await response.text());
    await p
      .getByRole("button", { name: "Record voice note", exact: true })
      .waitFor();
    const state = await (
      await c.get("/api/project-sharing?projectId=" + project)
    ).json();
    assert.ok(
      state.attachments.filter((f) => f.mime === "audio/wav").length >= 2,
    );
  } finally {
    await browser.close();
  }
});
