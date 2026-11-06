import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutWbs,
  descendants,
  wbsDone,
  WBS_ROOT,
} from "../shared/wbs-model.ts";
const node = (id, parent_id = null, position = 0) => ({
  id,
  parent_id,
  position,
  title: id,
  stage: "To do",
  frequency: null,
});
test("tree layout separates siblings and collapses only the selected branch", () => {
  const nodes = [
    node("design"),
    node("code", null, 1),
    node("wireframes", "design"),
    node("mockups", "design", 1),
    node("api", "code"),
  ];
  const full = layoutWbs(nodes, new Set());
  assert.equal(full.boxes.length, 6);
  assert.equal(full.edges.length, 5);
  const roots = full.boxes.filter(
    (b) => b.node.parent_id === null && b.node.id !== WBS_ROOT,
  );
  assert.ok(roots[0].x !== roots[1].x);
  const closed = layoutWbs(nodes, new Set(["design"]));
  assert.deepEqual(
    new Set(closed.boxes.map((b) => b.node.id)),
    new Set([WBS_ROOT, "design", "code", "api"]),
  );
  const focused = layoutWbs(nodes, new Set(), "design");
  assert.deepEqual(
    new Set(focused.boxes.map((b) => b.node.id)),
    new Set(["design", "wireframes", "mockups"]),
  );
});
test("descendant lookup prevents cycles and repeating activities never fade on occurrence completion", () => {
  assert.deepEqual(
    descendants([node("a"), node("b", "a"), node("c", "b"), node("d")], "a"),
    new Set(["a", "b", "c"]),
  );
  assert.equal(wbsDone({ stage: "Done", frequency: "daily" }), false);
  assert.equal(wbsDone({ stage: "Done", frequency: null }), true);
  assert.equal(wbsDone({ stage: "To do", frequency: null }), false);
});
