// Conservative label-based proposals. Text is evidence, never instructions.
const months = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};
export function parseDate(value) {
  const s = String(value).trim().replace(/[,]/g, "");
  let y,
    m,
    d,
    ambiguous = false;
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    [, y, m, d] = match.map(Number);
  } else if ((match = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/))) {
    d = +match[1];
    m = months[match[2].slice(0, 3).toUpperCase()];
    y = +match[3];
  } else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    d = +match[1];
    m = +match[2];
    y = +match[3];
    if (d <= 12 && m <= 12 && d !== m) ambiguous = true;
    else if (m > 12 && d <= 12) [d, m] = [m, d];
  } else return null;
  if (
    !y ||
    !m ||
    !d ||
    y < 1900 ||
    y > 2150 ||
    new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !==
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  )
    return null;
  return {
    value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    ambiguous,
  };
}
const definitions = [
  [
    "identity",
    "givenNames",
    "Given names",
    /^(?:given names?|first names?|forenames?)\s*[:：]\s*(.+)$/i,
  ],
  [
    "identity",
    "familyName",
    "Family name",
    /^(?:surname|family name|last name)\s*[:：]\s*(.+)$/i,
  ],
  [
    "identity",
    "birthDate",
    "Date of birth",
    /^(?:date of birth|birth date|dob)\s*[:：]\s*(.+)$/i,
    "date",
  ],
  [
    "identity",
    "birthCity",
    "City of birth",
    /^(?:city of birth|birth city)\s*[:：]\s*(.+)$/i,
  ],
  [
    "identity",
    "birthCountry",
    "Country of birth",
    /^(?:country of birth)\s*[:：]\s*(.+)$/i,
  ],
  [
    "identity",
    "citizenship",
    "Citizenship",
    /^(?:nationality|citizenship)\s*[:：]\s*(.+)$/i,
  ],
  [
    "contact",
    "email",
    "Email",
    /^(?:email(?: address)?)\s*[:：]\s*([^\s]+@[^\s]+\.[^\s]+)$/i,
  ],
  [
    "contact",
    "phone",
    "Primary phone",
    /^(?:mobile|phone|telephone)(?: number)?\s*[:：]\s*(\+?[\d ()-]{7,25})$/i,
  ],
  [
    "passports",
    "number",
    "Passport number",
    /^(?:passport (?:number|no\.?))\s*[:：]\s*([A-Z0-9 -]{5,20})$/i,
  ],
  [
    "passports",
    "issuingCountry",
    "Passport issuing country",
    /^(?:passport issuing country|country of issue|issuing country)\s*[:：]\s*(.+)$/i,
  ],
  [
    "passports",
    "issueDate",
    "Passport issue date",
    /^(?:passport issue date|date of issue|issue date)\s*[:：]\s*(.+)$/i,
    "date",
  ],
  [
    "passports",
    "expiryDate",
    "Passport expiry date",
    /^(?:passport expiry date|date of expiry|expiry date|expiration date)\s*[:：]\s*(.+)$/i,
    "date",
  ],
  [
    "identity",
    "birthDate",
    "Date of birth",
    /^date of birth\s*[:：]?\s*(.+)$/i,
    "date",
  ],
  [
    "identity",
    "birthPlace",
    "Place of birth",
    /^place of birth\s*[:：]?\s*(.+)$/i,
  ],
  [
    "passports",
    "number",
    "Passport number",
    /^(?:passport (?:number|no\.?)|document no\.?)\s*[:：]?\s*([A-Z0-9]{5,20})$/i,
  ],
  [
    "passports",
    "issueDate",
    "Passport issue date",
    /^date of issue\s*[:：]?\s*(.+)$/i,
    "date",
  ],
  [
    "passports",
    "expiryDate",
    "Passport expiry date",
    /^date of expiry\s*[:：]?\s*(.+)$/i,
    "date",
  ],
  [
    "passports",
    "issuingAuthority",
    "Issuing authority",
    /^(?:issuing authority|authority)\s*[:：]?\s*(.+)$/i,
  ],
  [
    "education",
    "institution",
    "Institution name",
    /^(?:institution name|school name|university name)\s*[:：]\s*(.+)$/i,
  ],
  [
    "education",
    "qualification",
    "Qualification",
    /^(?:qualification(?: title)?|degree(?: title)?)\s*[:：]\s*(.+)$/i,
  ],
  [
    "education",
    "subject",
    "Subject / major",
    /^(?:major|subject(?: of study)?)\s*[:：]\s*(.+)$/i,
  ],
  [
    "education",
    "grade",
    "Grade",
    /^(?:final grade|overall grade|gpa|cgpa)\s*[:：]\s*(.+)$/i,
  ],
  [
    "education",
    "startDate",
    "Education start date",
    /^(?:attendance start|education start date|course start date)\s*[:：]\s*(.+)$/i,
    "date",
  ],
  [
    "education",
    "endDate",
    "Education end date",
    /^(?:attendance end|education end date|course end date)\s*[:：]\s*(.+)$/i,
    "date",
  ],
  [
    "tests",
    "type",
    "Test name",
    /^(?:test name|language test)\s*[:：]\s*(.+)$/i,
  ],
  [
    "tests",
    "overall",
    "Overall score",
    /^(?:overall (?:score|band))\s*[:：]\s*(.+)$/i,
  ],
  ["tests", "date", "Test date", /^(?:test date)\s*[:：]\s*(.+)$/i, "date"],
  [
    "employment",
    "employer",
    "Employer",
    /^(?:employer name|employer|organization name)\s*[:：]\s*(.+)$/i,
  ],
  [
    "employment",
    "role",
    "Job title",
    /^(?:job title|designation)\s*[:：]\s*(.+)$/i,
  ],
  [
    "employment",
    "startDate",
    "Employment start date",
    /^(?:employment start date)\s*[:：]\s*(.+)$/i,
    "date",
  ],
  [
    "employment",
    "endDate",
    "Employment end date",
    /^(?:employment end date)\s*[:：]\s*(.+)$/i,
    "date",
  ],
];

// ICAO TD3 passport MRZ: two 44-char lines of A-Z/0-9/"<" at the bottom of
// the bio-data page. Far more reliable than the printed fields above since
// it's designed to be machine-read: no label matching, fixed-width columns.
const mrzCheckWeights = [7, 3, 1];
function mrzCheckDigit(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const v = c === "<" ? 0 : /[0-9]/.test(c) ? +c : c.charCodeAt(0) - 55;
    sum += v * mrzCheckWeights[i % 3];
  }
  return sum % 10;
}
function mrzDate(yymmdd) {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = +yymmdd.slice(0, 2),
    mm = yymmdd.slice(2, 4),
    dd = yymmdd.slice(4, 6);
  // No century in MRZ; dates > ~10y in the future are almost always 19xx
  // (birth dates), everything else is treated as 20xx.
  const century = yy > (new Date().getFullYear() % 100) + 10 ? 1900 : 2000;
  return parseDate(`${century + yy}-${mm}-${dd}`);
}
function parseMRZLines(pages) {
  const out = [];
  for (const page of pages) {
    const lines = page.lines
      .map((l) => ({
        ...l,
        clean: l.text
          .toUpperCase()
          .replace(/\s+/g, "")
          .replace(/[^A-Z0-9<]/g, ""),
      }))
      .filter((l) => l.clean.length >= 40 && l.clean.length <= 48);
    for (let i = 0; i < lines.length - 1; i++) {
      const l1 = lines[i].clean.padEnd(44, "<").slice(0, 44);
      const l2raw = lines[i + 1].clean;
      if (!/^P[A-Z<]/.test(l1)) continue;
      const l2 = l2raw.padEnd(44, "<").slice(0, 44);
      const names = l1.slice(5).split("<<");
      const surname = (names[0] || "").replace(/</g, " ").trim();
      const givenNames = (names[1] || "").replace(/</g, " ").trim();
      const passportNumber = l2.slice(0, 9).replace(/<+$/, "");
      const nationality = l2.slice(10, 13).replace(/</g, "");
      const birthDate = mrzDate(l2.slice(13, 19));
      const sex = l2.slice(20, 21);
      const expiryDate = mrzDate(l2.slice(21, 27));
      if (!passportNumber || !birthDate || !expiryDate) continue;
      const checksOk =
        mrzCheckDigit(l2.slice(0, 9)) === +(l2[9] || -1) &&
        mrzCheckDigit(l2.slice(13, 19)) === +(l2[19] || -1) &&
        mrzCheckDigit(l2.slice(21, 27)) === +(l2[27] || -1);
      const evidence = {
        text: lines[i].text + "\n" + lines[i + 1].text,
        box: null,
        confidence:
          lines[i].confidence === null || lines[i + 1].confidence === null
            ? null
            : Math.min(lines[i].confidence, lines[i + 1].confidence),
      };
      const warnings = checksOk
        ? []
        : [
            "MRZ check digits did not verify: confirm every character against the document.",
          ];
      const push = (fieldKey, label, value) =>
        value &&
        out.push({
          sectionKey: "passports",
          fieldKey,
          label,
          value,
          rawValue: value,
          pageNumber: page.pageNumber,
          sourceExcerpt: evidence.text,
          box: evidence.box,
          confidence: evidence.confidence,
          method: page.method,
          groupKey: "passports:" + page.pageNumber,
          warnings,
        });
      push("number", "Passport number", passportNumber);
      push(
        "issuingCountry",
        "Passport issuing country",
        l1.slice(2, 5).replace(/</g, ""),
      );
      push("expiryDate", "Passport expiry date", expiryDate.value);
      out.push({
        sectionKey: "identity",
        fieldKey: "birthDate",
        label: "Date of birth",
        value: birthDate.value,
        rawValue: birthDate.value,
        pageNumber: page.pageNumber,
        sourceExcerpt: evidence.text,
        box: evidence.box,
        confidence: evidence.confidence,
        method: page.method,
        groupKey: "identity:" + page.pageNumber,
        warnings,
      });
      if (nationality)
        out.push({
          sectionKey: "identity",
          fieldKey: "citizenship",
          label: "Citizenship",
          value: nationality,
          rawValue: nationality,
          pageNumber: page.pageNumber,
          sourceExcerpt: evidence.text,
          box: evidence.box,
          confidence: evidence.confidence,
          method: page.method,
          groupKey: "identity:" + page.pageNumber,
          warnings,
        });
      if (surname)
        out.push({
          sectionKey: "identity",
          fieldKey: "familyName",
          label: "Family name",
          value: surname,
          rawValue: surname,
          pageNumber: page.pageNumber,
          sourceExcerpt: evidence.text,
          box: evidence.box,
          confidence: evidence.confidence,
          method: page.method,
          groupKey: "identity:" + page.pageNumber,
          warnings,
        });
      if (givenNames)
        out.push({
          sectionKey: "identity",
          fieldKey: "givenNames",
          label: "Given names",
          value: givenNames,
          rawValue: givenNames,
          pageNumber: page.pageNumber,
          sourceExcerpt: evidence.text,
          box: evidence.box,
          confidence: evidence.confidence,
          method: page.method,
          groupKey: "identity:" + page.pageNumber,
          warnings,
        });
      if (sex === "M" || sex === "F")
        out.push({
          sectionKey: "identity",
          fieldKey: "sexAsRecorded",
          label: "Sex",
          value: sex === "M" ? "Male" : "Female",
          rawValue: sex,
          pageNumber: page.pageNumber,
          sourceExcerpt: evidence.text,
          box: evidence.box,
          confidence: evidence.confidence,
          method: page.method,
          groupKey: "identity:" + page.pageNumber,
          warnings,
        });
    }
  }
  return out;
}

export function extractFacts(pages) {
  const facts = parseMRZLines(pages);
  for (const page of pages) {
    for (const [lineIndex, line] of page.lines.entries()) {
      const text = line.text.trim();
      if (!text || text.length > 600) continue;
      for (const [sectionKey, fieldKey, label, pattern, type] of definitions) {
        let evidence = line,
          match = text.match(pattern);
        if (!match && !text.includes(":") && page.lines[lineIndex + 1]) {
          const next = page.lines[lineIndex + 1];
          match = (text + ": " + next.text).match(pattern);
          if (match)
            evidence = {
              ...line,
              text: text + "\n" + next.text,
              confidence:
                line.confidence === null || next.confidence === null
                  ? null
                  : Math.min(line.confidence, next.confidence),
              box: null,
            };
        }
        if (!match) continue;
        if (
          sectionKey === "passports" &&
          !/passport|travel document/i.test(
            page.text || page.lines.map((l) => l.text).join(" "),
          )
        )
          continue;
        let value = match[1].trim();
        const warnings = [];
        if (type === "date") {
          const parsed = parseDate(value);
          if (!parsed) continue;
          if (parsed.ambiguous) {
            warnings.push(
              "Ambiguous day/month order: choose the correct ISO date after checking the source.",
            );
            value = "";
          } else value = parsed.value;
        }
        if (value.length > 300) continue;
        if (evidence.confidence !== null && evidence.confidence < 80)
          warnings.push("Low OCR confidence: inspect every character.");
        facts.push({
          sectionKey,
          fieldKey,
          label,
          value,
          rawValue: match[1].trim(),
          pageNumber: page.pageNumber,
          sourceExcerpt: evidence.text,
          box: evidence.box || null,
          confidence: evidence.confidence,
          method: page.method,
          groupKey: sectionKey + ":" + page.pageNumber,
          warnings,
        });
      }
    }
  }
  // Same value repeated on a page is one suggestion; differing values remain separate conflicts.
  const seen = new Set();
  return facts
    .filter((f) => {
      const key = [
        f.sectionKey,
        f.fieldKey,
        f.value,
        f.rawValue,
        f.pageNumber,
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 300);
}
