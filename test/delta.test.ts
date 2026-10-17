import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
process.env.LLM_MODE = "offline";
process.env.AGENT_MODE = "rules";
process.env.LOG_PROMPTS = "true";
const { seed } = await import("../server/seed.js");
const { principal, db } = await import("../server/store/db.js");
const { syncGitHub, githubMask } = await import(
  "../server/connectors/github.js"
);
const { getDelta, deliverDigest } = await import("../server/delta.js");
const store = await import("../server/store/visibility.js");
seed();
const eng = principal("ava")!,
  sales = principal("priya")!;
test("GitHub deterministic labels and digest cursor semantics", async () => {
  const result = await syncGitHub(eng, "northwind");
  assert.equal(result.count, 9);
  assert.equal((await syncGitHub(eng, "northwind")).count, 0);
  assert.equal(store.list(sales, { type: "pr" }).length, 3);
  assert.equal(store.list(eng, { type: "pr" }).length, 9);
  const open = {
    number: 1,
    title: "",
    body: "",
    labels: ["customer-facing"],
    merged: false,
    base: "main",
    merge_sha: null,
    url: "",
  };
  assert.equal(githubMask(open), 1);
  assert.equal(githubMask({ ...open, merged: true }), 0);
  assert.equal(getDelta(sales, "northwind").records.length, 3);
  assert.equal(db.prepare("SELECT * FROM cursors").all().length, 0);
  const digest = await deliverDigest(sales, "northwind");
  assert.equal(digest.refs.length, 3);
  assert.match(String(digest.meta.compare_url), /compare\/.+\.\.\./);
  assert.equal(getDelta(sales, "northwind").records.length, 0);
  assert.equal(getDelta(eng, "northwind").records.length, 3);
  assert.match((await deliverDigest(sales, "northwind")).text, /No new/);
  assert.ok(!JSON.stringify(store.list(sales)).includes("CANARY-ENG-7F3A"));
});
