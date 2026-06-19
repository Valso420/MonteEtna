import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = process.env.OUTPUT_DIR || "data";
const TRACKS_PATH = path.join(OUTPUT_DIR, "spotify-playlist-tracks.json");
const SUMMARY_PATH = path.join(OUTPUT_DIR, "spotify-playlist-summary.json");
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";
const PAGE_LIMIT = 50;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function loadDotEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function loadLocalEnv() {
  try {
    loadDotEnv(await readFile(".env", "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function asIsoOrNull(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSpotifyUrl(type, id) {
  return id ? `https://open.spotify.com/${type}/${id}` : null;
}

function normalizeAddedBy(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id || null,
    uri: user.uri || null,
    href: user.href || null,
    type: user.type || null,
    spotifyUrl: user.external_urls?.spotify || toSpotifyUrl("user", user.id),
  };
}

async function requestJson(url, options = {}, label = "request") {
  const response = await fetch(url, options);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Spotify ${label} failed ${response.status}: ${body}`);
  }

  return body ? JSON.parse(body) : null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function withoutLastUpdated(summary) {
  const copy = { ...summary };
  delete copy.lastUpdated;
  return copy;
}

async function refreshAccessToken() {
  const clientId = requireEnv("SPOTIFY_CLIENT_ID", process.env.SPOTIFY_CLIENT_ID);
  const clientSecret = requireEnv(
    "SPOTIFY_CLIENT_SECRET",
    process.env.SPOTIFY_CLIENT_SECRET,
  );
  const refreshToken = requireEnv(
    "SPOTIFY_REFRESH_TOKEN",
    process.env.SPOTIFY_REFRESH_TOKEN,
  );

  const basicToken = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const token = await requestJson(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
    "token refresh",
  );

  if (!token?.access_token) {
    throw new Error("Spotify did not return an access token.");
  }

  return token.access_token;
}

async function getPlaylist(accessToken, playlistId) {
  const fields = [
    "id",
    "name",
    "external_urls",
    "owner(display_name)",
    "followers(total)",
    "tracks(total)",
    "images(url,width,height)",
  ].join(",");

  return requestJson(
    `${API_URL}/playlists/${playlistId}?fields=${fields}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    "playlist metadata",
  );
}

async function getTracksPage(accessToken, playlistId, offset) {
  const fields = [
    "total",
    "limit",
    "offset",
    "next",
    "items(added_at,added_by(id,uri,href,type,external_urls),item(id,name,uri,external_urls,duration_ms,explicit,is_local,is_playable,available_markets,popularity,preview_url,artists(id,name,uri,external_urls),album(id,name,uri,external_urls,release_date,images(url,width,height))))",
  ].join(",");

  const params = new URLSearchParams({
    limit: String(PAGE_LIMIT),
    offset: String(offset),
    fields,
    market: "from_token",
    additional_types: "track",
  });

  return requestJson(
    `${API_URL}/playlists/${playlistId}/items?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    `playlist items offset ${offset}`,
  );
}

function normalizeTrack(item, index) {
  const track = item.track || item.item;

  if (!track) {
    return {
      position: index + 1,
      addedAt: asIsoOrNull(item.added_at),
      addedBy: normalizeAddedBy(item.added_by),
      id: null,
      name: null,
      artists: [],
      album: null,
      durationMs: 0,
      durationMin: 0,
      explicit: false,
      isLocal: false,
      isPlayable: false,
      isAvailable: false,
      availableMarkets: 0,
      popularity: null,
      previewUrl: null,
      spotifyUrl: null,
      uri: null,
    };
  }

  const artists = (track.artists || []).map((artist) => ({
    id: artist.id || null,
    name: artist.name || "",
    uri: artist.uri || null,
    spotifyUrl: artist.external_urls?.spotify || toSpotifyUrl("artist", artist.id),
  }));

  const availableMarkets = Array.isArray(track.available_markets)
    ? track.available_markets.length
    : 0;
  const isPlayable = track.is_playable !== false;
  const isAvailable = Boolean(track.is_local || isPlayable);

  return {
    position: index + 1,
    addedAt: asIsoOrNull(item.added_at),
    addedBy: normalizeAddedBy(item.added_by),
    id: track.id || null,
    name: track.name || "",
    artists,
    album: track.album
      ? {
          id: track.album.id || null,
          name: track.album.name || "",
          uri: track.album.uri || null,
          releaseDate: track.album.release_date || null,
          spotifyUrl:
            track.album.external_urls?.spotify || toSpotifyUrl("album", track.album.id),
          coverUrl: track.album.images?.[0]?.url || null,
        }
      : null,
    durationMs: track.duration_ms || 0,
    durationMin: Number(((track.duration_ms || 0) / 60000).toFixed(2)),
    explicit: Boolean(track.explicit),
    isLocal: Boolean(track.is_local),
    isPlayable,
    isAvailable,
    availableMarkets,
    popularity: Number.isFinite(track.popularity) ? track.popularity : null,
    previewUrl: track.preview_url || null,
    spotifyUrl: track.external_urls?.spotify || toSpotifyUrl("track", track.id),
    uri: track.uri || null,
  };
}

function sortByCountThenName(a, b) {
  if (b.tracks !== a.tracks) {
    return b.tracks - a.tracks;
  }

  return a.name.localeCompare(b.name);
}

function summarizeTracks(playlist, tracks, apiTotal) {
  if (tracks.length === 0) {
    throw new Error("Spotify returned 0 tracks.");
  }

  if (tracks.length !== apiTotal) {
    throw new Error(`Exported ${tracks.length} tracks but Spotify reported ${apiTotal}.`);
  }

  const tracksWithMetadata = tracks.filter((track) => track.id && track.name);
  if (tracksWithMetadata.length === 0) {
    throw new Error(
      "Spotify returned playlist items without track metadata. Check the fields selector or app access.",
    );
  }

  const artistCounts = new Map();
  const uniqueArtists = new Set();
  const uniqueAlbums = new Set();
  const trackCounts = new Map();

  for (const track of tracks) {
    for (const artist of track.artists) {
      if (!artist.name) {
        continue;
      }

      uniqueArtists.add(artist.id || artist.name);
      artistCounts.set(artist.name, (artistCounts.get(artist.name) || 0) + 1);
    }

    if (track.album?.id || track.album?.name) {
      uniqueAlbums.add(track.album.id || track.album.name);
    }

    const duplicateKey = track.id || track.uri;
    if (duplicateKey) {
      const existing = trackCounts.get(duplicateKey) || {
        id: track.id,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        count: 0,
      };
      existing.count += 1;
      trackCounts.set(duplicateKey, existing);
    }
  }

  const totalDurationMs = tracks.reduce((sum, track) => sum + track.durationMs, 0);
  const topArtists = [...artistCounts.entries()]
    .map(([name, count]) => ({ name, tracks: count }))
    .sort(sortByCountThenName)
    .slice(0, 20);
  const duplicateDetails = [...trackCounts.values()]
    .filter((track) => track.count > 1)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const recentTracks = tracks
    .filter((track) => track.addedAt)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .slice(0, 5)
    .map((track) => ({
      name: track.name,
      artists: track.artists.map((artist) => artist.name),
      addedAt: track.addedAt,
      spotifyUrl: track.spotifyUrl,
    }));

  return {
    schemaVersion: 1,
    playlistId: playlist.id,
    playlistName: playlist.name,
    playlistUrl: playlist.external_urls?.spotify || toSpotifyUrl("playlist", playlist.id),
    ownerName: playlist.owner?.display_name || null,
    followers: playlist.followers?.total ?? null,
    totalTracks: apiTotal,
    exportedTracks: tracks.length,
    totalDurationMs,
    totalHours: Number((totalDurationMs / 3600000).toFixed(1)),
    averageDurationMin: Number((totalDurationMs / tracks.length / 60000).toFixed(2)),
    uniqueArtists: uniqueArtists.size,
    uniqueAlbums: uniqueAlbums.size,
    topArtists,
    recentTracks,
    duplicateTracks: duplicateDetails.length,
    duplicateDetails,
    explicitTracks: tracks.filter((track) => track.explicit).length,
    availableTracks: tracks.filter((track) => track.isAvailable).length,
    unavailableTracks: tracks.filter((track) => !track.isAvailable).length,
    localTracks: tracks.filter((track) => track.isLocal).length,
    coverUrl: playlist.images?.[0]?.url || null,
    lastUpdated: new Date().toISOString(),
  };
}

async function main() {
  await loadLocalEnv();

  const playlistId = requireEnv("SPOTIFY_PLAYLIST_ID", process.env.SPOTIFY_PLAYLIST_ID);

  const accessToken = await refreshAccessToken();
  const playlist = await getPlaylist(accessToken, playlistId);
  const tracks = [];
  let totalTracks = playlist.tracks?.total ?? null;
  let offset = 0;

  while (totalTracks === null || offset < totalTracks) {
    const page = await getTracksPage(accessToken, playlistId, offset);
    totalTracks = page.total;

    for (const item of page.items || []) {
      tracks.push(normalizeTrack(item, tracks.length));
    }

    offset += page.items?.length || 0;
    console.log(`Fetched ${tracks.length} / ${totalTracks} tracks`);

    if (!page.next) {
      break;
    }
  }

  const summary = summarizeTracks(playlist, tracks, totalTracks);
  const previousTracks = await readJsonIfExists(TRACKS_PATH);
  const previousSummary = await readJsonIfExists(SUMMARY_PATH);

  if (
    previousTracks &&
    previousSummary?.lastUpdated &&
    JSON.stringify(previousTracks) === JSON.stringify(tracks) &&
    JSON.stringify(withoutLastUpdated(previousSummary)) ===
      JSON.stringify(withoutLastUpdated(summary))
  ) {
    summary.lastUpdated = previousSummary.lastUpdated;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(TRACKS_PATH, `${JSON.stringify(tracks, null, 2)}\n`);
  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`Wrote ${TRACKS_PATH}`);
  console.log(`Wrote ${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
