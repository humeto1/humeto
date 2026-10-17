import {
  dayKey,
  dayOffset,
  localInstant,
  validDay,
  validTimezone,
} from "./agent/dates";
export function proposeExpectedDate(
  message: string,
  timezone: string,
  receivedAt = new Date(),
) {
  validTimezone(timezone);
  const text = message.toLowerCase();
  const intent =
    /\b(receive|receiving|available|ready|provide|share|upload|send|get|expect|expecting|arrive|arriving|obtain|deliver)\b/.test(
      text,
    );
  if (!intent) return { state: "none", day: "", at: "", reason: "" };
  const unclear = (reason: string) => ({
    state: "clarify",
    day: "",
    at: "",
    reason,
  });
  if (
    /\b(not|cannot|can't|won't|maybe|perhaps|unsure|between|or)\b|\?/.test(text)
  )
    return unclear("Please confirm one definite availability date.");
  const absolute = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(
    (m) => m[0],
  );
  const relative = [...text.matchAll(/\b(?:after|in)\s+(\d+)\s+days?\b/g)];
  const tomorrow = /\btomorrow\b/.test(text);
  if (absolute.length + relative.length + Number(tomorrow) !== 1)
    return unclear(
      "Use one date such as 2026-11-20, tomorrow, or after 20 days.",
    );
  let day = "";
  if (absolute.length) {
    day = absolute[0];
    if (!validDay(day))
      return unclear("The availability date is not a valid calendar date.");
  } else if (relative.length) {
    const n = Number(relative[0][1]);
    if (n < 1 || n > 730) return unclear("Use an interval from 1 to 730 days.");
    day = dayOffset(receivedAt, timezone, n);
  } else day = dayOffset(receivedAt, timezone, 1);
  const at = localInstant(day, 9, 0, timezone);
  if (Date.parse(at) <= receivedAt.getTime())
    return unclear("Choose a future availability date.");
  return {
    state: "suggested",
    day,
    at,
    reason: `Based on the reply received on ${dayKey(receivedAt, timezone)} in ${timezone}; follow-up is at 09:00.`,
  };
}
