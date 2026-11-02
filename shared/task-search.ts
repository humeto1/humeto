/** Shared lexical search: no external AI, network request or exact phrase requirement. */
export type SearchableTask = {
  id: string;
  title: string;
  display_title?: string | null;
  category?: string | null;
  project_title?: string | null;
  assignee?: string | null;
  person_name?: string | null;
  goals?: { title: string }[];
  stage?: string;
  storage_state?: string;
  revision?: number;
};
const ignored = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "my",
  "please",
  "task",
  "tasks",
]);
const aliases: Record<string, string> = {
  purchase: "buy",
  purchasing: "buy",
  bought: "buy",
  buying: "buy",
  telephone: "call",
  phone: "call",
  calling: "call",
  meeting: "meet",
  meetings: "meet",
  email: "email",
  emails: "email",
  emailing: "email",
  invoice: "invoice",
  invoices: "invoice",
  invoicing: "invoice",
  review: "review",
  reviewing: "review",
  reviewed: "review",
};
export function normalizeSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/e[\s-]mail/g, "email")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function canonical(word: string) {
  return (
    aliases[word] ||
    (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word)
  );
}
function tokens(value: string) {
  const words = normalizeSearch(value).split(/\s+/).filter(Boolean);
  const meaningful = words.filter((word) => !ignored.has(word));
  return (meaningful.length ? meaningful : words).map(canonical).slice(0, 32);
}
// Bounded Damerau-Levenshtein, including common adjacent-letter transpositions.
function distance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}
function wordScore(query: string, word: string) {
  if (query === word) return 1;
  if (/\p{N}/u.test(query) || /\p{N}/u.test(word)) return 0;
  if (query.length >= 2 && word.startsWith(query)) return 0.9;
  const allowance = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
  if (
    !allowance ||
    Math.abs(query.length - word.length) > allowance ||
    query.length > 48 ||
    word.length > 48
  )
    return 0;
  return distance(query, word) <= allowance ? 0.7 : 0;
}
export function taskSearchScore(
  task: SearchableTask,
  query: string,
  extra = "",
) {
  const normalized = normalizeSearch(query.slice(0, 200));
  if (!normalized) return 1;
  const title = normalizeSearch(
    [task.title, task.display_title].filter(Boolean).join(" "),
  );
  const words = tokens(
    [
      title,
      task.category,
      task.project_title,
      task.assignee,
      task.person_name,
      ...(task.goals || []).map((g) => g.title),
      extra,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const terms = tokens(normalized);
  const scores = terms.map((term) =>
    Math.max(0, ...words.map((word) => wordScore(term, word))),
  );
  // Every meaningful term must match: unrelated one-word overlap isn't a result.
  if (scores.some((score) => !score)) return 0;
  return (
    scores.reduce((sum, score) => sum + score, 0) / scores.length +
    (title === normalized ? 2 : title.includes(normalized) ? 1 : 0)
  );
}

/** More cautious title-only check for creation, including extra/missing keywords. */
export function taskSimilarityScore(task: SearchableTask, query: string) {
  const exact = taskSearchScore(task, query);
  if (exact) return exact;
  const terms = tokens(query.slice(0, 200));
  const titleWords = tokens(
    [task.title, task.display_title].filter(Boolean).join(" "),
  );
  const matched = terms.filter((term) =>
    titleWords.some((word) => wordScore(term, word) > 0),
  );
  // Never call a single generic word a near duplicate of a longer instruction.
  return matched.length >= 2 && matched.length / terms.length >= 0.6
    ? (matched.length / terms.length) * 0.6
    : 0;
}
