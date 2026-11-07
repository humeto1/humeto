export type FocusSessionData = {
  id: string;
  title: string;
  check_in_at: string | null;
  attendance_due_at?: string | null;
  attendance_prompt_at?: string | null;
  break_until?: string;
  ended_at?: string | null;
  state: string;
  target_minutes?: number;
  total_seconds?: number;
} | null;
export type FocusSnapshot = { id: string; seconds: number; remaining: number };
// Convert server deadlines to device time, without assuming the clocks agree.
export function focusNotification(
  active: FocusSessionData,
  serverNow: string | undefined,
  receivedAt: number,
  now: number,
  previous?: FocusSnapshot | null,
) {
  if (!active || active.ended_at || active.state === "stopped") return null;
  const seconds = Number(active.total_seconds || 0);
  const server = serverNow ? Date.parse(serverNow) : receivedAt;
  const serverTime =
    (Number.isFinite(server) ? server : receivedAt) +
    Math.max(0, now - receivedAt);
  const until = active.break_until ? Date.parse(active.break_until) : 0;
  const deadline = active.check_in_at ? Date.parse(active.check_in_at) : 0;
  const running = active.state === "running";
  const remaining =
    running && deadline
      ? Math.max(0, Math.ceil((deadline - serverTime) / 1000))
      : previous?.id === active.id
        ? Math.max(
            0,
            previous.remaining - Math.max(0, seconds - previous.seconds),
          )
        : Math.max(0, (active.target_minutes || 25) * 60 - seconds);
  const elapsedSinceRead = running
    ? Math.max(0, Math.floor((now - receivedAt) / 1000))
    : 0;
  return {
    options: {
      title: active.title || "Your focus task",
      state: until > serverTime ? "break" : running ? "running" : "paused",
      targetMinutes: active.target_minutes || 25,
      remainingSeconds: Math.ceil(remaining),
      checkInAt: deadline
        ? now + deadline - serverTime
        : now + remaining * 1000,
      breakUntil: until ? now + until - serverTime : 0,
    },
    snapshot: { id: active.id, seconds: seconds + elapsedSinceRead, remaining },
  };
}
