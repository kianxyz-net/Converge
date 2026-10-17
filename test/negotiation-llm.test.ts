import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_PROMPTS = "true";
const n = await import("../server/negotiation.js");
const { principal } = await import("../server/store/db.js");
const store = await import("../server/store/visibility.js");
n.seedNegotiation();

test("structured LLM adapter uses only authorized retrieved evidence; ablation changes inputs; invalid quotations never stage", async () => {
  const requests: string[] = [];
  let fabricate = false;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    requests.push(raw);
    const body = JSON.parse(raw);
    assert.deepEqual(body.tool_choice, { type: "tool", name: "respond" });
    const content = String(body.messages[0].content),
      match = content.match(
        /<authorized_evidence>(.*?)<\/authorized_evidence>/s,
      )!;
    const evidence = JSON.parse(match[1]) as { id: string; text: string }[];
    const csv = evidence.find((s) => /CSV/i.test(s.text));
    const rest = evidence.find((s) => s !== csv)!;
    const picked = [
      csv || evidence[0],
      rest === evidence[0] && !csv ? evidence[1] : rest,
    ];
    const options = [
      {
        kind: "proposal",
        introduction:
          "Please review these proposed scope considerations before deciding on delivery.",
        arguments: picked.map((s, i) => ({
          id: "a" + i,
          text:
            i === 0 && csv
              ? "Consider the limited data evaluation supported by the retrieved customer communication."
              : "Review the available evaluation requirements before agreeing on scope.",
          evidence_candidates: [
            {
              source_id: s.id,
              exact_excerpt: fabricate
                ? "An invented quote from a customer"
                : s.text,
            },
          ],
        })),
      },
    ];
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "mock",
        type: "message",
        role: "assistant",
        model: "mock-model",
        content: [
          {
            type: "tool_use",
            id: "respond",
            name: "respond",
            input: { options },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.AGENT_MODE = "llm";
  process.env.ANTHROPIC_API_KEY = "local-sdk-mock-only";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const b = principal("business-member")!;
    const first = await n.draft(
      b,
      "Prepare the pilot using CSV evidence and client review constraints.",
    );
    assert.equal(first.type, "neg_draft");
    assert.equal(n.state(b).messages.length, 0);
    assert.ok(!requests[0].includes("T-INT-"));
    assert.ok(!requests[0].includes("evaluation_only_expected_discovery"));
    assert.ok(!requests[0].includes("possible_final_decision"));
    assert.ok(!requests[0].includes("$180"));
    for (const s of n
      .sources(b)
      .filter((s) => /CSV|scrubbed|anonymized/i.test(s.text))) {
      const id = n.runId() + ":" + s.id;
      const notice = store.append(b, {
        type: "retraction",
        channel_id: n.runId(),
        labels_mask: 2,
        text: "Ablation for adapter test",
        meta: { target_id: id },
      });
      store.withdraw(b, id, notice.id);
    }
    const second = await n.draft(
      b,
      "Prepare the pilot using CSV evidence and client review constraints.",
    );
    assert.notEqual(requests[0], requests[1]);
    assert.ok(!JSON.stringify(n.sources(b)).includes("anonymized CSV"));
    assert.notDeepEqual(first.meta.options, second.meta.options);
    const count = n.pending(b).length;
    fabricate = true;
    await assert.rejects(
      n.draft(b, "Prepare the pilot using current customer constraints"),
      /quotation/,
    );
    assert.equal(n.pending(b).length, count);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    process.env.AGENT_MODE = "rules";
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
