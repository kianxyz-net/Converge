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
  process.env.LLM_MODE = "live";process.env.AGENT_MODE="llm";process.env.LOG_PROMPTS="true";
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
    process.env.LLM_MODE = "offline";process.env.AGENT_MODE="rules";process.env.LOG_PROMPTS="true";
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('live adapter backstop escalates uncited commitments and replaces Engineering dates with placeholders',async()=>{const server=http.createServer(async(req,res)=>{for await(const _chunk of req){}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'msg-risk',type:'message',role:'assistant',model:'mock-model',content:[{type:'tool_use',id:'respond-risk',name:'respond',input:{answer_markdown:'On-prem will ship on 2027-04-01 for $999.',source_ids:['brief-northwind'],status:'answered',high_risk_fields:[]}}],stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:10,output_tokens:10}}))});server.listen(0,'127.0.0.1');await once(server,'listening');process.env.AGENT_MODE='llm';process.env.ANTHROPIC_API_KEY='local-test-key';process.env.ANTHROPIC_BASE_URL=`http://127.0.0.1:${(server.address()as {port:number}).port}`;try{const store=await import('../server/store/visibility.js');const brief=store.get(principal('agent-sales')!,'brief-northwind')!;const sales=await generate(principal('agent-sales')!,'northwind','risk-sales','What is our on-prem delivery commitment?',[brief]);assert.equal(sales.answer.status,'needs_escalation');assert.ok(!sales.answer.answer_markdown.includes('2027-04-01'));const eng=await generate(principal('agent-eng')!,'northwind','risk-eng','What is our on-prem delivery commitment?',[brief]);assert.ok(eng.answer.answer_markdown.includes('[DATE]'));assert.ok(eng.answer.answer_markdown.includes('[PRICE]'));assert.ok(!eng.answer.answer_markdown.includes('2027-04-01'));assert.ok(!eng.answer.answer_markdown.includes('$999'))}finally{delete process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_BASE_URL;process.env.AGENT_MODE='rules';server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}})
