import type { Express, Request, Response } from "express";
import { z } from "zod";
import { fromToken, issueToken, requireHuman } from "./auth.js";
import type { Principal } from "./types.js";
import * as h from "./handoff.js";
import { runScenario } from "./handoff-checks.js";
import { serial } from "./agents/turn.js";
const text = z.string().trim().min(1).max(6000),
  digest = z.string().length(64);
export function mountHandoff(app: Express) {
  const route = (
    method: "get" | "post",
    path: string,
    fn: (req: Request, res: Response, p: Principal) => unknown,
  ) =>
    app[method]("/api/handoff" + path, (req, res, next) => {
      const p = fromToken(req.headers.authorization?.replace(/^Bearer /, ""));
      if (!p) return res.status(401).json({ error: "Select a demo team" });
      Promise.resolve()
        .then(() => {
          h.scope(p);
          return fn(req, res, p);
        })
        .catch(next);
    });
  app.post("/api/handoff/session", (req, res, next) => {
    try {
      h.seedHandoff();
      const v = z
        .object({ identity: z.enum(h.identities) })
        .strict()
        .parse(req.body);
      res.json(issueToken(v.identity));
    } catch (e) {
      next(e);
    }
  });
  route("get", "/state", (_req, res, p) => res.json(h.snapshot(p)));
  route("get", "/sources/:id", (req, res, p) => {
    const source = h.getSource(p, String(req.params.id));
    if (!source) return res.status(404).json({ error: "Source not visible" });
    res.json(source);
  });
  route("post", "/ask", async (req, res, p) => {
    const v = z.object({ text }).strict().parse(req.body);
    res.json(
      await serial(h.currentChannel() + ":" + p.id, () => h.answer(p, v.text)),
    );
  });
  route("post", "/escalate", async (req, res, p) => {
    const v = z
      .object({ id: z.string(), hash: digest, confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(await h.confirmEscalation(p, v.id, v.hash));
  });
  route("post", "/drafts/:id/edit", (req, res, p) => {
    const v = z.object({ text, hash: digest }).strict().parse(req.body);
    res.json(h.editDraft(p, String(req.params.id), v.text, v.hash));
  });
  route("post", "/drafts/:id/approve", (req, res, p) => {
    const v = z
      .object({ hash: digest, confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(h.approveDraft(p, String(req.params.id), v.hash));
  });
  route("post", "/drafts/:id/release", (req, res, p) => {
    const v = z
      .object({ hash: digest, confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(h.releaseDraft(p, String(req.params.id), v.hash));
  });
  route("post", "/security", async (req, res, p) => {
    requireHuman(p);
    const v = z
      .object({
        scenario: z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "all"]),
      })
      .strict()
      .parse(req.body);
    const ids =
      v.scenario === "all"
        ? (["A", "B", "C", "D", "E", "F", "G", "H"] as const)
        : [v.scenario];
    const results = [];
    for (const id of ids) results.push(await runScenario(id));
    res.json({ results });
  });
  route("post", "/reset", (req, res, p) => {
    requireHuman(p);
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    h.seedHandoff(true);
    res.json({ ok: true });
  });
}
