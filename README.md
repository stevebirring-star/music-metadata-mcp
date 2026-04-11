# music-metadata-mcp

MCP server for the [Music Metadata API](https://freqblog.com/music-api.html).

Lets Claude, Cursor, Windsurf, and any MCP-compatible AI assistant look up BPM, musical key, mood, genre, and 17 audio features by track name — no Spotify account, no ISRC required.

## Tools

| Tool | Description |
|------|-------------|
| `lookup_track` | Get BPM, key, mood, genre, danceability, energy and more for any track. Covers 24,000+ pre-analyzed tracks + 7.5M fallback via MusicBrainz |
| `find_tracks_by_bpm` | Find tracks within ±tolerance of a target BPM |
| `find_tracks_by_key` | Find tracks by key — Camelot (8A), Open Key (1m), or name (A-Minor) |
| `bulk_lookup` | Look up up to 50 tracks in one request |

## Quick Start

Get a free API key at [freqblog.com/music-api.html](https://freqblog.com/music-api.html) (500 req/month free).

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "music-metadata": {
      "command": "npx",
      "args": ["music-metadata-mcp", "--api-key=sk_live_YOUR_KEY_HERE"]
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP config (`.cursor/mcp.json` or `.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "music-metadata": {
      "command": "npx",
      "args": ["music-metadata-mcp", "--api-key=sk_live_YOUR_KEY_HERE"]
    }
  }
}
```

### Environment variable

```bash
export MUSIC_API_KEY=sk_live_YOUR_KEY_HERE
npx music-metadata-mcp
```

## Example prompts

Once connected, you can ask your AI:

- *"What's the BPM and key of Blinding Lights by The Weeknd?"*
- *"Find me 10 tracks in A-Minor around 128 BPM"*
- *"What's the mood and genre of Come to Daddy by Aphex Twin?"*
- *"Look up the audio features for these 5 tracks: ..."*

## API key tiers

| Plan | Price | Requests/month |
|------|-------|---------------|
| Free | £0 | 500 |
| Hobbyist | £9.99/mo | 3,000 |
| Starter | £39/mo | 20,000 |
| Professional | £129/mo | 150,000 |

[Get your key →](https://freqblog.com/music-api.html)

## Links

- [API documentation](https://freqblog.com/music-api.html)
- [OpenAPI / Swagger docs](https://api.freqblog.com/docs)
- [GitHub](https://github.com/stevebirring-star/music-metadata-api)
