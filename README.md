# music-metadata-mcp

MCP server for the [FreqBlog Music API](https://freqblog.com/music-api.html).

Lets Claude, Cursor, Windsurf, and any MCP-compatible AI assistant look up audio features, build harmonic playlists, fetch lyrics, render waveforms, and export DJ-ready files — by track name, ISRC, MusicBrainz ID, or Spotify track ID. No Spotify account required; a track name alone works (no ISRC needed).

## Tools (v2.1.0 — 17 total)

### Core lookup
| Tool | Description |
|------|-------------|
| `lookup_track` | BPM, key, mood, genre, danceability, energy and 30+ more — by track name (+ optional artist), ISRC, MusicBrainz ID, or Spotify track ID. Covers 270k+ pre-analyzed tracks + 7.5M fallback via MusicBrainz/AcousticBrainz |
| `search_tracks` | Full-text search across the catalog (FTS5-backed) |
| `bulk_lookup` | Look up up to 50 tracks in one request |
| `find_tracks_by_bpm` | Find tracks within ±tolerance of a target BPM |
| `find_tracks_by_key` | Find tracks by key — Camelot (8A), Open Key (1m), or name (A-Minor) |

### Recommendations & DJ tools
| Tool | Description |
|------|-------------|
| `find_similar_tracks` | Cosine-similarity recommendation engine over the entire catalog |
| `build_radio_playlist` | Harmonic + BPM-continuity DJ playlist from a seed track |
| `export_playlist` | Generate Rekordbox XML / M3U / cuesheet from a list of track ids |
| `country_chart` | Live national music chart for 45 countries (Apple Music RSS) |
| `harmonic_keys` | Camelot wheel adjacency — pure logic, no quota |

### Browse
| Tool | Description |
|------|-------------|
| `find_artist_tracks` | List every catalog track for an artist (paginated) |
| `list_genres` | Distinct genre tags with track counts |
| `tracks_in_genre` | List tracks tagged with a genre |

### Per-track extras
| Tool | Description |
|------|-------------|
| `track_embedding` | 18-dim numeric vector for ML / similarity / clustering |
| `track_artwork_url` | Resolved cover-art image URL (iTunes / Cover Art Archive) |
| `track_lyrics` | Synced + plain lyrics via the open LRClib dataset |
| `track_waveform_svg` | SVG waveform render of the track's 30-second preview |

## Quick Start

Get a free API key at [freqblog.com/music-api.html](https://freqblog.com/music-api.html) (1,000 req/month free).

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
- *"Get the audio features for ISRC USUM71900001"* — also works with a MusicBrainz recording ID or a Spotify track ID

## API key tiers

| Plan | Price | Requests/month |
|------|-------|---------------|
| Free | £0 | 1,000 |
| Hobbyist | £9.99/mo | 15,000 |
| Starter | £39/mo | 150,000 |
| Professional | £129/mo | 750,000 |

[Get your key →](https://freqblog.com/music-api.html)

## Links

- [API documentation](https://freqblog.com/music-api.html)
- [OpenAPI / Swagger docs](https://api.freqblog.com/docs)
- [GitHub](https://github.com/stevebirring-star/music-metadata-api)
