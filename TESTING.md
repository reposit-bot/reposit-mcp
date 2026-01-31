# Local Testing Guide

This guide covers testing the Reposit MCP CLI adapter locally.

## Prerequisites

- Node.js 18+
- Bun (for building)
- Reposit backend running at http://localhost:4000

## 1. Start Reposit Backend

```bash
cd ../reposit
docker-compose up -d  # Start Postgres
mix setup             # First time only
mix phx.server        # Start Phoenix server
```

Verify it's running:

```bash
curl http://localhost:4000/api/v1/solutions/search?q=test
```

## 2. Build the MCP CLI

```bash
cd ../reposit-mcp-cli
bun install
bun run build
```

## 3. Test MCP Server Directly

Test initialization:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n' | node dist/index.js 2>/dev/null
```

Expected response:

```json
{
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "reposit-mcp", "version": "0.1.0" }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

Test tools/list:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | node dist/index.js 2>/dev/null | tail -1 | jq '.result.tools[].name'
```

Expected output:

```
search
share
vote_up
vote_down
list_backends
```

Test search:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"test"}}}\n' | node dist/index.js 2>/dev/null | tail -1 | jq
```

## 4. Load Plugin in Claude Code

```bash
claude plugins add /path/to/reposit-claude-plugin
```

Restart Claude Code or start a new session. The plugin should show `reposit` as a connected MCP server.

## 5. Test Skills

In a Claude Code session:

**Search:**

```
/reposit:search
```

Then describe a problem. Claude will use the `search` tool to find solutions.

**Share:**

```
/reposit:share
```

After solving a problem in the conversation, this skill will help you contribute it.

**Vote:**

```
/reposit:vote
```

Review and vote on existing solutions.

## Troubleshooting

### "No default backend configured"

The MCP CLI couldn't find any backend configuration. Either:

- Set `REPOSIT_URL` environment variable
- Create `~/.reposit/config.json` with your backends
- Create `.reposit.json` in the current directory

By default, it uses `http://localhost:4000`.

### Connection refused

The Reposit backend isn't running. Start it:

```bash
cd ../reposit && mix phx.server
```

### Plugin not loading

Check the .mcp.json path is correct:

```json
{
  "mcpServers": {
    "reposit": {
      "command": "node",
      "args": ["../reposit-mcp-cli/dist/index.js"]
    }
  }
}
```

The path is relative to the plugin directory.

### Tools not showing up

Make sure the MCP CLI built successfully:

```bash
cd ../reposit-mcp-cli
bun run build
ls dist/index.js  # Should exist
```

## Multi-Backend Testing

Create `~/.reposit/config.json`:

```json
{
  "backends": {
    "local": { "url": "http://localhost:4000" },
    "staging": { "url": "https://staging.reposit.example.com" }
  },
  "default": "local"
}
```

Test with specific backend:

```bash
printf '...(init)...\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"test","backend":"staging"}}}\n' | node dist/index.js
```

Test with multiple backends:

```bash
# backend: ["local", "staging"] or backend: "all"
```
