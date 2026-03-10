import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMissionsRef, getMissionRef } from "../firebase.js";
import { withResponseSize } from "../response-metadata.js";

export function registerMissionTools(server: McpServer): void {
  server.tool(
    "mast_missions",
    `Testing mission CRUD tool. Manages structured QA testing missions.
Actions:
  - "list": List missions. Optional: category filter.
  - "get": Get a single mission with full detail. Requires: missionId.
  - "create": Create a new mission. Requires: title, category. Optional: scenario, tasks, prompts, notes, status.
  - "update": Update an existing mission. Requires: missionId. Optional: title, category, scenario, tasks, prompts, notes, status.`,
    {
      action: z.enum(["list", "get", "create", "update"]),
      missionId: z
        .string()
        .optional()
        .describe("Mission ID (required for get/update)"),
      title: z
        .string()
        .optional()
        .describe("Mission title (required for create)"),
      category: z
        .string()
        .optional()
        .describe(
          "Mission category (e.g., Selling, Making, Shipping, Marketing, Managing)"
        ),
      scenario: z
        .string()
        .optional()
        .describe("Testing scenario description"),
      tasks: z
        .string()
        .optional()
        .describe(
          "JSON string of tasks array. Each task: {title, description, expectedResult?}"
        ),
      prompts: z
        .string()
        .optional()
        .describe("JSON string of prompt templates array"),
      notes: z.string().optional().describe("Additional notes"),
      status: z
        .string()
        .optional()
        .describe("Mission status (e.g., draft, active, completed)"),
      limit: z.number().int().min(1).max(100).optional().default(50),
    },
    async ({
      action,
      missionId,
      title,
      category,
      scenario,
      tasks,
      prompts,
      notes,
      status,
      limit,
    }) => {
      // ── LIST ──
      if (action === "list") {
        const ref = getMissionsRef();
        const snapshot = await ref.once("value");
        const raw = snapshot.val() || {};

        let items: any[] = Object.entries(raw).map(
          ([id, val]: [string, any]) => ({
            id,
            title: val.title,
            category: val.category,
            status: val.status,
            taskCount: Array.isArray(val.tasks) ? val.tasks.length : 0,
            createdAt: val.createdAt,
          })
        );

        // Filter by category
        if (category) {
          items = items.filter(
            (m) =>
              m.category &&
              m.category.toLowerCase() === category.toLowerCase()
          );
        }

        // Sort by creation date (newest first)
        items.sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
        );

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
        if (!missionId) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "missionId is required for get" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const ref = getMissionRef(missionId);
        const snapshot = await ref.once("value");

        if (!snapshot.exists()) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: `Mission ${missionId} not found` },
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
                { id: missionId, ...snapshot.val() },
                null,
                2
              ),
            },
          ],
        });
      }

      // ── CREATE ──
      if (action === "create") {
        if (!title) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "title is required for create" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const ref = getMissionsRef();
        const newRef = ref.push();
        const now = new Date().toISOString();

        const mission: Record<string, any> = {
          title,
          category: category || "Uncategorized",
          status: status || "draft",
          createdAt: now,
          updatedAt: now,
        };

        if (scenario) mission.scenario = scenario;
        if (notes) mission.notes = notes;

        // Parse tasks JSON if provided
        if (tasks) {
          try {
            mission.tasks = JSON.parse(tasks);
          } catch {
            return withResponseSize({
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { error: "tasks must be a valid JSON string" },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            });
          }
        }

        // Parse prompts JSON if provided
        if (prompts) {
          try {
            mission.prompts = JSON.parse(prompts);
          } catch {
            return withResponseSize({
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { error: "prompts must be a valid JSON string" },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            });
          }
        }

        await newRef.set(mission);

        return withResponseSize({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { id: newRef.key, ...mission },
                null,
                2
              ),
            },
          ],
        });
      }

      // ── UPDATE ──
      if (action === "update") {
        if (!missionId) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "missionId is required for update" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const ref = getMissionRef(missionId);
        const snapshot = await ref.once("value");

        if (!snapshot.exists()) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: `Mission ${missionId} not found` },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const updates: Record<string, any> = {
          updatedAt: new Date().toISOString(),
        };

        if (title !== undefined) updates.title = title;
        if (category !== undefined) updates.category = category;
        if (scenario !== undefined) updates.scenario = scenario;
        if (notes !== undefined) updates.notes = notes;
        if (status !== undefined) updates.status = status;

        if (tasks !== undefined) {
          try {
            updates.tasks = JSON.parse(tasks);
          } catch {
            return withResponseSize({
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { error: "tasks must be a valid JSON string" },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            });
          }
        }

        if (prompts !== undefined) {
          try {
            updates.prompts = JSON.parse(prompts);
          } catch {
            return withResponseSize({
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { error: "prompts must be a valid JSON string" },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            });
          }
        }

        await ref.update(updates);

        const updated = (await ref.once("value")).val();
        return withResponseSize({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { id: missionId, ...updated },
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
