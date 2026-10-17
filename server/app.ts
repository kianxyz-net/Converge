import express from "express";
import { randomUUID } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { z } from "zod";
import { db, hash, principal } from "./store/db.js";
import * as store from "./store/visibility.js";
import { issueToken, fromToken, requireEngineer } from "./auth.js";
import * as core from "./core.js";
import { turn, draftQuestion } from "./agents/turn.js";
import { subscribe, flush } from "./realtime.js";
import type { Principal } from "./types.js";
import { syncGitHub } from "./connectors/github.js";
import { deliverDigest } from "./delta.js";
import { ingest } from "./connectors/ingest.js";
import { mountMcp } from "../mcp/http.js";
export const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  if (
    ["POST", "PUT", "DELETE"].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}` &&
    req.headers.origin !== `https://${req.headers.host}`
  )
    return res.status(403).json({ error: "Origin rejected" });
  next();
});
const wrap =
  (
    fn: (req: express.Request, res: express.Response, p: Principal) => unknown,
  ): express.RequestHandler =>
  (req, res, next) => {
    const p = fromToken(req.headers.authorization?.replace(/^Bearer /, ""));
    if (!p) {
      res.status(401).json({ error: "Select a demo identity first" });
      return;
    }
    Promise.resolve()
      .then(() => fn(req, res, p))
      .catch(next);
  };
const text = z.string().trim().min(1).max(12000);
const id = (req: express.Request, key: string) => String(req.params[key]);
app.post("/api/connectors/:id/ingest", (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    const v = z
      .object({ channel_id: z.string(), text: z.string().min(1).max(200000) })
      .passthrough()
      .parse(req.body);
    res.json(ingest(id(req, "id"), token, v));
    flush();
  } catch (e) {
    next(e);
  }
});
const exportsByUser = new Map<string, { start: number; count: number }>();
app.get(
  "/api/export",
  wrap((req, res, p) => {
    db.prepare("INSERT INTO audit(ts,principal_id,action) VALUES(?,?,?)").run(
      new Date().toISOString(),
      p.id,
      "export:" + String(req.query.team),
    );
    let rate = exportsByUser.get(p.id);
    if (!rate || Date.now() - rate.start > 60000) {
      rate = { start: Date.now(), count: 0 };
      exportsByUser.set(p.id, rate);
    }
    if (++rate.count > 30)
      return res.status(429).json({ error: "Export limited to 30 per minute" });
    const team = z.enum(["eng", "sales"]).parse(req.query.team);
    const mask = team === "eng" ? 1 : 2;
    if (!store.visible(mask, p))
      return res.status(403).json({ error: "Team clearance required" });
    res.json(store.exportRecords(p, mask));
  }),
);
mountMcp(app);
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    fts5: true,
    mode: process.env.ANTHROPIC_API_KEY ? "anthropic" : "offline",
    operatorEnabled: process.env.ENABLE_DEMO_OPERATOR !== "false",
  }),
);
app.post("/api/auth/switch", (req, res, next) => {
  try {
    const { user_id } = z
      .object({ user_id: z.enum(["ava", "priya", "ben"]) })
      .strict()
      .parse(req.body);
    res.json(issueToken(user_id));
  } catch (e) {
    next(e);
  }
});
app.post("/api/auth/operator", (_req, res) => {
  if (process.env.ENABLE_DEMO_OPERATOR === "false")
    return res.status(403).json({ error: "Operator mode disabled" });
  res.json(issueToken("operator"));
});
app.post(
  "/api/github/sync",
  wrap(async (req, res, p) => {
    const v = z.object({ channel_id: z.string() }).strict().parse(req.body);
    res.json(await syncGitHub(p, v.channel_id));
    flush();
  }),
);
app.post(
  "/api/channels/:id/digest",
  wrap(async (req, res, p) => {
    res.json(await deliverDigest(p, id(req, "id")));
    flush();
  }),
);
app.get(
  "/api/operator/log",
  wrap((_req, res, p) => {
    if (p.id !== "operator" || process.env.ENABLE_DEMO_OPERATOR === "false")
      return res.status(403).json({ error: "Demo operator only" });
    res.json(store.list(p, { limit: 100000 }));
  }),
);
app.post(
  "/api/questions/:id/draft",
  wrap(async (req, res, p) => {
    requireEngineer(p);
    const q = db
      .prepare("SELECT * FROM questions WHERE id=?")
      .get(id(req, "id")) as
      | { channel_id: string; event_seq: number }
      | undefined;
    if (!q || !store.bySeq(p, q.event_seq))
      return res.status(404).json({ error: "Question not visible" });
    res.json(await draftQuestion(id(req, "id")));
    flush();
  }),
);
app.get(
  "/api/me",
  wrap((_req, res, p) => res.json(p)),
);
app.get(
  "/api/channels",
  wrap((_req, res, p) =>
    res.json(
      (db.prepare("SELECT * FROM channels").all() as { id: string }[]).map(
        (c) => ({
          ...c,
          conversation_id:
            p.team_id === "operator" ? null : core.myConversation(p, c.id),
        }),
      ),
    ),
  ),
);
app.post(
  "/api/channels",
  wrap((req, res, p) => {
    requireEngineer(p);
    const v = z
      .object({ name: text, account: text, brief: text })
      .strict()
      .parse(req.body);
    const channelId = randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO channels VALUES(?,?,?,?)").run(
        channelId,
        v.name,
        v.account,
        p.id,
      );
      store.append(p, {
        type: "ingest",
        channel_id: channelId,
        labels_mask: 0,
        text: v.brief,
        meta: { kind: "brief" },
        index: true,
      });
    })();
    flush();
    res.json({ id: channelId });
  }),
);
app.get(
  "/api/channels/:id/thread",
  wrap((req, res, p) => {
    core.channel(id(req, "id"));
    res.json(store.list(p, { channel: id(req, "id"), sharedOnly: true }));
  }),
);
app.get(
  "/api/channels/:id/questions",
  wrap((req, res, p) => res.json(core.questions(p, id(req, "id")))),
);
app.get(
  "/api/conversations/:id/messages",
  wrap((req, res, p) => {
    const c = core.conversation(p, id(req, "id"));
    res.json(store.list(p, { channel: c.channel_id, conversation: c.id }));
  }),
);
app.post(
  "/api/conversations/:id/messages",
  wrap(async (req, res, p) => {
    const v = z.object({ text }).strict().parse(req.body);
    res.json(await turn(p, id(req, "id"), v.text));
  }),
);
app.get(
  "/api/records/:id",
  wrap((req, res, p) => {
    const record =
      store.get(p, id(req, "id")) || store.getChunk(p, id(req, "id"));
    if (!record) return res.status(404).json({ error: "Record not visible" });
    res.json(record);
  }),
);
app.get(
  "/api/events/:id/inspect",
  wrap((req, res, p) => {
    const event = store.get(p, id(req, "id"));
    if (!event) return res.status(404).json({ error: "Event not visible" });
    res.json(
      event.meta.manifest || { note: "This record is not an agent turn" },
    );
  }),
);
app.get(
  "/api/stream",
  wrap((req, res, p) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const after = Number(req.headers["last-event-id"] || req.query.after || 0);
    subscribe(p, res, Number.isSafeInteger(after) && after >= 0 ? after : 0);
    const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    res.on("close", () => clearInterval(timer));
  }),
);
app.get(
  "/api/channels/:id/documents",
  wrap((req, res, p) => res.json(core.documents(p, id(req, "id")))),
);
app.post(
  "/api/channels/:id/documents",
  wrap((req, res, p) => {
    const v = z
      .object({
        name: z.string().regex(/\.(md|txt)$/i),
        text: z.string().min(1).max(200000),
      })
      .strict()
      .parse(req.body);
    const docId = core.upload(p, id(req, "id"), v.name, v.text);
    flush();
    res.json({ id: docId });
  }),
);
app.post(
  "/api/documents/:id/release",
  wrap((req, res, p) => {
    const v = z
      .object({ confirmed: z.literal(true), text_hash: z.string() })
      .strict()
      .parse(req.body);
    const event = core.releaseDocument(
      p,
      id(req, "id"),
      v.confirmed,
      v.text_hash,
    );
    flush();
    res.json(event);
  }),
);
app.get(
  "/api/releases/pending",
  wrap((_req, res, p) => res.json(core.pending(p))),
);
app.post(
  "/api/releases/:id/approve",
  wrap((req, res, p) => {
    const v = z
      .object({ text, text_hash: z.string(), expected_hash: z.string() })
      .strict()
      .parse(req.body);
    const event = core.approve(
      p,
      id(req, "id"),
      v.text,
      v.text_hash,
      v.expected_hash,
    );
    flush();
    res.json(event);
  }),
);
app.post(
  "/api/releases/:id/reject",
  wrap((req, res, p) => {
    core.reject(p, id(req, "id"));
    flush();
    res.json({ ok: true });
  }),
);
app.post(
  "/api/channels/:id/updates",
  wrap((req, res, p) => {
    requireEngineer(p);
    core.channel(id(req, "id"));
    const v = z.object({ text }).strict().parse(req.body);
    const event = store.append(p, {
      type: "release_draft",
      channel_id: id(req, "id"),
      labels_mask: 1,
      text: v.text,
      meta: { kind: "proactive_update" },
    });
    const releaseId = core.draftRelease(p, "update", event, v.text);
    flush();
    res.json({ id: releaseId });
  }),
);
app.get(
  "/api/release-status",
  wrap((_req, res, p) => {
    const shared = { ...p, clearance_mask: 0 };
    res.json(
      store
        .list(shared, { type: "declassify" })
        .map((e) => ({
          id: e.id,
          channel_id: e.channel_id,
          text: e.text,
          meta: e.meta,
        })),
    );
  }),
);
export const apiRoute = (
  method: "get" | "post",
  route: string,
  fn: (req: express.Request, res: express.Response, p: Principal) => unknown,
) => app[method](route, wrap(fn));
export async function finishApp(frontend = true) {
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown endpoint" }),
  );
  if (frontend) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const e = err as { status?: number; message?: string };
      if (res.headersSent) return;
      res
        .status(err instanceof z.ZodError ? 400 : e.status || 500)
        .json({
          error:
            err instanceof z.ZodError
              ? "Invalid request: " +
                err.issues
                  .map((x) => x.path.join(".") + " " + x.message)
                  .join("; ")
              : e.status
                ? e.message
                : "Operation failed. No unvalidated agent answer was delivered.",
        });
      console.error(e.message);
    },
  );
  return app;
}
