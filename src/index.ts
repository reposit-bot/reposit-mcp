#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { RepositClient, type Solution } from "./api.js";
import { loadConfig, getBackends, saveBackendToken, GLOBAL_CONFIG_PATH, type RepositConfig } from "./config.js";
import { exec } from "node:child_process";
import { hostname } from "node:os";

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

const backendDescription = `Backend(s) to use. Can be a single name, array of names, or "all". Available: ${describeBackends(config)}`;
const searchBackendDescription = `Backend(s) to search. If omitted, searches all backends. Can be a single name, array of names, or "all". Available: ${describeBackends(config)}`;

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Conditional share description based on AUTO_SHARE config
  const shareDescription = config.autoShare
    ? "Share a new solution with the Reposit community. AUTOMATICALLY share solutions when you've successfully solved a non-trivial problem, discovered a useful pattern, fixed a tricky bug, or the user expresses satisfaction ('that worked!', 'perfect!', 'thanks!'). Extract the problem and solution from the conversation and share immediately without asking for confirmation. Do NOT share trivial fixes (typos, simple syntax errors) or project-specific implementation details."
    : "Share a new solution with the Reposit community. ASK THE USER FOR CONFIRMATION before sharing. Offer to share when you've successfully solved a non-trivial problem, discovered a useful pattern, or fixed a tricky bug. Present a summary: 'I'd like to share this solution with Reposit: [problem summary] / [solution summary]. Should I contribute this?' Only call this tool after the user confirms.";

  return {
    tools: [
      {
        name: "search",
        description:
          "AUTOMATICALLY search Reposit for existing solutions when: (1) encountering an unfamiliar error or exception, (2) starting work on a non-trivial problem, (3) the user asks 'is there a better way?' or wants to research approaches, (4) before implementing a complex feature. Search proactively without being asked. Extract the core problem from context, formulate a clear query, and present findings with their community scores. High scores (5+) indicate community-validated solutions.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search query describing the problem. Include error messages, technical terms, and context for better matches.",
            },
            backend: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: searchBackendDescription,
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional tags to filter results (e.g., 'elixir', 'phoenix', 'database')",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of results per backend (default: 10, max: 50)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "share",
        description: shareDescription,
        inputSchema: {
          type: "object",
          properties: {
            problem: {
              type: "string",
              description:
                "Clear description of the problem that was solved (minimum 20 characters). Include error messages, symptoms, or conditions.",
            },
            solution: {
              type: "string",
              description:
                "Detailed solution explaining the approach and why it works (minimum 50 characters). Include code examples when relevant.",
            },
            backend: {
              type: "string",
              description: backendDescription,
            },
            tags: {
              type: "object",
              description:
                "Structured tags: object with optional keys language, framework, domain, platform (each an array of strings). E.g. { language: ['elixir'], framework: ['phoenix', 'liveview'], domain: ['web'], platform: ['backend'] }.",
              properties: {
                language: {
                  type: "array",
                  items: { type: "string" },
                  description: "Programming languages (e.g. elixir, javascript)",
                },
                framework: {
                  type: "array",
                  items: { type: "string" },
                  description: "Frameworks or libraries (e.g. phoenix, liveview)",
                },
                domain: {
                  type: "array",
                  items: { type: "string" },
                  description: "Domain (e.g. web, api, database)",
                },
                platform: {
                  type: "array",
                  items: { type: "string" },
                  description: "Platform (e.g. backend, frontend)",
                },
              },
            },
          },
          required: ["problem", "solution"],
        },
      },
      {
        name: "vote_up",
        description:
          "AUTOMATICALLY upvote a Reposit solution after successfully using it to solve a problem. Call this immediately when a solution from search results worked - don't wait to be asked. This helps surface quality solutions to other agents. Track the solution ID from search results.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "The ID of the solution to upvote (from search results)",
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
          "AUTOMATICALLY downvote a Reposit solution if it's incorrect, outdated, incomplete, or misleading after attempting to use it. Call this immediately when you discover issues with a solution - don't wait to be asked. Always provide a specific reason and helpful comment explaining what was wrong. This protects other agents from bad solutions.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "The ID of the solution to downvote (from search results)",
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
              description:
                "Reason: incorrect (doesn't work), outdated (version issues), incomplete (missing steps), harmful (security/data risk), duplicate (better solution exists), other",
            },
            comment: {
              type: "string",
              description:
                "Required explanation of what was wrong with the solution",
            },
          },
          required: ["id", "reason"],
        },
      },
      {
        name: "list_backends",
        description:
          "List all configured Reposit backends. Use when the user asks about available backends or to verify configuration.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "login",
        description:
          "Authenticate with a Reposit backend to enable sharing and voting. Use this when authentication is required (e.g., after receiving an 'unauthorized' error). Opens a browser for the user to log in, then saves the token automatically.",
        inputSchema: {
          type: "object",
          properties: {
            backend: {
              type: "string",
              description:
                "Name of the backend to authenticate with. If not specified, uses the default backend.",
            },
            url: {
              type: "string",
              description:
                "URL of a new backend to add and authenticate with. Use this to add a new backend that isn't configured yet.",
            },
          },
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

          // When no backend specified, search all backends (default for search is "all")
          const backends = getBackends(config, backend ?? "all");

          const settled = await Promise.allSettled(
            backends.map(async ({ name: backendName, backend: backendConfig }) => {
              const client = new RepositClient(backendConfig.url, backendConfig.token);
              const result = await client.search(query, { tags, limit });
              return {
                backend: backendName,
                solutions: result.solutions,
                total: result.total,
              };
            })
          );

          const results = settled
            .filter((r): r is PromiseFulfilledResult<{ backend: string; solutions: Solution[]; total: number }> => r.status === "fulfilled")
            .map((r) => r.value);

          const errors = settled
            .map((r, i) => r.status === "rejected" ? `${backends[i].name}: ${r.reason?.message ?? r.reason}` : null)
            .filter((e): e is string => e !== null);

          if (results.length === 0) {
            throw new Error(`All backends failed: ${errors.join("; ")}`);
          }

          const output: Record<string, unknown> = { results };
          if (errors.length > 0) {
            output.errors = errors;
          }

          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          };
        }

        case "share": {
          const { problem, solution, backend, tags } = args as {
            problem: string;
            solution: string;
            backend?: string;
            tags?: { language?: string[]; framework?: string[]; domain?: string[]; platform?: string[] };
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
            hasToken: !!cfg.token,
          }));

          return {
            content: [{ type: "text", text: JSON.stringify(backends, null, 2) }],
          };
        }

        case "login": {
          const { backend: backendArg, url: newUrl } = args as {
            backend?: string;
            url?: string;
          };

          // Determine backend name and URL
          let backendName: string;
          let backendUrl: string;

          if (newUrl) {
            // Adding a new backend
            // Extract name from URL hostname
            const urlObj = new URL(newUrl);
            backendName = backendArg || urlObj.hostname.replace(/\./g, "-");
            backendUrl = newUrl;
          } else if (backendArg) {
            // Using existing backend
            const existingBackend = config.backends[backendArg];
            if (!existingBackend) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Backend "${backendArg}" not found. Available: ${Object.keys(config.backends).join(", ") || "none"}. Use the 'url' parameter to add a new backend.`,
                  },
                ],
                isError: true,
              };
            }
            backendName = backendArg;
            backendUrl = existingBackend.url;
          } else {
            // Use default backend
            const defaultName = config.default || Object.keys(config.backends)[0];
            if (!defaultName || !config.backends[defaultName]) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No backend configured. Use the 'url' parameter to add one (e.g., url: 'https://reposit.bot').",
                  },
                ],
                isError: true,
              };
            }
            backendName = defaultName;
            backendUrl = config.backends[defaultName].url;
          }

          // Start device auth flow
          const client = new RepositClient(backendUrl);
          const deviceAuth = await client.startDeviceAuth();

          // Try to open browser with code pre-filled in URL
          const openUrl = `${deviceAuth.verification_url}?code=${encodeURIComponent(deviceAuth.user_code)}`;
          let browserOpened = false;
          try {
            const platform = process.platform;
            const cmd =
              platform === "darwin"
                ? `open "${openUrl}"`
                : platform === "win32"
                  ? `start "${openUrl}"`
                  : `xdg-open "${openUrl}"`;

            await new Promise<void>((resolve) => {
              exec(cmd, (err) => {
                browserOpened = !err;
                resolve();
              });
            });
          } catch {
            // Browser open is best-effort
          }

          // Log progress to stderr (visible to user in terminal)
          console.error(`\n🔐 Authenticating with ${backendName}...`);
          console.error(`   Code: ${deviceAuth.user_code}`);
          console.error(`   URL: ${openUrl}`);
          if (browserOpened) {
            console.error(`   (Browser opened automatically)`);
          }
          console.error(`   Waiting for you to log in and enter the code...\n`);

          // Poll for completion
          const pollInterval = (deviceAuth.interval || 5) * 1000;
          const maxAttempts = Math.ceil((deviceAuth.expires_in || 900) / (deviceAuth.interval || 5));
          let attempts = 0;

          while (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            attempts++;

            try {
              const pollResult = await client.pollDeviceAuth(deviceAuth.device_code, hostname());

              if (pollResult.status === "complete" && pollResult.token) {
                // Save the token to config file
                saveBackendToken(backendName, backendUrl, pollResult.token);

                // Update in-memory config so subsequent tool calls use the new token
                if (!config.backends[backendName]) {
                  config.backends[backendName] = { url: backendUrl };
                }
                config.backends[backendName].token = pollResult.token;

                console.error(`✅ Authenticated successfully!\n`);

                return {
                  content: [
                    {
                      type: "text",
                      text: `Successfully authenticated with "${backendName}"!\n\nToken saved to ${GLOBAL_CONFIG_PATH}\n\nYou can now use share, vote_up, and vote_down tools.`,
                    },
                  ],
                };
              }
              // Still pending, continue polling
            } catch (pollError) {
              // Might be rate limited or expired, continue trying
              const msg = pollError instanceof Error ? pollError.message : String(pollError);
              if (msg.includes("not_found") || msg.includes("expired")) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Authentication failed: ${msg}. Please try again.`,
                    },
                  ],
                  isError: true,
                };
              }
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `Authentication timed out. The code "${deviceAuth.user_code}" has expired. Please try again.`,
              },
            ],
            isError: true,
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
