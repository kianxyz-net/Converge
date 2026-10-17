import type { Express, Request, Response } from "express";
import { z } from "zod";
import { fromToken, issueToken, requireHuman } from "./auth.js";
import type { Principal } from "./types.js";
import * as n from "./negotiation.js";
import * as store from "./store/visibility.js";
import { flush } from "./realtime.js";
const text = z.string().trim().min(1).max(5000);
const selection = z
  .object({
    option: z.number().int().min(0).max(1),
    argument_ids: z.array(z.string()).min(1).max(4),
    evidence_keys: z.array(z.string()).max(12),
  })
  .strict();
export function mountNegotiation(app: Express) {
  const route = (
    method: "get" | "post",
    path: string,
    fn: (req: Request, res: Response, p: Principal) => unknown,
  ) =>
    app[method]("/api/negotiation" + path, (req, res, next) => {
      const p = fromToken(req.headers.authorization?.replace(/^Bearer /, ""));
      if (!p) return res.status(401).json({ error: "Select a demo identity" });
      Promise.resolve()
        .then(() => {
          n.teamOf(p);
          return fn(req, res, p);
        })
        .then(() => flush())
        .catch(next);
    });
  app.post("/api/negotiation/session", (req, res, next) => {
    try {
      n.seedNegotiation();
      const v = z
        .object({ identity: z.enum(["business-member", "technical-member"]) })
        .strict()
        .parse(req.body);
      res.json(issueToken(v.identity));
    } catch (e) {
      next(e);
    }
  });
  route("get", "/state", (req, res, p) =>
    res.json(
      n.state(
        p,
        z
          .enum(["team-b", "team-t", "collab"])
          .optional()
          .parse(req.query.channel),
      ),
    ),
  );
  route("get", "/sources/:id", (req, res, p) => {
    const s = n.inspectSource(p, String(req.params.id));
    if (!s)
      return res.status(404).json({ error: "Source not visible to your team" });
    res.json(s);
  });
  route("post", "/messages", async (req, res, p) => {
    const v = z
      .object({
        channel: z.enum(["team-b", "team-t", "collab"]),
        text,
        confirmed: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    res.json({ draft: await n.message(p, v.channel, v.text, v.confirmed) });
  });
  route("post", "/drafts", async (req, res, p) => {
    requireHuman(p);
    const v = z
      .object({ text, topic_id: z.string().optional() })
      .strict()
      .parse(req.body);
    res.json(await n.draft(p, v.text, v.topic_id));
  });
  route("post", "/drafts/:id/preview", (req, res, p) =>
    res.json(n.preview(p, String(req.params.id), selection.parse(req.body))),
  );
  route("post", "/drafts/:id/publish", async (req, res, p) => {
    const v = z
      .object({
        selection,
        hash: z.string().length(64),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    res.json(await n.publish(p, String(req.params.id), v.selection, v.hash));
  });
  route("post", "/drafts/:id/discard", (req, res, p) => {
    z.object({}).strict().parse(req.body);
    n.discard(p, String(req.params.id));
    res.json({ ok: true });
  });
  route("post", "/decisions", (req, res, p) => {
    const v = z
      .object({
        text,
        conditional: z.boolean().default(true),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    res.json(n.proposeDecision(p, v.text, v.conditional));
  });
  route("post", "/decisions/:id/approve", (req, res, p) => {
    const v = z
      .object({
        hash: z.string().length(64),
        confirmed: z.literal(true),
        conditions_resolved: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    res.json(
      n.approveDecision(
        p,
        String(req.params.id),
        v.hash,
        v.conditions_resolved,
      ),
    );
  });
  route("post", "/reset", (req, res, p) => {
    requireHuman(p, p.authority_mask);
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json({ run_id: n.seedNegotiation(true) });
  });
  // Refresh notifications contain no source/draft text. Each reconnect reloads a scoped snapshot.
  route("get", "/stream", (req, res, p) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    let seq = Number(req.headers["last-event-id"] || 0),
      run = "";
    const poll = () => {
      const current = n.runId();
      const rows = store.list(p, {
        channel: current,
        after: Number.isSafeInteger(seq) && seq >= 0 ? seq : 0,
        limit: 100000,
      });
      if (rows.length || run !== current) {
        seq = rows.at(-1)?.seq || seq;
        run = current;
        res.write(`id: ${seq}\nevent: refresh\ndata: {"refresh":true}\n\n`);
      }
    };
    poll();
    const timer = setInterval(poll, 800);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => {
      clearInterval(timer);
      clearInterval(heartbeat);
    });
  });
}
