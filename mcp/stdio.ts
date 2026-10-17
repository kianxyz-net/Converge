import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { seed } from "../server/seed.js";
import { fromToken } from "../server/auth.js";
import { createMcp } from "./server.js";
seed();
const p = fromToken(process.env.RELAY_TOKEN);
if (!p || p.scope!=="mcp" || !["eng", "sales"].includes(p.team_id)) {
  console.error("Set RELAY_TOKEN to a scoped token from POST /api/auth/mcp-token.");
  process.exit(1);
}
await createMcp(p).connect(new StdioServerTransport());
