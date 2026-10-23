const formatters = new Map();
function formatter(zone) {
  if (!formatters.has(zone))
    formatters.set(
      zone,
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  return formatters.get(zone);
}
export function localParts(at, zone) {
  const parts = formatter(zone).formatToParts(new Date(at));
  const value = (key) => Number(parts.find((x) => x.type === key)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}
export function localDay(at, zone) {
  const p = localParts(at, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function validDay(day) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}
export function nextDay(
  day,
  frequency,
  interval = 1,
  anchor = Number(day.slice(8)),
) {
  const at = new Date(day + "T12:00:00Z");
  if (frequency === "monthly" || frequency === "yearly") {
    const month =
      at.getUTCMonth() + interval * (frequency === "yearly" ? 12 : 1);
    const last = new Date(
      Date.UTC(at.getUTCFullYear(), month + 1, 0),
    ).getUTCDate();
    at.setUTCDate(1);
    at.setUTCMonth(month);
    at.setUTCDate(Math.min(anchor, last));
  } else if (frequency === "weekdays") {
    for (let i = 0; i < interval; i++) {
      do {
        at.setUTCDate(at.getUTCDate() + 1);
      } while ([0, 6].includes(at.getUTCDay()));
    }
  } else
    at.setUTCDate(
      at.getUTCDate() + (frequency === "weekly" ? 7 : 1) * interval,
    );
  return at.toISOString().slice(0, 10);
}
function exactWall(day, time, zone) {
  const [y, m, d] = day.split("-").map(Number),
    [h, min] = time.split(":").map(Number),
    target = Date.UTC(y, m - 1, d, h, min);
  let candidate = target;
  for (let i = 0; i < 6; i++) {
    const p = localParts(candidate, zone),
      actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
      delta = target - actual;
    if (!delta) return new Date(candidate).toISOString();
    candidate += delta;
  }
  return null;
}
// On a DST gap, choose the first valid local minute after the requested wall time.
export function scheduledAt(day, time, zone) {
  for (let offset = 0; offset <= 180; offset++) {
    const [hour, minute] = time.split(":").map(Number),
      total = hour * 60 + minute + offset;
    if (total >= 1440) break;
    const wall = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      result = exactWall(day, wall, zone);
    if (result) return result;
  }
  throw Error("Local schedule time is unavailable.");
}
export function quietUntil(at, prefs) {
  if (!prefs.quiet_enabled) return null;
  const p = localParts(at, prefs.timezone),
    minute = p.hour * 60 + p.minute,
    toMinutes = (value) =>
      Number(value.slice(0, 2)) * 60 + Number(value.slice(3)),
    start = toMinutes(prefs.quiet_start),
    end = toMinutes(prefs.quiet_end);
  let day = localDay(at, prefs.timezone);
  if (start > end) {
    if (minute >= start) day = nextDay(day, "daily");
    else if (minute >= end) return null;
  } else if (minute < start || minute >= end) return null;
  return scheduledAt(day, prefs.quiet_end, prefs.timezone);
}
export function latestOccurrence(series, now) {
  let day = series.next_day,
    latest = null;
  for (let i = 0; i < 5000; i++) {
    if (series.end_day && day > series.end_day)
      return { day: latest, next: day, ended: true };
    if (
      Date.parse(scheduledAt(day, series.local_time, series.timezone)) >
      now.getTime()
    )
      return { day: latest, next: day, ended: false };
    latest = day;
    day = nextDay(
      day,
      series.frequency,
      series.interval_count,
      Number(series.first_day.slice(8)),
    );
  }
  throw Error("Schedule catch-up exceeds safe limit.");
}
export const defaultPreferences = {
  tone: "chime",
  vibration: true,
  precise: false,
  enabled: true,
  timezone: "Asia/Karachi",
  quiet_enabled: true,
  quiet_start: "22:00",
  quiet_end: "08:00",
  daily_limit: 5,
  followup_minutes: 0,
  revision: 0,
};
