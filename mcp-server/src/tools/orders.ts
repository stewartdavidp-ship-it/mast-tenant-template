import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrdersRef, getOrderRef } from "../firebase.js";
import { withResponseSize } from "../response-metadata.js";

export function registerOrderTools(server: McpServer): void {
  server.tool(
    "mast_orders",
    `Order management tool (read-only). Reads from order data.
Actions:
  - "list": List orders. Optional: status, limit (default 20).
  - "get": Get full order detail. Requires: orderId.`,
    {
      action: z.enum(["list", "get"]),
      orderId: z
        .string()
        .optional()
        .describe("Order ID (required for get)"),
      status: z
        .string()
        .optional()
        .describe(
          "Filter by status (e.g., pending, confirmed, shipped, delivered, cancelled)"
        ),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ action, orderId, status, limit }) => {
      // ── LIST ──
      if (action === "list") {
        const ref = getOrdersRef();
        const snapshot = await ref
          .orderByChild("createdAt")
          .limitToLast(200)
          .once("value");
        const raw = snapshot.val() || {};

        let items: any[] = Object.entries(raw).map(
          ([id, val]: [string, any]) => ({
            orderId: id,
            orderNumber: val.orderNumber,
            status: val.status,
            total: val.total,
            customerName: val.customerName || val.customer?.name,
            customerEmail: val.customerEmail || val.customer?.email,
            itemCount: Array.isArray(val.items) ? val.items.length : 0,
            createdAt: val.createdAt,
          })
        );

        // Sort newest first
        items.sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
        );

        // Filter by status
        if (status) {
          items = items.filter(
            (o) =>
              o.status && o.status.toLowerCase() === status.toLowerCase()
          );
        }

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
        if (!orderId) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "orderId is required for get" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const ref = getOrderRef(orderId);
        const snapshot = await ref.once("value");

        if (!snapshot.exists()) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: `Order ${orderId} not found` },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        return withResponseSize({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { orderId, ...snapshot.val() },
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
