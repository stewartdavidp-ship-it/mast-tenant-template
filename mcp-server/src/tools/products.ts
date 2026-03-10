import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getProductsRef,
  getProductRef,
  getInventoryRef,
  getProductInventoryRef,
} from "../firebase.js";
import { withResponseSize } from "../response-metadata.js";

export function registerProductTools(server: McpServer): void {
  server.tool(
    "mast_products",
    `Product catalog tool (read-only). Reads from product catalog and inventory data.
Actions:
  - "list": List products. Optional: category, status, limit (default 50).
  - "get": Get full product detail with inventory. Requires: pid.`,
    {
      action: z.enum(["list", "get"]),
      pid: z
        .string()
        .optional()
        .describe("Product ID (required for get)"),
      category: z
        .string()
        .optional()
        .describe("Filter by category"),
      status: z
        .string()
        .optional()
        .describe("Filter by status (e.g., active, draft, archived)"),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ action, pid, category, status, limit }) => {
      // ── LIST ──
      if (action === "list") {
        const ref = getProductsRef();
        const snapshot = await ref.once("value");
        const raw = snapshot.val() || {};

        let items: any[] = Object.entries(raw).map(
          ([id, val]: [string, any]) => ({
            pid: id,
            name: val.name,
            category: val.category,
            price: val.price,
            status: val.status,
            type: val.type,
            createdAt: val.createdAt,
          })
        );

        // Filter by category
        if (category) {
          items = items.filter(
            (p) =>
              p.category &&
              p.category.toLowerCase() === category.toLowerCase()
          );
        }

        // Filter by status
        if (status) {
          items = items.filter(
            (p) =>
              p.status && p.status.toLowerCase() === status.toLowerCase()
          );
        }

        // Sort by name
        items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        const total = items.length;
        items = items.slice(0, limit);

        return withResponseSize({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ items, total, limit }, null, 2),
            },
          ],
        });
      }

      // ── GET ──
      if (action === "get") {
        if (!pid) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "pid is required for get" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const productRef = getProductRef(pid);
        const productSnap = await productRef.once("value");

        if (!productSnap.exists()) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: `Product ${pid} not found` },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const product = productSnap.val();

        // Join inventory data
        const inventoryRef = getProductInventoryRef(pid);
        const inventorySnap = await inventoryRef.once("value");
        const inventory = inventorySnap.exists() ? inventorySnap.val() : null;

        return withResponseSize({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { pid, ...product, inventory },
                null,
                2
              ),
            },
          ],
        });
      }

      return withResponseSize({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { error: `Unknown action: ${action}` },
              null,
              2
            ),
          },
        ],
        isError: true,
      });
    }
  );
}
