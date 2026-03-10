import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import { registerMissionTools } from "./tools/missions.js";
import { registerProductTools } from "./tools/products.js";
import { registerOrderTools } from "./tools/orders.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mast-mcp-server",
    version: "1.0.0",
  });

  // Register all tools
  registerWorkflowTools(server);
  registerMissionTools(server);
  registerProductTools(server);
  registerOrderTools(server);

  return server;
}
