import type { Response } from "express";
import type { Principal } from "./types.js";
import { list } from "./store/visibility.js";
const clients = new Set<{ p: Principal; res: Response; seq: number }>();
export function subscribe(p: Principal, res: Response, after: number) {
  const client = { p, res, seq: after };
  clients.add(client);
  res.on("close", () => clients.delete(client));
  flushClient(client);
  return client;
}
function flushClient(c: { p: Principal; res: Response; seq: number }) {
  for (const e of list(c.p, { after: c.seq, limit: 100000 })) {
    c.res.write(`id: ${e.seq}\nevent: record\ndata: ${JSON.stringify(e)}\n\n`);
    c.seq = e.seq;
  }
}
export function flush() {
  for (const c of clients) flushClient(c);
}
export function step(
  p: Principal,
  conversation: string,
  status: "retrieving" | "drafting" | "validating" | "idle",
) {
  for (const c of clients)
    if (c.p.id === p.id)
      c.res.write(
        `event: step\ndata: ${JSON.stringify({ conversation_id: conversation, status })}\n\n`,
      );
}
