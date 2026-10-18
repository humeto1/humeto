import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
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
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
    200,
  );
  return c;
}
const read = async (c) => (await c.get("/api/announcements")).json(),
  send = (c, v) => c.post("/api/announcements", { data: v });
async function draft(c, extra = {}) {
  const r = await send(c, {
    action: "draft",
    title: "Your next application step",
    body: "Please upload the remaining documents before your review.",
    audience: "students",
    popup: true,
    image: "/assets/campus.webp",
    ctaLabel: "View documents",
    ctaPath: "/workspace/documents",
    startsAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    ...extra,
  });
  assert.equal(r.status(), 200, await r.text());
  const id = (await r.json()).id;
  ids.push(id);
  return id;
}
after(async () => {
  for (const c of contexts) await c.dispose();
  for (const id of ids)
    await d.prepare("DELETE FROM company_announcements WHERE id=?").run(id);
  await d.close();
});
test("admin publishes targeted company notifications; drafts stay private and reads/dismissals persist", async () => {
  const owner = await ctx("ayesha"),
    student = await ctx("amira"),
    staff = await ctx("consultant"),
    other = await ctx("bright-owner");
  const id = await draft(owner);
  assert.ok(!(await read(student)).inbox.some((n) => n.id === id));
  assert.equal(
    (await send(owner, { action: "publish", id, revision: 1 })).status(),
    200,
  );
  assert.ok((await read(student)).inbox.some((n) => n.id === id));
  assert.ok(!(await read(staff)).inbox.some((n) => n.id === id));
  assert.ok(!(await read(other)).inbox.some((n) => n.id === id));
  assert.equal(
    (await send(other, { action: "retract", id, revision: 2 })).status(),
    404,
  );
  assert.equal(
    (await send(staff, { action: "publish", id, revision: 2 })).status(),
    403,
  );
  assert.equal((await send(other, { action: "read", id })).status(), 404);
  assert.equal((await send(student, { action: "dismiss", id })).status(), 200);
  assert.equal((await send(student, { action: "dismiss", id })).status(), 200);
  const n = (await read(student)).inbox.find((n) => n.id === id);
  assert.ok(n.read_at);
  assert.ok(n.popup_dismissed_at);
  const campaign = (await read(owner)).campaigns.find((n) => n.id === id);
  assert.equal(Number(campaign.read_count), 1);
  assert.equal(Number(campaign.dismissed_count), 1);
  assert.equal(
    (await send(owner, { action: "publish", id, revision: 1 })).status(),
    409,
  );
  assert.equal(
    (await send(owner, { action: "retract", id, revision: 2 })).status(),
    200,
  );
  assert.ok(!(await read(student)).inbox.some((n) => n.id === id));
});
test("staff and individual targeting stay scoped, scheduled/expired campaigns stay hidden and hostile links rejected", async () => {
  const owner = await ctx("ayesha"),
    staff = await ctx("consultant"),
    student = await ctx("amira");
  let id = await draft(owner, { audience: "staff", popup: false });
  await send(owner, { action: "publish", id, revision: 1 });
  assert.ok((await read(staff)).inbox.some((n) => n.id === id));
  assert.ok(!(await read(student)).inbox.some((n) => n.id === id));
  await send(owner, { action: "retract", id, revision: 2 });
  id = await draft(owner, {
    audience: "selected",
    userIds: ["amira"],
    startsAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await send(owner, { action: "publish", id, revision: 1 });
  assert.ok(!(await read(student)).inbox.some((n) => n.id === id));
  await d
    .prepare(
      "UPDATE company_announcements SET starts_at=clock_timestamp()-interval '1 hour' WHERE id=?",
    )
    .run(id);
  assert.ok((await read(student)).inbox.some((n) => n.id === id));
  await d
    .prepare(
      "UPDATE company_announcements SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=?",
    )
    .run(id);
  assert.ok(!(await read(student)).inbox.some((n) => n.id === id));
  const input = {
    action: "draft",
    title: "Bad target",
    body: "test",
    audience: "selected",
    userIds: ["bright-owner"],
    popup: false,
    startsAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  assert.equal((await send(owner, input)).status(), 400);
  assert.equal(
    (
      await send(owner, {
        ...input,
        audience: "all",
        userIds: [],
        ctaLabel: "Open",
        ctaPath: "//outside.example",
      })
    ).status(),
    400,
  );
  const platform = await ctx("admin");
  assert.equal((await platform.get("/api/announcements")).status(), 403);
});
test("notification UI previews without sending and recipient popup closes once with inbox history", async () => {
  const browser = await chromium.launch(),
    owner = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      viewport: { width: 1440, height: 1000 },
    }),
    student = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      viewport: { width: 390, height: 844 },
    });
  try {
    await owner.request.post("/api/auth/demo", { data: { userId: "ayesha" } });
    await student.request.post("/api/auth/demo", { data: { userId: "amira" } });
    const page = await owner.newPage();
    await page.goto(base + "/workspace/notifications");
    await page
      .getByLabel("Announcement title", { exact: true })
      .fill("Welcome to your next chapter");
    await page
      .getByLabel("Announcement message", { exact: true })
      .fill(
        "Your document review is ready. Let’s take the next step together.",
      );
    await page
      .getByRole("button", { name: "Preview", exact: true })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("button", { name: "Close preview", exact: true })
      .click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page
      .getByText("Draft saved. Review it below before publishing.", {
        exact: true,
      })
      .waitFor();
    let n = (await read(owner.request)).campaigns.find(
      (n) => n.title === "Welcome to your next chapter",
    );
    ids.push(n.id);
    assert.equal(n.status, "draft");
    await page
      .locator("article")
      .filter({ has: page.getByText(n.title, { exact: true }) })
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await page
      .getByText("Published to the selected company audience.", { exact: true })
      .waitFor();
    const recipient = await student.newPage();
    await recipient.goto(base + "/workspace");
    await recipient.getByRole("dialog").waitFor();
    await recipient
      .getByRole("heading", { name: n.title, exact: true })
      .waitFor();
    assert.ok(
      await recipient.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await recipient
      .getByRole("button", { name: "Close company announcement", exact: true })
      .click();
    await recipient.getByRole("dialog").waitFor({ state: "hidden" });
    await recipient.waitForFunction(
      () => document.querySelector("dialog")?.open === false,
    );
    let inbox = await read(student.request);
    for (
      let i = 0;
      i < 20 && !inbox.inbox.find((x) => x.id === n.id)?.popup_dismissed_at;
      i++
    ) {
      await new Promise((r) => setTimeout(r, 100));
      inbox = await read(student.request);
    }
    assert.ok(inbox.inbox.find((x) => x.id === n.id)?.popup_dismissed_at);
    await recipient.reload();
    await recipient
      .getByRole("link", { name: /Company notifications/ })
      .waitFor();
    assert.equal(await recipient.getByRole("dialog").isVisible(), false);
    await recipient.goto(base + "/workspace/notifications");
    await recipient
      .getByRole("heading", { name: n.title, exact: true })
      .waitFor();
    const linked = await draft(owner.request, {
      title: "A new document request",
    });
    await send(owner.request, { action: "publish", id: linked, revision: 1 });
    await recipient.goto(base + "/workspace");
    await recipient.getByRole("dialog").waitFor();
    await recipient
      .getByRole("link", { name: "View documents", exact: true })
      .click();
    await recipient.waitForURL("**/workspace/documents");
    let acknowledged = false;
    for (let i = 0; i < 30; i++) {
      const state = await read(student.request);
      if (state.inbox.find((x) => x.id === linked)?.popup_dismissed_at) {
        acknowledged = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(
      acknowledged,
      "following the action link persists popup acknowledgment",
    );
  } finally {
    await owner.close();
    await student.close();
    await browser.close();
  }
});

test("announcement auth, origin and inactive subscription checks protect publication", async () => {
  const c = await ctx("ayesha"),
    anonymous = await request.newContext({ baseURL: base });
  try {
    assert.equal((await anonymous.get("/api/announcements")).status(), 401);
    assert.equal(
      (
        await c.post("/api/announcements", {
          headers: { Origin: "https://outside.example" },
          data: { action: "draft" },
        })
      ).status(),
      403,
    );
    const id = await draft(c),
      prior = await d
        .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
        .get();
    try {
      await d
        .prepare(
          "UPDATE subscriptions SET status='paused' WHERE tenant_id='northstar'",
        )
        .run();
      assert.equal(
        (await send(c, { action: "publish", id, revision: 1 })).status(),
        403,
      );
      assert.equal((await c.get("/api/announcements")).status(), 200);
    } finally {
      await d
        .prepare(
          "UPDATE subscriptions SET status=? WHERE tenant_id='northstar'",
        )
        .run(prior.status);
    }
  } finally {
    await anonymous.dispose();
  }
});
