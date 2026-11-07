"use client";
import { useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import { WBS_ROOT, type WbsNode } from "./wbs-model";

import {
  resolveWbsDrop,
  type WbsDragSource as Source,
  type WbsDropTarget as Target,
} from "./wbs-model";
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
  const [panning, setPanning] = useState(false);
  const active = useRef<Drag | null>(null);
  const pending = useRef<{
    source: Source;
    pointerId: number;
    x: number;
    y: number;
    element: HTMLElement;
    pointerType: string;
    panning: boolean;
    lastX: number;
    lastY: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const suppressUntil = useRef(0);
  const frame = useRef(0);
  function targetAt(source: Source, x: number, y: number): Target | null {
    const { nodes, container } = latest.current;
    const el = container.current;
    if (!el) return null;
    const bounds = el.getBoundingClientRect();
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return null;
    const boxes = Array.from(
      el.querySelectorAll<HTMLElement>(".wbs-position[data-node-id]"),
      (box) => ({
        id: box.dataset.nodeId!,
        ...(() => {
          const r = box.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        })(),
      }),
    );
    return resolveWbsDrop(
      nodes,
      source,
      boxes,
      x,
      y,
      pending.current?.pointerType,
    );
  }
  function activate(x: number, y: number) {
    const p = pending.current;
    if (
      !p ||
      p.source.id === WBS_ROOT ||
      p.panning ||
      active.current ||
      !latest.current.enabled
    )
      return;
    clearTimeout(p.timer);
    try {
      p.element.setPointerCapture(p.pointerId);
    } catch {}
    const next: Drag = { ...p.source, x, y, target: null };
    active.current = next;
    setDrag(next);
    latest.current.onNotice(
      `Moving ${p.source.title}. Drop on a box to attach, or in a gap to reorder.`,
    );
    if (p.pointerType !== "mouse") navigator.vibrate?.(15);
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
      setPanning(false);
    }
    function move(e: PointerEvent) {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const dx = e.clientX - p.lastX,
        dy = e.clientY - p.lastY;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      if (!active.current) {
        const distance = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (!p.panning && distance > (p.pointerType === "mouse" ? 6 : 10)) {
          clearTimeout(p.timer);
          p.panning = true;
          setPanning(true);
          try {
            p.element.setPointerCapture(p.pointerId);
          } catch {}
          latest.current.onPan(e.clientX - p.x, e.clientY - p.y);
        } else if (p.panning) latest.current.onPan(dx, dy);
        if (p.panning) e.preventDefault();
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
      if (wasDragging || p.panning) {
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
      if (active.current || pending.current?.panning)
        suppressUntil.current = Date.now() + 400;
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
        if (e.button !== 0 || !e.isPrimary || pending.current) return;
        e.stopPropagation();
        // A new pointer gesture is intentional; only suppress the click from
        // the drag/pan that just ended, not a fresh tap on a box.
        suppressUntil.current = 0;
        const element = e.currentTarget;
        const x = e.clientX,
          y = e.clientY,
          pointerId = e.pointerId;
        const timer = setTimeout(() => {
          const p = pending.current;
          if (p) activate(p.lastX, p.lastY);
        }, 350);
        pending.current = {
          source,
          pointerId,
          x,
          y,
          lastX: x,
          lastY: y,
          element,
          pointerType: e.pointerType,
          panning: false,
          timer,
        };
      },
      onClickCapture(e: ReactMouseEvent) {
        if (
          Date.now() < suppressUntil.current ||
          active.current ||
          pending.current?.panning
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onContextMenu(e: ReactMouseEvent) {
        e.preventDefault();
      },
    };
  }
  return { drag, panning, bind };
}
