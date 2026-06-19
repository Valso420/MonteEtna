import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8888/callback";
const DEFAULT_SCOPE = "playlist-read-private playlist-read-collaborative user-read-private";

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function requestToken(clientId, clientSecret, code, redirectUri) {
  const basicToken = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Spotify token exchange failed ${response.status}: ${body}`);
  }

  return JSON.parse(body);
}

function waitForCode(redirectUri, expectedState) {
  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || 80);

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, redirectUri);
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      const state = requestUrl.searchParams.get("state");

      response.setHeader("Content-Type", "text/plain; charset=utf-8");

      if (error) {
        response.end(`Spotify authorization failed: ${error}\n`);
        server.close();
        reject(new Error(`Spotify authorization failed: ${error}`));
        return;
      }

      if (!code) {
        response.statusCode = 404;
        response.end("Waiting for Spotify callback.\n");
        return;
      }

      if (state !== expectedState) {
        response.statusCode = 400;
        response.end("Invalid Spotify authorization state.\n");
        server.close();
        reject(new Error("Invalid Spotify authorization state."));
        return;
      }

      response.end("Refresh token received. You can close this tab.\n");
      server.close();
      resolve(code);
    });

    server.on("error", reject);
    server.listen(port, redirect.hostname, () => {
      console.log(`Listening on ${redirectUri}`);
    });
  });
}

async function main() {
  await loadLocalEnv();

  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const scope = process.env.SPOTIFY_SCOPE || DEFAULT_SCOPE;
  const state = randomUUID();

  const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  console.log("Open this URL and authorize with the playlist owner account:");
  console.log(authorizeUrl.toString());

  const code = await waitForCode(redirectUri, state);
  const token = await requestToken(clientId, clientSecret, code, redirectUri);

  if (!token.refresh_token) {
    throw new Error("Spotify did not return a refresh token.");
  }

  console.log("");
  console.log("SPOTIFY_REFRESH_TOKEN=");
  console.log(token.refresh_token);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
