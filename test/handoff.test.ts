import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
process.env.DATABASE_PATH = ":memory:";
process.env.AGENT_MODE = "rules";
process.env.LOG_PROMPTS = "true";
const h = await import("../server/handoff.js");
const { runScenario } = await import("../server/handoff-checks.js");
const { db, principal, hash } = await import("../server/store/db.js");
const store = await import("../server/store/visibility.js");
const { issueToken } = await import("../server/auth.js");
const { app, finishApp } = await import("../server/app.js");
h.seedHandoff();
const sales = h.actor("demo-sales"),
  eng = h.actor("demo-engineer"),
  infra = h.actor("demo-infra");

test("rate-limit citations, third-team isolation and exact revision approval/release complete the handoff", async () => {
  const a = await h.answer(
    sales,
    "What are the rate limits for enterprise customers?",
  );
  assert.equal(a.status, "answered");
  for (const id of ["DOC-001", "PR-412"])
    assert.ok(a.citations.some((c) => c.source_id === id));
  for (const fact of [
    "5,000",
    "per API key",
    "2x for 10 seconds",
    "429",
    "Retry-After",
  ])
    assert.ok(a.text.includes(fact));
  const ch = h.currentChannel();
  for (const [p, notAllowed] of [
    [sales, [1, 4]],
    [eng, [2, 4]],
    [infra, [1, 2]],
  ] as const) {
    const s = h.snapshot(p);
    assert.ok(
      s.sources.every((r) => !notAllowed.includes(r.labels_mask as never)),
    );
    for (const hidden of h.seeded.filter((s) => !store.visible(s.mask, p)))
      assert.equal(h.getSource(p, `${ch}:${hidden.id}`), undefined);
  }
  const query = await h.answer(sales, "When will on-prem support launch?");
  assert.equal(query.status, "needs_escalation");
  assert.ok(query.escalation);
  assert.equal(h.drafts(eng).length, 0);
  await h.confirmEscalation(
    sales,
    query.escalation!.id,
    query.escalation!.hash,
  );
  let d = h.drafts(eng)[0];
  assert.equal(d.state, "staged");
  assert.equal(h.snapshot(sales).artifacts.length, 0);
  assert.equal(h.drafts(sales).length, 0);
  const original = store.get(eng, `${ch}:ENG-ROADMAP`)!;
  assert.throws(() => h.approveDraft(eng, d.id, d.hash), /placeholder/);
  assert.throws(
    () => h.approveDraft({ ...eng, authority_mask: 0 }, d.id, d.hash),
    /authority/,
  );
  const text = "On-prem support is tentative. No launch date is committed.";
  h.editDraft(eng, d.id, text, d.hash);
  d = h.drafts(eng)[0];
  assert.throws(() => h.releaseDraft(eng, d.id, d.hash), /approved again/);
  h.approveDraft(eng, d.id, d.hash);
  assert.equal(h.snapshot(sales).artifacts.length, 0);
  const revision = text + " Availability remains uncommitted.";
  h.editDraft(eng, d.id, revision, d.hash);
  const changed = h.drafts(eng)[0];
  assert.equal(changed.state, "staged");
  assert.equal(changed.approver, null);
  assert.throws(() => h.releaseDraft(eng, d.id, d.hash), /approved again/);
  h.approveDraft(eng, d.id, changed.hash);
  const released = h.releaseDraft(eng, d.id, changed.hash);
  assert.equal(released.text, revision);
  assert.equal(released.hash, hash(revision));
  assert.ok(!("refs" in released));
  assert.ok(!("manifest" in released));
  assert.ok(!JSON.stringify(released).includes("CANARY"));
  const follow = await h.answer(sales, "When will on-prem support launch?");
  assert.equal(follow.status, "answered");
  assert.ok(follow.citations.some((c) => c.id === released.id));
  assert.equal(store.get(eng, original.id)!.hash, original.hash);
  assert.throws(
    () => h.editDraft(eng, d.id, "changed", changed.hash),
    /immutable/,
  );
  const prompts = db
    .prepare(
      "SELECT prompt_text FROM llm_calls WHERE principal_id='agent-sales'",
    )
    .all() as { prompt_text: string }[];
  assert.ok(!JSON.stringify(prompts).includes("CANARY-ENG"));
  assert.ok(!JSON.stringify(prompts).includes("CANARY-INFRA"));
  h.seedHandoff(true);
  assert.equal(h.drafts(eng).length, 0);
  assert.equal(h.snapshot(sales).artifacts.length, 0);
  assert.equal(h.snapshot(sales).questions.length, 0);
  assert.ok(store.get(eng, original.id));
});

test("all eight visible security scenarios execute real checks and return sanitized outcomes", async () => {
  const current = h.currentChannel();
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H"] as const) {
    const r = await runScenario(id);
    assert.equal(r.passed, true, JSON.stringify(r));
    assert.ok(r.checks.length > 0);
    assert.ok(r.checks.every((c) => c.passed));
    assert.ok(!JSON.stringify(r).includes("CANARY-"));
    assert.equal(h.currentChannel(), current);
  }
  assert.equal(
    (await runScenario("G")).passed,
    true,
    "approval checks stay repeatable after earlier releases",
  );
  assert.equal(
    (await runScenario("G")).passed,
    true,
    "retired scratch transcripts do not affect a new run",
  );
  // A broken backend must produce a visible failure, not a hardcoded passing badge.
  const original = store.retriever.search;
  store.retriever.search = () => {
    throw Error("injected test fault");
  };
  try {
    const bad = await runScenario("A");
    assert.equal(bad.passed, false);
    assert.ok(bad.checks.some((c) => !c.passed));
  } finally {
    store.retriever.search = original;
  }
});

test("HTTP identity, source, hash and authority overrides are rejected", async () => {
  await finishApp(false);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const tokens = {
    sales: issueToken(sales.id).token,
    eng: issueToken(eng.id).token,
    infra: issueToken(infra.id).token,
    agent: issueToken("agent-eng").token,
    mcp: issueToken(eng.id, "mcp").token,
  };
  const call = async (path: string, token = tokens.sales, body?: unknown) => {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    assert.equal(
      (
        await call("/api/handoff/session", tokens.sales, {
          identity: "demo-sales",
          clearance_mask: 7,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/api/handoff/ask", tokens.sales, {
          text: "enterprise rate limits",
          team: "eng",
        })
      ).status,
      400,
    );
    const reflected = await call("/api/handoff/session", tokens.sales, {
      identity: "CANARY-ENG-7F3A",
    });
    assert.equal(reflected.status, 400);
    assert.ok(!JSON.stringify(reflected.body).includes("CANARY-"));
    const ch = h.currentChannel();
    for (const id of ["ENG-ROADMAP", "PR-419", "INFRA-NOTE"]) {
      const r = await call(
        "/api/handoff/sources/" + encodeURIComponent(`${ch}:${id}`),
      );
      assert.equal(r.status, 404);
      assert.ok(!JSON.stringify(r).includes("CANARY"));
    }
    const overridden = await call(
      "/api/handoff/state?team=infra&clearance_mask=7",
    );
    assert.equal(overridden.body.team, "sales");
    assert.ok(!JSON.stringify(overridden.body).includes("CANARY-INFRA"));
    const asked = await call("/api/handoff/ask", tokens.sales, {
      text: "When will on-prem support launch?",
    });
    const e = asked.body.escalation;
    assert.equal(
      (
        await call("/api/handoff/escalate", tokens.sales, {
          id: e.id,
          hash: e.hash,
          confirmed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/api/handoff/escalate", tokens.sales, {
          id: e.id,
          hash: e.hash,
          confirmed: true,
        })
      ).status,
      200,
    );
    let d = h.drafts(eng)[0];
    for (const token of [tokens.sales, tokens.infra, tokens.agent, tokens.mcp])
      for (const action of ["approve", "release"])
        assert.equal(
          (
            await call(`/api/handoff/drafts/${d.id}/${action}`, token, {
              hash: d.hash,
              confirmed: true,
            })
          ).status,
          403,
        );
    assert.equal(
      (
        await call(`/api/releases/${d.id}/approve`, tokens.eng, {
          text: "bypass",
          hash: d.hash,
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/auth/operator", tokens.eng, {})).status,
      403,
    );
    const safe = "On-prem support has no committed launch date.";
    assert.equal(
      (
        await call(`/api/handoff/drafts/${d.id}/edit`, tokens.eng, {
          text: safe,
          hash: hash("wrong"),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(`/api/handoff/drafts/${d.id}/edit`, tokens.eng, {
          text: safe,
          hash: d.hash,
        })
      ).status,
      200,
    );
    d = h.drafts(eng)[0];
    assert.equal(
      (
        await call(`/api/handoff/drafts/${d.id}/approve`, tokens.eng, {
          hash: d.hash,
          confirmed: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(`/api/handoff/drafts/${d.id}/edit`, tokens.eng, {
          text: safe + " Scope is tentative.",
          hash: d.hash,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(`/api/handoff/drafts/${d.id}/release`, tokens.eng, {
          hash: d.hash,
          confirmed: true,
        })
      ).status,
      409,
    );
    const results = await call("/api/handoff/security", tokens.sales, {
      scenario: "H",
    });
    assert.equal(results.status, 200);
    assert.equal(results.body.results[0].passed, true);
    assert.ok(!JSON.stringify(results.body).includes("CANARY-"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("conflicting or stale authorized rate-limit sources cannot produce a verified answer", async () => {
  const channel = h.createFixtureChannel("conflict-test");
  store.append(eng, {
    type: "ingest",
    channel_id: channel,
    labels_mask: 0,
    text: "Enterprise limits are 6,000 requests per minute per API key.",
    meta: { kind: "document", status: "approved" },
    index: true,
  });
  const conflict = await h.answer(
    sales,
    "What are the enterprise rate limits?",
    channel,
    true,
  );
  assert.equal(conflict.status, "needs_escalation");
  assert.match(conflict.text, /conflict|stale/);
  const staleChannel = h.createFixtureChannel("stale-test");
  store.append(eng, {
    type: "ingest",
    channel_id: staleChannel,
    labels_mask: 0,
    text: "Enterprise rate-limit policy requires review.",
    meta: { kind: "document", status: "stale" },
    index: true,
  });
  const stale = await h.answer(
    sales,
    "What are the enterprise rate limits?",
    staleChannel,
    true,
  );
  assert.equal(stale.status, "needs_escalation");
});
