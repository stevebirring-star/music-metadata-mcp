#!/usr/bin/env node
/**
 * music-metadata-mcp
 * MCP server for the Music Metadata API (https://freqblog.com/music-api.html)
 *
 * Exposes BPM, key, mood, genre and 30+ audio features through 20 MCP tools.
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
    "[music-metadata-mcp] Error: no API key set.\n" +
    "Pass --api-key=sk_live_... or set MUSIC_API_KEY env var.\n" +
    "Get a free key at https://freqblog.com/music-api.html\n"
  );
  process.exit(1);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Api-Key": API_KEY },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

async function apiGetText(path) {
  // For endpoints that return text/csv/SVG/XML rather than JSON.
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Api-Key": API_KEY },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.text();
}

async function apiGetRedirect(path) {
  // For endpoints that 302-redirect (e.g. /track/{id}/artwork). We want the
  // resolved URL string, not the bytes — return the Location header.
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Api-Key": API_KEY },
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    return res.headers.get("location");
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  // Endpoint didn't redirect — body should still be useful.
  return res.text();
}

function text(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function plain(content) {
  return { content: [{ type: "text", text: String(content) }] };
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "music-metadata", version: "2.4.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Music metadata, recognition, recommendation and DJ-tooling endpoints for the FreqBlog API.\n\n" +
      "PRIMARY: lookup_track (audio features by name, ISRC, MBID, or Spotify ID), search_tracks (full-text search), " +
      "find_similar_tracks (acoustic recommendation engine), get_recommendations (Spotify " +
      "/recommendations replacement — genre-aware blend of up to 5 seed tracks), get_related_artists " +
      "(Spotify related-artists replacement — derived artist graph).\n\n" +
      "DJ: build_radio_playlist (harmonic + BPM-continuity walk), export_playlist " +
      "(Rekordbox/M3U/cuesheet), country_chart (live national charts), harmonic_keys " +
      "(Camelot wheel adjacency).\n\n" +
      "SET FLOW (the differentiator — pairwise transition scoring + whole-set ordering): " +
      "score_transition (how well track A mixes into track B, 0-100), suggest_next_track " +
      "(ranked next-track picks for a seed), build_setlist (order a crate into a beat-matched " +
      "energy arc). Chain build_setlist -> export_playlist to drop straight into Rekordbox/Serato.\n\n" +
      "FILTER + BROWSE: find_tracks_by_bpm, find_tracks_by_key, find_artist_tracks, " +
      "list_genres, tracks_in_genre.\n\n" +
      "EXTRAS: track_lyrics (synced + plain), track_artwork_url (cover art), " +
      "track_waveform_svg (waveform render), track_embedding (numeric vector for ML), " +
      "tag_track (compact, honestly-labelled tag list — a tag-shaped projection of lookup_track, " +
      "each tag carrying its confidence + provenance).\n\n" +
      "BATCH: bulk_lookup (up to 50 tracks per call).",
  }
);

// ── Tool: lookup_track ────────────────────────────────────────────────────────

server.registerTool(
  "lookup_track",
  {
    description:
      "Look up audio features for a track — BPM, musical key, mood, genre, danceability, " +
      "energy, acousticness, instrumentalness and 30+ more. Provide exactly ONE of: a track " +
      "name (optionally with artist), an ISRC, a MusicBrainz recording ID (mbid), or a Spotify " +
      "track ID. For reliable coverage, identify by track name (+artist) or ISRC: a name miss " +
      "queues an on-demand fetch + analysis so even tracks not yet in the catalog get ingested " +
      "and returned shortly. A raw Spotify ID resolves ONLY tracks already mapped to a Spotify " +
      "ID — a minority of the catalog (~2.4%) — not as a universal Spotify-ID reverse lookup. " +
      "Covers 270,000+ pre-analyzed tracks (instant) plus 7.5M+ via MusicBrainz + " +
      "AcousticBrainz fallback. " +
      "Drop-in replacement for Spotify audio-features.",
    inputSchema: {
      track: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Track name. Supply this OR isrc OR mbid OR spotify_id."),
      artist: z
        .string()
        .max(200)
        .optional()
        .describe("Artist name — only used alongside `track`; improves accuracy."),
      isrc: z
        .string()
        .max(15)
        .optional()
        .describe("ISRC, e.g. USUM71900001. Catalog is checked first, then MusicBrainz/Deezer resolve the recording on a miss."),
      mbid: z
        .string()
        .max(40)
        .optional()
        .describe("MusicBrainz recording ID (UUID). Features come straight from AcousticBrainz for that exact recording — the precise key when no ISRC exists (e.g. pre-1986 vinyl) or a name match is ambiguous. Returns no result when AcousticBrainz has no analysis for the recording."),
      spotify_id: z
        .string()
        .max(80)
        .optional()
        .describe("Spotify track ID (also accepts a spotify:track: URI or an open.spotify.com URL). Resolves ONLY tracks already mapped to a Spotify ID — a minority of the catalog (~2.4%) — so it is not a universal Spotify-ID reverse lookup and will 404 on unmapped IDs. For reliable coverage, look up by `track` (+ `artist`) or by `isrc` instead; if your own Spotify app already gives you the track's external_ids.isrc, pass that as `isrc`."),
    },
  },
  async ({ track, artist, isrc, mbid, spotify_id }) => {
    const supplied = [
      ["track", track],
      ["isrc", isrc],
      ["mbid", mbid],
      ["spotify_id", spotify_id],
    ].filter(([, v]) => v != null && String(v).length > 0);
    if (supplied.length !== 1) {
      throw new Error(
        "Provide exactly one of: track (optionally with artist), isrc, mbid, or spotify_id."
      );
    }
    const [key, value] = supplied[0];
    const params = new URLSearchParams({ [key]: String(value) });
    if (key === "track" && artist) params.set("artist", artist);
    return text(await apiGet(`/lookup?${params}`));
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

// ── Tool: search_tracks (Slice 1) ─────────────────────────────────────────────

server.registerTool(
  "search_tracks",
  {
    description:
      "Full-text search across the catalog by track / artist / album. Returns " +
      "lightweight track stubs (no audio features) ranked by FTS5 BM25 relevance " +
      "then popularity. Use this when you don't have an exact track name — pass " +
      "any tokens and we prefix-match. Then call lookup_track for full features.",
    inputSchema: {
      q: z.string().min(1).max(200).describe("Search query (artist, track, album, or any combination)"),
      limit: z.number().int().min(1).max(50).default(10).describe("Max results (default 10)"),
    },
  },
  async ({ q, limit = 10 }) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return text(await apiGet(`/search?${params}`));
  }
);

// ── Tool: find_artist_tracks (Slice 1) ────────────────────────────────────────

server.registerTool(
  "find_artist_tracks",
  {
    description:
      "List every catalog track for an artist (case-insensitive exact match). " +
      "Paginated via limit + offset. Returns track stubs only — pair with " +
      "lookup_track or track_embedding for audio features.",
    inputSchema: {
      artist: z.string().min(1).max(200).describe("Artist name (case-insensitive exact match)"),
      limit: z.number().int().min(1).max(100).default(20).describe("Max tracks per page (default 20)"),
      offset: z.number().int().min(0).default(0).describe("Pagination offset"),
    },
  },
  async ({ artist, limit = 20, offset = 0 }) => {
    const params = new URLSearchParams({ artist, limit: String(limit), offset: String(offset) });
    return text(await apiGet(`/artist/tracks?${params}`));
  }
);

// ── Tool: list_genres (Slice 1) ───────────────────────────────────────────────

server.registerTool(
  "list_genres",
  {
    description:
      "List every distinct genre tag in the catalog with track counts. " +
      "Sorted by count descending. Use the resulting genre names with tracks_in_genre.",
    inputSchema: {
      min_count: z.number().int().min(1).default(1).describe("Minimum tracks-per-genre to include (default 1)"),
      limit: z.number().int().min(1).max(500).default(200).describe("Max genres to return"),
    },
  },
  async ({ min_count = 1, limit = 200 }) => {
    const params = new URLSearchParams({ min_count: String(min_count), limit: String(limit) });
    return text(await apiGet(`/genres?${params}`));
  }
);

// ── Tool: tracks_in_genre (Slice 1) ───────────────────────────────────────────

server.registerTool(
  "tracks_in_genre",
  {
    description:
      "List catalog tracks tagged with a specific genre. Discover available genre names " +
      "via list_genres. Paginated.",
    inputSchema: {
      genre: z.string().min(1).max(100).describe("Genre name (case-insensitive)"),
      limit: z.number().int().min(1).max(100).default(20).describe("Max tracks per page (default 20)"),
      offset: z.number().int().min(0).default(0).describe("Pagination offset"),
    },
  },
  async ({ genre, limit = 20, offset = 0 }) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return text(await apiGet(`/genres/${encodeURIComponent(genre)}/tracks?${params}`));
  }
);

// ── Tool: harmonic_keys (Slice 1) ─────────────────────────────────────────────

server.registerTool(
  "harmonic_keys",
  {
    description:
      "Pure-logic helper: given a Camelot value (e.g. 8A), return all harmonically " +
      "compatible keys. Always returns same / relative / adjacent_up / adjacent_down. " +
      "With extended=true also returns energy_boost (+7) and energy_drop (-7) for DJ key changes.",
    inputSchema: {
      camelot: z.string().min(2).max(3).describe("Camelot value e.g. '8A' or '12B'"),
      extended: z.boolean().default(false).describe("Include energy_boost/drop variants (default false)"),
    },
  },
  async ({ camelot, extended = false }) => {
    const params = new URLSearchParams({ extended: String(extended) });
    return text(await apiGet(`/key/${encodeURIComponent(camelot)}/compatible?${params}`));
  }
);

// ── Tool: track_embedding (Slice 1) ───────────────────────────────────────────

server.registerTool(
  "track_embedding",
  {
    description:
      "Project a track's audio features into an 18-dimensional numeric vector — for " +
      "similarity search, clustering, or feeding into your own ML model. Returns " +
      "embedding (filled with defaults for missing positions), embedding_mask " +
      "(true where real, false where filler), and fields (positional names).",
    inputSchema: {
      track_id: z.string().min(1).max(80).describe("Catalog itunes_track_id from any prior response"),
    },
  },
  async ({ track_id }) => {
    return text(await apiGet(`/track/${encodeURIComponent(track_id)}/embedding`));
  }
);

// ── Tool: find_similar_tracks (Slice 2) ───────────────────────────────────────

server.registerTool(
  "find_similar_tracks",
  {
    description:
      "Recommendation engine. Given a seed track id, return the most acoustically " +
      "similar tracks in the catalog ranked by cosine similarity over an 18-feature " +
      "audio embedding. Use exclude_same_artist=true for cross-artist discovery feeds.",
    inputSchema: {
      track_id: z.string().min(1).max(80).describe("Seed track id (catalog itunes_track_id)"),
      limit: z.number().int().min(1).max(50).default(10).describe("Max results (default 10)"),
      exclude_same_artist: z.boolean().default(false).describe("Drop tracks by the seed's artist"),
    },
  },
  async ({ track_id, limit = 10, exclude_same_artist = false }) => {
    const params = new URLSearchParams({
      track_id, limit: String(limit), exclude_same_artist: String(exclude_same_artist),
    });
    return text(await apiGet(`/similar?${params}`));
  }
);

// ── Tool: country_chart (Slice 3) ─────────────────────────────────────────────

server.registerTool(
  "country_chart",
  {
    description:
      "Live national music chart for any of 45 supported countries (ISO alpha-2, " +
      "lowercase: us, gb, jp, de, fr, mx, …). Sourced from Apple Music RSS, cached " +
      "12 hours. Each entry is cross-referenced against the catalog so in_catalog=true " +
      "entries carry a full TrackStub you can feed straight into other tools.",
    inputSchema: {
      country: z.string().length(2).describe("ISO 3166-1 alpha-2 country code, lowercase"),
      type: z.enum(["most-played", "new-music"]).default("most-played").describe("Chart type"),
      limit: z.number().int().min(1).max(100).default(50).describe("Max entries (default 50)"),
    },
  },
  async ({ country, type = "most-played", limit = 50 }) => {
    const params = new URLSearchParams({ type, limit: String(limit) });
    return text(await apiGet(`/charts/${encodeURIComponent(country)}?${params}`));
  }
);

// ── Tool: build_radio_playlist (Slice 3) ──────────────────────────────────────

server.registerTool(
  "build_radio_playlist",
  {
    description:
      "Generate a harmonic + BPM-continuity DJ playlist from a seed track. Greedy walk " +
      "over the similarity index that respects Camelot wheel adjacency and BPM drift. " +
      "Returns tracks in play order — pipe straight into export_playlist for a " +
      "ready-to-mix XML/M3U file.",
    inputSchema: {
      seed_track_id: z.string().min(1).max(80).describe("Seed track id"),
      n: z.number().int().min(2).max(50).default(20).describe("Total playlist length including seed"),
      max_key_distance: z.number().int().min(0).max(12).default(2).describe("Max Camelot wheel hops between consecutive tracks"),
      bpm_drift: z.number().min(0.5).max(30).default(8).describe("Max BPM difference between consecutive tracks"),
      exclude_same_artist: z.boolean().default(false).describe("Drop seed-artist tracks"),
    },
  },
  async ({ seed_track_id, n = 20, max_key_distance = 2, bpm_drift = 8, exclude_same_artist = false }) => {
    const params = new URLSearchParams({
      seed_track_id,
      n: String(n),
      max_key_distance: String(max_key_distance),
      bpm_drift: String(bpm_drift),
      exclude_same_artist: String(exclude_same_artist),
    });
    return text(await apiGet(`/radio?${params}`));
  }
);

// ── Tool: export_playlist (Slice 3) ───────────────────────────────────────────

server.registerTool(
  "export_playlist",
  {
    description:
      "Generate a DJ-ready playlist file from a list of catalog track ids. Format options: " +
      "rekordbox (Pioneer XML 1.0.0 with hot cues), m3u (Extended M3U8 for Serato/Traktor/" +
      "Engine DJ/VirtualDJ), or cuesheet (plain text). Up to 200 tracks per call. " +
      "Returns the file contents as text.",
    inputSchema: {
      format: z.enum(["rekordbox", "m3u", "cuesheet"]).describe("Output format"),
      track_ids: z.array(z.string()).min(1).max(200).describe("Catalog itunes_track_ids in playlist order"),
    },
  },
  async ({ format, track_ids }) => {
    const params = new URLSearchParams({ track_ids: track_ids.join(",") });
    return plain(await apiGetText(`/export/${encodeURIComponent(format)}?${params}`));
  }
);

// ── Tool: score_transition (Set Builder) ──────────────────────────────────────

server.registerTool(
  "score_transition",
  {
    description:
      "Score how well one catalog track mixes into another (0-100) — the pairwise DJ " +
      "transition score no raw key/BPM API gives you. Combines Camelot-wheel key " +
      "compatibility, octave-aware BPM proximity (half/double-time counts as a match), and " +
      "energy smoothness. Returns the overall score, per-component scores " +
      "(harmonic/tempo/energy), a detail block (key relation, both Camelot keys, both BPMs, " +
      "bpm_delta, bpm_octave_matched, both energies, energy_delta) and a one-line human reason. " +
      "Both ids are catalog itunes_track_ids (e.g. 'apple_ad1829eeccb70f9a') — get them from " +
      "search_tracks or any lookup_track response. Costs 1 quota unit.",
    inputSchema: {
      from_track_id: z.string().min(1).max(80).describe("The track you're mixing FROM (catalog itunes_track_id)"),
      to_track_id: z.string().min(1).max(80).describe("The candidate track you're mixing INTO (catalog itunes_track_id)"),
    },
  },
  async ({ from_track_id, to_track_id }) => {
    const params = new URLSearchParams({ from_track_id, to_track_id });
    return text(await apiGet(`/transition?${params}`));
  }
);

// ── Tool: suggest_next_track (Set Builder) ─────────────────────────────────────

server.registerTool(
  "suggest_next_track",
  {
    description:
      "Given a seed track, return the top-N catalog tracks to play NEXT, ranked by transition " +
      "score. Each suggestion carries the same transition score, per-component scores and " +
      "human reason as score_transition (e.g. '11B->11B same key, 118->117 BPM (-0.29), energy " +
      "+0.12'). The seed's sonic neighbours re-ranked for a clean mix — pair with build_setlist " +
      "to order a whole crate. seed_track_id is a catalog itunes_track_id from search_tracks or " +
      "any lookup_track response. Costs 3 quota units.",
    inputSchema: {
      seed_track_id: z.string().min(1).max(80).describe("The track currently playing (catalog itunes_track_id)"),
      n: z.number().int().min(1).max(50).default(10).describe("How many next-track suggestions to return (default 10)"),
      min_score: z.number().int().min(0).max(100).default(0).describe("Drop candidates below this overall transition score (default 0)"),
      exclude_same_artist: z.boolean().default(false).describe("Drop tracks by the seed's artist (default false)"),
      bpm_drift: z.number().min(0.5).max(30).default(12).describe("Max BPM difference pre-filter before scoring (default 12)"),
      max_key_distance: z.number().int().min(0).max(12).default(2).describe("Max Camelot-wheel hops pre-filter before scoring (default 2)"),
    },
  },
  async ({ seed_track_id, n = 10, min_score = 0, exclude_same_artist = false, bpm_drift = 12, max_key_distance = 2 }) => {
    const params = new URLSearchParams({
      seed_track_id,
      n: String(n),
      min_score: String(min_score),
      exclude_same_artist: String(exclude_same_artist),
      bpm_drift: String(bpm_drift),
      max_key_distance: String(max_key_distance),
    });
    return text(await apiGet(`/next-track?${params}`));
  }
);

// ── Tool: build_setlist (Set Builder) ──────────────────────────────────────────

server.registerTool(
  "build_setlist",
  {
    description:
      "Order a crate of 2-100 catalog tracks into a beat-matched DJ set that follows an energy " +
      "arc, keeping each consecutive transition harmonically and tempo-smooth. arc is one of " +
      "peak_time (default — builds to a peak then eases), warmup, cooldown, or flat. Returns " +
      "the tracks in play order, the per-step transition scores + reasons, an overall flow_score " +
      "(0-100), and any ids not found in the catalog (omitted). Pipe tracks[].itunes_track_id " +
      "straight into export_playlist for a ready-to-mix Rekordbox/Serato file. track_ids are " +
      "catalog itunes_track_ids. Costs 5 quota units.",
    inputSchema: {
      track_ids: z.array(z.string().min(1).max(80)).min(2).max(100).describe("The crate to order — 2 to 100 catalog itunes_track_ids"),
      arc: z.enum(["peak_time", "warmup", "cooldown", "flat"]).default("peak_time").describe("Energy arc to follow (default peak_time)"),
      start_track_id: z.string().min(1).max(80).optional().describe("Optional fixed opener — must be one of track_ids"),
    },
  },
  async ({ track_ids, arc = "peak_time", start_track_id }) => {
    const body = { track_ids, arc };
    if (start_track_id) body.start_track_id = start_track_id;
    return text(await apiPost("/setlist", body));
  }
);

// ── Tool: get_recommendations (Recommendations — Spotify /recommendations) ─────
server.registerTool(
  "get_recommendations",
  {
    description:
      "Recommended tracks for one or more seed tracks — the drop-in for Spotify's removed " +
      "GET /v1/recommendations. Blend up to 5 catalog seed tracks into a single point in " +
      "audio-feature space and return the nearest catalogue tracks, RE-RANKED by genre affinity " +
      "(so a feature-close cross-genre track doesn't outrank same-genre picks). Returns `seeds` " +
      "(each {id, found}), `count`, and `tracks` (each {track, score}). `score` is the raw " +
      "audio-feature cosine similarity in [0,1]; genre affinity influences ORDER, not the score, " +
      "so the list is NOT strictly score-descending. seed_tracks are catalog itunes_track_ids " +
      "(e.g. 'apple_ad1829eeccb70f9a') from search_tracks or any lookup_track response. Costs 2 quota units.",
    inputSchema: {
      seed_tracks: z
        .array(z.string().min(1).max(80))
        .min(1)
        .max(5)
        .describe("1-5 catalog itunes_track_ids to base recommendations on (blended into a feature-space centroid)"),
      limit: z.number().int().min(1).max(100).default(20).describe("Number of recommendations to return (default 20)"),
      exclude_seed_artists: z.boolean().default(false).describe("Drop tracks by any of the seed artists (default false)"),
    },
  },
  async ({ seed_tracks, limit = 20, exclude_seed_artists = false }) => {
    const params = new URLSearchParams({
      seed_tracks: seed_tracks.join(","),
      limit: String(limit),
      exclude_seed_artists: String(exclude_seed_artists),
    });
    return text(await apiGet(`/recommendations?${params}`));
  }
);

// ── Tool: get_related_artists (Recommendations — Spotify related-artists) ─────
server.registerTool(
  "get_related_artists",
  {
    description:
      "Artists related to a seed artist — the drop-in for Spotify's removed " +
      "GET /v1/artists/{id}/related-artists. No artist graph exists, so we derive one: build the " +
      "seed artist's track-vector centroid, take its nearest catalogue tracks, aggregate by artist " +
      "(each scored on its top-3 track similarities so a prolific artist can't dominate) plus a " +
      "same-genre lift and a cross-genre penalty. Returns `artist`, `count`, and `related` (each " +
      "{artist_name, score, match_count, sample_track_id}). Pass a sample_track_id straight to " +
      "lookup_track or suggest_next_track. Costs 2 quota units.",
    inputSchema: {
      artist: z.string().min(1).max(200).describe("Seed artist name (as it appears in the catalog; case-insensitive)"),
      limit: z.number().int().min(1).max(50).default(20).describe("Number of related artists to return (default 20)"),
    },
  },
  async ({ artist, limit = 20 }) => {
    const params = new URLSearchParams({ artist, limit: String(limit) });
    return text(await apiGet(`/related-artists?${params}`));
  }
);

// ── Tool: track_artwork_url (Slice 7) ─────────────────────────────────────────

server.registerTool(
  "track_artwork_url",
  {
    description:
      "Get a cover-art image URL for a track. Resolves via iTunes Lookup for numeric " +
      "catalog ids, or Cover Art Archive via MBID for the rest. Returns the final " +
      "image URL string (the API endpoint 302-redirects; this tool returns the redirect target).",
    inputSchema: {
      track_id: z.string().min(1).max(80).describe("Catalog itunes_track_id"),
      size: z.number().int().min(100).max(1200).default(600).describe("Desired image size in pixels"),
    },
  },
  async ({ track_id, size = 600 }) => {
    const params = new URLSearchParams({ size: String(size) });
    return plain(await apiGetRedirect(`/track/${encodeURIComponent(track_id)}/artwork?${params}`));
  }
);

// ── Tool: track_lyrics (Slice 8) ──────────────────────────────────────────────

server.registerTool(
  "track_lyrics",
  {
    description:
      "Synced + plain lyrics for a catalog track via the open LRClib dataset. Synced lyrics " +
      "come back parsed as [{ms, text}] — no LRC parsing needed. Returns instrumental=true " +
      "for tracks LRClib has flagged as instrumental.",
    inputSchema: {
      track_id: z.string().min(1).max(80).describe("Catalog itunes_track_id"),
    },
  },
  async ({ track_id }) => {
    return text(await apiGet(`/track/${encodeURIComponent(track_id)}/lyrics`));
  }
);

// ── Tool: track_waveform_svg (Slice 8) ────────────────────────────────────────

server.registerTool(
  "track_waveform_svg",
  {
    description:
      "SVG waveform render of the track's 30-second iTunes preview. 120 RMS-bucketed " +
      "bars themable via CSS currentColor. Returns the SVG markup as text — embed " +
      "directly in HTML or save to a .svg file. Catalog tracks with numeric iTunes ids " +
      "only; synthetic ids (mb:/fma:/msd:) return 404.",
    inputSchema: {
      track_id: z.string().min(1).max(80).describe("Numeric catalog itunes_track_id"),
      w: z.number().int().min(120).max(2400).default(600).describe("Width in px"),
      h: z.number().int().min(20).max(400).default(80).describe("Height in px"),
    },
  },
  async ({ track_id, w = 600, h = 80 }) => {
    const params = new URLSearchParams({ w: String(w), h: String(h) });
    return plain(await apiGetText(`/track/${encodeURIComponent(track_id)}/waveform.svg?${params}`));
  }
);
// ── Tool: tag_track (Tags) ──────────────────────────────────────────────────

server.registerTool(
  "tag_track",
  {
    description:
      "Get a compact, HONESTLY-LABELLED tag list for a track — energy / danceability / valence / " +
      "acousticness / instrumentalness, plus a mood tag and a broad genre tag. It is a tag-shaped " +
      "projection of the same open-data analysis lookup_track returns (no audio upload, no extra " +
      "compute), so it costs the same 1 quota unit and is charged only on a served result. The " +
      "differentiator vs opaque taggers (e.g. Cyanite) is that EVERY tag carries its own " +
      "`confidence` (measured = our Essentia analysis | derived = MIREX mood from valence+energy | " +
      "model-estimated = AcousticBrainz mood SVM probability, raw prob in `value` | catalog-genre = " +
      "broad catalogue tag) and `provenance` (essentia | valence+energy | acousticbrainz | catalog). " +
      "`value` is the [0,1] score for numeric tags and null for label-only tags (mood category, " +
      "genre). Provide exactly ONE of: a track name (optionally with artist), an ISRC, a " +
      "MusicBrainz recording ID (mbid), a Spotify track ID, or a catalog track_id " +
      "(itunes_track_id from any prior response). The broad, reliable coverage is the MEASURED tags " +
      "from our Essentia analysis over the analysed catalogue (~178k+ tracks, plus on-demand by " +
      "name); MBID/ISRC additionally reach 7.5M+ AcousticBrainz recordings WHEN you supply that " +
      "identifier. For the full numeric feature set use lookup_track; for nearest tracks use " +
      "find_similar_tracks. Returns { track, count, tags, disclaimer }.",
    inputSchema: {
      track: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Track name. Supply this OR isrc OR mbid OR spotify_id OR track_id."),
      artist: z
        .string()
        .max(200)
        .optional()
        .describe("Artist name — only used alongside `track`; improves accuracy."),
      isrc: z
        .string()
        .max(15)
        .optional()
        .describe("ISRC, e.g. USUM71900001."),
      mbid: z
        .string()
        .max(40)
        .optional()
        .describe("MusicBrainz recording ID (UUID). Tags come from AcousticBrainz for that exact recording."),
      spotify_id: z
        .string()
        .max(80)
        .optional()
        .describe("Spotify track ID (also accepts a spotify:track: URI or open.spotify.com URL). Resolves ONLY tracks already mapped to a Spotify ID (~2.4% of the catalog) — prefer track (+artist) or isrc."),
      track_id: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe("Catalog itunes_track_id from any prior response (e.g. search_tracks or a lookup_track result)."),
    },
  },
  async ({ track, artist, isrc, mbid, spotify_id, track_id }) => {
    const supplied = [
      ["track", track],
      ["isrc", isrc],
      ["mbid", mbid],
      ["spotify_id", spotify_id],
      ["track_id", track_id],
    ].filter(([, v]) => v != null && String(v).length > 0);
    if (supplied.length !== 1) {
      throw new Error(
        "Provide exactly one of: track (optionally with artist), isrc, mbid, spotify_id, or track_id."
      );
    }
    const [k, value] = supplied[0];
    const params = new URLSearchParams({ [k]: String(value) });
    if (k === "track" && artist) params.set("artist", artist);
    return text(await apiGet(`/tag?${params}`));
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[music-metadata-mcp] Server running on stdio (v2.4.0 — 23 tools)\n");
