import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Principal } from "../server/types.js";
import { myConversation, questions, pending, fail } from "../server/core.js";
import { turn } from "../server/agents/turn.js";
import { deliverDigest } from "../server/delta.js";
import { retriever } from "../server/store/visibility.js";
export function createMcp(p: Principal) {
  const server = new McpServer({ name: "relay-team-agents", version: "0.2.0" });
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  server.registerTool(
    "ask_team_agent",
    {
      description:
        "Ask only your own department agent; permissions are fixed by your bearer token.",
      inputSchema: {
        channel_id: z.string(),
        text: z.string().min(1).max(12000),
      },
    },
    async ({ channel_id, text }) =>
      result(await turn(p, myConversation(p, channel_id), text)),
  );
  server.registerTool(
    "get_delta",
    {
      description:
        "Deliver this team’s validated shipped-change digest and advance its cursor.",
      inputSchema: { channel_id: z.string() },
    },
    async ({ channel_id }) => result(await deliverDigest(p, channel_id)),
  );
  server.registerTool(
    "search_context",
    {
      description: "Search only records visible to your team.",
      inputSchema: { channel_id: z.string(), query: z.string().max(1000) },
    },
    async ({ channel_id, query }) =>
      result(retriever.search(p, channel_id, query)),
  );
  server.registerTool(
    "list_open_questions",
    {
      description: "List visible channel questions.",
      inputSchema: { channel_id: z.string() },
    },
    async ({ channel_id }) =>
      result(questions(p, channel_id).filter((q) => q.state !== "answered")),
  );
  server.registerTool(
    "list_pending_releases",
    {
      description:
        "Engineering only. No approval capability is exposed through MCP.",
      inputSchema: {},
    },
    async () => {
      if (p.team_id !== "eng")
        return {
          isError: true,
          content: [{ type: "text", text: "Engineering only" }],
        };
      return result(pending(p).filter((r) => r.state === "pending"));
    },
  );
  return server;
}
