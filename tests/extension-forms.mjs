import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { matchField, prepareValue } from "../extension/matcher.mjs";
test("split dates use exact saved calendar dates and label-matched dropdowns", () => {
  const facts = [
    { key: "birthDate", sectionKey: "identity", value: "2001-09-12" },
  ];
  for (const [label, expected] of [
    ["Day", "12"],
    ["Month", "9"],
    ["Year", "2001"],
  ]) {
    const field = { label, context: "Date of birth", type: "number" };
    assert.equal(matchField(field, facts)?.fact, facts[0]);
    assert.equal(prepareValue(field, facts[0]), expected);
  }
  const field = {
    label: "Month",
    context: "Date of birth",
    type: "select",
    options: [
      { value: "8", label: "September" },
      { value: "9", label: "October" },
    ],
  };
  assert.equal(prepareValue(field, facts[0]), "September");
  assert.equal(
    prepareValue(
      { ...field, options: [{ value: "x", label: "Choose a month" }] },
      facts[0],
    ),
    null,
  );
  assert.equal(prepareValue(field, { ...facts[0], value: "2001-02-30" }), null);
  assert.equal(
    matchField({ label: "Day", context: "Date of birth" }, [
      ...facts,
      { ...facts[0], value: "2002-09-12" },
    ]),
    null,
  );
  assert.equal(
    matchField({ label: "Year", context: "Passport details · Expiry date" }, [
      { key: "expiryDate", sectionKey: "passports", value: "2030-08-17" },
    ]).fact.value,
    "2030-08-17",
  );
});
test("family and referee mapping requires the right relationship and preserves repeated-record ambiguity", () => {
  const facts = [
    { key: "givenNames", sectionKey: "identity", value: "Applicant" },
    {
      key: "relationship",
      sectionKey: "family",
      recordIndex: 0,
      value: "Spouse / partner",
    },
    {
      key: "givenNames",
      sectionKey: "family",
      recordIndex: 0,
      value: "Samira",
    },
    {
      key: "relationship",
      sectionKey: "family",
      recordIndex: 1,
      value: "Parent",
    },
    {
      key: "givenNames",
      sectionKey: "family",
      recordIndex: 1,
      value: "Parent Name",
    },
    {
      key: "relationship",
      sectionKey: "references",
      recordIndex: 0,
      value: "Academic supervisor",
    },
    {
      key: "email",
      sectionKey: "references",
      recordIndex: 0,
      value: "referee@example.com",
    },
  ];
  assert.equal(
    matchField({ label: "First name", context: "Spouse details" }, facts)?.fact
      .value,
    "Samira",
  );
  assert.equal(
    matchField({ label: "First name", context: "Mother details" }, facts),
    null,
  );
  assert.equal(
    matchField({ label: "First name" }, facts)?.fact.value,
    "Applicant",
  );
  assert.equal(
    matchField({ label: "Email address", context: "Academic referee" }, facts)
      ?.fact.value,
    "referee@example.com",
  );
  assert.equal(
    matchField({ label: "First name", context: "Spouse details" }, [
      ...facts,
      {
        key: "givenNames",
        sectionKey: "family",
        recordIndex: 0,
        value: "Other",
      },
    ]),
    null,
  );
  assert.equal(
    matchField(
      { label: "I agree to share referee data", context: "Academic referee" },
      facts,
    ),
    null,
  );
});
test("native controls in same-origin frames and open shadow roots fill safely; custom and inaccessible fields stay manual", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<fieldset><legend>Date of birth</legend><label>Day<input name="day" autocomplete="bday-day"></label><label>Month<select name="month"><option value="">Choose</option><option value="8">September</option><option value="9">October</option></select></label><label>Year<input name="year" autocomplete="bday-year"></label></fieldset><div id="shadow"></div><label>Institution<input name="custom" role="combobox"></label><iframe title="Application details" srcdoc='<label>First name<input name="given" autocomplete="given-name"></label>'></iframe><fieldset><legend>Mother details</legend><iframe title="Mother contact" srcdoc='<label>First name<input name="parent"></label>'></iframe></fieldset><iframe sandbox srcdoc='<input name="untrusted">'></iframe><button type="submit" id="submit">Submit</button>`,
    );
    await page.evaluate(() => {
      document
        .querySelector("#shadow")
        .attachShadow({ mode: "open" }).innerHTML =
        '<label>Last name<input name="surname" autocomplete="family-name"></label>';
      window.chrome = {
        runtime: {
          id: "fixture",
          onMessage: { addListener: (fn) => (window.humetoListener = fn) },
        },
      };
      window.submitted = false;
      document.querySelector("#submit").onclick = () =>
        (window.submitted = true);
    });
    await page.addScriptTag({ path: resolve("extension/content.js") });
    const send = (msg) =>
      page.evaluate(
        (msg) =>
          new Promise((resolve) =>
            window.humetoListener(msg, { id: "fixture" }, resolve),
          ),
        msg,
      );
    let scan = await send({ type: "HUMETO_SCAN" });
    assert.equal(scan.skippedFrames, 1);
    assert.equal(scan.unsupportedControls, 1);
    assert.ok(!scan.fields.some((f) => f.name === "custom"));
    assert.ok(
      scan.fields.find((f) => f.name === "given").location.includes("frame"),
    );
    assert.ok(
      scan.fields.find((f) => f.name === "surname").location.includes("shadow"),
    );
    const facts = [
      { key: "birthDate", value: "2001-09-12" },
      { key: "givenNames", value: "Amira" },
      { key: "familyName", value: "Shah" },
    ];
    const items = scan.fields
      .map((f) => {
        const match = matchField(f, facts);
        return match
          ? { id: f.id, label: f.label, value: prepareValue(f, match.fact) }
          : null;
      })
      .filter(Boolean);
    const result = await send({ type: "HUMETO_FILL", url: scan.url, items });
    assert.equal(result.results.filter((r) => r.ok).length, 5);
    assert.equal(await page.locator("[name=month]").inputValue(), "8");
    assert.equal(
      await page
        .frameLocator('iframe[title="Application details"]')
        .locator("[name=given]")
        .inputValue(),
      "Amira",
    );
    assert.equal(await page.locator("[name=surname]").inputValue(), "Shah");
    assert.equal(await page.evaluate(() => window.submitted), false);
    assert.equal(
      await page
        .frameLocator('iframe[title="Mother contact"]')
        .locator("[name=parent]")
        .inputValue(),
      "",
    );
    assert.ok(
      scan.fields.find((f) => f.name === "parent").context.includes("Mother"),
    );
    await page.locator("[name=month]").selectOption("");
    scan = await send({ type: "HUMETO_SCAN" });
    const month = scan.fields.find((f) => f.name === "month");
    await page
      .locator("[name=month]")
      .evaluate((el) => (el.options[1].text = "Changed"));
    assert.equal(
      (
        await send({
          type: "HUMETO_FILL",
          url: scan.url,
          items: [{ id: month.id, label: month.label, value: "September" }],
        })
      ).results[0].ok,
      false,
    );
    scan = await send({ type: "HUMETO_SCAN" });
    const given = scan.fields.find((f) => f.name === "given");
    await page
      .locator('iframe[title="Application details"]')
      .evaluate(
        (el) => (el.srcdoc = '<label>First name<input name="given"></label>'),
      );
    await page
      .frameLocator('iframe[title="Application details"]')
      .locator("[name=given]")
      .waitFor();
    assert.equal(
      (
        await send({
          type: "HUMETO_FILL",
          url: scan.url,
          items: [{ id: given.id, label: given.label, value: "Wrong" }],
        })
      ).results[0].ok,
      false,
    );
  } finally {
    await browser.close();
  }
});

test("shipped practice portal exposes embedded contact under DENY framing headers", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://practice.example/**", route => route.fulfill({
      contentType: "text/html", headers: { "X-Frame-Options": "DENY" },
      body: readFileSync(resolve("public/test-application-advanced.html"), "utf8"),
    }));
    await page.goto("https://practice.example/form");
    await page.frameLocator("iframe").locator("[name=frame_email]").waitFor();
    await page.evaluate(() => {
      window.chrome = { runtime: { id: "fixture", onMessage: { addListener: fn => window.humetoListener = fn } } };
    });
    await page.addScriptTag({ path: resolve("extension/content.js") });
    const scan = await page.evaluate(() => new Promise(resolve => window.humetoListener({ type: "HUMETO_SCAN" }, { id: "fixture" }, resolve)));
    assert.equal(scan.skippedFrames, 0);
    assert.equal(scan.fields.length, 12);
    assert.equal(scan.unsupportedControls, 1);
    assert.ok(scan.fields.find(field => field.name === "frame_email").location.includes("frame"));
  } finally { await browser.close(); }
});
