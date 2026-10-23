"use client";
import { useEffect } from "react";

/** Follow the visible viewport, including Android resize and browser keyboard overlays. */
export function useChatViewport(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let baseline = window.innerHeight;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height || window.innerHeight;
        const top = viewport?.offsetTop || 0;
        const editing = document.activeElement?.matches(
          "textarea, input:not([type=checkbox]):not([type=radio]), [contenteditable=true]",
        );
        if (!editing) baseline = Math.max(baseline, window.innerHeight);
        root.style.setProperty("--chat-viewport-height", `${height}px`);
        root.style.setProperty("--chat-viewport-top", `${top}px`);
        root.dataset.chatKeyboard =
          editing && baseline - height > 120 ? "true" : "false";
      });
    };
    const rotate = () => {
      baseline = window.innerHeight;
      update();
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", rotate);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", rotate);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.style.removeProperty("--chat-viewport-height");
      root.style.removeProperty("--chat-viewport-top");
      delete root.dataset.chatKeyboard;
    };
  }, [enabled]);
}
