import { matchField } from "./matcher.mjs";
export function reviewFields(fields, facts) {
  return fields.map((field, index) => {
    const match = matchField(field, facts);
    return {
      index,
      field,
      match,
      group: field.value ? "preserved" : match ? "suggested" : "attention",
      selected: !field.value && !!match,
    };
  });
}
export function reviewCounts(rows) {
  return rows.reduce(
    (counts, row) => {
      counts[row.group]++;
      return counts;
    },
    { suggested: 0, attention: 0, preserved: 0 },
  );
}
