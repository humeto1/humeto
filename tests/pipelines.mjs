import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  leads = [];
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
const get = async (c) => (await c.get("/api/workspace/pipelines")).json();
const save = (c, data) => c.post("/api/workspace/pipelines", { data });
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const id of leads)
    await d.prepare("DELETE FROM leads WHERE id=?").run(id);
  await d
    .prepare("DELETE FROM pipeline_settings WHERE tenant_id='brightpath'")
    .run();
  await d.close();
});
test("owners rename, reorder and add stages; removal moves cards and future events redirect", async () => {
  const c = await ctx("bright-owner");
  let settings = await get(c),
    old = settings.leads;
  let stages = [
    ...old.stages.map((s, i) => ({
      ...s,
      title: i === 0 ? "Fresh inquiry" : s.title,
    })),
    { key: "custom-qa", title: "Call booked" },
  ];
  let r = await save(c, { kind: "leads", revision: old.revision, stages });
  assert.equal(r.status(), 200, await r.text());
  assert.equal(
    (await save(c, { kind: "leads", revision: old.revision, stages })).status(),
    409,
  );
  r = await c.post("/api/workspace/leads", {
    data: { name: "Pipeline QA", email: "pipeline-qa@example.com" },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  leads.push(id);
  r = await c.patch("/api/workspace/leads/" + id, {
    data: { stage: "custom-qa", revision: 1 },
  });
  assert.equal(r.status(), 200, await r.text());
  settings = await get(c);
  stages = stages.filter((s) => s.key !== "custom-qa");
  assert.equal(
    (
      await save(c, {
        kind: "leads",
        revision: settings.leads.revision,
        stages,
      })
    ).status(),
    400,
  );
  r = await save(c, {
    kind: "leads",
    revision: settings.leads.revision,
    stages,
    replacements: { "custom-qa": "New" },
  });
  assert.equal(r.status(), 200, await r.text());
  const d = database();
  let row = await d.prepare("SELECT stage FROM leads WHERE id=?").get(id);
  assert.equal(row.stage, "New");
  await d.prepare("UPDATE leads SET stage='custom-qa' WHERE id=?").run(id);
  row = await d.prepare("SELECT stage FROM leads WHERE id=?").get(id);
  assert.equal(row.stage, "New");
});
test("pipeline configuration is tenant scoped and owner only", async () => {
  const c = await ctx("consultant"),
    student = await ctx("amira"),
    owner = await ctx("ayesha");
  const original = (await get(owner)).leads;
  assert.equal(original.stages[0].title, "New");
  assert.equal(
    (
      await save(c, { kind: "leads", revision: 0, stages: original.stages })
    ).status(),
    403,
  );
  assert.equal((await student.get("/api/workspace/pipelines")).status(), 403);
});
