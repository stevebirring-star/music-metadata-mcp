#!/usr/bin/env node
/**
 * music-metadata-mcp
 * MCP server for the Music Metadata API (https://freqblog.com/music-api.html)
 *
 * Exposes BPM, key, mood, genre, and 17 audio features as MCP tools.
 * Drop-in replacement for Spotify audio-features in AI workflows.
 *
 * Usage:
 *   npx music-metadata-mcp --api-key=sk_live_...
 *   MUSIC_API_KEY=sk_live_... npx music-metadata-mcp
 *
 * Add to Claude Desktop (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "music-metadata": {
 *         "command": "npx",
 *         "args": ["music-metadata-mcp", "--api-key=sk_live_YOUR_KEY"]
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Config ───────────────────────────────────────────────────────────────────

const API_KEY =
  process.env.MUSIC_API_KEY ||
  process.argv.find((a) => a.startsWith("--api-key="))?.split("=").slice(1).join("=") ||
  "";

const BASE_URL =
  process.env.MUSIC_API_URL || "https://api.freqblog.com";

if (!API_KEY) {
  process.stderr.write(
    "[music-metadata-mcp] Warning: no API key set. " +
    "Pass --api-key=sk_live_... or set MUSIC_API_KEY env var.\n" +
    "Get a free key at https://freqblog.com/music-api.html\n"
  );
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Api-Key": API_KEY },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  return data;
}

function text(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "music-metadata", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Use lookup_track to get BPM, key, mood, genre and audio features for any song by name. " +
      "Use find_tracks_by_bpm to find harmonically compatible tracks for DJs and playlist builders. " +
      "Use find_tracks_by_key for harmonic mixing. " +
      "Use bulk_lookup for batch processing of up to 50 tracks at once.",
  }
);

// ── Tool: lookup_track ────────────────────────────────────────────────────────

server.registerTool(
  "lookup_track",
  {
    description:
      "Look up audio features for a track by name — BPM, musical key, mood, genre, " +
      "danceability, energy, acousticness, instrumentalness, and more. " +
      "Covers 24,000+ pre-analyzed chart tracks (instant) plus 7.5M+ additional tracks " +
      "via MusicBrainz + AcousticBrainz fallback. Drop-in replacement for Spotify audio-features.",
    inputSchema: {
      track: z.string().min(2).max(200).describe("Track name"),
      artist: z
        .string()
        .max(200)
        .optional()
        .describe("Artist name — optional but improves accuracy"),
    },
  },
  async ({ track, artist }) => {
    const params = new URLSearchParams({ track });
    if (artist) params.set("artist", artist);
    const data = await apiGet(`/lookup?${params}`);
    return text(data);
  }
);

// ── Tool: find_tracks_by_bpm ──────────────────────────────────────────────────

server.registerTool(
  "find_tracks_by_bpm",
  {
    description:
      "Find pre-analyzed tracks within a BPM range. " +
      "Results ordered by proximity to target BPM then by popularity. " +
      "Useful for DJ set planning, workout playlist building, and tempo-matching.",
    inputSchema: {
      bpm: z
        .number()
        .min(20)
        .max(300)
        .describe("Target BPM"),
      tolerance: z
        .number()
        .min(0.5)
        .max(10)
        .default(2)
        .describe("BPM tolerance window ±BPM (default: 2)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max tracks to return (default: 10)"),
    },
  },
  async ({ bpm, tolerance = 2, limit = 10 }) => {
    const params = new URLSearchParams({
      q: String(bpm),
      tolerance: String(tolerance),
      limit: String(limit),
    });
    const data = await apiGet(`/bpm?${params}`);
    return text(data);
  }
);

// ── Tool: find_tracks_by_key ──────────────────────────────────────────────────

server.registerTool(
  "find_tracks_by_key",
  {
    description:
      "Find pre-analyzed tracks in a specific musical key. " +
      "Accepts Camelot notation (e.g. '8A'), Open Key (e.g. '1m'), or key name (e.g. 'A-Minor'). " +
      "Results ordered by popularity. Perfect for harmonic mixing and key-locked playlists.",
    inputSchema: {
      key: z
        .string()
        .min(1)
        .max(20)
        .describe(
          "Musical key — Camelot (8A), Open Key (1m), or name (A-Minor / F#-Major)"
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max tracks to return (default: 10)"),
    },
  },
  async ({ key, limit = 10 }) => {
    const params = new URLSearchParams({ q: key, limit: String(limit) });
    const data = await apiGet(`/key?${params}`);
    return text(data);
  }
);

// ── Tool: bulk_lookup ─────────────────────────────────────────────────────────

server.registerTool(
  "bulk_lookup",
  {
    description:
      "Look up audio features for up to 50 tracks in a single request. " +
      "Much faster than looping lookup_track. " +
      "Each track in the request uses one quota token. " +
      "Returns found/not_found counts alongside individual results.",
    inputSchema: {
      tracks: z
        .array(
          z.object({
            track: z.string().min(2).max(200).describe("Track name"),
            artist: z
              .string()
              .max(200)
              .optional()
              .describe("Artist name (optional)"),
          })
        )
        .min(1)
        .max(50)
        .describe("Array of tracks to look up (max 50)"),
    },
  },
  async ({ tracks }) => {
    const data = await apiPost("/bulk", tracks);
    return text(data);
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[music-metadata-mcp] Server running on stdio\n");
