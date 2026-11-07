import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createTestDatabase } from "../scripts/lib/test-database.mjs";
import { database } from "../src/lib/postgres.mjs";
test("KPI upgrade preserves saved snapshots and versions future target changes", async () => {
  const fixture = await createTestDatabase({ migrateSchema: false }),
    d = database(fixture.url);
  try {
    await d.transaction(async () => {
      for (const file of readdirSync("migrations")
        .filter((f) => /^\d+.*\.sql$/.test(f) && f < "041")
        .sort())
        await d.exec(readFileSync("migrations/" + file, "utf8"));
    });
    await d.exec(
      "INSERT INTO tenants(id,name,type) VALUES('legacy-kpi','Legacy','individual'); INSERT INTO users(id,name,email,password_hash) VALUES('legacy-kpi-user','Legacy','legacy-kpi@example.test','test-only'); INSERT INTO tasks(id,tenant_id,title,is_csf,is_kpi) VALUES('legacy-task','legacy-kpi','Run ad',TRUE,TRUE); INSERT INTO activity_kpis(id,activity_id,title,target,unit,cadence,timezone) VALUES('legacy-kpi-metric','legacy-task','Leads',3,'leads','daily','Asia/Karachi'); INSERT INTO plan_kpi_results(kpi_id,period_start,period_end,actual,target_snapshot,unit_snapshot,cadence_snapshot,direction_snapshot,recorded_by) VALUES('legacy-kpi-metric','2026-01-01','2026-01-01',3,3,'leads','daily','at_least','legacy-kpi-user');",
    );
    await d.transaction(() =>
      d.exec(readFileSync("migrations/041-kpi-setup-and-history.sql", "utf8")),
    );
    await d.transaction(() =>
      d.exec(
        readFileSync("migrations/042-kpi-unlogged-target-history.sql", "utf8"),
      ),
    );
    await d.exec(
      "INSERT INTO activity_kpis(id,activity_id,title,target,unit,cadence,timezone) VALUES('unlogged-kpi','legacy-task','Unlogged',3,'leads','daily','Asia/Karachi'); UPDATE activity_kpis SET target=5 WHERE id='unlogged-kpi';",
    );
    const unlogged = await d
      .prepare(
        "SELECT target FROM activity_kpi_targets WHERE kpi_id='unlogged-kpi' AND effective_from='0001-01-01'",
      )
      .get();
    assert.equal(
      Number(unlogged.target),
      3,
      "Target history is retained before any result has been logged",
    );
    await d
      .prepare("UPDATE activity_kpis SET target=0 WHERE id='legacy-kpi-metric'")
      .run();
    const history = await d
      .prepare(
        "SELECT target_snapshot,actual FROM plan_kpi_results WHERE kpi_id='legacy-kpi-metric'",
      )
      .get();
    assert.equal(Number(history.target_snapshot), 3);
    assert.equal(Number(history.actual), 3);
    const baseline = await d
      .prepare(
        "SELECT target FROM activity_kpi_targets WHERE kpi_id='legacy-kpi-metric' AND effective_from='0001-01-01'",
      )
      .get();
    assert.equal(Number(baseline.target), 3);
    assert.equal(
      (
        await d
          .prepare(
            "SELECT count(*)::int AS n FROM activity_kpi_targets WHERE kpi_id='legacy-kpi-metric'",
          )
          .get()
      ).n,
      2,
    );
    assert.equal(
      (await d.prepare("SELECT is_csf FROM tasks WHERE id='legacy-task'").get())
        .is_csf,
      true,
    );
  } finally {
    await d.close();
    await fixture.cleanup();
  }
});
