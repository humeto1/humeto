export type WbsNode = {
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
    boxes.push({ node, x, y: depth * 150 + 24 });
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
    height: Math.max(180, ...boxes.map((b) => b.y + 126)),
  };
}
