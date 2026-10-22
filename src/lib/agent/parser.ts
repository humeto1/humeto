import type { Intent } from "./contracts";
const base: Intent = {
  kind: "help",
  title: null,
  project: null,
  target: null,
  stage: null,
  important: null,
  urgent: null,
  dueDate: null,
  reminder: null,
  filter: "pending",
  scope: "mine",
};
export function parseLocal(
  message: string,
  context: { now?: Date; timezone?: string } = {},
): Intent {
  let text = message
    .trim()
    .replace(/^(please\s+|can you\s+|could you\s+)/i, "");
  const projectClause = text.match(
    /[.;]\s*project\s*(?:is|:|=)\s*(.{1,160}?)\s*[.]?$/i,
  );
  const project =
    projectClause?.[1].trim().replace(/^['"“]|['"”]$/g, "") || null;
  if (projectClause) text = text.slice(0, projectClause.index).trim();
  const low = text.toLowerCase();
  const intent = {
    ...base,
    scope: /\b(team|workspace|everyone|all users)\b/.test(low)
      ? ("team" as const)
      : ("mine" as const),
  };
  const schedulePattern =
    /\b(tomorrow|today|\d{4}-\d{2}-\d{2})(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b|\bin\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?)\b/i;
  const namedDeadline = text.match(
    /\b(?:by|on|due(?: on)?)\s+(\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+\d{4})?)\b/i,
  );
  const namedParts = namedDeadline?.[1].match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?$/,
  );
  let namedDate: string | null = null;
  if (namedParts) {
    const year =
      namedParts[3] ||
      new Intl.DateTimeFormat("en", {
        year: "numeric",
        timeZone: context.timezone || "UTC",
      }).format(context.now || new Date());
    const month =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(namedParts[2].slice(0, 3).toLowerCase()) + 1;
    namedDate = `${year}-${String(month).padStart(2, "0")}-${namedParts[1].padStart(2, "0")}`;
  }
  const schedule =
    namedDeadline?.[1] || text.match(schedulePattern)?.[0] || null;
  const create =
    /^(?:add|create|make|record|schedule)\s+(?:an?\s+)?(?:(?:important|urgent)\s+)*(?:task|to-do|todo)\b/i.test(
      text,
    ) ||
    /^mark\s+(?:an?\s+)?task\s+to\b/i.test(text) ||
    /^remind me to\s/i.test(text) ||
    (/^(?:submit|prepare|review|draft|write|call|email|contact|upload|book|pay|send|follow up)\b/i.test(
      text,
    ) &&
      (!!schedule || !!project));
  if (create) {
    let title = text
      .replace(
        /^(?:add|create|make|record|schedule|mark)\s+(?:an?\s+)?(?:(?:important|urgent)\s+)*(?:task|to-do|todo)(?:\s+to|\s*:)?\s*/i,
        "",
      )
      .replace(/^remind me to\s+/i, "");
    title = title.replace(/(?:[,.]?\s+(?:and\s+)?remind me\b.*)$/i, "");
    if (namedDeadline) title = title.replace(namedDeadline[0], "");
    else if (schedule) title = title.replace(schedule, "");
    title = title.replace(/\s+(?:by|on|due(?: on)?)\s*$/i, "");
    title = title
      .replace(/\s+(?:tomorrow|today)$/i, "")
      .replace(/[\s,.]+$/g, "")
      .trim();
    return {
      ...intent,
      kind: "create",
      title: title.replace(/^['"]|['"]$/g, ""),
      important: /\bimportant\b/.test(low) && !/\bnot important\b/.test(low),
      urgent: /\burgent\b/.test(low) && !/\bnot urgent\b/.test(low),
      project,
      dueDate: namedDate || schedule,
      reminder: /\bremind\b/.test(low)
        ? namedDate
          ? namedDate +
            (text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i)?.[1]
              ? " at " +
                text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i)![1]
              : "")
          : schedule
        : null,
    };
  }
  if (
    /^(mark|complete|finish|move|set|make|reschedule|remind|change)\b/.test(low)
  ) {
    const quoted = text.match(/["“]([^"”]+)["”]/)?.[1];
    const target =
      quoted ||
      text
        .replace(
          /^(?:mark|complete|finish|move|set|make|reschedule|remind me(?: about)?|change)\s+/i,
          "",
        )
        .replace(
          /\s+(?:as\s+)?(?:not important|not urgent|important|urgent|done|complete|completed|in progress|waiting|review|to do)(?:\s+.*)?$/i,
          "",
        )
        .replace(
          /\s+(?:to\s+)?(?:tomorrow|today|\d{4}-\d{2}-\d{2}|in\s+\d+).*/i,
          "",
        )
        .trim();
    const command = quoted ? low.replace(/["“][^"”]+["”]/, "") : low;
    const updateSchedule = command.match(schedulePattern)?.[0] || null;
    return {
      ...intent,
      kind: "update",
      target,
      stage: /\b(done|complete|completed|finish)\b/.test(command)
        ? "Done"
        : /\bin progress\b/.test(command)
          ? "In progress"
          : /\bwaiting\b/.test(command)
            ? "Waiting"
            : /\breview\b/.test(command)
              ? "Review"
              : /\bto do\b/.test(command)
                ? "To do"
                : null,
      important: /\bimportant\b/.test(command)
        ? !/\bnot important\b/.test(command)
        : null,
      urgent: /\burgent\b/.test(command)
        ? !/\bnot urgent\b/.test(command)
        : null,
      dueDate: updateSchedule,
      reminder: /\bremind\b/.test(command) ? updateSchedule : null,
    };
  }
  if (/\b(tasks?|pending|priorities|overdue|important|urgent)\b/.test(low)) {
    return {
      ...intent,
      kind: "list",
      important: /\bimportant\b/.test(low)
        ? !/\bnot important\b/.test(low)
        : null,
      urgent: /\burgent\b/.test(low) ? !/\bnot urgent\b/.test(low) : null,
      filter: /\binclude completed\b/.test(low)
        ? "all"
        : /\bimportant\b/.test(low) && !/\bnot important\b/.test(low)
          ? "important"
          : /\burgent\b/.test(low) && !/\bnot urgent\b/.test(low)
            ? "urgent"
            : /\boverdue\b/.test(low)
              ? "overdue"
              : /\btomorrow\b/.test(low)
                ? "tomorrow"
                : /\btoday\b/.test(low)
                  ? "today"
                  : /\binclude completed\b/.test(low)
                    ? "all"
                    : "pending",
    };
  }
  return intent;
}
