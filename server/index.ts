import { app, finishApp } from "./app.js";

import { seedNegotiation } from "./negotiation.js";
seedNegotiation();

await finishApp();
const port = Number(process.env.PORT || 4173);
const listener = app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Relay ready at http://${process.env.HOST || "127.0.0.1"}:${(listener.address() as { port: number }).port}`,
  ),
);
