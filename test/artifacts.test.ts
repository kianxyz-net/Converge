import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
process.env.DATABASE_PATH = ":memory:";
process.env.AGENT_MODE = "rules";
const { seed } = await import("../server/seed.js");
const { principal, hash, db } = await import("../server/store/db.js");
const core = await import("../server/core.js");
const { artifacts, artifactHistory } = await import("../server/artifacts.js");
const { app, finishApp } = await import("../server/app.js");
seed();

test("artifact versions, hashes and history respect audience and retraction", () => {
  const eng = principal("ava")!,
    sales = principal("priya")!;
  const one = core.upload(
    eng,
    "northwind",
    "Guide.txt",
    "Customer limits are per key.",
  );
  core.releaseDocument(eng, one, true, hash("Customer limits are per key."));
  core.upload(
    eng,
    "northwind",
    "Guide.txt",
    "Private second revision CANARY-ENG-7F3A",
  );
  const visible = artifacts(sales, "northwind").filter(
    (a) => a.title === "Guide.txt",
  );
  assert.equal(visible.length, 1);
  assert.equal(visible[0].version, 1);
  assert.equal(visible[0].hash, hash("Customer limits are per key."));
  assert.ok(
    !JSON.stringify(artifacts(sales, "northwind")).includes("CANARY-ENG"),
  );
  const own = artifacts(eng, "northwind").filter(
    (a) => a.title === "Guide.txt" && a.labels_mask === 1,
  );
  assert.deepEqual(
    own.map((a) => a.version),
    [2, 1],
  );
  const history = artifactHistory(sales, visible[0].id)!;
  assert.ok(history.every((e) => e.labels_mask === 0));
  assert.equal(artifactHistory(sales, own[0].id), null);
  core.retract(eng, visible[0].id);
  assert.equal(
    artifacts(sales, "northwind").find((a) => a.id === visible[0].id)?.status,
    "retracted",
  );
  assert.ok(
    artifactHistory(sales, visible[0].id)!.some((e) => e.type === "retraction"),
  );
});

test("staged answers stay private; approved artifacts reveal only released evidence", async () => {
  const store = await import("../server/store/visibility.js");
  const eng = principal("ava")!,
    sales = principal("priya")!;
  const draft = store.append(eng, {
    type: "release_draft",
    channel_id: "northwind",
    labels_mask: 1,
    text: "Review this draft",
    refs: [],
    meta: {},
  });
  const releaseId = core.draftRelease(
    eng,
    "answer",
    draft,
    "Review this draft",
  );
  assert.equal(
    artifacts(eng, "northwind").find((a) => a.id === draft.id)?.status,
    "staged",
  );
  assert.ok(!artifacts(sales, "northwind").some((a) => a.id === draft.id));
  const text = "The approved answer is available for review.";
  const approved = core.approve(
    eng,
    releaseId,
    text,
    hash(text),
    hash("Review this draft"),
  );
  const artifact = artifacts(sales, "northwind").find(
    (a) => a.id === approved.id,
  )!;
  assert.equal(artifact.text, text);
  assert.equal(artifact.hash, hash(text));
  assert.equal(artifact.status, "released");
  assert.equal(artifact.approved_by, "ava");
  assert.deepEqual(artifact.source_ids, []);
  assert.ok(
    !artifactHistory(sales, approved.id)!.some((e) => e.id === draft.id),
  );
  assert.ok(
    artifactHistory(eng, approved.id)!.some((e) => e.type === "declassify"),
  );
});

test("inspection is audited, operator exchange requires a human Engineering reviewer", async () => {
  await finishApp(false);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const call = async (path: string, token?: string, body?: unknown) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const sales = (
      await (await call("/auth/switch", undefined, { user_id: "priya" })).json()
    ).token;
    const eng = (
      await (await call("/auth/switch", undefined, { user_id: "ava" })).json()
    ).token;
    assert.equal((await call("/auth/operator", undefined, {})).status, 401);
    assert.equal((await call("/auth/operator", sales, {})).status, 403);
    assert.equal((await call("/auth/operator", eng, {})).status, 200);
    const mcp = (await (await call("/auth/mcp-token", eng, {})).json()).token;
    assert.equal((await call("/auth/operator", mcp, {})).status, 403);
    const hidden = artifacts(principal("ava")!, "northwind").find(
      (a) => a.labels_mask === 1,
    )!;
    assert.equal((await call("/records/" + hidden.id, sales)).status, 404);
    assert.equal(
      (await call("/artifacts/" + hidden.id + "/history", sales)).status,
      404,
    );
    assert.equal(
      (await call("/events/" + hidden.id + "/inspect", sales)).status,
      404,
    );
    const logs = db
      .prepare("SELECT action FROM audit WHERE principal_id='priya'")
      .all() as { action: string }[];
    for (const action of [
      "inspect_record",
      "inspect_history",
      "inspect_manifest",
    ])
      assert.ok(logs.some((l) => l.action === action + ":" + hidden.id));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
