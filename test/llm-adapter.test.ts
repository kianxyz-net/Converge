import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
process.env.DATABASE_PATH = ":memory:";
const { seed } = await import("../server/seed.js");
const { principal, db } = await import("../server/store/db.js");
const { generate } = await import("../server/agents/turn.js");
seed();
test("Anthropic adapter retries once, executes a scoped tool, forces final output and logs prompts", async () => {
  let calls = 0;
  const requests: Record<string, unknown>[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    calls++;
    res.setHeader("Content-Type", "application/json");
    if (calls === 1) {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "retry" },
        }),
      );
      return;
    }
    const input =
      calls === 2
        ? {
            type: "tool_use",
            id: "tool-search",
            name: "search_context",
            input: { query: "private engineering notes CANARY" },
          }
        : {
            type: "tool_use",
            id: "tool-final",
            name: "respond",
            input: {
              answer_markdown: "Invented capability",
              source_ids: ["invented-record"],
              status: "answered",
            },
          };
    res.end(
      JSON.stringify({
        id: "msg-test",
        type: "message",
        role: "assistant",
        model: "mock-model",
        content: [input],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 15, output_tokens: 12 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  process.env.ANTHROPIC_API_KEY = "local-test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.LLM_MODE = "live";
  try {
    const result = await generate(
      principal("agent-sales")!,
      "northwind",
      "test-live-adapter",
      "What can I tell customers?",
      [],
    );
    assert.equal(result.answer.status, "needs_escalation");
    assert.equal(calls, 4);
    assert.ok(!JSON.stringify(requests).includes("CANARY-ENG-7F3A"));
    assert.ok(!JSON.stringify(result.manifest).includes("CANARY-ENG-7F3A"));
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM llm_calls").get() as { n: number })
        .n,
      3,
    );
    assert.equal(
      (requests.at(-1)!.tool_choice as { type: string }).type,
      "tool",
    );
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    process.env.LLM_MODE = "offline";
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
