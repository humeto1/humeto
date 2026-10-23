import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.HUMETO_TEST_URL;
test("compiled security boundaries and bounded local response benchmark", async () => {
  assert.equal(
    process.env.HUMETO_ISOLATED_QA,
    "true",
    "Only run against disposable QA",
  );
  const client = await request.newContext({ baseURL: base });
  const results = [];
  try {
    for (const path of ["/", "/login", "/signup"]) {
      const samples = [];
      for (let i = 0; i < 6; i++) {
        const start = performance.now();
        const response = await client.get(path);
        samples.push(Math.round(performance.now() - start));
        assert.equal(response.status(), 200);
        assert.equal(response.headers()["x-content-type-options"], "nosniff");
        assert.equal(response.headers()["x-frame-options"], "DENY");
        assert.ok(!(await response.text()).includes("CHATGPT_HUMETO_API="));
      }
      const sorted = samples.slice(1).sort((a, b) => a - b);
      results.push({
        path,
        coldMs: samples[0],
        warmMedianMs: sorted[2],
        warmMaxMs: sorted.at(-1),
      });
    }
    for (const path of [
      "/api/task-activities?taskId=audit",
      "/api/project-sharing?projectId=audit",
    ]) {
      const response = await client.get(path);
      assert.ok(
        [401, 403].includes(response.status()),
        path + " must reject unauthenticated requests",
      );
      assert.ok(response.headers()["cache-control"].includes("no-store"));
    }
  } finally {
    mkdirSync(".data/product-audit", { recursive: true });
    writeFileSync(
      ".data/product-audit/response-times.json",
      JSON.stringify(
        {
          scope:
            "disposable local compiled server; not production load or mobile network performance",
          results,
        },
        null,
        2,
      ),
    );
    console.log("Local response benchmark:", JSON.stringify(results));
    await client.dispose();
  }
});
