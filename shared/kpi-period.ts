export type KpiCadence =
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "half_year"
  | "yearly";
export function kpiPeriod(cadence: KpiCadence, day: string) {
  const date = new Date(day + "T12:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day)
    throw Error("Choose a valid date.");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (cadence === "once")
    return { start: "0001-01-01", end: "9999-12-31", label: "Overall" };
  if (cadence === "daily") return { start: day, end: day, label: day };
  if (cadence === "weekly") {
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return {
      start: iso(start),
      end: iso(end),
      label: iso(start) + " – " + iso(end),
    };
  }
  if (cadence === "quarterly" || cadence === "half_year") {
    const months = cadence === "quarterly" ? 3 : 6;
    const firstMonth = Math.floor(date.getUTCMonth() / months) * months;
    const start = new Date(date);
    start.setUTCMonth(firstMonth, 1);
    const end = new Date(start);
    end.setUTCMonth(firstMonth + months, 0);
    return {
      start: iso(start),
      end: iso(end),
      label: iso(start) + " – " + iso(end),
    };
  }
  if (cadence === "monthly") {
    const start = day.slice(0, 7) + "-01";
    const end = new Date(date);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return { start, end: iso(end), label: day.slice(0, 7) };
  }
  return {
    start: day.slice(0, 4) + "-01-01",
    end: day.slice(0, 4) + "-12-31",
    label: day.slice(0, 4),
  };
}
export function kpiAchievement(
  actual: number | null,
  target: number,
  direction: string,
) {
  if (actual === null) return null;
  return direction === "at_most" ? actual <= target : actual >= target;
}

export function kpiLocalDay(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
