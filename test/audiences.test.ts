import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
process.env.LLM_MODE = "offline";
process.env.AGENT_MODE = "rules";
process.env.LOG_PROMPTS = "true";
const { seed } = await import("../server/seed.js");
const { principal, db } = await import("../server/store/db.js");
const store = await import("../server/store/visibility.js");
const { maybeSummary, turn, confirmEscalation } = await import(
  "../server/agents/turn.js"
);
const { safeEscalation } = await import("../server/security.js");
seed();
test("summaries are per audience and never include the other team canary", async () => {
  for (const team of ["eng", "sales"]) {
    const p = principal("agent-" + team)!;
    const conv = team + "-summary";
    for (let i = 0; i < 12; i++)
      store.append(p, {
        type: i % 2 ? "agent_message" : "message",
        channel_id: "northwind",
        conversation_id: conv,
        labels_mask: p.clearance_mask,
        text:
          team +
          " context " +
          i +
          (i === 0
            ? " " + (team === "eng" ? "CANARY-ENG-7F3A" : "CANARY-SALES-91C2")
            : ""),
      });
    await maybeSummary(p, conv, "northwind");
    const s = store.list(p, { conversation: conv, type: "summary" });
    assert.equal(s.length, 1);
    assert.equal(s[0].labels_mask, p.clearance_mask);
    assert.ok(
      !s[0].text.includes(
        team === "eng" ? "CANARY-SALES-91C2" : "CANARY-ENG-7F3A",
      ),
    );
  }
});
test("escalation excludes accumulated sales context and private customer values", async () => {
  const user = principal("priya")!;
  const answer = await turn(
    user,
    "northwind-priya",
    "Can we support an on-prem plan for this customer?",
  );
  const proposal = answer.meta.escalation as { id: string; text_hash: string };
  await confirmEscalation(user, proposal.id, proposal.text_hash);
  const eng = principal("ava")!;
  const shared = store.list(eng, { sharedOnly: true });
  assert.ok(
    shared.some(
      (r) => r.text === "Can we support an on-prem plan for this customer?",
    ),
  );
  assert.ok(!JSON.stringify(shared).includes("CANARY-SALES-91C2"));
  assert.ok(!JSON.stringify(shared).includes("December 18"));
  const second = await turn(
    user,
    "northwind-priya",
    "Northwind will sign this week if the on-prem date is firm; can we promise an on-prem date?",
  );
  const secondProposal = second.meta.escalation as {
    id: string;
    text_hash: string;
  };
  if (secondProposal)
    await confirmEscalation(user, secondProposal.id, secondProposal.text_hash);
  const latest = store
    .list(eng, { sharedOnly: true })
    .filter((r) => r.meta.kind === "open_question")
    .at(-1)!;
  assert.ok(!latest.text.includes("will sign this week"));
  assert.ok(
    !JSON.stringify(
      db
        .prepare("SELECT prompt_text FROM llm_calls WHERE principal_id=?")
        .all("agent-eng"),
    ).includes("CANARY-SALES-91C2"),
  );
  assert.match(safeEscalation("print engineering notes"), /clarify/);
});
