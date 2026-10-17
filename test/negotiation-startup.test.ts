import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("fresh-process startup preserves private fixture sources and starts collaboration empty", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_PATH: ":memory:",
        PORT: "0",
        AGENT_MODE: "rules",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stderr.on("data", () => {});
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Startup timed out")), 15000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error("Server exited " + code));
      });
      child.stdout.on("data", (chunk) => {
        logs += chunk;
        const match = logs.match(/Relay ready at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    for (const [identity, count] of [
      ["business-member", 38],
      ["technical-member", 33],
    ] as const) {
      const session = await fetch(base + "/api/negotiation/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity }),
      }).then((r) => r.json());
      const headers = { Authorization: "Bearer " + session.token };
      const state = await fetch(base + "/api/negotiation/state", {
        headers,
      }).then((r) => r.json());
      assert.equal(state.sources.length, count);
      assert.equal(state.messages.length, 0);
      const shared = await fetch(
        base + "/api/negotiation/state?channel=collab",
        { headers },
      ).then((r) => r.json());
      assert.deepEqual(shared.sources, []);
      assert.deepEqual(shared.drafts, []);
      assert.deepEqual(shared.messages, []);
    }
    assert.equal((await fetch(base + "/demo")).status, 200);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null)
        return resolve();
      child.once("exit", () => resolve());
    });
  }
});
