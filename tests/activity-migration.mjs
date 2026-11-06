import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createTestDatabase } from "../scripts/lib/test-database.mjs";
import { database } from "../src/lib/postgres.mjs";
test("unifying CSFs preserves archived activity identity, measurements and historical targets", async () => {
  const fixture = await createTestDatabase({ migrateSchema: false }),
    d = database(fixture.url);
  try {
    await d.transaction(async () => {
      for (const file of readdirSync("migrations")
        .filter((f) => /^\d+.*\.sql$/.test(f) && f < "040")
        .sort())
        await d.exec(readFileSync("migrations/" + file, "utf8"));
    });
    await d
      .prepare(
        "INSERT INTO tenants(id,name,type) VALUES('legacy-tenant','Legacy','individual')",
      )
      .run();
    await d
      .prepare(
        "INSERT INTO users(id,name,email,password_hash) VALUES('legacy-user','Legacy','legacy@example.test','test-only')",
      )
      .run();
    await d
      .prepare(
        "INSERT INTO projects(id,tenant_id,title,created_by) VALUES('legacy-project','legacy-tenant','Launch','legacy-user')",
      )
      .run();
    await d
      .prepare(
        "INSERT INTO plan_success_factors(id,tenant_id,entity_type,entity_id,title,status,description) VALUES('legacy-ad','legacy-tenant','project','legacy-project','Run ad','archived','Still important')",
      )
      .run();
    await d
      .prepare(
        "INSERT INTO plan_kpis(id,factor_id,title,unit,target,cadence,direction,timezone) VALUES('legacy-leads','legacy-ad','Leads','leads',3,'daily','at_least','UTC')",
      )
      .run();
    await d
      .prepare(
        "INSERT INTO plan_kpi_results(kpi_id,period_start,period_end,actual,target_snapshot,unit_snapshot,cadence_snapshot,direction_snapshot,recorded_by) VALUES('legacy-leads','2026-11-01','2026-11-01',3,3,'leads','daily','at_least','legacy-user')",
      )
      .run();
    await d.transaction(() =>
      d.exec(readFileSync("migrations/040-unified-activities.sql", "utf8")),
    );
    const activity = await d
      .prepare("SELECT * FROM tasks WHERE id='legacy-ad'")
      .get();
    assert.equal(activity.is_csf, true);
    assert.equal(activity.is_kpi, true);
    assert.equal(activity.storage_state, "archive");
    assert.equal(activity.activity_note, "Still important");
    assert.equal(
      (
        await d
          .prepare(
            "SELECT activity_id FROM activity_kpis WHERE id='legacy-leads'",
          )
          .get()
      ).activity_id,
      "legacy-ad",
    );
    assert.equal(
      Number(
        (
          await d
            .prepare(
              "SELECT actual FROM plan_kpi_results WHERE kpi_id='legacy-leads'",
            )
            .get()
        ).actual,
      ),
      3,
    );
    assert.equal(
      (
        await d
          .prepare("SELECT id FROM project_wbs_nodes WHERE id='legacy-ad'")
          .get()
      ).id,
      "legacy-ad",
    );
  } finally {
    await d.close();
    await fixture.cleanup();
  }
});
