import type { Express } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcp } from "./server.js";
import { fromToken } from "../server/auth.js";
export function mountMcp(app: Express) {
  app.post("/mcp", async (req, res) => {
    const p = fromToken(req.headers.authorization?.replace(/^Bearer /, ""));
    if (!p || !["eng", "sales"].includes(p.team_id)) {
      res.status(401).json({ error: "A team user token is required" });
      return;
    }
    const server = createMcp(p),
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
    try {
      await server.connect(transport);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "MCP operation failed" });
    }
  });
  app.get("/mcp", (_req, res) =>
    res.status(405).json({ error: "Stateless MCP uses POST" }),
  );
  app.delete("/mcp", (_req, res) =>
    res.status(405).json({ error: "Stateless MCP uses POST" }),
  );
}
