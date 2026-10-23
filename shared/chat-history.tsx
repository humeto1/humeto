import { useLayoutEffect, useRef, useState } from "react";

// Fresh replies replace overlapping messages while preserving pages already read.
export function mergeConversation(previous: any, next: any) {
  if (!previous || previous.threadId !== next.threadId || !next.threadId)
    return next;
  // A disconnected refresh window cannot be appended without leaving an unseen gap.
  // Reset to the recent page; its cursor can recover the complete continuous history.
  if (
    previous.messages.length &&
    next.messages.length &&
    !next.messages.some((m: any) =>
      previous.messages.some((old: any) => old.id === m.id),
    )
  )
    return next;
  const messages = new Map(previous.messages.map((m: any) => [m.id, m]));
  for (const message of next.messages) messages.set(message.id, message);
  return {
    ...next,
    messages: [...messages.values()],
    history: previous.history,
  };
}

export function useChatHistory(
  state: any,
  setState: any,
  fetchPage: (query: string) => Promise<any>,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const current = useRef(state);
  current.current = state;
  const lock = useRef(false);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const lastThread = useRef<string | null>(null);
  const nearBottom = useRef(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState("");
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (lastThread.current !== state?.threadId) {
      anchor.current = null;
      setHistoryError("");
      box.scrollTop = box.scrollHeight;
    } else if (anchor.current) {
      box.scrollTop =
        anchor.current.top + box.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (nearBottom.current) box.scrollTop = box.scrollHeight;
    lastThread.current = state?.threadId;
  });
  async function loadOlder() {
    const snapshot = current.current;
    if (lock.current || !snapshot?.history?.hasOlder || !snapshot.threadId)
      return;
    lock.current = true;
    setLoadingOlder(true);
    setHistoryError("");
    try {
      const page = await fetchPage(
        `?threadId=${encodeURIComponent(snapshot.threadId)}&before=${encodeURIComponent(snapshot.history.before)}`,
      );
      if (current.current?.threadId !== snapshot.threadId) return;
      const box = scroller.current;
      if (box)
        anchor.current = { height: box.scrollHeight, top: box.scrollTop };
      setState((previous: any) => {
        if (previous?.threadId !== snapshot.threadId) return previous;
        const ids = new Set(previous.messages.map((m: any) => m.id));
        return {
          ...previous,
          history: page.history,
          messages: [
            ...page.messages.filter((m: any) => !ids.has(m.id)),
            ...previous.messages,
          ],
        };
      });
    } catch (error) {
      if (current.current?.threadId === snapshot.threadId)
        setHistoryError((error as Error).message);
    } finally {
      lock.current = false;
      setLoadingOlder(false);
    }
  }
  return {
    scroller,
    loadingOlder,
    historyError,
    loadOlder,
    onScroll: () => {
      const box = scroller.current;
      if (!box) return;
      nearBottom.current =
        box.scrollHeight - box.scrollTop - box.clientHeight < 100;
      if (box.scrollTop < 60 && !historyError) void loadOlder();
    },
  };
}
