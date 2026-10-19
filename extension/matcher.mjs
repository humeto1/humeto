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
  const component = dateComponent(field);
  const rawLabel = normalize(field.label);
  const label = component
      ? normalize(
          (/^(day|month|year)$/.test(rawLabel)
            ? field.context
            : field.label
          ).replace(/\b(day|month|year)\b/gi, " "),
        )
      : rawLabel,
    name = normalize(field.name),
    autocomplete = String(field.autocomplete || "")
      .toLowerCase()
      .split(/\s+/)
      .at(-1);
  const auto = {
    "given-name": "givenNames",
    "family-name": "familyName",
    "additional-name": "middleNames",
    bday: "birthDate",
    "bday-day": "birthDate",
    "bday-month": "birthDate",
    "bday-year": "birthDate",
    email: "email",
    tel: "phone",
    "address-line1": "street",
    "address-level2": "city",
    "address-level1": "region",
    "postal-code": "postcode",
  };
  const relatedPersonContext =
    /parent|father|mother|spouse|referee|reference|emergency|sponsor|guardian|sibling|brother|sister|child|family member/.test(
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
    family: {
      givenNames: aliases.givenNames,
      familyName: aliases.familyName,
      birthDate: aliases.birthDate,
      citizenship: aliases.citizenship,
      email: aliases.email,
      phone: aliases.phone,
      address: ["address", "home address"],
      country: ["country of residence", "residence country"],
      occupation: ["occupation", "job title"],
    },
    references: {
      name: ["referee name", "reference name", "full name", "name"],
      email: [
        "referee email",
        "reference email",
        "email",
        "email address",
        "professional email",
      ],
      phone: ["referee phone", "phone number", "telephone"],
      organization: ["institution name", "organization", "organization name"],
      position: ["position", "job title"],
    },
    "trip-plans": {
      arrival: ["intended arrival date", "planned arrival date"],
      departure: ["intended departure date", "planned departure date"],
      arrivalCity: ["arrival city"],
      itinerary: ["proposed itinerary"],
    },
  };
  for (const f of facts) {
    if (relatedPersonContext) {
      const combined = normalize(field.label + " " + (field.context || ""));
      const reference = /referee|reference/.test(combined);
      if (
        (reference && f.sectionKey !== "references") ||
        (!reference && f.sectionKey !== "family")
      )
        continue;
      const relation = normalize(
        facts.find(
          (r) =>
            r.sectionKey === f.sectionKey &&
            r.recordIndex === f.recordIndex &&
            r.key === "relationship",
        )?.value,
      );
      const wanted = reference
        ? null
        : combined.match(
            /father|mother|parent|spouse|partner|sibling|brother|sister|child|guardian|emergency/,
          );
      if (
        !reference &&
        (!wanted ||
          !relation ||
          !new RegExp("\\b" + wanted[0] + "\\b").test(relation))
      )
        continue;
      if (reference) {
        const kind = combined.match(/academic|professional/);
        if (kind && !relation.includes(kind[0])) continue;
      }
    } else if (["family", "references"].includes(f.sectionKey)) continue;
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
    if (component) {
      const text = normalize(field.label + " " + (field.context || ""));
      if (
        /birth|dob/.test(text) &&
        f.key === "birthDate" &&
        (!f.sectionKey || ["identity", "family"].includes(f.sectionKey))
      )
        score = Math.max(score, 97);
      if (
        /passport/.test(text) &&
        f.sectionKey === "passports" &&
        ((/expir/.test(text) && f.key === "expiryDate") ||
          (/issue/.test(text) && f.key === "issueDate"))
      )
        score = Math.max(score, 97);
    }
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
    if (
      relatedPersonContext &&
      auto[autocomplete] === f.key &&
      f.sectionKey === "family"
    )
      score = Math.max(score, 94);
    if (score >= 88 && prepareValue(field, f) !== null)
      candidates.push({ fact: f, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || candidates[1]?.score === candidates[0].score)
    return null;
  return candidates[0];
}

export function dateComponent(field) {
  const auto = String(field.autocomplete || "")
    .toLowerCase()
    .split(/\s+/)
    .at(-1);
  if (["bday-day", "bday-month", "bday-year"].includes(auto))
    return auto.slice(5);
  const label = normalize(field.label);
  const part = label.match(/(?:^| )(day|month|year)(?:$| )/);
  if (!part) return null;
  if (
    /birth|dob|passport.*(issue|expir)|(?:issue|expir).*passport|test date|arrival date|departure date|start date|end date/.test(
      label + " " + normalize(field.context),
    )
  )
    return part[1];
  return null;
}
export function prepareValue(field, fact) {
  const value = String(fact.value || ""),
    component = dateComponent(field);
  if (!component) return value;
  if (
    !/Date$|^date$|^arrival$|^departure$/.test(fact.key) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    return null;
  const [year, month, day] = value.split("-");
  if (component === "year") return year;
  const number = Number(component === "month" ? month : day);
  if (field.type === "select" && field.options?.length) {
    const names =
      component === "month"
        ? [
            new Intl.DateTimeFormat("en", {
              month: "long",
              timeZone: "UTC",
            }).format(new Date(value)),
            new Intl.DateTimeFormat("en", {
              month: "short",
              timeZone: "UTC",
            }).format(new Date(value)),
          ]
        : [];
    const matches = field.options.filter(
      (o) =>
        names.some((n) => normalize(n) === normalize(o.label)) ||
        (/^0*\d+$/.test(o.label.trim()) && Number(o.label) === number),
    );
    if (matches.length !== 1) return null;
    return matches[0].label;
  }
  return String(number);
}
