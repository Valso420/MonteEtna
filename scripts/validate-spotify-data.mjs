import { readFile } from "node:fs/promises";

const TRACKS_PATH = "data/spotify-playlist-tracks.json";
const SUMMARY_PATH = "data/spotify-playlist-summary.json";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function assertValid(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const [tracks, summary] = await Promise.all([
    readJson(TRACKS_PATH),
    readJson(SUMMARY_PATH),
  ]);

  assertValid(Array.isArray(tracks), "Tracks output must be an array.");
  assertValid(tracks.length > 0, "Tracks output must not be empty.");
  assertValid(summary && typeof summary === "object", "Summary output must be an object.");
  assertValid(summary.totalTracks > 0, "Summary totalTracks must be greater than 0.");
  assertValid(
    summary.exportedTracks === summary.totalTracks,
    "Summary exportedTracks must match totalTracks.",
  );
  assertValid(
    tracks.length === summary.totalTracks,
    "Tracks file count must match summary totalTracks.",
  );

  const namedTracks = tracks.filter((track) => track.id && track.name);
  const tracksWithDuration = tracks.filter((track) => track.durationMs > 0);
  const tracksWithAddedByField = tracks.filter((track) =>
    Object.hasOwn(track, "addedBy"),
  );
  assertValid(namedTracks.length === tracks.length, "Every track must have id and name.");
  assertValid(
    tracksWithDuration.length === tracks.length,
    "Every track must have a positive duration.",
  );
  assertValid(
    tracksWithAddedByField.length === tracks.length,
    "Every track must include the addedBy field.",
  );
  assertValid(summary.totalHours > 0, "Summary totalHours must be greater than 0.");
  assertValid(
    summary.averageDurationMin > 0,
    "Summary averageDurationMin must be greater than 0.",
  );
  assertValid(summary.uniqueArtists > 0, "Summary uniqueArtists must be greater than 0.");
  assertValid(summary.uniqueAlbums > 0, "Summary uniqueAlbums must be greater than 0.");
  assertValid(Array.isArray(summary.topArtists), "Summary topArtists must be an array.");
  assertValid(summary.topArtists.length > 0, "Summary topArtists must not be empty.");
  assertValid(Array.isArray(summary.recentTracks), "Summary recentTracks must be an array.");
  assertValid(summary.recentTracks.length > 0, "Summary recentTracks must not be empty.");
  assertValid(
    summary.availableTracks + summary.unavailableTracks === summary.exportedTracks,
    "Available and unavailable tracks must add up to exportedTracks.",
  );
  assertValid(Boolean(summary.lastUpdated), "Summary lastUpdated must be present.");

  console.log("Spotify data validation OK");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
