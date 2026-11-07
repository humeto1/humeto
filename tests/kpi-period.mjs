import { test } from "node:test";
import assert from "node:assert/strict";
import { kpiPeriod, kpiAchievement } from "../shared/kpi-period.ts";
test("KPI periods use calendar boundaries, including leap years and weeks crossing a year", () => {
  assert.deepEqual(kpiPeriod("weekly", "2027-01-01"), {
    start: "2026-12-28",
    end: "2027-01-03",
    label: "2026-12-28 – 2027-01-03",
  });
  assert.equal(kpiPeriod("monthly", "2028-02-05").end, "2028-02-29");
  assert.equal(kpiPeriod("yearly", "2026-11-07").start, "2026-01-01");
  assert.equal(kpiPeriod("once", "2026-11-07").label, "Overall");
  assert.throws(() => kpiPeriod("daily", "2026-02-30"));
  assert.equal(kpiAchievement(null, 3, "at_least"), null);
  assert.equal(kpiAchievement(3, 3, "at_least"), true);
  assert.equal(kpiAchievement(0, 3, "at_most"), true);
  assert.equal(kpiAchievement(4, 3, "at_most"), false);
});

test("quarter and half-year targets follow calendar boundaries", () => {
  assert.deepEqual(kpiPeriod("quarterly", "2028-02-15"), {
    start: "2028-01-01",
    end: "2028-03-31",
    label: "2028-01-01 – 2028-03-31",
  });
  assert.equal(kpiPeriod("half_year", "2026-11-07").start, "2026-07-01");
  assert.equal(kpiPeriod("half_year", "2026-01-01").end, "2026-06-30");
  assert.equal(kpiAchievement(0, 0, "at_most"), true);
});
