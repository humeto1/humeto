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
  birthRegion: ["state of birth", "province of birth"],
  maritalStatus: ["marital status"],
  otherPhone: ["alternative phone", "secondary phone"],
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
  const relatedPersonContext =
    /parent|father|mother|spouse|referee|emergency|sponsor|guardian/.test(
      label + " " + normalize(field.context),
    );
  if (
    /password|signature|consent|declaration|security|convict|health|terror|agree|payment|card number|bank/.test(
      label,
    )
  )
    return null;
  let candidates = [];
  const scopedAliases = {
    passports: {
      number: ["passport number", "travel document number"],
      bookNumber: ["passport book number"],
      issuingCountry: ["passport issuing country", "country of passport issue"],
      issueDate: ["passport issue date", "date of passport issue"],
      expiryDate: ["passport expiry date", "passport expiration date"],
    },
    education: {
      institution: ["institution name", "school name", "university name"],
      qualification: ["qualification", "qualification title", "degree name"],
      subject: ["major", "subject of study"],
      startDate: ["attendance start", "education start date"],
      endDate: ["attendance end", "education end date"],
      grade: ["final grade", "gpa", "achieved grade"],
      country: ["institution country"],
      language: ["language of instruction"],
    },
    tests: {
      type: ["test name", "test type"],
      date: ["test date"],
      reportNumber: ["test report number"],
      overall: ["overall score", "overall result"],
      listening: ["listening score"],
      reading: ["reading score"],
      writing: ["writing score"],
      speaking: ["speaking score"],
    },
    employment: {
      employer: ["employer name", "organization name"],
      role: ["job title", "occupation"],
      startDate: ["employment start date"],
      endDate: ["employment end date"],
      duties: ["job responsibilities"],
    },
    "travel-history": {
      country: ["country visited"],
      arrival: ["previous arrival date"],
      departure: ["previous departure date"],
      purpose: ["purpose of previous visit"],
      visaReference: ["previous visa number"],
    },
    "trip-plans": {
      arrival: ["intended arrival date", "planned arrival date"],
      departure: ["intended departure date", "planned departure date"],
      arrivalCity: ["arrival city"],
      itinerary: ["proposed itinerary"],
    },
  };
  for (const f of facts) {
    if (relatedPersonContext) continue;
    if (
      (!f.sectionKey || ["identity", "contact"].includes(f.sectionKey)) &&
      /school|university|institution|employer/.test(
        label + " " + normalize(field.context),
      )
    )
      continue;
    const scoped =
      f.sectionKey && !["identity", "contact"].includes(f.sectionKey);
    // Repeated family/referee records need explicit selection; never guess whose name is requested.
    const list = scoped
      ? scopedAliases[f.sectionKey]?.[f.key] || []
      : aliases[f.key] || [];
    let score = 0;
    if (!scoped && auto[autocomplete] === f.key) score = 99;
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
