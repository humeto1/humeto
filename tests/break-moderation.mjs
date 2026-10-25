import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localBreakRule,
  moderateBreakText,
} from "../src/lib/break-moderation.ts";
test("public break language rules reject profanity, obfuscation and contact details before calling AI", async () => {
  for (const text of [
    "f.u.c.k",
    "madarchod",
    "بہن چود",
    "https://example.com",
    "hello@work.example",
    "+92 300 1234567",
  ])
    assert.ok(localBreakRule(text), text);
  assert.equal(localBreakRule("A lovely day for a little break."), null);
  let called = false;
  assert.equal(
    (
      await moderateBreakText("f.u.c.k", async () => {
        called = true;
        throw Error("must not call");
      })
    ).allowed,
    false,
  );
  assert.equal(called, false);
});
test("public language classification fails closed on service failures, malformed responses or missing verdicts", async () => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "isolated-test-key";
  try {
    for (const payload of [
      { choices: [{ message: { content: '{"allowed":true}' } }] },
      { choices: [{ message: { content: '{"allowed":false}' } }] },
    ]) {
      const verdict = await moderateBreakText("A nice cup of tea.", async () =>
        Response.json(payload),
      );
      assert.equal(
        verdict.allowed,
        JSON.parse(payload.choices[0].message.content).allowed,
      );
    }
    await assert.rejects(() =>
      moderateBreakText("A nice cup of tea.", async () =>
        Response.json({}, { status: 503 }),
      ),
    );
    await assert.rejects(() =>
      moderateBreakText("A nice cup of tea.", async () =>
        Response.json({ choices: [{ message: { content: '{"foo":true}' } }] }),
      ),
    );
    await assert.rejects(() =>
      moderateBreakText("A nice cup of tea.", async () =>
        Response.json({ choices: [{ message: { content: "invalid json" } }] }),
      ),
    );
  } finally {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  }
});
