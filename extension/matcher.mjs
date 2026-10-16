// Conservative deterministic matching. No model calls or executable remote configuration.
export const aliases = {
  givenNames: [
    "given names",
    "given name",
    "first names",
    "first name",
    "forename",
  ],
  middleNames: ["middle name", "middle names"],
  familyName: ["family name", "last name", "surname"],
  nativeName: ["name in native alphabet", "full name in native language"],
  birthDate: ["date of birth", "birth date", "dob"],
  birthCity: ["city of birth", "birth city", "town of birth"],
  birthCountry: ["country of birth", "birth country"],
  citizenship: ["citizenship", "nationality"],
  email: ["email address", "email", "e mail"],
  phone: ["primary phone", "phone number", "mobile number", "telephone"],
  street: ["street address", "address line 1", "address line one"],
  city: ["city", "town city"],
  region: [
    "state province region",
    "state province",
    "province",
    "region",
    "state",
  ],
  postcode: ["postal code", "zip code", "postcode", "postal zip"],
  country: ["country of residence", "residence country"],
  preferredName: ["preferred name"],
};
export function normalize(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function matchField(field, facts) {
  const label = normalize(field.label),
    name = normalize(field.name),
    autocomplete = String(field.autocomplete || "").toLowerCase();
  const auto = {
    "given-name": "givenNames",
    "family-name": "familyName",
    "additional-name": "middleNames",
    bday: "birthDate",
    email: "email",
    tel: "phone",
    "address-line1": "street",
    "address-level2": "city",
    "address-level1": "region",
    "postal-code": "postcode",
  };
  if (
    /parent|father|mother|spouse|referee|emergency|sponsor|guardian|school|university|institution|employer/.test(
      label + " " + normalize(field.context),
    )
  )
    return null;
  if (
    /password|signature|consent|declaration|security|convict|health|terror|agree|payment|card number|bank/.test(
      label,
    )
  )
    return null;
  let candidates = [];
  for (const f of facts) {
    const list = aliases[f.key] || [];
    let score = 0;
    if (auto[autocomplete] === f.key) score = 99;
    for (const a of list) {
      const normalized = normalize(a);
      if (label === normalized) score = Math.max(score, 97);
      else if (
        label.startsWith(normalized + " ") ||
        label.endsWith(" " + normalized)
      )
        score = Math.max(score, 88);
      else if (name === normalize(f.key) || name === normalized)
        score = Math.max(score, 83);
    }
    if (score >= 88) candidates.push({ fact: f, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || candidates[1]?.score === candidates[0].score)
    return null;
  return candidates[0];
}
