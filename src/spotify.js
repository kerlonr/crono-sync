const { randomBytes } = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");

module.exports = {
  registerSpotifyRoutes,
};

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ||
  "https://timer.swhorizontina.com.br/spotify";
const SPOTIFY_SCOPE = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]+$/;
const SPOTIFY_TRACK_URI_PATTERN = /^spotify:track:[A-Za-z0-9]+$/;
const SPOTIFY_CONTEXT_URI_PATTERN = /^spotify:(playlist|album|artist):[A-Za-z0-9]+$/;
const SPOTIFY_REPEAT_STATES = new Set(["off", "context", "track"]);
const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

function registerSpotifyRoutes({ app, logEvent, sessionStore, tokensMatch }) {
  const apiLimiter = createLimiter(60 * 1000, 60);
  const spotifyTokens = {
    accessToken: null,
    refreshToken: null,
    expiresAt: 0,
  };
  const authStates = new Map();
  const apiRouter = express.Router();

  apiRouter.use(apiLimiter);
  apiRouter.use(requireAdminSession);

  apiRouter.post("/auth-url", (request, response) => {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REDIRECT_URI) {
      return response.status(503).json({ error: "spotify_not_configured" });
    }

    cleanupAuthStates();

    const state = randomBytes(24).toString("hex");
    const returnTo = normalizeReturnTo(
      request.body?.returnTo,
      request.spotifyAdminSession.id,
      request.spotifyAdminToken,
    );

    authStates.set(state, {
      createdAt: Date.now(),
      returnTo,
      sessionId: request.spotifyAdminSession.id,
    });

    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      response_type: "code",
      scope: SPOTIFY_SCOPE,
      state,
    });

    return response.json({
      url: `https://accounts.spotify.com/authorize?${params.toString()}`,
    });
  });

  apiRouter.get("/status", async (_request, response) => {
    if (!spotifyTokens.accessToken) {
      return response.json({ authenticated: false });
    }

    try {
      const { status, data } = await spotifyFetch("GET", "/me/player");

      if (status === 401) {
        clearSpotifyTokens();
        return response.json({ authenticated: false });
      }

      if (status === 204 || !data) {
        return response.json({ authenticated: true, player: null });
      }

      return response.json({
        authenticated: true,
        player: {
          isPlaying: Boolean(data.is_playing),
          volume: data.device?.volume_percent ?? null,
          shuffleState: Boolean(data.shuffle_state),
          repeatState: normalizeRepeatState(data.repeat_state) || "off",
          device: data.device
            ? {
                name: data.device.name,
                type: data.device.type,
              }
            : null,
          track: data.item
            ? {
                id: data.item.id,
                name: data.item.name,
                artists: data.item.artists.map((artist) => artist.name).join(", "),
                album: data.item.album?.name || "",
                cover: data.item.album?.images?.[0]?.url || null,
                durationMs: data.item.duration_ms,
                progressMs: data.progress_ms,
              }
            : null,
        },
      });
    } catch {
      return response.status(500).json({ error: "internal_error" });
    }
  });

  apiRouter.put("/play", async (request, response) => {
    const contextUri = normalizeContextUri(request.body?.contextUri);
    const body = contextUri ? { context_uri: contextUri } : null;
    const { status } = await spotifyFetch("PUT", "/me/player/play", body);
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.put("/pause", async (_request, response) => {
    const { status } = await spotifyFetch("PUT", "/me/player/pause");
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.post("/next", async (_request, response) => {
    const { status } = await spotifyFetch("POST", "/me/player/next");
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.post("/previous", async (_request, response) => {
    const { status } = await spotifyFetch("POST", "/me/player/previous");
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.put("/volume", async (request, response) => {
    const volume = Number.parseInt(request.query.value, 10);
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      return response.status(400).json({ error: "invalid_volume" });
    }

    const { status } = await spotifyFetch(
      "PUT",
      `/me/player/volume?volume_percent=${volume}`,
    );
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.put("/seek", async (request, response) => {
    const ms = Number.parseInt(request.query.ms, 10);
    if (!Number.isInteger(ms) || ms < 0) {
      return response.status(400).json({ error: "invalid_position" });
    }

    const { status } = await spotifyFetch(
      "PUT",
      `/me/player/seek?position_ms=${ms}`,
    );
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.put("/shuffle", async (request, response) => {
    const state = request.query.state === "true";
    const { status } = await spotifyFetch(
      "PUT",
      `/me/player/shuffle?state=${state}`,
    );
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.put("/repeat", async (request, response) => {
    const state = normalizeRepeatState(request.query.state);
    if (!state) {
      return response.status(400).json({ error: "invalid_repeat_state" });
    }

    const { status } = await spotifyFetch(
      "PUT",
      `/me/player/repeat?state=${state}`,
    );
    return sendPlayerCommandResponse(response, status);
  });

  apiRouter.get("/playlists", async (_request, response) => {
    const { status, data } = await spotifyFetch("GET", "/me/playlists?limit=50");

    if (status === 401) {
      clearSpotifyTokens();
      return response.status(401).json({ error: "not_authenticated" });
    }

    if (status !== 200 || !data) {
      return response.status(502).json({ error: "fetch_failed" });
    }

    return response.json({
      playlists: data.items.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        uri: playlist.uri,
        tracks: playlist.tracks?.total || 0,
        cover: playlist.images?.[0]?.url || null,
      })),
    });
  });

  apiRouter.get("/playlists/:id/tracks", async (request, response) => {
    const playlistId = normalizeSpotifyId(request.params.id);
    if (!playlistId) {
      return response.status(400).json({ error: "invalid_playlist_id" });
    }

    const { status, data } = await spotifyFetch(
      "GET",
      `/playlists/${playlistId}/tracks?limit=50&fields=items(track(id,name,duration_ms,artists,album(name,images)))`,
    );

    if (status === 401) {
      clearSpotifyTokens();
      return response.status(401).json({ error: "not_authenticated" });
    }

    if (status !== 200 || !data) {
      return response.status(502).json({ error: "fetch_failed" });
    }

    return response.json({
      tracks: data.items
        .filter((item) => item.track && normalizeSpotifyId(item.track.id))
        .map((item) => ({
          id: item.track.id,
          name: item.track.name,
          artists: item.track.artists.map((artist) => artist.name).join(", "),
          album: item.track.album?.name || "",
          cover: item.track.album?.images?.[0]?.url || null,
          durationMs: item.track.duration_ms,
        })),
    });
  });

  apiRouter.put("/play/track", async (request, response) => {
    const trackUri = normalizeTrackUri(request.body?.trackUri);
    const contextUri = normalizeContextUri(request.body?.contextUri);

    if (!trackUri) {
      return response.status(400).json({ error: "invalid_track_uri" });
    }

    const body = contextUri
      ? { context_uri: contextUri, offset: { uri: trackUri } }
      : { uris: [trackUri] };
    const { status } = await spotifyFetch("PUT", "/me/player/play", body);
    return sendPlayerCommandResponse(response, status);
  });

  app.use("/api/spotify", apiRouter);

  app.get("/spotify", apiLimiter, async (request, response) => {
    cleanupAuthStates();

    const stateKey =
      typeof request.query.state === "string" ? request.query.state : "";
    const authState = consumeAuthState(stateKey);

    if (!authState) {
      return response.status(400).send("Autorização inválida ou expirada.");
    }

    const { code, error } = request.query;

    if (error || typeof code !== "string" || !code) {
      logEvent("spotify_auth_error", {
        error: error || "no_code",
        sessionId: authState.sessionId,
      });
      return response
        .status(400)
        .send(`Autorização negada pelo Spotify: ${error || "código ausente"}`);
    }

    try {
      const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(
              `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`,
            ).toString("base64"),
        },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          redirect_uri: SPOTIFY_REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        const body = await tokenResponse.text();
        logEvent("spotify_token_error", {
          body,
          sessionId: authState.sessionId,
          status: tokenResponse.status,
        });
        return response.status(502).send("Erro ao trocar código por token.");
      }

      const data = await tokenResponse.json();
      spotifyTokens.accessToken = data.access_token;
      spotifyTokens.refreshToken = data.refresh_token;
      spotifyTokens.expiresAt = Date.now() + (data.expires_in - 60) * 1000;

      logEvent("spotify_auth_success", { sessionId: authState.sessionId });
      return response.redirect(authState.returnTo);
    } catch (errorCaught) {
      logEvent("spotify_callback_exception", {
        message: errorCaught.message,
        sessionId: authState.sessionId,
      });
      return response.status(500).send("Erro interno ao autenticar com Spotify.");
    }
  });

  function requireAdminSession(request, response, next) {
    const sessionId = readHeader(request, "x-crono-session-id");
    const adminToken = readHeader(request, "x-crono-admin-token");

    if (
      !sessionStore.isValidSessionId(sessionId) ||
      !sessionStore.isValidAdminToken(adminToken)
    ) {
      return response.status(401).json({ error: "unauthorized" });
    }

    const session = sessionStore.getSession(sessionId);
    if (
      !session ||
      !tokensMatch(
        session.adminToken,
        adminToken,
        sessionStore.isValidAdminToken,
      )
    ) {
      return response.status(401).json({ error: "unauthorized" });
    }

    sessionStore.touchSession(session);
    request.spotifyAdminSession = session;
    request.spotifyAdminToken = adminToken;
    return next();
  }

  function cleanupAuthStates() {
    const now = Date.now();

    for (const [key, value] of authStates.entries()) {
      if (now - value.createdAt > AUTH_STATE_TTL_MS) {
        authStates.delete(key);
      }
    }
  }

  function consumeAuthState(state) {
    if (!state) {
      return null;
    }

    const value = authStates.get(state);
    if (!value) {
      return null;
    }

    authStates.delete(state);
    return value;
  }

  function clearSpotifyTokens() {
    spotifyTokens.accessToken = null;
    spotifyTokens.refreshToken = null;
    spotifyTokens.expiresAt = 0;
  }

  async function refreshSpotifyToken() {
    if (
      !spotifyTokens.refreshToken ||
      !SPOTIFY_CLIENT_ID ||
      !SPOTIFY_CLIENT_SECRET
    ) {
      return false;
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString(
            "base64",
          ),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: spotifyTokens.refreshToken,
      }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    spotifyTokens.accessToken = data.access_token;
    spotifyTokens.expiresAt = Date.now() + (data.expires_in - 60) * 1000;

    if (data.refresh_token) {
      spotifyTokens.refreshToken = data.refresh_token;
    }

    logEvent("spotify_token_refreshed", {});
    return true;
  }

  async function spotifyFetch(method, endpoint, body = null) {
    if (!spotifyTokens.accessToken) {
      return { status: 401, data: null };
    }

    if (
      Date.now() >= spotifyTokens.expiresAt &&
      !(await refreshSpotifyToken())
    ) {
      clearSpotifyTokens();
      return { status: 401, data: null };
    }

    let result = await executeSpotifyFetch(method, endpoint, body);

    if (result.status === 401 && (await refreshSpotifyToken())) {
      result = await executeSpotifyFetch(method, endpoint, body);
    }

    if (result.status === 401) {
      clearSpotifyTokens();
    }

    return result;
  }

  async function executeSpotifyFetch(method, endpoint, body = null) {
    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${spotifyTokens.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();

    return {
      status: response.status,
      data: parseJson(text),
    };
  }
}

function createLimiter(windowMs, max) {
  return rateLimit({
    legacyHeaders: false,
    max,
    standardHeaders: "draft-7",
    windowMs,
  });
}

function parseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeReturnTo(value, sessionId, adminToken) {
  const fallback = `/admin/${sessionId}#${adminToken}`;

  if (typeof value !== "string" || value.length > 500) {
    return fallback;
  }

  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") {
      return fallback;
    }

    if (url.pathname !== `/admin/${sessionId}`) {
      return fallback;
    }

    const hash = url.hash || `#${adminToken}`;
    return `${url.pathname}${url.search}${hash}`;
  } catch {
    return fallback;
  }
}

function readHeader(request, name) {
  const value = request.headers[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSpotifyId(value) {
  return typeof value === "string" && SPOTIFY_ID_PATTERN.test(value)
    ? value
    : null;
}

function normalizeTrackUri(value) {
  return typeof value === "string" && SPOTIFY_TRACK_URI_PATTERN.test(value)
    ? value
    : null;
}

function normalizeContextUri(value) {
  return typeof value === "string" && SPOTIFY_CONTEXT_URI_PATTERN.test(value)
    ? value
    : null;
}

function normalizeRepeatState(value) {
  if (typeof value !== "string") {
    return null;
  }

  return SPOTIFY_REPEAT_STATES.has(value) ? value : null;
}

function sendPlayerCommandResponse(response, status) {
  if (status === 204 || status === 202 || status === 200) {
    return response.json({ ok: true });
  }

  if (status === 401) {
    return response.status(401).json({ error: "not_authenticated" });
  }

  if (status === 403) {
    return response.status(403).json({ error: "premium_required" });
  }

  if (status === 404) {
    return response.status(404).json({ error: "no_active_device" });
  }

  if (status === 429) {
    return response.status(429).json({ error: "rate_limited" });
  }

  return response.status(502).json({ error: "spotify_error" });
}
