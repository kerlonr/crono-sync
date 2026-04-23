const express = require("express");
const helmet = require("helmet");
const http = require("http");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");

const config = require("./src/config");
const { triggerDeploy } = require("./src/deploy-client");
const {
  formatTimerMs,
  getLogFile,
  getRequestIp,
  logAccess,
  logEvent,
} = require("./src/logger");
const {
  getBranchFromRef,
  isAllowedOrigin,
  isValidWebhookSignature,
  parseWebhookPayload,
  tokensMatch,
} = require("./src/security");
const { createSessionStore } = require("./src/sessions");
const { registerSpotifyRoutes } = require("./src/spotify");


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024,
  transports: ["websocket", "polling"],
  allowRequest(request, callback) {
    callback(
      null,
      isAllowedOrigin(
        request.headers.origin,
        request.headers.host,
        config.ALLOWED_ORIGIN,
      ),
    );
  },
});

const sessionStore = createSessionStore({
  adminTokenPattern: config.ADMIN_TOKEN_PATTERN,
  defaultTimerMs: config.DEFAULT_TIMER_MS,
  io,
  maxTimerMs: config.MAX_TIMER_MS,
  sessionIdPattern: config.SESSION_ID_PATTERN,
  sessionTtlMs: config.SESSION_TTL_MS,
});

const cspDirectives = buildCspDirectives(process.env.NODE_ENV);
const globalLimiter = createLimiter(15 * 60 * 1000, 250);
const createSessionLimiter = createLimiter(10 * 60 * 1000, 30);
const activeSessionsLimiter = createLimiter(60 * 1000, 120);
const webhookLimiter = createLimiter(15 * 60 * 1000, 20);

app.disable("x-powered-by");

if (config.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

app.use((request, response, next) => {
  const startedAt = process.hrtime.bigint();
  response.on("finish", () => {
    logAccess(request, response, startedAt);
  });
  next();
});

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: cspDirectives,
    },
    hsts: process.env.NODE_ENV === "production",
    referrerPolicy: { policy: "no-referrer" },
  }),
);

app.use((request, response, next) => {
  response.setHeader("Permissions-Policy", "fullscreen=(self)");
  next();
});

app.use(globalLimiter);

app.post(
  "/webhook",
  webhookLimiter,
  express.raw({ type: "application/json", limit: "32kb" }),
  async (request, response) => {
    if (!config.ENABLE_WEBHOOK) {
      return response.status(404).send("Not Found");
    }

    const signature = request.headers["x-hub-signature-256"];
    if (
      !isValidWebhookSignature(signature, request.body, config.WEBHOOK_SECRET)
    ) {
      return response.status(401).send("Unauthorized");
    }

    const eventName = request.headers["x-github-event"];
    if (eventName && eventName !== "push") {
      return response.status(202).send("Ignored");
    }

    const payload = parseWebhookPayload(request.body);
    if (!payload) {
      return response.status(400).send("Invalid payload");
    }

    const pushedBranch = getBranchFromRef(payload.ref);
    if (!pushedBranch || pushedBranch !== config.WEBHOOK_DEPLOY_BRANCH) {
      logEvent("webhook_ignored", {
        branch: pushedBranch || "unknown",
        expectedBranch: config.WEBHOOK_DEPLOY_BRANCH,
      });
      return response.status(202).send("Ignored");
    }

    const repository = payload.repository?.full_name || "unknown";
    logEvent("webhook_accepted", { branch: pushedBranch, repository });

    const deployStarted = await triggerDeploy({
      branch: pushedBranch,
      deployerUrl: config.DEPLOYER_URL,
      logEvent,
      repository,
      timeoutMs: config.DEPLOYER_TIMEOUT_MS,
    });

    if (!deployStarted) {
      return response.status(502).send("Deploy trigger failed");
    }

    return response.status(202).send("Accepted");
  },
);

app.use(express.json({ limit: "16kb" }));

app.use(
  "/assets",
  express.static(path.join(config.PUBLIC_DIR, "assets"), {
    fallthrough: false,
    etag: true,
    immutable: false,
    maxAge: 0,
  }),
);

app.use(
  express.static(config.PUBLIC_DIR, {
    fallthrough: true,
    index: "index.html",
    maxAge: 0,
  }),
);

app.get("/admin/:id", (request, response) => {
  if (!sessionStore.isValidSessionId(request.params.id)) {
    return response.status(404).send("Not Found");
  }
  return response.sendFile(path.join(config.PUBLIC_DIR, "admin.html"));
});

app.get("/view/:id", (request, response) => {
  if (!sessionStore.isValidSessionId(request.params.id)) {
    return response.status(404).send("Not Found");
  }
  return response.sendFile(path.join(config.PUBLIC_DIR, "viewer.html"));
});

app.get("/overview", (_request, response) => {
  response.sendFile(path.join(config.PUBLIC_DIR, "overview.html"));
});

app.post("/api/session/new", createSessionLimiter, (request, response) => {
  const session = sessionStore.createSession();
  logEvent("session_created", {
    sessionId: session.id,
    totalTime: formatTimerMs(session.totalTime),
    ip: getRequestIp(request),
    userAgent: request.get("user-agent") || "unknown",
  });

  response.status(201).json({
    id: session.id,
    adminToken: session.adminToken,
  });
});

app.get("/api/sessions/active", activeSessionsLimiter, (_request, response) => {
  sessionStore.cleanupExpiredSessions();
  response.json({ sessions: sessionStore.listActiveSessions() });
});

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});
registerSpotifyRoutes({
  app,
  logEvent,
  sessionStore,
  tokensMatch,
});

io.on("connection", (socket) => {
  socket.currentSession = null;
  socket.isAdmin = false;

  socket.on(
    "session:join",
    (sessionId, role, tokenOrCallback, maybeCallback) => {
      const callback =
        typeof tokenOrCallback === "function" ? tokenOrCallback : maybeCallback;
      const adminToken =
        typeof tokenOrCallback === "string" ? tokenOrCallback : null;

      if (
        !sessionStore.isValidSessionId(sessionId) ||
        !sessionStore.isValidRole(role)
      ) {
        logEvent(
          "session_join_denied",
          buildSocketLogDetails(socket, {
            sessionId: normalizeSessionId(sessionId),
            role: normalizeRole(role),
            reason: "invalid_request",
          }),
        );
        if (callback) callback({ success: false, reason: "invalid_request" });
        return;
      }

      const currentSession = sessionStore.getSession(sessionId);
      if (!currentSession) {
        sessionStore.deleteSession(sessionId);
        logEvent(
          "session_join_denied",
          buildSocketLogDetails(socket, {
            sessionId,
            role,
            reason: "not_found",
          }),
        );
        if (callback) callback({ success: false, reason: "not_found" });
        return;
      }

      const wantsAdmin = role === "admin";
      if (
        wantsAdmin &&
        !tokensMatch(
          currentSession.adminToken,
          adminToken,
          sessionStore.isValidAdminToken,
        )
      ) {
        logEvent(
          "session_join_denied",
          buildSocketLogDetails(socket, {
            sessionId,
            role,
            reason: "unauthorized",
          }),
        );
        if (callback) callback({ success: false, reason: "unauthorized" });
        return;
      }

      if (socket.currentSession && socket.currentSession !== sessionId) {
        socket.leave(socket.currentSession);
      }

      sessionStore.touchSession(currentSession);
      socket.join(sessionId);
      socket.currentSession = sessionId;
      socket.isAdmin = wantsAdmin;

      sessionStore.emitSessionState(socket, currentSession);
      logEvent(
        "session_joined",
        buildSocketLogDetails(socket, {
          sessionId,
          role,
          status: currentSession.status,
          remaining: formatTimerMs(sessionStore.getRemaining(currentSession)),
          userAgent: getSocketUserAgent(socket),
        }),
      );

      if (callback) callback({ success: true });
    },
  );

  socket.on("timer:setTime", (ms) => {
    const session = sessionStore.getAdminSession(socket);
    const safeMs = sessionStore.sanitizeTimerMs(ms);
    if (!session || safeMs === null || session.status === "running") return;

    session.totalTime = safeMs;
    session.elapsed = 0;
    session.startTime = null;
    session.status = "stopped";
    sessionStore.broadcastSession(socket.currentSession);
  });

  socket.on("timer:start", () => {
    const session = sessionStore.getAdminSession(socket);
    if (
      !session ||
      session.status === "running" ||
      sessionStore.getRemaining(session) <= 0
    )
      return;

    session.startTime = Date.now();
    session.status = "running";
    sessionStore.touchSession(session);

    if (!session.interval) {
      const sessionId = socket.currentSession;
      session.interval = setInterval(
        () => sessionStore.broadcastSession(sessionId),
        250,
      );
    }

    sessionStore.broadcastSession(socket.currentSession);
  });

  socket.on("timer:pause", () => {
    const session = sessionStore.getAdminSession(socket);
    if (!session || session.status !== "running") return;

    session.elapsed += Date.now() - session.startTime;
    session.startTime = null;
    session.status = "paused";
    sessionStore.clearSessionInterval(session);
    sessionStore.broadcastSession(socket.currentSession);
  });

  socket.on("timer:reset", () => {
    const session = sessionStore.getAdminSession(socket);
    if (!session) return;

    session.elapsed = 0;
    session.startTime = null;
    session.status = "stopped";
    sessionStore.clearSessionInterval(session);
    sessionStore.broadcastSession(socket.currentSession);
  });
});

setInterval(
  sessionStore.cleanupExpiredSessions,
  config.SESSION_CLEANUP_MS,
).unref();

server.listen(config.PORT, () => {
  logEvent("server_started", {
    port: config.PORT,
    url: `http://localhost:${config.PORT}`,
    file: getLogFile(),
  });
});

function buildCspDirectives(nodeEnv) {
  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    connectSrc: [
      "'self'",
      "ws:",
      "wss:",
      "https://api.spotify.com",
      "https://accounts.spotify.com",
    ],
    imgSrc: ["'self'", "data:", "https://i.scdn.co"],
    frameSrc: ["'self'", "https://open.spotify.com"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };

  if (nodeEnv === "production") {
    directives.upgradeInsecureRequests = [];
  }

  return directives;
}

function createLimiter(windowMs, max) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
}

function buildSocketLogDetails(socket, extra = {}) {
  return {
    socketId: socket.id,
    ip: getRequestIp(socket.request),
    ...extra,
  };
}

function getSocketUserAgent(socket) {
  return socket.request?.headers?.["user-agent"] || "unknown";
}

function normalizeSessionId(value) {
  return typeof value === "string" && value ? value : "unknown";
}

function normalizeRole(value) {
  return value === "admin" || value === "viewer" ? value : "unknown";
}

