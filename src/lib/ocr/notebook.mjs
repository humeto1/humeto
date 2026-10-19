// The OCR is evidence to review, never a command to mutate tasks.
export const normalizeTaskTitle = (value) =>
  String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function notebookLines(page) {
  return page.lines
    .slice(0, 500)
    .filter((line) => line.text.trim().length >= 2)
    .map((line, index) => ({
      index,
      text: line.text.trim().slice(0, 1000),
      box: line.box,
      confidence: line.confidence ?? null,
      completionHint: /^\s*(?:\[\s*[xX✓✔]\s*\]|[☑✓✔])/.test(line.text),
    }));
}
export function proposedTitle(text) {
  return String(text)
    .replace(/^\s*(?:(?:\[[ xX✓✔]*\]|[☐☑✓✔•●])|(?:\d{1,3}[.)])|[-*])\s*/, "")
    .trim()
    .slice(0, 200);
}
