import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getWorkflowsRef,
  getWorkflowSectionsRef,
  getWorkflowSectionRef,
} from "../firebase.js";
import { withResponseSize } from "../response-metadata.js";

export function registerWorkflowTools(server: McpServer): void {
  server.tool(
    "mast_workflows",
    `Workflow reference tool. Reads synced workflow data from Firebase.
Actions:
  - "list_sections": List all workflow sections with entry counts.
  - "get_section": Get one section's YAML content. Requires: section.
  - "get_full": Get complete workflows YAML (large — use sparingly).
  - "search": Search for workflows by keyword across all sections. Requires: query.`,
    {
      action: z.enum(["list_sections", "get_section", "get_full", "search"]),
      section: z
        .string()
        .optional()
        .describe("Section name (required for get_section)"),
      query: z
        .string()
        .optional()
        .describe("Search query (required for search)"),
    },
    async ({ action, section, query }) => {
      // ── LIST_SECTIONS ──
      if (action === "list_sections") {
        const ref = getWorkflowsRef();
        const snapshot = await ref.once("value");
        const data = snapshot.val();

        if (!data || !data.sectionList) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "No workflow data found. Has sync-workflows run?" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const sections: Record<string, number> = {};
        for (const name of data.sectionList) {
          // Count entries by parsing the YAML string for "- name:" occurrences
          const sectionYaml = data.sections?.[name] || "";
          const matches = sectionYaml.match(/^- name:/gm);
          sections[name] = matches ? matches.length : 0;
        }

        return withResponseSize({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  sections,
                  totalSections: data.sectionList.length,
                  syncedAt: data.syncedAt,
                },
                null,
                2
              ),
            },
          ],
        });
      }

      // ── GET_SECTION ──
      if (action === "get_section") {
        if (!section) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "section is required for get_section" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const ref = getWorkflowSectionRef(section);
        const snapshot = await ref.once("value");
        const yaml = snapshot.val();

        if (!yaml) {
          // Try case-insensitive match
          const listRef = getWorkflowsRef().child("sectionList");
          const listSnap = await listRef.once("value");
          const sectionList = listSnap.val() || [];
          const match = sectionList.find(
            (s: string) => s.toLowerCase() === section.toLowerCase()
          );

          if (match) {
            const matchRef = getWorkflowSectionRef(match);
            const matchSnap = await matchRef.once("value");
            const matchYaml = matchSnap.val();
            if (matchYaml) {
              return withResponseSize({
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      { section: match, content: matchYaml },
                      null,
                      2
                    ),
                  },
                ],
              });
            }
          }

          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: `Section "${section}" not found`,
                    availableSections: sectionList,
                  },
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
              text: JSON.stringify({ section, content: yaml }, null, 2),
            },
          ],
        });
      }

      // ── GET_FULL ──
      if (action === "get_full") {
        const ref = getWorkflowsRef().child("full");
        const snapshot = await ref.once("value");
        const full = snapshot.val();

        if (!full) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "No full workflow data found" },
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
                { content: full, charCount: full.length },
                null,
                2
              ),
            },
          ],
        });
      }

      // ── SEARCH ──
      if (action === "search") {
        if (!query) {
          return withResponseSize({
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "query is required for search" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          });
        }

        const ref = getWorkflowSectionsRef();
        const snapshot = await ref.once("value");
        const sections = snapshot.val() || {};

        const queryLower = query.toLowerCase();
        const results: Array<{ section: string; name: string; snippet: string }> =
          [];

        for (const [sectionName, yamlStr] of Object.entries(sections)) {
          if (typeof yamlStr !== "string") continue;

          // Split by workflow entries and search each
          const entries = yamlStr.split(/^- name:/m);
          for (const entry of entries) {
            if (!entry.trim()) continue;
            const entryLower = entry.toLowerCase();
            if (entryLower.includes(queryLower)) {
              // Extract the workflow name
              const nameMatch = entry.match(/^([^\n]+)/);
              const name = nameMatch ? nameMatch[1].trim() : "Unknown";
              // Provide a snippet around the match
              const idx = entryLower.indexOf(queryLower);
              const start = Math.max(0, idx - 50);
              const end = Math.min(entry.length, idx + query.length + 50);
              const snippet = entry.slice(start, end).trim();
              results.push({ section: sectionName, name, snippet });
            }
          }
        }

        return withResponseSize({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { query, resultCount: results.length, results },
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
