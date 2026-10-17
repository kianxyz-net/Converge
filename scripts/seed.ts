import "../server/config.js";
const { seedHandoff } = await import("../server/handoff.js");
seedHandoff(process.argv.includes("--reset"));
console.log(
  "Three-team handoff ready: deterministic sources, empty approvals and releases.",
);
