import { test } from "node:test";
import assert from "node:assert/strict";
import { matchField } from "../extension/matcher.mjs";
const facts = [
  { key: "givenNames", label: "Given names", value: "Amira" },
  { key: "familyName", label: "Family name", value: "Shah" },
  { key: "birthDate", label: "Date of birth", value: "2001-09-12" },
  { key: "email", label: "Email", value: "amira@example.com" },
  { key: "citizenship", label: "Citizenship", value: "Pakistan" },
];
test("generic label synonyms map to the correct canonical fact", () => {
  assert.equal(
    matchField({ label: "First name" }, facts)?.fact.key,
    "givenNames",
  );
  assert.equal(matchField({ label: "Surname" }, facts)?.fact.key, "familyName");
  assert.equal(matchField({ label: "DOB" }, facts)?.fact.key, "birthDate");
  assert.equal(
    matchField({ label: "Nationality" }, facts)?.fact.key,
    "citizenship",
  );
});
test("autocomplete and context prevent guessing a parent name", () => {
  assert.equal(
    matchField({ label: "Your name", autocomplete: "given-name" }, facts)?.fact
      .key,
    "givenNames",
  );
  assert.equal(
    matchField({ label: "First name", context: "Parent information" }, facts),
    null,
  );
  assert.equal(matchField({ label: "Mother first name" }, facts), null);
  assert.equal(matchField({ label: "Signature" }, facts), null);
  assert.equal(
    matchField({ label: "Have you ever been convicted?" }, facts),
    null,
  );
  assert.equal(matchField({ label: "Unknown institution code" }, facts), null);
});
test("ambiguous duplicate canonical values abstain instead of choosing a record", () => {
  assert.equal(
    matchField({ label: "First name" }, [
      ...facts,
      { key: "givenNames", label: "Given names", value: "Another person" },
    ]),
    null,
  );
});

test("review separates suggested, ambiguous and preserved answers before any fill", async () => {
  const { reviewFields, reviewCounts } =
    await import("../extension/review-state.mjs");
  const rows = reviewFields(
    [
      { label: "First name", value: "", type: "text" },
      {
        label: "First name",
        context: "Parent information",
        value: "",
        type: "text",
      },
      { label: "Email address", value: "existing@example.com", type: "email" },
    ],
    [
      { key: "givenNames", label: "First name", value: "Amira" },
      { key: "email", label: "Email", value: "new@example.com" },
    ],
  );
  assert.deepEqual(reviewCounts(rows), {
    suggested: 1,
    attention: 1,
    preserved: 1,
  });
  assert.deepEqual(
    rows.map((r) => r.selected),
    [true, false, false],
  );
});

test("repeated education and passport facts need a unique match and never leak into applicant names", async () => {
  const facts = [
    { key: "institution", sectionKey: "education", value: "Sample University" },
    { key: "number", sectionKey: "passports", value: "FAKE123" },
  ];
  assert.equal(
    matchField({ label: "Institution name" }, facts).fact.value,
    "Sample University",
  );
  assert.equal(
    matchField({ label: "Passport number" }, facts).fact.value,
    "FAKE123",
  );
  assert.equal(
    matchField({ label: "Institution name" }, [
      facts[0],
      { ...facts[0], value: "Other University" },
    ]),
    null,
  );
  assert.equal(
    matchField({ label: "First name", context: "Mother" }, [
      { key: "givenNames", value: "Amira" },
    ]),
    null,
  );
  const { answerQuestion } = await import("../extension/helper.mjs");
  assert.equal(
    answerQuestion("find passport number", {
      facts: [
        {
          key: "number",
          section: "Passports & identity",
          label: "Passport number",
          value: "FAKE123",
        },
      ],
    }).facts[0].value,
    "FAKE123",
  );
  assert.match(
    answerQuestion("submit this form", { facts }).text,
    /never submit/i,
  );
});
