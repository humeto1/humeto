import { useEffect, useId, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./touch-drag.css";

type Options = {
  enabled: boolean;
  onDrop: (id: string, zone: string) => Promise<void> | void;
};
export function useTouchDrag({ enabled, onDrop }: Options) {
  const boardRef = useRef<HTMLDivElement>(null),
    owner = useId(),
    latest = useRef({ enabled, onDrop });
  latest.current = { enabled, onDrop };
  const [status, setStatus] = useState("");
  const cleanupRef = useRef<(() => void) | null>(null),
    pending = useRef(false);
  useEffect(() => () => cleanupRef.current?.(), []);
  useEffect(() => {
    if (!enabled) cleanupRef.current?.();
  }, [enabled]);
  function begin(
    e: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    title: string,
  ) {
    if (
      !latest.current.enabled ||
      pending.current ||
      e.button !== 0 ||
      !e.isPrimary
    )
      return;
    e.stopPropagation();
    cleanupRef.current?.();
    const node = e.currentTarget,
      pointer = e.pointerId,
      initial = { x: e.clientX, y: e.clientY };
    let x = e.clientX,
      y = e.clientY,
      active = false,
      frame = 0,
      over: HTMLElement | null = null,
      ghost: HTMLDivElement | null = null,
      finished = false;
    const clear = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
      node.removeEventListener("lostpointercapture", cancel);
      over?.classList.remove("touch-drop-over");
      ghost?.remove();
      document.body.classList.remove("touch-dragging");
      node.classList.remove("touch-grip-active");
      if (node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
      cleanupRef.current = null;
    };
    function cancel() {
      if (active) setStatus("Move cancelled");
      clear();
    }
    function hidden() {
      if (document.hidden) cancel();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") cancel();
    }
    function target() {
      const hit = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-touch-drop]");
      const next =
        hit &&
        boardRef.current?.contains(hit) &&
        hit.dataset.touchOwner === owner
          ? hit
          : null;
      if (next !== over) {
        over?.classList.remove("touch-drop-over");
        over = next;
        over?.classList.add("touch-drop-over");
      }
    }
    function scroll() {
      let el = document.elementFromPoint(x, y) as HTMLElement | null;
      let scrolledY = false;
      while (el && boardRef.current?.contains(el)) {
        const rect = el.getBoundingClientRect(),
          css = getComputedStyle(el);
        const edge = (position: number, start: number, end: number) =>
          position < start + 40 ? -10 : position > end - 40 ? 10 : 0;
        if (
          /auto|scroll/.test(css.overflowX) &&
          el.scrollWidth > el.clientWidth
        ) {
          const dx = edge(
            x,
            Math.max(0, rect.left),
            Math.min(innerWidth, rect.right),
          );
          if (dx) el.scrollLeft += dx;
        }
        if (
          !scrolledY &&
          /auto|scroll/.test(css.overflowY) &&
          el.scrollHeight > el.clientHeight
        ) {
          const dy = edge(
            y,
            Math.max(0, rect.top),
            Math.min(innerHeight, rect.bottom),
          );
          if (dy) {
            const before = el.scrollTop;
            el.scrollTop += dy;
            scrolledY = before !== el.scrollTop;
          }
        }
        el = el.parentElement;
      }
      if (!scrolledY) {
        if (y < 65) window.scrollBy(0, -10);
        else if (y > innerHeight - 65) window.scrollBy(0, 10);
      }
    }
    function animate() {
      if (!active || finished) return;
      if (ghost) {
        ghost.style.left =
          Math.max(8, Math.min(innerWidth - 228, x - 36)) + "px";
        ghost.style.top =
          Math.max(8, Math.min(innerHeight - 65, y - 48)) + "px";
      }
      scroll();
      target();
      frame = requestAnimationFrame(animate);
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      x = event.clientX;
      y = event.clientY;
      if (!active) {
        if (Math.hypot(x - initial.x, y - initial.y) > 12) clear();
        return;
      }
      event.preventDefault();
      target();
    }
    function end(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      if (!active) {
        clear();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      target();
      const zone = over?.dataset.touchDrop;
      clear();
      if (zone && latest.current.enabled) {
        pending.current = true;
        setStatus(
          "Dropped on " +
            (over?.dataset.touchLabel ||
              over?.getAttribute("aria-label") ||
              zone),
        );
        Promise.resolve()
          .then(() => latest.current.onDrop(id, zone))
          .catch(() => setStatus("Move failed. Try again."))
          .finally(() => {
            pending.current = false;
          });
      } else setStatus("Move cancelled");
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end, { passive: false });
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    node.addEventListener("lostpointercapture", cancel);
    const timer = setTimeout(() => {
      if (finished || !latest.current.enabled) return;
      try {
        node.setPointerCapture(pointer);
      } catch {
        clear();
        return;
      }
      active = true;
      node.classList.add("touch-grip-active");
      document.body.classList.add("touch-dragging");
      ghost = document.createElement("div");
      ghost.className = "touch-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.textContent = title;
      document.body.append(ghost);
      setStatus("Moving " + title + ". Release over a column.");
      animate();
    }, 280);
    cleanupRef.current = clear;
  }
  return {
    boardRef,
    status,
    zone: (key: string, label = key.replace(/^(stage|priority):/, "")) => ({
      "data-touch-drop": key,
      "data-touch-label": label,
      "data-touch-owner": owner,
    }),
    handle: (id: string, title: string) => (
      <button
        type="button"
        className="touch-drag-handle"
        draggable={false}
        disabled={!enabled}
        aria-label={"Drag: " + title}
        title="Hold to drag. Stage and priority controls are also available."
        onPointerDown={(e) => begin(e, id, title)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <GripVertical size={17} aria-hidden="true" />
      </button>
    ),
  };
}
