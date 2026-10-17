// RFC-style quoted CSV, including embedded commas, newlines and escaped quotes.
export function parseLeadCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell)
        throw new Error("Quote must begin at the start of a cell.");
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(cell.trim());
      cell = "";
      if (c !== ",") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else cell += c;
  }
  if (quoted) throw new Error("A quoted cell is not closed.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers =
    rows.shift()?.map((s) => s.toLowerCase().replace(/\s+/g, "_")) || [];
  if (!headers.includes("name") || !headers.includes("email"))
    throw new Error("CSV needs name and email headers.");
  if (new Set(headers).size !== headers.length || headers.some((h) => !h))
    throw new Error("Use unique, non-empty column headers.");
  const cash = new Set(["expected_fee", "upfront_fee", "incentive"]);
  const known = new Set([
    "name",
    "email",
    "phone",
    "destination",
    "course",
    "notes",
    "follow_up",
    "timeline",
    ...cash,
  ]);
  return rows.map((cells, i) => {
    if (cells.length !== headers.length)
      throw new Error("Wrong number of cells on row " + (i + 2));
    const out = { source: "CSV", extras: {} };
    headers.forEach((h, k) => {
      if (cash.has(h)) {
        if (cells[k] && !/^\d+$/.test(cells[k]))
          throw new Error("Amounts must be whole PKR on row " + (i + 2));
        out[h] = Number(cells[k] || 0);
      } else if (known.has(h)) out[h] = cells[k];
      else out.extras[h] = cells[k];
    });
    return out;
  });
}
