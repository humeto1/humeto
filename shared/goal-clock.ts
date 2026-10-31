export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function addDays(value: string, days: number) {
  const d = new Date(value + "T12:00:00");
  d.setDate(d.getDate() + days);
  return localDate(d);
}
const ordinal = (s: string) =>
  Date.parse(s.slice(0, 10) + "T00:00:00Z") / 86400000;
const parse = (s: string) =>
  Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
export function computeGoalTiming(
  goal: {
    created_at?: string;
    target_date?: string;
    status?: string;
    completed_at?: string | null;
  },
  now = new Date(),
) {
  const today = localDate(now);
  const target = (goal.target_date || "").slice(0, 10);
  const hasTarget =
    /^\d{4}-\d{2}-\d{2}$/.test(target) && Number.isFinite(ordinal(target));
  const created = goal.created_at ? new Date(parse(goal.created_at)) : null;
  const start =
    created && Number.isFinite(created.getTime()) ? localDate(created) : null;
  const completed = goal.status === "Completed";
  const completedAt = goal.completed_at
    ? new Date(parse(goal.completed_at))
    : null;
  const end =
    completedAt && Number.isFinite(completedAt.getTime())
      ? localDate(completedAt)
      : completed
        ? null
        : today;
  const elapsed =
    start && end ? Math.max(0, ordinal(end) - ordinal(start)) : null;
  const total =
    start && hasTarget ? Math.max(1, ordinal(target) - ordinal(start)) : null;
  const remaining = hasTarget ? ordinal(target) - ordinal(today) : null;
  return {
    hasTarget,
    completed,
    elapsed,
    total,
    remaining,
    percent:
      elapsed !== null && total
        ? Math.min(100, Math.round((elapsed / total) * 100))
        : 0,
    summary: completed
      ? elapsed === null
        ? "Completed · completion date not recorded"
        : `Completed in ${elapsed} days`
      : !hasTarget
        ? "Set a goal timeframe"
        : remaining! < 0
          ? `${Math.abs(remaining!)} days overdue · extend or start a new cycle`
          : remaining === 0
            ? "Target date is today"
            : `${remaining} days remaining`,
  };
}
export function extendGoalTarget(
  target: string,
  days: number,
  today = localDate(),
) {
  return addDays(target && target > today ? target : today, days);
}
