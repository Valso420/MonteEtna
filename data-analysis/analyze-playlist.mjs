import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const analysisDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(analysisDirectory, "..");
const tracksPath = resolve(repositoryRoot, "data/spotify-playlist-tracks.json");
const summaryPath = resolve(repositoryRoot, "data/spotify-playlist-summary.json");
const resultsPath = resolve(analysisDirectory, "analysis-results.json");
const artifactPath = resolve(analysisDirectory, "artifact.json");
const reportSourcePath = resolve(analysisDirectory, "report-source.sql");

const tracks = JSON.parse(readFileSync(tracksPath, "utf8"));
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const reportSql = readFileSync(reportSourcePath, "utf8");

if (!Array.isArray(tracks) || tracks.length === 0) {
  throw new Error("Expected a non-empty Spotify track array.");
}

const DAY_MS = 86_400_000;
const snapshotDate = new Date(summary.lastUpdated);

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function percent(part, total, digits = 1) {
  return total === 0 ? 0 : round((part / total) * 100, digits);
}

function quantile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function groupCount(items, keySelector) {
  const counts = new Map();
  for (const item of items) {
    const key = keySelector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sortedCountRows(counts, label = "label") {
  return [...counts.entries()]
    .map(([key, count]) => ({ [label]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[label]).localeCompare(String(right[label])));
}

function monthRange(firstMonth, lastMonth) {
  const months = [];
  let [year, month] = firstMonth.split("-").map(Number);
  const [lastYear, lastMonthNumber] = lastMonth.split("-").map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonthNumber)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function releaseYear(track) {
  const value = track.album?.releaseDate;
  const match = /^(\d{4})/.exec(String(value ?? ""));
  return match ? Number(match[1]) : null;
}

function artistKey(artist) {
  return artist.id || artist.uri || normalizeText(artist.name);
}

function albumKey(track) {
  return track.album?.id || track.album?.uri || `${normalizeText(track.album?.name)}|${artistKey(track.artists?.[0] ?? {})}`;
}

const trackIdentities = new Map();
const exactRows = new Map();
for (const track of tracks) {
  const identity = track.id || track.uri;
  if (identity) {
    const matchingTracks = trackIdentities.get(identity) ?? [];
    matchingTracks.push(track);
    trackIdentities.set(identity, matchingTracks);
  }
  const exactKey = JSON.stringify(track);
  exactRows.set(exactKey, (exactRows.get(exactKey) ?? 0) + 1);
}

const duplicateIdentities = [...trackIdentities.entries()]
  .filter(([, matchingTracks]) => matchingTracks.length > 1)
  .map(([identity, matchingTracks]) => ({
    identity,
    name: matchingTracks[0].name,
    artists: matchingTracks[0].artists.map((artist) => artist.name).join(", "),
    positions: matchingTracks.map((track) => track.position),
    occurrences: matchingTracks.length,
  }));

const metadataGroups = new Map();
for (const track of tracks) {
  const artists = track.artists.map(artistKey).sort().join("|");
  const key = `${normalizeText(track.name)}|${artists}`;
  const matchingTracks = metadataGroups.get(key) ?? [];
  matchingTracks.push(track);
  metadataGroups.set(key, matchingTracks);
}

const sameRecordingCandidates = [];
for (const matchingTracks of metadataGroups.values()) {
  if (matchingTracks.length < 2) continue;
  const ordered = [...matchingTracks].sort((left, right) => left.durationMs - right.durationMs);
  const cluster = [];
  for (const track of ordered) {
    const previous = cluster.at(-1);
    if (previous && track.durationMs - previous.durationMs > 2_000) {
      if (new Set(cluster.map((item) => item.id || item.uri)).size > 1) {
        sameRecordingCandidates.push([...cluster]);
      }
      cluster.length = 0;
    }
    cluster.push(track);
  }
  if (new Set(cluster.map((item) => item.id || item.uri)).size > 1) {
    sameRecordingCandidates.push([...cluster]);
  }
}

const candidateRows = sameRecordingCandidates
  .map((cluster) => ({
    name: cluster[0].name,
    artists: cluster[0].artists.map((artist) => artist.name).join(", "),
    entries: cluster.length,
    durationDifferenceSeconds: round((Math.max(...cluster.map((track) => track.durationMs)) - Math.min(...cluster.map((track) => track.durationMs))) / 1_000, 1),
    albums: [...new Set(cluster.map((track) => track.album?.name).filter(Boolean))],
    ids: cluster.map((track) => track.id || track.uri),
    positions: cluster.map((track) => track.position),
  }))
  .sort((left, right) => right.entries - left.entries || left.name.localeCompare(right.name));

const nullProfileFields = {
  id: (track) => track.id,
  uri: (track) => track.uri,
  name: (track) => track.name,
  addedAt: (track) => track.addedAt,
  addedById: (track) => track.addedBy?.id,
  artists: (track) => track.artists?.length,
  albumId: (track) => track.album?.id,
  albumName: (track) => track.album?.name,
  albumReleaseDate: (track) => track.album?.releaseDate,
  durationMs: (track) => track.durationMs,
  spotifyUrl: (track) => track.spotifyUrl,
  popularity: (track) => track.popularity,
  previewUrl: (track) => track.previewUrl,
};

const completeness = Object.entries(nullProfileFields).map(([field, getter]) => {
  const missing = tracks.filter((track) => getter(track) === null || getter(track) === undefined || getter(track) === "").length;
  return { field, missing, missingRate: percent(missing, tracks.length) };
});

const positions = tracks.map((track) => track.position);
const uniquePositions = new Set(positions);
const expectedPositions = new Set(Array.from({ length: tracks.length }, (_, index) => index + 1));
const positionsAreContiguous = uniquePositions.size === tracks.length && [...expectedPositions].every((position) => uniquePositions.has(position));

const durationValues = tracks.map((track) => track.durationMs).filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
const durationBands = [
  { band: "Menos de 3 min", order: 1, predicate: (minutes) => minutes < 3 },
  { band: "3 a 5 min", order: 2, predicate: (minutes) => minutes >= 3 && minutes < 5 },
  { band: "5 a 7 min", order: 3, predicate: (minutes) => minutes >= 5 && minutes < 7 },
  { band: "7 a 10 min", order: 4, predicate: (minutes) => minutes >= 7 && minutes < 10 },
  { band: "10 min o más", order: 5, predicate: (minutes) => minutes >= 10 },
].map((definition) => {
  const count = tracks.filter((track) => definition.predicate(track.durationMs / 60_000)).length;
  return { band: definition.band, order: definition.order, tracks: count, share: percent(count, tracks.length) / 100 };
});

const longestTracks = [...tracks]
  .sort((left, right) => right.durationMs - left.durationMs)
  .slice(0, 10)
  .map((track) => ({
    name: track.name,
    artists: track.artists.map((artist) => artist.name).join(", "),
    durationMin: round(track.durationMs / 60_000, 2),
    album: track.album?.name ?? null,
    releaseDate: track.album?.releaseDate ?? null,
  }));

const artistCounts = new Map();
const artistNames = new Map();
const primaryArtistCounts = new Map();
for (const track of tracks) {
  const seenArtistKeys = new Set();
  for (const artist of track.artists) {
    const key = artistKey(artist);
    artistNames.set(key, artist.name);
    if (!seenArtistKeys.has(key)) {
      artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
      seenArtistKeys.add(key);
    }
  }
  const primaryArtist = track.artists[0];
  if (primaryArtist) {
    const key = artistKey(primaryArtist);
    primaryArtistCounts.set(key, (primaryArtistCounts.get(key) ?? 0) + 1);
  }
}

const topArtists = [...artistCounts.entries()]
  .map(([key, count]) => ({ key, artist: artistNames.get(key), tracks: count, share: count / tracks.length }))
  .sort((left, right) => right.tracks - left.tracks || left.artist.localeCompare(right.artist));
const topPrimaryArtists = [...primaryArtistCounts.entries()]
  .map(([key, count]) => ({ artist: artistNames.get(key), tracks: count, share: count / tracks.length }))
  .sort((left, right) => right.tracks - left.tracks || left.artist.localeCompare(right.artist));
const artistTrackCounts = [...artistCounts.values()].sort((left, right) => left - right);
const topTenArtistKeys = new Set(topArtists.slice(0, 10).map((row) => row.key));
const tracksWithTopTenArtist = tracks.filter((track) => track.artists.some((artist) => topTenArtistKeys.has(artistKey(artist)))).length;
const artistCredits = tracks.reduce((total, track) => total + new Set(track.artists.map(artistKey)).size, 0);

const albumGroups = new Map();
for (const track of tracks) {
  const key = albumKey(track);
  const matchingTracks = albumGroups.get(key) ?? [];
  matchingTracks.push(track);
  albumGroups.set(key, matchingTracks);
}
const topAlbums = [...albumGroups.values()]
  .map((matchingTracks) => ({
    album: matchingTracks[0].album?.name ?? "Sin álbum",
    primaryArtist: matchingTracks[0].artists[0]?.name ?? "Desconocido",
    tracks: matchingTracks.length,
    releaseDate: matchingTracks[0].album?.releaseDate ?? null,
  }))
  .sort((left, right) => right.tracks - left.tracks || left.album.localeCompare(right.album));

const collaborationBands = [
  { collaborators: "1 artista", order: 1, predicate: (count) => count === 1 },
  { collaborators: "2 artistas", order: 2, predicate: (count) => count === 2 },
  { collaborators: "3 artistas", order: 3, predicate: (count) => count === 3 },
  { collaborators: "4 o más", order: 4, predicate: (count) => count >= 4 },
].map((definition) => {
  const count = tracks.filter((track) => definition.predicate(new Set(track.artists.map(artistKey)).size)).length;
  return { collaborators: definition.collaborators, order: definition.order, tracks: count, share: count / tracks.length };
});

const releaseYears = tracks.map(releaseYear).filter(Number.isFinite);
const releaseYearCounts = groupCount(releaseYears, (year) => year);
const releaseMixDefinitions = [
  { bucket: "Antes de 2000", order: 1, predicate: (year) => year < 2000 },
  { bucket: "2000–2009", order: 2, predicate: (year) => year >= 2000 && year <= 2009 },
  { bucket: "2010–2019", order: 3, predicate: (year) => year >= 2010 && year <= 2019 },
  { bucket: "2020–2022", order: 4, predicate: (year) => year >= 2020 && year <= 2022 },
  { bucket: "2023", order: 5, predicate: (year) => year === 2023 },
  { bucket: "2024", order: 6, predicate: (year) => year === 2024 },
  { bucket: "2025", order: 7, predicate: (year) => year === 2025 },
  { bucket: "2026", order: 8, predicate: (year) => year === 2026 },
].map((definition) => {
  const count = releaseYears.filter(definition.predicate).length;
  return { bucket: definition.bucket, order: definition.order, tracks: count, share: releaseYears.length === 0 ? 0 : count / releaseYears.length };
});

const releaseLagDays = tracks
  .filter((track) => /^\d{4}-\d{2}-\d{2}$/.test(String(track.album?.releaseDate ?? "")) && track.addedAt)
  .map((track) => (new Date(track.addedAt).getTime() - new Date(`${track.album.releaseDate}T00:00:00.000Z`).getTime()) / DAY_MS)
  .filter(Number.isFinite)
  .sort((left, right) => left - right);
const negativeReleaseLags = releaseLagDays.filter((days) => days < -1).length;
const nonNegativeReleaseLags = releaseLagDays.filter((days) => days >= -1).map((days) => Math.max(0, days));

const addedDates = tracks.map((track) => new Date(track.addedAt)).filter((date) => Number.isFinite(date.getTime())).sort((left, right) => left - right);
const additionsByMonth = groupCount(addedDates, (date) => date.toISOString().slice(0, 7));
const additionsMonthly = monthRange(addedDates[0].toISOString().slice(0, 7), addedDates.at(-1).toISOString().slice(0, 7)).map((month) => ({
  month,
  tracks: additionsByMonth.get(month) ?? 0,
  year: Number(month.slice(0, 4)),
  monthNumber: Number(month.slice(5, 7)),
}));
let cumulativeTracks = 0;
for (const row of additionsMonthly) {
  cumulativeTracks += row.tracks;
  row.cumulativeTracks = cumulativeTracks;
}
const additionsYearly = sortedCountRows(groupCount(addedDates, (date) => date.getUTCFullYear()), "year").sort((left, right) => left.year - right.year);
const additionsByDay = sortedCountRows(groupCount(addedDates, (date) => date.toISOString().slice(0, 10)), "date").slice(0, 12);
const activeMonthCounts = additionsMonthly.filter((row) => row.tracks > 0).map((row) => row.tracks).sort((left, right) => left - right);
const latestAddedAt = addedDates.at(-1);

const versionMarkerDefinitions = [
  { marker: "Remix", pattern: /\bremix\b/i },
  { marker: "Edit", pattern: /\bedit\b/i },
  { marker: "Extended", pattern: /\bextended\b/i },
  { marker: "Mix", pattern: /\bmix\b/i },
  { marker: "Live", pattern: /\blive\b/i },
  { marker: "Remaster", pattern: /\bremaster(?:ed)?\b/i },
  { marker: "Version", pattern: /\bversion\b/i },
  { marker: "Dub", pattern: /\bdub\b/i },
  { marker: "Acoustic", pattern: /\bacoustic\b/i },
  { marker: "Instrumental", pattern: /\binstrumental\b/i },
];
const versionMarkers = versionMarkerDefinitions.map((definition) => {
  const count = tracks.filter((track) => definition.pattern.test(track.name)).length;
  return { marker: definition.marker, tracks: count, share: count / tracks.length };
});
const tracksWithVersionMarker = tracks.filter((track) => versionMarkerDefinitions.some((definition) => definition.pattern.test(track.name))).length;

const addedByCounts = sortedCountRows(groupCount(tracks, (track) => track.addedBy?.id || "unknown"), "account");
const availability = {
  available: tracks.filter((track) => track.isAvailable).length,
  unavailable: tracks.filter((track) => !track.isAvailable).length,
  playable: tracks.filter((track) => track.isPlayable).length,
  unplayable: tracks.filter((track) => !track.isPlayable).length,
  availabilityPlayableMismatches: tracks.filter((track) => Boolean(track.isAvailable) !== Boolean(track.isPlayable)).length,
  zeroAvailableMarkets: tracks.filter((track) => track.availableMarkets === 0).length,
  nonzeroAvailableMarkets: tracks.filter((track) => Number.isFinite(track.availableMarkets) && track.availableMarkets > 0).length,
  local: tracks.filter((track) => track.isLocal).length,
  explicit: tracks.filter((track) => track.explicit).length,
};

const summaryChecks = [
  { check: "Tracks exportados", expected: summary.exportedTracks, actual: tracks.length },
  { check: "Duración total", expected: summary.totalDurationMs, actual: tracks.reduce((total, track) => total + track.durationMs, 0) },
  { check: "Artistas únicos", expected: summary.uniqueArtists, actual: artistCounts.size },
  { check: "Álbumes únicos", expected: summary.uniqueAlbums, actual: albumGroups.size },
  { check: "Tracks explícitos", expected: summary.explicitTracks, actual: availability.explicit },
  { check: "Tracks disponibles", expected: summary.availableTracks, actual: availability.available },
  { check: "Tracks no disponibles", expected: summary.unavailableTracks, actual: availability.unavailable },
  { check: "Tracks locales", expected: summary.localTracks, actual: availability.local },
  { check: "Duplicados por identidad", expected: summary.duplicateTracks, actual: duplicateIdentities.length },
].map((row) => ({ ...row, status: row.expected === row.actual ? "OK" : "Revisar" }));

const allSummaryChecksPass = summaryChecks.every((row) => row.status === "OK");
const recentReleaseShare = releaseYears.filter((year) => year >= snapshotDate.getUTCFullYear() - 3).length / releaseYears.length;
const catalogBefore2020Share = releaseYears.filter((year) => year < 2020).length / releaseYears.length;
const withinNinetyDaysOfRelease = nonNegativeReleaseLags.filter((days) => days <= 90).length;
const moreThanFiveYearsAfterRelease = nonNegativeReleaseLags.filter((days) => days > 365.25 * 5).length;

const qualityChecks = [
  {
    check: "Identidad única por track",
    status: duplicateIdentities.length === 0 && trackIdentities.size === tracks.length ? "OK" : "Revisar",
    evidence: `${trackIdentities.size} identidades para ${tracks.length} filas`,
    severity: duplicateIdentities.length === 0 ? "Ninguna" : "Alta",
  },
  {
    check: "Posiciones completas y sin repetir",
    status: positionsAreContiguous ? "OK" : "Revisar",
    evidence: positionsAreContiguous ? `Secuencia 1–${tracks.length}` : `${uniquePositions.size} posiciones distintas`,
    severity: positionsAreContiguous ? "Ninguna" : "Alta",
  },
  {
    check: "Reconciliación con el resumen",
    status: allSummaryChecksPass ? "OK" : "Revisar",
    evidence: `${summaryChecks.filter((row) => row.status === "OK").length}/${summaryChecks.length} controles coinciden`,
    severity: allSummaryChecksPass ? "Ninguna" : "Alta",
  },
  {
    check: "Disponibilidad en Spotify",
    status: availability.unavailable === 0 ? "OK" : "Con salvedad",
    evidence: `${availability.unavailable} no disponibles (${percent(availability.unavailable, tracks.length)}%)`,
    severity: availability.unavailable === 0 ? "Ninguna" : "Media",
  },
  {
    check: "Popularidad y previews",
    status: "No utilizable",
    evidence: `${completeness.find((row) => row.field === "popularity").missingRate}% sin popularidad; ${completeness.find((row) => row.field === "previewUrl").missingRate}% sin preview`,
    severity: "Media",
  },
  {
    check: "Candidatos por metadatos",
    status: candidateRows.length === 0 ? "OK" : "Revisión manual",
    evidence: `${candidateRows.length} grupos con mismo título/artistas y duración ±2 s, pero IDs distintos`,
    severity: candidateRows.length === 0 ? "Ninguna" : "Baja",
  },
];

const results = {
  generatedAt: new Date().toISOString(),
  sourceSnapshot: summary.lastUpdated,
  playlist: {
    id: summary.playlistId,
    name: summary.playlistName,
    followers: summary.followers,
    tracks: tracks.length,
    totalHours: round(tracks.reduce((total, track) => total + track.durationMs, 0) / 3_600_000, 1),
    firstAddedAt: addedDates[0].toISOString(),
    lastAddedAt: latestAddedAt.toISOString(),
    daysSinceLastAdditionAtSnapshot: round((snapshotDate.getTime() - latestAddedAt.getTime()) / DAY_MS, 1),
  },
  quality: {
    distinctTrackIdentities: trackIdentities.size,
    missingTrackIdentities: tracks.filter((track) => !(track.id || track.uri)).length,
    duplicateIdentityGroups: duplicateIdentities,
    exactDuplicateRows: [...exactRows.values()].filter((count) => count > 1).reduce((total, count) => total + count - 1, 0),
    positionsAreContiguous,
    completeness,
    summaryChecks,
    candidateSameRecordingGroups: candidateRows,
    invalidOrFutureAddedDates: tracks.filter((track) => !Number.isFinite(new Date(track.addedAt).getTime()) || new Date(track.addedAt) > snapshotDate).length,
    releaseDatesAfterAddition: negativeReleaseLags,
  },
  availability: {
    ...availability,
    availableRate: availability.available / tracks.length,
    explicitRate: availability.explicit / tracks.length,
  },
  duration: {
    averageMin: round(durationValues.reduce((total, value) => total + value, 0) / durationValues.length / 60_000, 2),
    medianMin: round(quantile(durationValues, 0.5) / 60_000, 2),
    p10Min: round(quantile(durationValues, 0.1) / 60_000, 2),
    p25Min: round(quantile(durationValues, 0.25) / 60_000, 2),
    p75Min: round(quantile(durationValues, 0.75) / 60_000, 2),
    p90Min: round(quantile(durationValues, 0.9) / 60_000, 2),
    shortestMin: round(durationValues[0] / 60_000, 2),
    longestMin: round(durationValues.at(-1) / 60_000, 2),
    bands: durationBands,
    longestTracks,
  },
  artists: {
    unique: artistCounts.size,
    uniquePrimary: primaryArtistCounts.size,
    totalCredits: artistCredits,
    medianTracksPerArtist: quantile(artistTrackCounts, 0.5),
    oneTrackArtists: artistTrackCounts.filter((count) => count === 1).length,
    oneTrackArtistShare: artistTrackCounts.filter((count) => count === 1).length / artistTrackCounts.length,
    topTenCreditShare: topArtists.slice(0, 10).reduce((total, row) => total + row.tracks, 0) / artistCredits,
    tracksFeaturingTopTen: tracksWithTopTenArtist,
    tracksFeaturingTopTenShare: tracksWithTopTenArtist / tracks.length,
    top: topArtists.slice(0, 30).map(({ key: _key, ...row }) => row),
    topPrimary: topPrimaryArtists.slice(0, 20),
    collaborationBands,
  },
  albums: {
    unique: albumGroups.size,
    oneTrackAlbums: [...albumGroups.values()].filter((matchingTracks) => matchingTracks.length === 1).length,
    oneTrackAlbumShare: [...albumGroups.values()].filter((matchingTracks) => matchingTracks.length === 1).length / albumGroups.size,
    top: topAlbums.slice(0, 20),
  },
  releases: {
    knownReleaseYears: releaseYears.length,
    earliestYear: Math.min(...releaseYears),
    latestYear: Math.max(...releaseYears),
    medianYear: quantile([...releaseYears].sort((left, right) => left - right), 0.5),
    releaseYearCounts: sortedCountRows(releaseYearCounts, "year").sort((left, right) => left.year - right.year),
    releaseMix: releaseMixDefinitions,
    recentReleaseShare,
    catalogBefore2020Share,
    releaseLagSample: nonNegativeReleaseLags.length,
    medianDaysFromReleaseToAddition: round(quantile(nonNegativeReleaseLags, 0.5), 0),
    withinNinetyDaysOfRelease,
    withinNinetyDaysOfReleaseShare: withinNinetyDaysOfRelease / nonNegativeReleaseLags.length,
    moreThanFiveYearsAfterRelease,
    moreThanFiveYearsAfterReleaseShare: moreThanFiveYearsAfterRelease / nonNegativeReleaseLags.length,
  },
  additions: {
    monthly: additionsMonthly,
    yearly: additionsYearly,
    activeMonths: activeMonthCounts.length,
    medianPerActiveMonth: quantile(activeMonthCounts, 0.5),
    peakMonths: [...additionsMonthly].sort((left, right) => right.tracks - left.tracks || left.month.localeCompare(right.month)).slice(0, 8),
    peakDays: additionsByDay,
  },
  curation: {
    distinctAddingAccounts: addedByCounts.length,
    topAddingAccountShare: addedByCounts[0].count / tracks.length,
    tracksWithVersionMarker,
    tracksWithVersionMarkerShare: tracksWithVersionMarker / tracks.length,
    versionMarkers,
  },
};

const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE tracks (
    track_key TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    id TEXT,
    uri TEXT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    artist_set_key TEXT NOT NULL,
    added_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    explicit INTEGER NOT NULL,
    is_available INTEGER NOT NULL,
    is_playable INTEGER NOT NULL,
    is_local INTEGER NOT NULL,
    popularity REAL,
    preview_url TEXT,
    album_key TEXT NOT NULL,
    album_name TEXT,
    primary_artist TEXT,
    release_date TEXT,
    release_year INTEGER
  );
  CREATE TABLE track_artists (
    track_key TEXT NOT NULL,
    artist_key TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    PRIMARY KEY (track_key, artist_key)
  );
  CREATE TABLE summary_values (
    check_name TEXT PRIMARY KEY,
    expected_value REAL NOT NULL,
    actual_value REAL NOT NULL
  );
`);

const insertTrack = database.prepare(`
  INSERT INTO tracks (
    track_key, position, id, uri, name, normalized_name, artist_set_key,
    added_at, duration_ms, explicit, is_available, is_playable, is_local,
    popularity, preview_url, album_key, album_name, primary_artist,
    release_date, release_year
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertArtist = database.prepare(`
  INSERT OR IGNORE INTO track_artists (track_key, artist_key, artist_name)
  VALUES (?, ?, ?)
`);
const insertSummaryValue = database.prepare(`
  INSERT INTO summary_values (check_name, expected_value, actual_value)
  VALUES (?, ?, ?)
`);

database.exec("BEGIN");
for (const track of tracks) {
  const trackKey = track.id || track.uri;
  const artistSetKey = [...new Set(track.artists.map(artistKey))].sort().join("|");
  insertTrack.run(
    trackKey,
    track.position,
    track.id,
    track.uri,
    track.name,
    normalizeText(track.name),
    artistSetKey,
    track.addedAt,
    track.durationMs,
    track.explicit ? 1 : 0,
    track.isAvailable ? 1 : 0,
    track.isPlayable ? 1 : 0,
    track.isLocal ? 1 : 0,
    track.popularity,
    track.previewUrl,
    albumKey(track),
    track.album?.name ?? null,
    track.artists[0]?.name ?? null,
    track.album?.releaseDate ?? null,
    releaseYear(track),
  );
  for (const artist of track.artists) {
    insertArtist.run(trackKey, artistKey(artist), artist.name);
  }
}
for (const check of summaryChecks) {
  insertSummaryValue.run(check.check, check.expected, check.actual);
}
database.exec("COMMIT");
database.exec(reportSql);

const headlineMetrics = database.prepare("SELECT * FROM headline_metrics").all();
const sqlMonthlyAdditions = database.prepare("SELECT * FROM monthly_additions").all();
const artistChartRows = database.prepare("SELECT * FROM top_artists LIMIT 15").all();
const sqlReleaseMix = database.prepare("SELECT * FROM release_mix").all();
const sqlDurationBands = database.prepare("SELECT * FROM duration_bands").all();
const sqlTopAlbums = database.prepare("SELECT * FROM top_albums LIMIT 12").all();
const qualityRows = database.prepare("SELECT * FROM quality_checks").all();

const sqlCrossChecks = [
  {
    check: "Métricas principales",
    passed:
      headlineMetrics[0].tracks === results.playlist.tracks &&
      headlineMetrics[0].totalHours === results.playlist.totalHours &&
      headlineMetrics[0].uniqueArtists === results.artists.unique &&
      Math.abs(headlineMetrics[0].availableRate - results.availability.availableRate) < 1e-12,
  },
  {
    check: "Adiciones mensuales",
    passed:
      sqlMonthlyAdditions.length === results.additions.monthly.length &&
      sqlMonthlyAdditions.every((row, index) =>
        row.month === results.additions.monthly[index].month &&
        row.tracks === results.additions.monthly[index].tracks &&
        row.cumulativeTracks === results.additions.monthly[index].cumulativeTracks),
  },
  {
    check: "Ranking de artistas",
    passed: artistChartRows.every((row, index) =>
      row.artist === results.artists.top[index].artist && row.tracks === results.artists.top[index].tracks),
  },
  {
    check: "Mix de lanzamientos",
    passed: sqlReleaseMix.every((row, index) =>
      row.bucket === results.releases.releaseMix[index].bucket && row.tracks === results.releases.releaseMix[index].tracks),
  },
  {
    check: "Bandas de duración",
    passed: sqlDurationBands.every((row, index) =>
      row.band === results.duration.bands[index].band && row.tracks === results.duration.bands[index].tracks),
  },
  {
    check: "Tabla de calidad",
    passed: qualityRows.every((row, index) =>
      row.check === qualityChecks[index].check && row.status === qualityChecks[index].status),
  },
];
results.quality.sqlCrossChecks = sqlCrossChecks;
results.quality.sqlCrossChecksPass = sqlCrossChecks.every((check) => check.passed);

if (!results.quality.sqlCrossChecksPass) {
  throw new Error(`Independent SQL cross-check failed: ${JSON.stringify(sqlCrossChecks)}`);
}

const source = {
  id: "playlist_analysis_sql",
  label: "Consultas reproducibles del análisis de la playlist",
  path: "data-analysis/report-source.sql",
  query: {
    engine: "sqlite",
    language: "sql",
    description: "Vistas SQL ejecutadas en memoria sobre el snapshot completo de tracks y artistas.",
    executed_at: results.generatedAt,
    tables_used: ["tracks", "track_artists", "summary_values"],
    filters: ["Sin muestreo", "Todos los tracks del snapshot", "Fechas interpretadas en UTC"],
    metric_definitions: [
      "Artista único: ID de Spotify del artista; nombre normalizado como respaldo.",
      "Duplicado inequívoco: ID o URI estable del track repetido.",
      "Candidato por metadatos: mismo título normalizado, mismos artistas y duración con diferencia máxima de 2 segundos, pero ID distinto.",
      "Adiciones mensuales: fecha addedAt de tracks que permanecen en el snapshot actual; no representa tracks eliminados.",
    ],
  },
};

const rawSource = {
  id: "spotify_tracks_export",
  label: "Export versionado de la playlist de Spotify",
  path: "data/spotify-playlist-tracks.json",
};

const artifact = {
  surface: "report",
  manifest: {
    version: 1,
    surface: "report",
    title: "Radiografía de la playlist Monte Etna",
    description: "Análisis descriptivo y de calidad del snapshot completo de Spotify.",
    generatedAt: results.generatedAt,
    cards: [
      {
        id: "tracks_card",
        description: "Entradas actualmente presentes en la playlist.",
        dataset: "headline_metrics",
        sourceId: source.id,
        metrics: [{ label: "Tracks", field: "tracks", format: "number" }],
      },
      {
        id: "hours_card",
        description: "Duración continua de todo el catálogo.",
        dataset: "headline_metrics",
        sourceId: source.id,
        metrics: [{ label: "Horas", field: "totalHours", format: "number", unit: "h" }],
      },
      {
        id: "artists_card",
        description: "Artistas acreditados al menos una vez.",
        dataset: "headline_metrics",
        sourceId: source.id,
        metrics: [{ label: "Artistas únicos", field: "uniqueArtists", format: "number" }],
      },
      {
        id: "availability_card",
        description: "Porcentaje de tracks marcado como disponible en el snapshot.",
        dataset: "headline_metrics",
        sourceId: source.id,
        metrics: [{ label: "Disponibles", field: "availableRate", format: "percent" }],
      },
    ],
    charts: [
      {
        id: "monthly_additions_chart",
        title: "Tracks actuales por mes de incorporación",
        subtitle: `${results.additions.monthly[0].month} a ${results.additions.monthly.at(-1).month}; sólo incluye tracks que siguen en la playlist`,
        type: "line",
        dataset: "monthly_additions",
        sourceId: source.id,
        encodings: {
          x: { field: "month", type: "temporal", label: "Mes" },
          y: { field: "tracks", type: "quantitative", label: "Tracks" },
          tooltip: [
            { field: "cumulativeTracks", type: "quantitative", label: "Acumulado vigente", format: "number" },
            { field: "year", type: "quantitative", label: "Año", format: "number" },
          ],
        },
        palette: { kind: "single", root: "orange" },
      },
      {
        id: "top_artists_chart",
        title: "Artistas con más tracks",
        subtitle: "Top 15; cada track cuenta una vez por artista acreditado",
        type: "bar",
        dataset: "top_artists",
        sourceId: source.id,
        encodings: {
          x: { field: "artist", type: "nominal", label: "Artista" },
          y: { field: "tracks", type: "quantitative", label: "Tracks" },
          tooltip: [
            { field: "share", type: "quantitative", label: "Proporción de la playlist", format: "percent" },
            { field: "rank", type: "quantitative", label: "Posición", format: "number" },
          ],
        },
        options: { orientation: "horizontal", valueLabels: true },
        palette: { kind: "single", root: "blue" },
      },
      {
        id: "release_mix_chart",
        title: "Composición por año de lanzamiento",
        subtitle: `${results.releases.knownReleaseYears} tracks con año conocido; buckets históricos y años recientes`,
        type: "bar",
        dataset: "release_mix",
        sourceId: source.id,
        encodings: {
          x: { field: "bucket", type: "nominal", label: "Lanzamiento" },
          y: { field: "tracks", type: "quantitative", label: "Tracks" },
          tooltip: [
            { field: "share", type: "quantitative", label: "Proporción", format: "percent" },
            { field: "order", type: "quantitative", label: "Orden", format: "number" },
          ],
        },
        palette: { kind: "single", root: "olive" },
      },
      {
        id: "duration_chart",
        title: "Distribución de duración",
        subtitle: `Mediana ${results.duration.medianMin} min; percentil 90 ${results.duration.p90Min} min`,
        type: "bar",
        dataset: "duration_bands",
        sourceId: source.id,
        encodings: {
          x: { field: "band", type: "nominal", label: "Duración" },
          y: { field: "tracks", type: "quantitative", label: "Tracks" },
          tooltip: [
            { field: "share", type: "quantitative", label: "Proporción", format: "percent" },
            { field: "order", type: "quantitative", label: "Orden", format: "number" },
          ],
        },
        palette: { kind: "single", root: "gold" },
      },
    ],
    sources: [
      { id: source.id, label: source.label, path: source.path },
      { id: rawSource.id, label: rawSource.label, path: rawSource.path },
    ],
    blocks: [
      { id: "title", type: "markdown", body: "# Radiografía de la playlist Monte Etna" },
      {
        id: "executive_summary",
        type: "markdown",
        sourceId: source.id,
        body: [
          "## Executive Summary",
          "",
          `- **Es una colección grande, profunda y vigente.** Reúne ${tracks.length.toLocaleString("es-AR")} tracks, ${results.playlist.totalHours.toLocaleString("es-AR")} horas y ${results.artists.unique.toLocaleString("es-AR")} artistas; la última incorporación ocurrió ${results.playlist.daysSinceLastAdditionAtSnapshot} días antes del snapshot.`,
          `- **La identidad es reconocible sin depender de unos pocos nombres.** ${topArtists[0].artist} lidera con ${topArtists[0].tracks} tracks, pero el top 10 participa en sólo ${percent(tracksWithTopTenArtist, tracks.length)}% de la playlist y ${percent(results.artists.oneTrackArtists, results.artists.unique)}% de los artistas aparece una sola vez.`,
          `- **Los datos son confiables para describir la curaduría, con límites claros.** No hay IDs duplicados y el resumen reconcilia, aunque ${availability.unavailable} tracks no están disponibles y popularidad, géneros, audio features, escuchas e historial de eliminaciones no están presentes.`,
        ].join("\n"),
      },
      { id: "headline_metrics", type: "metric-strip", cardIds: ["tracks_card", "hours_card", "artists_card", "availability_card"] },
      {
        id: "growth_section",
        type: "markdown",
        sourceId: source.id,
        body: [
          "## La playlist creció por oleadas, no a ritmo uniforme",
          "",
          `La colección vigente abarca incorporaciones desde ${results.playlist.firstAddedAt.slice(0, 10)} hasta ${results.playlist.lastAddedAt.slice(0, 10)}. La mediana fue de ${results.additions.medianPerActiveMonth} tracks por mes activo; los picos reflejan sesiones de curaduría o cargas por lotes, no necesariamente descubrimiento orgánico continuo.`,
          "",
          "**Implicación:** para comunicar actividad conviene mostrar fecha de actualización y novedades recientes, pero no presentar esta serie como crecimiento neto histórico: los tracks eliminados ya no están en el snapshot.",
        ].join("\n"),
      },
      { id: "monthly_additions_block", type: "chart", chartId: "monthly_additions_chart" },
      {
        id: "artist_section",
        type: "markdown",
        sourceId: source.id,
        body: [
          "## Un núcleo de artistas define el sonido, acompañado por una cola larga",
          "",
          `${topArtists[0].artist}, ${topArtists[1].artist} y ${topArtists[2].artist} encabezan la presencia. Aun así, ${results.artists.oneTrackArtists.toLocaleString("es-AR")} artistas aparecen una sola vez y los tracks que incluyen al top 10 representan ${percent(tracksWithTopTenArtist, tracks.length)}% del total.`,
          "",
          "**Implicación:** la playlist tiene referentes fuertes para explicar su identidad, pero suficiente amplitud para no sentirse como una discografía de pocos nombres.",
        ].join("\n"),
      },
      { id: "top_artists_block", type: "chart", chartId: "top_artists_chart" },
      {
        id: "catalog_section",
        type: "markdown",
        sourceId: source.id,
        body: [
          "## El catálogo es contemporáneo, con espacio para rescates",
          "",
          `${percent(releaseYears.filter((year) => year >= snapshotDate.getUTCFullYear() - 3).length, releaseYears.length)}% de los tracks con fecha conocida fue lanzado entre ${snapshotDate.getUTCFullYear() - 3} y ${snapshotDate.getUTCFullYear()}, mientras que ${percent(releaseYears.filter((year) => year < 2020).length, releaseYears.length)}% es anterior a 2020. Entre los tracks con fecha completa, ${percent(withinNinetyDaysOfRelease, nonNegativeReleaseLags.length)}% se agregó dentro de los 90 días de su lanzamiento.`,
          "",
          "**Implicación:** la selección combina descubrimiento reciente con catálogo, una mezcla útil para sostener actualidad sin perder profundidad.",
        ].join("\n"),
      },
      { id: "release_mix_block", type: "chart", chartId: "release_mix_chart" },
      {
        id: "duration_section",
        type: "markdown",
        sourceId: source.id,
        body: [
          "## La duración combina formato estándar con una cola larga de club",
          "",
          `La mediana es ${results.duration.medianMin} minutos y el 50% central se ubica entre ${results.duration.p25Min} y ${results.duration.p75Min} minutos. ${percent(durationBands.filter((row) => row.order >= 3).reduce((total, row) => total + row.tracks, 0), tracks.length)}% dura al menos cinco minutos.`,
          "",
          "**Implicación:** el núcleo está en el formato estándar de tres a cinco minutos, pero un tercio de la selección conserva duraciones extendidas útiles para una experiencia de club.",
        ].join("\n"),
      },
      { id: "duration_block", type: "chart", chartId: "duration_chart" },
      {
        id: "quality_section",
        type: "markdown",
        sourceId: source.id,
        body: [
          "## La base es apta para análisis descriptivo",
          "",
          `Las ${tracks.length.toLocaleString("es-AR")} posiciones son completas, las identidades son únicas y los nueve agregados del resumen coinciden con el detalle. Hay ${candidateRows.length} grupos candidatos por título, artistas y duración similar con IDs distintos: requieren ISRC o comparación de audio antes de considerarlos el mismo track.`,
          "",
          "**Implicación:** se pueden respaldar decisiones editoriales y controles operativos con estos datos; no se deben inferir popularidad, rendimiento o comportamiento de oyentes.",
        ].join("\n"),
      },
      {
        id: "recommendations",
        type: "markdown",
        body: [
          "## Próximos pasos recomendados",
          "",
          "1. **Usar la amplitud como argumento editorial:** combinar artistas ancla con novedades y rescates, en lugar de describir la playlist sólo por volumen.",
          "2. **Automatizar controles estables:** unicidad de ID/URI, posiciones completas, reconciliación del resumen, frescura y tasa de tracks no disponibles.",
          "3. **Agregar ISRC al export si el objetivo es detectar la misma grabación en lanzamientos distintos.** El ID de Spotify detecta repeticiones exactas dentro del catálogo, pero no todas las reediciones equivalentes.",
          "4. **Guardar snapshots históricos si se quiere medir crecimiento real:** seguidores, altas, bajas, rotación y velocidad de renovación no pueden reconstruirse desde una sola foto.",
        ].join("\n"),
      },
      {
        id: "further_questions",
        type: "markdown",
        body: [
          "## Preguntas que los datos actuales no pueden responder",
          "",
          "- ¿Qué tracks o artistas generan más escuchas, guardados o seguidores?",
          "- ¿Cuál es la rotación real, incluyendo tracks eliminados?",
          "- ¿Cómo se distribuyen energía, tempo, tonalidad y rasgos sonoros?",
          "- ¿Cómo evolucionaron los seguidores y la conversión desde la landing?",
        ].join("\n"),
      },
      {
        id: "caveats",
        type: "markdown",
        sourceId: source.id,
        body: [
          "## Supuestos y límites",
          "",
          `- Snapshot analizado: ${summary.lastUpdated.replace("T", " ").replace("Z", " UTC")}.`,
          "- Cada fila representa un track actualmente presente; las eliminaciones históricas no aparecen.",
          "- Las fechas `addedAt` se agrupan en UTC.",
          "- Los remixes, edits y versiones con IDs distintos se consideran tracks distintos.",
          "- Los candidatos de misma grabación por metadatos no son duplicados confirmados sin ISRC o huella de audio.",
          "- `availableMarkets` vale cero en todo el export, por lo que no sirve para comparar disponibilidad geográfica.",
          "- No se infieren géneros, popularidad ni engagement porque esos campos no están disponibles en el export.",
        ].join("\n"),
      },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt: results.generatedAt,
    status: "ready",
    datasets: {
      headline_metrics: headlineMetrics,
      monthly_additions: sqlMonthlyAdditions,
      top_artists: artistChartRows,
      release_mix: sqlReleaseMix,
      duration_bands: sqlDurationBands,
    },
  },
  sources: [source, rawSource],
};

writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  resultsPath,
  artifactPath,
  snapshot: results.sourceSnapshot,
  tracks: results.playlist.tracks,
  totalHours: results.playlist.totalHours,
  artists: results.artists.unique,
  albums: results.albums.unique,
  duplicateIdentities: results.quality.duplicateIdentityGroups.length,
  metadataCandidateGroups: results.quality.candidateSameRecordingGroups.length,
  unavailableTracks: results.availability.unavailable,
  allSummaryChecksPass,
}, null, 2));
