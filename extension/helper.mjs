// Deterministic local help. Saved values are data, never executable instructions.
export function answerQuestion(question, profile) {
  const q = String(question || "")
    .toLowerCase()
    .trim();
  if (!profile)
    return {
      text: "Pair one applicant first so I can search their shared information.",
      facts: [],
    };
  if (/fill|overwrite|submit/.test(q) && !q.includes("number"))
    return {
      text: "Use “Find fields on this page”, review the suggestions, then approve one batch. Existing answers are preserved. I never submit the form.",
      facts: [],
    };
  if (/attach|upload|document|file/.test(q) && !/passport number/.test(q))
    return {
      text: "Choose a shared document and the page’s file input below. Check the website and filename before approving attachment. If a file input is custom or unavailable, download the file and attach it yourself.",
      facts: [],
    };
  if (/verify|verified|source|accurate/.test(q))
    return {
      text: "These are saved profile answers, not OCR-verified facts. Each result names its section and last update. Check it against the original document before using it.",
      facts: [],
    };
  const synonyms = {
    dob: "birth date",
    passport: "passport identity",
    university: "institution",
    degree: "qualification",
    ielts: "test languages",
    mobile: "phone",
  };
  const words = q
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 1 &&
        ![
          "what",
          "where",
          "when",
          "the",
          "is",
          "my",
          "me",
          "show",
          "find",
          "tell",
          "please",
          "his",
          "her",
          "their",
          "number",
          "of",
        ].includes(w),
    );
  const terms = [
    ...words,
    ...words.flatMap((w) => (synonyms[w] || "").split(" ").filter(Boolean)),
  ];
  const ranked = (profile.facts || [])
    .map((f) => ({
      fact: f,
      score: terms.filter((w) =>
        (f.label + " " + f.section + " " + f.key).toLowerCase().includes(w),
      ).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score || 0,
    facts = ranked
      .filter((x) => x.score === best)
      .slice(0, 8)
      .map((x) => x.fact);
  return {
    text: facts.length
      ? "Here is the saved information I found. Review repeated records carefully."
      : "I couldn’t find a saved answer in the sections shared with this pairing. Add it in Humeto or create a new pairing with the relevant section.",
    facts,
  };
}
