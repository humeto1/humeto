export function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    throw new Error("Choose a valid timezone.");
  }
}
export function parts(at: Date, timezone: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (key: string) =>
    Number(p.find((x) => x.type === key)?.value || 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}
export function dayKey(at: Date, timezone: string) {
  const p = parts(at, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function dayOffset(now: Date, timezone: string, offset: number) {
  const p = parts(now, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day + offset))
    .toISOString()
    .slice(0, 10);
}
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function localInstant(
  day: string,
  hour: number,
  minute: number,
  timezone: string,
) {
  if (!validDay(day) || hour > 23 || minute > 59 || hour < 0 || minute < 0)
    throw new Error("Use a valid date and time.");
  const [y, m, d] = day.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(candidate), timezone);
    const actual = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const delta = target - actual;
    if (!delta) return new Date(candidate).toISOString();
    candidate += delta;
  }
  throw new Error(
    "That local time is affected by a clock change. Choose another time.",
  );
}
export function resolveSchedule(
  value: string,
  timezone: string,
  now = new Date(),
) {
  validTimezone(timezone);
  const text = value.toLowerCase().trim();
  const relative = text.match(
    /\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\b/,
  );
  if (relative) {
    const count = Number(relative[1]);
    if (count < 1 || count > 10080)
      throw new Error("Choose a reminder interval between 1 and 10,080 units.");
    if (/day/.test(relative[2])) {
      const p = parts(now, timezone);
      return localInstant(
        dayOffset(now, timezone, count),
        p.hour,
        p.minute,
        timezone,
      );
    }
    return new Date(
      now.getTime() + count * (/hour|hr/.test(relative[2]) ? 3600000 : 60000),
    ).toISOString();
  }
  const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const day =
    date ||
    (/\btomorrow\b/.test(text)
      ? dayOffset(now, timezone, 1)
      : /\btoday\b/.test(text)
        ? dayOffset(now, timezone, 0)
        : null);
  if (!day)
    throw new Error(
      "Please give a date, such as tomorrow at 9 AM or 2026-11-20 at 14:00.",
    );
  const t = text.match(/\b(?:at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let hour = t ? Number(t[1]) : 9;
  if (t?.[3]) {
    if (hour < 1 || hour > 12)
      throw new Error("Use a time from 1 to 12 with AM or PM.");
    hour = (hour % 12) + (t[3] === "pm" ? 12 : 0);
  }
  const at = localInstant(day, hour, Number(t?.[2] || 0), timezone);
  if (Date.parse(at) <= now.getTime())
    throw new Error(
      "That reminder time has passed. Please choose a future time.",
    );
  return at;
}
