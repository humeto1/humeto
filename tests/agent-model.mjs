import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

if (!process.env.HUMETO_MODEL_TEST_CHILD) {
  test("OpenAI model adapter contract", () => {
    execFileSync(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", import.meta.filename],
      { env: { ...process.env, HUMETO_MODEL_TEST_CHILD: "1" }, stdio: "pipe" },
    );
  });
} else {
  const { interpret } = await import("../src/lib/agent/model.ts");
  const { parseLocal } = await import("../src/lib/agent/parser.ts");
  test("OpenAI uses only the approved model and validates its output; rejected key cannot apply actions", async () => {
    const previous = { ...process.env };
    const original = globalThis.fetch;
    try {
      process.env.HUMETO_AGENT_PROVIDER = "openai";
      process.env.CHATGPT_HUMETO_API = "fake-test-key";
      process.env.HUMETO_AGENT_MODEL = "disallowed-model";
      const intent = parseLocal("Create a task to review sample");
      globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        assert.equal(body.model, "gpt-5.4-mini");
        assert.equal(body.store, false);
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(intent) },
              },
            ],
          }),
        );
      };
      const context = {
        timezone: "Asia/Karachi",
        now: "2026-10-23T05:00:00Z",
        tasks: [],
        history: [],
      };
      assert.deepEqual(
        await interpret("Create a task to review sample", context),
        intent,
      );
      globalThis.fetch = async () => new Response("{}", { status: 401 });
      await assert.rejects(
        () => interpret("hello", context),
        /rejected the configured API key/,
      );
    } finally {
      globalThis.fetch = original;
      for (const k of Object.keys(process.env))
        if (!(k in previous)) delete process.env[k];
      Object.assign(process.env, previous);
    }
  });
}
