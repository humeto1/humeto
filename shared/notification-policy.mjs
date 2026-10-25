import {
  localDay,
  quietUntil,
  nextDay,
  scheduledAt,
} from "../src/lib/scheduling-clock.mjs";
export function priorityTier(t) {
  return t.important && t.urgent
    ? "audible"
    : t.important || t.urgent
      ? "gentle"
      : "silent";
}
/** @param {{reminders?:any[],series?:any[],focus?:any,prefs?:any,now?:Date}} input */
export function notificationCandidates({
  reminders = [],
  series = [],
  focus = null,
  prefs = {},
  now = new Date(),
}) {
  const result = new Map();
  const add = (r) => {
    if (!Number.isFinite(Date.parse(r.at))) return;
    result.set(r.key, r);
  };
  if (prefs.enabled === false) return [];
  for (const s of series.filter(
    (s) =>
      s.status === "active" &&
      s.track_occurrences &&
      s.storage_state !== "archive" &&
      s.storage_state !== "bin",
  )) {
    let day = s.next_day;
    for (let i = 0; i < 8; i++) {
      if (s.end_day && day > s.end_day) break;
      const at = scheduledAt(day, s.local_time, s.timezone);
      if (
        Date.parse(quietUntil(new Date(at), prefs) || at) >=
          now.getTime() - 60000 &&
        priorityTier(s) !== "silent"
      )
        add({
          key: "auto:" + s.id + ":" + day,
          kind: "automatic",
          title: s.display_title || s.title,
          taskIds: [s.template_task_id],
          at,
          tier: priorityTier(s),
        });
      day = nextDay(
        day,
        s.frequency,
        s.interval_count,
        Number(s.first_day.slice(8)),
      );
    }
  }
  for (const r of reminders) {
    if (
      (r.status && r.status !== "scheduled") ||
      r.stage === "Done" ||
      (r.storage_state && r.storage_state !== "active")
    )
      continue;
    const kind = r.origin === "automatic" ? "automatic" : "manual";
    if (
      kind === "automatic" &&
      (priorityTier(r) === "silent" ||
        localDay(
          new Date(quietUntil(new Date(r.remind_at), prefs) || r.remind_at),
          prefs.timezone,
        ) < localDay(now, prefs.timezone))
    )
      continue;
    if (kind === "manual" && Date.parse(r.remind_at) < now.getTime() - 60000)
      continue;
    add({
      key:
        kind === "automatic"
          ? "auto:" + (r.source_key || r.id)
          : "manual:" + r.id + ":" + r.remind_at,
      kind,
      title: r.display_title || r.title,
      taskIds: [r.task_id],
      at: r.remind_at,
      tier: priorityTier(r),
    });
  }
  if (prefs.focus_alerts && focus && !focus.ended_at) {
    const at =
      focus.state === "running" ? focus.check_in_at : focus.break_until;
    if (at)
      add({
        key: "focus:" + focus.id + ":" + at,
        kind: "focus",
        title: focus.title || "Your focus task",
        body:
          focus.state === "running"
            ? "Time for your focus check-in."
            : "Break finished. Ready to return?",
        taskIds: [focus.task_id],
        at,
        tier: "gentle",
      });
  }
  return [...result.values()].map((r) => {
    const quiet = quietUntil(new Date(r.at), prefs);
    // Explicit reminders retain their requested time, quietly. Automatic nudges wait until morning.
    if (quiet && r.kind !== "automatic")
      return {
        ...r,
        tier: "silent",
        day: localDay(new Date(r.at), prefs.timezone),
      };
    const at = quiet ? new Date(quiet).toISOString() : r.at;
    return { ...r, at, day: localDay(new Date(at), prefs.timezone) };
  });
}
export function selectNotifications(
  candidates,
  history,
  prefs,
  now = new Date(),
) {
  const past = history.filter(
    (h) => h.device_id && Date.parse(h.at) <= now.getTime(),
  );
  const consumed = new Set(past.map((h) => h.key));
  for (const h of past)
    for (const key of h.payload?.sourceKeys || []) consumed.add(key);
  const groups = new Map();
  for (const r of candidates) {
    if (consumed.has(r.key)) continue;
    const key =
      r.kind === "automatic"
        ? "automatic:" +
          r.day +
          ":" +
          (Date.parse(r.at) <= now.getTime()
            ? "catchup"
            : Math.floor(Date.parse(r.at) / 60000))
        : r.key;
    if (consumed.has(key)) continue;
    const g = groups.get(key);
    if (g) {
      g.taskIds = [...new Set([...g.taskIds, ...r.taskIds])];
      g.titles.push(r.title);
      g.sourceKeys.push(r.key);
      if (r.tier === "audible") g.tier = "audible";
    } else
      groups.set(key, { ...r, key, titles: [r.title], sourceKeys: [r.key] });
  }
  const budget = new Map(),
    sound = new Set();
  for (const h of past.filter((h) => h.kind === "automatic")) {
    const day = localDay(new Date(h.at), prefs.timezone);
    budget.set(day, (budget.get(day) || 0) + 1);
    if (h.tier === "audible") sound.add(day);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) || (a.tier === "audible" ? -1 : 1),
    )
    .filter((r) => {
      if (r.kind !== "automatic") return true;
      const count = budget.get(r.day) || 0;
      if (count >= Math.min(3, prefs.daily_limit ?? 3)) return false;
      budget.set(r.day, count + 1);
      if (r.tier === "audible") {
        if (sound.has(r.day)) r.tier = "gentle";
        else sound.add(r.day);
      }
      return true;
    })
    .map((r) => ({
      ...r,
      title:
        r.titles.length > 1
          ? `${r.titles.length} tasks need a little attention`
          : r.title,
      body: r.body || r.titles.join(" · ").slice(0, 300),
    }));
}
