# gowhistle-mcp

MCP server for **[Whistle](https://gowhistle.io)** — collegiate athletics sales intelligence.

Query verified contact data, school profiles, and hiring/departure signals across 350+ NCAA athletic departments directly from any MCP client (Claude, Cursor, Windsurf, etc.).

## Tools

| Tool | What it does |
|------|--------------|
| `search_staff` | Search staff by name, title, school, or free-text |
| `get_school` | Full school profile — staff list, division, conference |
| `get_signals` | Recent hire / departure / title-change signals |
| `trigger_scrape` | Queue a fresh data refresh for a school |

## Setup

You need a Whistle API key (`sk_live_…`). Get one from your Whistle account.

### Claude Code / Claude Desktop

```bash
claude mcp add whistle \
  --env WHISTLE_API_KEY=sk_live_yourkey \
  -- npx -y gowhistle-mcp
```

### Manual config (any MCP client)

```json
{
  "mcpServers": {
    "whistle": {
      "command": "npx",
      "args": ["-y", "gowhistle-mcp"],
      "env": {
        "WHISTLE_API_KEY": "sk_live_yourkey"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `WHISTLE_API_KEY` | yes | — | Your Whistle API key |
| `WHISTLE_API_BASE` | no | `https://gowhistle.io` | Override the API base URL |

## License

MIT · [gowhistle.io](https://gowhistle.io)
