import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWbsDrop } from "../shared/wbs-model.ts";
const node = (id, parent_id = null, position = 0) => ({
  id,
  title: id,
  parent_id,
  position,
});
const nodes = [
  node("source"),
  node("one"),
  node("two", "one"),
  node("three", "two"),
  node("child", "source"),
];
const source = { id: "source", title: "source" };
test("whole cards attach children at every tier and zoom, including former reorder edges", () => {
  for (const zoom of [0.2, 0.4, 0.8, 1, 1.5]) {
    for (const id of ["one", "two", "three"]) {
      const r = {
        id,
        left: 100,
        right: 100 + 184 * zoom,
        top: 200,
        bottom: 200 + 140 * zoom,
      };
      for (const fraction of [0.02, 0.1, 0.5, 0.9, 0.98]) {
        const target = resolveWbsDrop(
          nodes,
          source,
          [r],
          (r.left + r.right) / 2,
          r.top + (r.bottom - r.top) * fraction,
        );
        assert.equal(target.parentId, id);
        assert.equal(target.kind, "inside");
      }
    }
  }
});
test("sibling insertion belongs in gaps and touch tolerance stays usable when zoomed out", () => {
  const box = { id: "two", left: 100, right: 150, top: 200, bottom: 240 };
  const before = resolveWbsDrop(nodes, source, [box], 125, 192);
  assert.equal(before.parentId, "one");
  assert.equal(before.beforeId, "two");
  assert.equal(before.kind, "before");
  const after = resolveWbsDrop(nodes, source, [box], 125, 248);
  assert.equal(after.parentId, "one");
  assert.equal(after.kind, "after");
  assert.equal(resolveWbsDrop(nodes, source, [box], 80, 220).parentId, "two");
  assert.equal(resolveWbsDrop(nodes, source, [box], 80, 220, "mouse"), null);
  assert.equal(resolveWbsDrop(nodes, source, [box], 70, 220), null);
});
test("self and descendants reject drops; an actual card outranks a neighbour's halo", () => {
  const boxes = [
    { id: "child", left: 100, right: 150, top: 200, bottom: 240 },
    { id: "two", left: 155, right: 205, top: 200, bottom: 240 },
  ];
  assert.equal(resolveWbsDrop(nodes, source, boxes, 125, 220), null);
  assert.equal(resolveWbsDrop(nodes, source, boxes, 158, 220).parentId, "two");
  assert.equal(
    resolveWbsDrop(
      nodes,
      source,
      [{ id: "source", left: 0, right: 50, top: 0, bottom: 50 }],
      25,
      25,
    ),
    null,
  );
});
