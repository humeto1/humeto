"use client";
import { useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import { descendants, WBS_ROOT, type WbsNode } from "./wbs-model";

type Source = { id: string; title: string; available?: boolean };
type Target = {
  nodeId: string;
  parentId: string | null;
  beforeId: string | null;
  label: string;
};
type Drag = Source & { x: number; y: number; target: Target | null };
export function useWbsDrag(options: {
  nodes: WbsNode[];
  enabled: boolean;
  container: RefObject<HTMLElement | null>;
  onDrop: (source: Source, target: Target) => void;
  onNotice: (message: string) => void;
  onPan: (x: number, y: number) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [drag, setDrag] = useState<Drag | null>(null);
  const active = useRef<Drag | null>(null);
  const pending = useRef<{
    source: Source;
    pointerId: number;
    x: number;
    y: number;
    element: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const suppressUntil = useRef(0);
  const frame = useRef(0);
  function targetAt(source: Source, x: number, y: number): Target | null {
    const { nodes, container } = latest.current;
    const excluded = source.available
      ? new Set<string>()
      : descendants(nodes, source.id);
    const boxes =
      container.current?.querySelectorAll<HTMLElement>(
        ".wbs-position[data-node-id]",
      ) || [];
    const candidates = Array.from(boxes, (box) => ({
      box,
      rect: box.getBoundingClientRect(),
    })).sort(
      (a, b) =>
        Math.hypot(
          x - (a.rect.left + a.rect.width / 2),
          y - (a.rect.top + a.rect.height / 2),
        ) -
        Math.hypot(
          x - (b.rect.left + b.rect.width / 2),
          y - (b.rect.top + b.rect.height / 2),
        ),
    );
    for (const { box, rect: r } of candidates) {
      const nodeId = box.dataset.nodeId!;
      if (
        x < r.left - 8 ||
        x > r.right + 8 ||
        y < r.top - 8 ||
        y > r.bottom + 8
      )
        continue;
      if (excluded.has(nodeId)) return null;
      if (nodeId === WBS_ROOT)
        return {
          nodeId,
          parentId: null,
          beforeId: null,
          label: "Add to main branch",
        };
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      const fraction = (y - r.top) / r.height;
      if (fraction >= 0.25 && fraction <= 0.75)
        return {
          nodeId,
          parentId: node.id,
          beforeId: null,
          label: `Inside ${node.title}`,
        };
      if (node.parent_id && excluded.has(node.parent_id)) return null;
      const siblings = nodes
        .filter((n) => n.parent_id === node.parent_id && n.id !== source.id)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      const before = fraction < 0.25;
      const next = siblings[siblings.findIndex((n) => n.id === nodeId) + 1];
      return {
        nodeId,
        parentId: node.parent_id,
        beforeId: before ? nodeId : next?.id || null,
        label: `${before ? "Before" : "After"} ${node.title}`,
      };
    }
    return null;
  }
  useEffect(() => {
    function pan() {
      const current = active.current;
      const bounds = latest.current.container.current?.getBoundingClientRect();
      if (!current || !bounds) return;
      const delta = (point: number, low: number, high: number) =>
        point < low + 36
          ? Math.min(7, (low + 36 - point) / 5)
          : point > high - 36
            ? -Math.min(7, (point - high + 36) / 5)
            : 0;
      const dx = delta(current.x, bounds.left, bounds.right),
        dy = delta(current.y, bounds.top, bounds.bottom);
      if ((dx || dy) && !current.target) {
        latest.current.onPan(dx, dy);
        const next = {
          ...current,
          target: targetAt(current, current.x, current.y),
        };
        active.current = next;
        setDrag(next);
      }
      frame.current = requestAnimationFrame(pan);
    }
    function clear() {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      const p = pending.current;
      if (p) {
        clearTimeout(p.timer);
        try {
          p.element.releasePointerCapture(p.pointerId);
        } catch {}
      }
      pending.current = null;
      active.current = null;
      setDrag(null);
    }
    function move(e: PointerEvent) {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!active.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clear();
        return;
      }
      e.preventDefault();
      const next = {
        ...active.current,
        x: e.clientX,
        y: e.clientY,
        target: targetAt(p.source, e.clientX, e.clientY),
      };
      active.current = next;
      setDrag(next);
      if (!frame.current) frame.current = requestAnimationFrame(pan);
    }
    function finish(e: PointerEvent) {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const wasDragging = active.current;
      const target = wasDragging && targetAt(p.source, e.clientX, e.clientY);
      if (wasDragging) {
        e.preventDefault();
        suppressUntil.current = Date.now() + 400;
      }
      clear();
      if (wasDragging && target && latest.current.enabled)
        latest.current.onDrop(p.source, target);
      else if (wasDragging)
        latest.current.onNotice(
          "Move cancelled. Drop on a highlighted box to connect it.",
        );
    }
    function cancel() {
      if (active.current) suppressUntil.current = Date.now() + 400;
      clear();
    }
    function multiTouch(e: PointerEvent) {
      if (pending.current && e.pointerId !== pending.current.pointerId)
        cancel();
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && pending.current) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    }
    window.addEventListener("pointerdown", multiTouch);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish, { passive: false });
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      const p = pending.current;
      if (p) clearTimeout(p.timer);
      window.removeEventListener("pointerdown", multiTouch);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  function bind(source: Source) {
    return {
      onPointerDown(e: ReactPointerEvent<HTMLElement>) {
        if (
          !latest.current.enabled ||
          source.id === WBS_ROOT ||
          e.button !== 0 ||
          !e.isPrimary ||
          pending.current
        )
          return;
        e.stopPropagation();
        const element = e.currentTarget;
        const x = e.clientX,
          y = e.clientY,
          pointerId = e.pointerId;
        const timer = setTimeout(() => {
          if (!latest.current.enabled || !pending.current) return;
          try {
            element.setPointerCapture(pointerId);
          } catch {}
          const next: Drag = { ...source, x, y, target: null };
          active.current = next;
          setDrag(next);
          latest.current.onNotice(
            `Moving ${source.title}. Drop in a box to nest, or near its top or bottom to reorder.`,
          );
          navigator.vibrate?.(20);
        }, 1500);
        pending.current = { source, pointerId, x, y, element, timer };
      },
      onClickCapture(e: ReactMouseEvent) {
        if (Date.now() < suppressUntil.current || active.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onContextMenu(e: ReactMouseEvent) {
        e.preventDefault();
      },
    };
  }
  return { drag, bind };
}
