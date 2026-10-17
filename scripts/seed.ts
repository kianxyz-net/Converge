import "../server/config.js";
import { existsSync, unlinkSync } from "node:fs";
if (process.argv.includes("--reset")) {
  const file = process.env.DATABASE_PATH || ".data/relay.sqlite";
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(file + suffix)) unlinkSync(file + suffix);
}
const { seed } = await import("../server/seed.js");
seed();
const { syncGitHub } = await import("../server/connectors/github.js");
const { principal } = await import("../server/store/db.js");
await syncGitHub(principal("ava")!, "northwind");
console.log("Relay demo seeded (idempotent).");
