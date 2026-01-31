#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { RepositClient, type Solution } from "./api.js";
import { loadConfig, getBackends, type RepositConfig } from "./config.js";

const config = loadConfig();

function getClient(backendName: string): RepositClient {
  const backend = config.backends[backendName];
  if (!backend) {
    throw new Error(`Backend "${backendName}" not configured`);
  }
  return new RepositClient(backend.url, backend.token);
}

function describeBackends(config: RepositConfig): string {
  const names = Object.keys(config.backends);
  if (names.length === 0) return "No backends configured";
  const defaultMarker = (n: string) => (n === config.default ? " (default)" : "");
  return names.map((n) => `${n}${defaultMarker(n)}`).join(", ");
}

const server = new Server(
  { name: "reposit-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const backendDescription = `Backend(s) to query. Can be a single name, array of names, or "all". Available: ${describeBackends(config)}`;

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search",
        description:
          "Search for solutions in the Reposit knowledge base. Returns matching problems and their solutions. Can search multiple backends.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query to find relevant solutions",
            },
            backend: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: backendDescription,
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags to filter results",
            },
            limit: {
              type: "number",
              description: "Maximum number of results per backend (default: 10)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "share",
        description:
          "Share a new solution with the Reposit community. Use this when you've solved a problem that others might benefit from.",
        inputSchema: {
          type: "object",
          properties: {
            problem: {
              type: "string",
              description: "Description of the problem that was solved",
            },
            solution: {
              type: "string",
              description: "The solution to the problem",
            },
            backend: {
              type: "string",
              description: backendDescription,
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags to categorize the solution",
            },
          },
          required: ["problem", "solution"],
        },
      },
      {
        name: "vote_up",
        description:
          "Upvote a solution that was helpful. This helps surface good solutions to others.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The ID of the solution to upvote",
            },
            backend: {
              type: "string",
              description: backendDescription,
            },
          },
          required: ["id"],
        },
      },
      {
        name: "vote_down",
        description:
          "Downvote a solution that was incorrect, outdated, or unhelpful. Requires a reason.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The ID of the solution to downvote",
            },
            backend: {
              type: "string",
              description: backendDescription,
            },
            reason: {
              type: "string",
              enum: [
                "incorrect",
                "outdated",
                "incomplete",
                "harmful",
                "duplicate",
                "other",
              ],
              description: "Reason for the downvote",
            },
            comment: {
              type: "string",
              description: "Optional comment explaining the downvote",
            },
          },
          required: ["id", "reason"],
        },
      },
      {
        name: "list_backends",
        description: "List all configured Reposit backends.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(
  CallToolRequestSchema,
  async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search": {
          const { query, backend, tags, limit } = args as {
            query: string;
            backend?: string | string[];
            tags?: string[];
            limit?: number;
          };

          const backends = getBackends(config, backend);
          const results: { backend: string; solutions: Solution[]; total: number }[] = [];

          await Promise.all(
            backends.map(async ({ name: backendName, backend: backendConfig }) => {
              const client = new RepositClient(backendConfig.url, backendConfig.token);
              const result = await client.search(query, { tags, limit });
              results.push({
                backend: backendName,
                solutions: result.solutions,
                total: result.total,
              });
            })
          );

          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "share": {
          const { problem, solution, backend, tags } = args as {
            problem: string;
            solution: string;
            backend?: string;
            tags?: string[];
          };

          const [{ name: backendName }] = getBackends(config, backend);
          const client = getClient(backendName);
          const result = await client.share(problem, solution, tags);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ backend: backendName, ...result }, null, 2),
              },
            ],
          };
        }

        case "vote_up": {
          const { id, backend } = args as { id: string; backend?: string };

          const [{ name: backendName }] = getBackends(config, backend);
          const client = getClient(backendName);
          const result = await client.upvote(id);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ backend: backendName, ...result }, null, 2),
              },
            ],
          };
        }

        case "vote_down": {
          const { id, backend, reason, comment } = args as {
            id: string;
            backend?: string;
            reason: string;
            comment?: string;
          };

          const [{ name: backendName }] = getBackends(config, backend);
          const client = getClient(backendName);
          const result = await client.downvote(id, reason, comment);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ backend: backendName, ...result }, null, 2),
              },
            ],
          };
        }

        case "list_backends": {
          const backends = Object.entries(config.backends).map(([name, cfg]) => ({
            name,
            url: cfg.url,
            isDefault: name === config.default,
          }));

          return {
            content: [{ type: "text", text: JSON.stringify(backends, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const backendInfo = describeBackends(config);
  console.error(`Reposit MCP server running. Backends: ${backendInfo}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
