/**
 * Whistle MCP Server
 * Exposes collegiate athletics contact/org data to AI agents via the Model Context Protocol.
 *
 * Run: npx tsx server/mcp/index.ts
 * Auth: set WHISTLE_API_KEY env var to a valid Whistle API key
 * List on: https://mcp.so and https://smithery.ai
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.WHISTLE_API_BASE ?? "http://localhost:5000";
const API_KEY = process.env.WHISTLE_API_KEY ?? "";

if (!API_KEY) {
  console.error("[Whistle MCP] WHISTLE_API_KEY is not set. Requests will fail.");
}

async function whistleFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whistle API ${res.status}: ${body}`);
  }
  return res.json();
}

const server = new Server(
  { name: "whistle", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_staff",
      description:
        "Search for collegiate athletics staff members by name, title, school, or free-text query. Returns contact info, title, and school affiliation.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Free-text search (name, title, keyword)" },
          school_id: { type: "string", description: "Filter by school ID" },
          limit: { type: "number", description: "Max results (default 50, max 500)" },
          offset: { type: "number", description: "Pagination offset" },
        },
        required: [],
      },
    },
    {
      name: "get_school",
      description:
        "Get full profile for a school: org data, staff list, tech stack, recent signals. Use list_schools first to find school IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          school_id: { type: "string", description: "Whistle school ID (e.g. 'michigan')" },
        },
        required: ["school_id"],
      },
    },
    {
      name: "get_signals",
      description:
        "Get recent intent signals (new hires, departures, tech-stack changes, job postings) for a school or across all schools.",
      inputSchema: {
        type: "object" as const,
        properties: {
          school_id: { type: "string", description: "Filter by school (optional)" },
          type: {
            type: "string",
            enum: ["new_hire", "departure", "title_change", "tech_add", "tech_drop", "job_posting"],
            description: "Filter by signal type (optional)",
          },
          since: { type: "string", description: "ISO date — only return signals after this date" },
          limit: { type: "number", description: "Max results (default 50)" },
        },
        required: [],
      },
    },
    {
      name: "trigger_scrape",
      description:
        "Queue a fresh data refresh/scrape for a specific school. Rate-limited. Returns a job ID you can reference.",
      inputSchema: {
        type: "object" as const,
        properties: {
          school_id: { type: "string", description: "Whistle school ID to refresh" },
        },
        required: ["school_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "search_staff": {
        const params = new URLSearchParams();
        if (args?.query) params.set("query", String(args.query));
        if (args?.school_id) params.set("school_id", String(args.school_id));
        if (args?.limit) params.set("limit", String(args.limit));
        if (args?.offset) params.set("offset", String(args.offset));
        const data = await whistleFetch(`/api/v1/staff?${params}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_school": {
        const schoolId = String(args?.school_id);
        const [school, staff, signals] = await Promise.all([
          whistleFetch(`/api/v1/schools/${schoolId}`).catch(() => null),
          whistleFetch(`/api/v1/schools/${schoolId}/staff?limit=200`).catch(() => ({ staff: [] })),
          whistleFetch(`/api/v1/signals?school_id=${schoolId}&limit=10`).catch(() => ({ signals: [] })),
        ]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ school, staff_count: staff.total, staff: staff.staff?.slice(0, 20), recent_signals: signals.signals }, null, 2),
            },
          ],
        };
      }

      case "get_signals": {
        const params = new URLSearchParams();
        if (args?.school_id) params.set("school_id", String(args.school_id));
        if (args?.type) params.set("type", String(args.type));
        if (args?.since) params.set("since", String(args.since));
        if (args?.limit) params.set("limit", String(args.limit ?? 50));
        const data = await whistleFetch(`/api/v1/signals?${params}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      }

      case "trigger_scrape": {
        const schoolId = String(args?.school_id);
        const data = await whistleFetch(`/api/v1/schools/${schoolId}/refresh`, { method: "POST" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Whistle MCP] Server running on stdio");
}

main().catch((err) => {
  console.error("[Whistle MCP] Fatal:", err);
  process.exit(1);
});
