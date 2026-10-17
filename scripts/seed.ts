import "../server/config.js";
const { seedNegotiation } = await import("../server/negotiation.js");
seedNegotiation(process.argv.includes("--reset"));
console.log(
  "Northstar negotiation ready: 38 Business sources, 33 Technical sources; append-only reset.",
);
