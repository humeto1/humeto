export type WbsNode = {
  is_plan_paused?: boolean;
  is_csf?: boolean;
  is_kpi?: boolean;
  activity_note?: string;
  id: string;
  parent_id: string | null;
  position: number;
  title: string;
  stage: string;
  storage_state: string;
  revision: number;
  due_date: string;
  frequency: string | null;
  first_day: string | null;
  series_id: string | null;
};
export const WBS_ROOT = "__project__";
export function descendants(
  nodes: Pick<WbsNode, "id" | "parent_id">[],
  id: string,
) {
  const found = new Set<string>([id]);
  const visit = (parent: string) => {
    for (const n of nodes)
      if (n.parent_id === parent && !found.has(n.id)) {
        found.add(n.id);
        visit(n.id);
      }
  };
  visit(id);
  return found;
}
export function wbsDone(node: Pick<WbsNode, "stage" | "frequency">) {
  return node.stage === "Done" && !node.frequency;
}
// Automatic layout preserves sibling order; collapsed branches take no space.
export function layoutWbs(
  nodes: WbsNode[],
  collapsed: Set<string>,
  focus: string | null = null,
) {
  const boxes: { node: WbsNode; x: number; y: number }[] = [];
  const edges: { from: string; to: string }[] = [];
  let cursor = 0;
  const children = (id: string | null) =>
    nodes
      .filter((n) => n.parent_id === id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const place = (node: WbsNode, depth: number): number => {
    const kids = collapsed.has(node.id) ? [] : children(node.id);
    const xs = kids.map((child) => {
      edges.push({ from: node.id, to: child.id });
      return place(child, depth + 1);
    });
    const x = xs.length
      ? (xs[0] + xs[xs.length - 1]) / 2
      : cursor++ * 208 + 104;
    boxes.push({ node, x, y: depth * 180 + 24 });
    return x;
  };
  if (focus) {
    const n = nodes.find((n) => n.id === focus);
    if (n) place(n, 0);
  } else {
    for (const n of children(null)) {
      edges.push({ from: WBS_ROOT, to: n.id });
      place(n, 1);
    }
    const roots = boxes.filter((b) => b.node.parent_id === null);
    const x = roots.length ? (roots[0].x + roots[roots.length - 1].x) / 2 : 104;
    boxes.push({
      node: {
        id: WBS_ROOT,
        title: "",
        parent_id: null,
        position: 0,
        stage: "",
        storage_state: "planning",
        revision: 0,
        due_date: "",
        frequency: null,
        first_day: null,
        series_id: null,
      },
      x,
      y: 24,
    });
  }
  return {
    boxes,
    edges,
    width: Math.max(208, cursor * 208),
    height: Math.max(180, ...boxes.map((b) => b.y + 154)),
  };
}

export type WbsDragSource = { id: string; title: string; available?: boolean };
export type WbsDropTarget = {
  nodeId: string;
  parentId: string | null;
  beforeId: string | null;
  kind: "inside" | "before" | "after";
  label: string;
};
export type WbsDropBox = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};
// Use screen-space bounds so zoom never shrinks the touch tolerance. The entire
// card attaches a child; sibling insertion only happens in the surrounding gap.
export function resolveWbsDrop(
  nodes: WbsNode[],
  source: WbsDragSource,
  boxes: WbsDropBox[],
  x: number,
  y: number,
  pointerType = "touch",
): WbsDropTarget | null {
  const excluded = source.available
    ? new Set<string>()
    : descendants(nodes, source.id);
  const tolerance = pointerType === "mouse" ? 10 : 22;
  const distance = (b: WbsDropBox) =>
    Math.hypot(
      Math.max(b.left - x, 0, x - b.right),
      Math.max(b.top - y, 0, y - b.bottom),
    );
  const candidates = boxes
    .filter((b) => distance(b) <= tolerance)
    .sort(
      (a, b) =>
        distance(a) - distance(b) ||
        Math.hypot(x - (a.left + a.right) / 2, y - (a.top + a.bottom) / 2) -
          Math.hypot(x - (b.left + b.right) / 2, y - (b.top + b.bottom) / 2),
    );
  for (const box of candidates) {
    if (excluded.has(box.id)) {
      if (distance(box) === 0) return null;
      continue;
    }
    if (box.id === WBS_ROOT)
      return {
        nodeId: box.id,
        parentId: null,
        beforeId: null,
        kind: "inside",
        label: "Add to main branch",
      };
    const node = nodes.find((n) => n.id === box.id);
    if (!node) continue;
    if (y >= box.top && y <= box.bottom)
      return {
        nodeId: node.id,
        parentId: node.id,
        beforeId: null,
        kind: "inside",
        label: `Add under ${node.title}`,
      };
    if (node.parent_id && excluded.has(node.parent_id)) continue;
    const before = y < box.top;
    const siblings = nodes
      .filter((n) => n.parent_id === node.parent_id && n.id !== source.id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const next = siblings[siblings.findIndex((n) => n.id === node.id) + 1];
    return {
      nodeId: node.id,
      parentId: node.parent_id,
      beforeId: before ? node.id : next?.id || null,
      kind: before ? "before" : "after",
      label: `${before ? "Before" : "After"} ${node.title}`,
    };
  }
  return null;
}
