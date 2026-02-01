**IMPORTANT**: before you do anything else, run the `beans prime` command and heed its output.

# reposit-mcp

MCP (Model Context Protocol) server for Reposit - exposes tools for Claude to search, share, and vote on solutions.

## Tech Stack

- **Runtime**: Bun (preferred) or Node.js 18+
- **Language**: TypeScript
- **Protocol**: MCP SDK (`@modelcontextprotocol/sdk`)

## Commands

```bash
# Install dependencies
bun install

# Build TypeScript
bun run build

# Run the server
bun start

# Development (watch mode)
bun run dev

# Type check without emitting
bun run typecheck

# Clean build artifacts
bun run clean
```

## Project Structure

```
src/
  index.ts      # MCP server setup, tool definitions
  api.ts        # HTTP client for Reposit backend
  config.ts     # Backend configuration loading
dist/           # Compiled JavaScript output
```

## MCP Tools Exposed

| Tool            | Description                      |
| --------------- | -------------------------------- |
| `search`        | Semantic search for solutions    |
| `share`         | Contribute a new solution        |
| `vote_up`       | Upvote a helpful solution        |
| `vote_down`     | Downvote with reason and comment |
| `list_backends` | List configured backends         |

## Configuration

The server reads backend config from `~/.reposit/config.json` or environment variables:

```bash
# Single backend
export REPOSIT_URL=http://localhost:4000

# Multiple backends (JSON)
export REPOSIT_BACKENDS='{"community":{"url":"https://..."}}'
```

### Auto-Share Configuration

Control whether the `share` tool requires user confirmation:

```bash
# Environment variable (highest priority)
export REPOSIT_AUTO_SHARE=true
```

Or in config files:

```json
{
  "backends": { ... },
  "autoShare": true
}
```

**Priority**: `REPOSIT_AUTO_SHARE` env > `.reposit.json` > `~/.reposit/config.json` > default (false)

**Behavior**:
- `false` (default): Tool asks "Should I share this solution?" before sharing
- `true`: Tool shares automatically when appropriate

## Automatic Tool Triggering

Tools are configured to trigger automatically based on context:

- **search**: Triggers on unfamiliar errors, non-trivial problems, research requests
- **vote_up**: Triggers after successfully using a solution
- **vote_down**: Triggers when discovering issues with a solution
- **share**: Triggers after solving problems (asks first unless `autoShare: true`)

## Development

1. Ensure the Reposit backend is running: `cd ../reposit && mix phx.server`
2. Build and run: `bun run build && bun start`
3. Test with MCP Inspector or the reposit-claude-plugin

## Pre-commit

**ALWAYS run before committing:**

```bash
bun run build
```

This ensures TypeScript compiles successfully. The npm package ships compiled JS, so broken builds = broken package.

## Git

This directory is its own git repo (separate from the root monorepo).

## Releasing

Releases are done via GitHub releases, which triggers npm publishing via GitHub Actions:

```bash
# After bumping version in package.json and committing:
gh release create v0.x.x --title "v0.x.x: Brief description" --notes "Release notes here"
```

The release tag should match the version in `package.json` (prefixed with `v`).
