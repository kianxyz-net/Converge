import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
process.env.DATABASE_PATH = ":memory:";
const { seed } = await import("../server/seed.js");
const { principal } = await import("../server/store/db.js");
const store = await import("../server/store/visibility.js");
const sec = await import("../server/security.js");
seed();
const eng = principal("ava")!,
  sales = principal("priya")!;
test("label properties, retrieval and canaries are isolated", () => {
  for (let i = 0; i < 500; i++) {
    const mask = Math.floor(Math.random() * 8),
      clearance = Math.floor(Math.random() * 8);
    const p = { ...sales, clearance_mask: clearance };
    assert.equal(store.visible(mask, p), (mask & ~clearance) === 0);
  }
  for (const p of [eng, sales]) {
    const records = store.list(p);
    assert.ok(records.every((r) => store.visible(r.labels_mask, p)));
    const text =
      JSON.stringify(records) +
      JSON.stringify(
        store.retriever.search(p, "northwind", "on-prem CANARY deadline"),
      );
    assert.ok(
      !text.includes(
        p.team_id === "eng" ? "CANARY-SALES-91C2" : "CANARY-ENG-7F3A",
      ),
    );
    const mask = sec.unionLabels(records, p.clearance_mask);
    assert.equal(mask & ~p.clearance_mask, 0);
  }
});
test("events reject update and delete", () => {
  assert.throws(() => store.assertAppendOnly(eng), /append-only/);
  assert.throws(() => store.assertDeleteBlocked(eng), /append-only/);
});
test("only visibility.ts can contain SQL touching protected tables", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(dir + "/" + e.name) : [dir + "/" + e.name],
    );
  for (const f of ["server", "mcp", "scripts", "eval"].flatMap(walk)) {
    if (!f.endsWith(".ts") || f === "server/store/visibility.ts") continue;
    const text = readFileSync(f, "utf8");
    assert.ok(
      !/\b(?:FROM|JOIN|INTO|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ON)\s+(?:events|chunks|search)\b/i.test(
        text,
      ),
      f + " bypasses visibility gateway",
    );
  }
});
test("citations default to escalation and scanner blocks seeded leaks", () => {
  assert.equal(
    sec.validateCitations("answered", ["invented"], [], "sales").status,
    "needs_escalation",
  );
  assert.equal(sec.outboundScan(sales, "CANARY-ENG-7F3A", []).ok, false);
  assert.equal(sec.outboundScan(eng, "CANARY-SALES-91C2", []).ok, false);
  assert.equal(sec.outboundScan(sales, "I cannot confirm that.", []).ok, true);
});
test("randomized assembled contexts and SQL retrieval never exceed clearance", async () => {
  const { assemble } = await import("../server/agents/turn.js");
  const { db } = await import("../server/store/db.js");
  db.prepare("INSERT INTO channels VALUES(?,?,?,?)").run(
    "property",
    "Property",
    "Property",
    "ava",
  );
  const writer = { ...eng, id: "property-writer", clearance_mask: 3 };
  for (let i = 0; i < 120; i++)
    store.append(writer, {
      type: "ingest",
      channel_id: "property",
      labels_mask: Math.floor(Math.random() * 4),
      text: "property record " + i,
      meta: { kind: "brief" },
      index: true,
    });
  for (let i = 0; i < 120; i++) {
    const p = { ...sales, clearance_mask: Math.floor(Math.random() * 4) };
    const inputs = [
      ...assemble(p, "property", "property-chat"),
      ...store.retriever.search(p, "property", "property record"),
    ];
    assert.ok(inputs.every((r) => (r.labels_mask & ~p.clearance_mask) === 0));
    assert.equal(
      sec.unionLabels(inputs, p.clearance_mask) & ~p.clearance_mask,
      0,
    );
  }
});
