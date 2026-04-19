const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const { randomBytes, timingSafeEqual } = require("crypto");

const PORT = parsePositiveInt(process.env.PORT, 3000);
const ENABLE_WEBHOOK = process.env.ENABLE_WEBHOOK === "true";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const SESSION_TTL_MS = parsePositiveInt(process.env.SESSION_TTL_MINUTES, 180) * 60 * 1000;
const SESSION_CLEANUP_MS =
  parsePositiveInt(process.env.SESSION_CLEANUP_MINUTES, 5) * 60 * 1000;
const MAX_TIMER_MS = 12 * 60 * 60 * 1000;
const DEFAULT_TIMER_MS = 5 * 60 * 1000;
const SESSION_ID_PATTERN = /^[a-f0-9]{8}$/i;
const ADMIN_TOKEN_PATTERN = /^[a-f0-9]{36}$/i;
const ALLOWED_ORIGIN = normalizeOrigin(process.env.APP_ORIGIN);

if (ENABLE_WEBHOOK && !WEBHOOK_SECRET) {
  throw new Error("ENABLE_WEBHOOK=true requires WEBHOOK_SECRET.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024,
  transports: ["websocket", "polling"],
  allowRequest(request, callback) {
    callback(null, isAllowedOrigin(request.headers.origin, request.headers.host));
  },
});

const publicDir = path.join(__dirname, "public");
const sessions = new Map();
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  connectSrc: ["'self'", "ws:", "wss:"],
  imgSrc: ["'self'", "data:"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

if (process.env.NODE_ENV === "production") {
  cspDirectives.upgradeInsecureRequests = [];
}

app.disable("x-powered-by");

if (process.env.TRUST_PROXY === "true") {
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
  })
);

app.use((request, response, next) => {
  response.setHeader("Permissions-Policy", "fullscreen=(self)");
  next();
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 250,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const createSessionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.use(globalLimiter);
app.use(express.json({ limit: "16kb" }));

app.post(
  "/webhook",
  webhookLimiter,
  express.raw({ type: "application/json", limit: "32kb" }),
  (request, response) => {
    if (!ENABLE_WEBHOOK) {
      return response.status(404).send("Not Found");
    }

    const signature = request.headers["x-hub-signature-256"];
    if (!isValidWebhookSignature(signature, request.body)) {
      return response.status(401).send("Unauthorized");
    }

    const eventName = request.headers["x-github-event"];
    if (eventName && eventName !== "push") {
      return response.status(202).send("Ignored");
    }

    console.log("Webhook validado com sucesso.");
    return response.status(202).send("Accepted");
  }
);

app.use(
  "/assets",
  express.static(path.join(publicDir, "assets"), {
    fallthrough: false,
    immutable: true,
    maxAge: "7d",
  })
);

app.use(
  express.static(publicDir, {
    fallthrough: true,
    index: "index.html",
    maxAge: 0,
  })
);

app.get("/admin/:id", (request, response) => {
  if (!isValidSessionId(request.params.id)) {
    return response.status(404).send("Not Found");
  }

  return response.sendFile(path.join(publicDir, "admin.html"));
});

app.get("/view/:id", (request, response) => {
  if (!isValidSessionId(request.params.id)) {
    return response.status(404).send("Not Found");
  }

  return response.sendFile(path.join(publicDir, "viewer.html"));
});

app.get("/overview", (_request, response) => {
  return response.sendFile(path.join(publicDir, "overview.html"));
});

app.post("/api/session/new", createSessionLimiter, (request, response) => {
  const session = createSession();
  logEvent("session_created", {
    sessionId: session.id,
    ip: getRequestIp(request),
    userAgent: request.get("user-agent") || "unknown",
  });
  response.status(201).json({
    id: session.id,
    adminToken: session.adminToken,
  });
});

app.get("/api/sessions/active", (_request, response) => {
  cleanupExpiredSessions();
  response.json({
    sessions: listActiveSessions(),
  });
});

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.currentSession = null;
  socket.isAdmin = false;

  socket.on("session:join", (sessionId, role, tokenOrCallback, maybeCallback) => {
    const callback =
      typeof tokenOrCallback === "function" ? tokenOrCallback : maybeCallback;
    const adminToken = typeof tokenOrCallback === "string" ? tokenOrCallback : null;

    if (!isValidSessionId(sessionId) || !isValidRole(role)) {
      if (callback) callback({ success: false, reason: "invalid_request" });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session || isSessionExpired(session)) {
      deleteSession(sessionId);
      if (callback) callback({ success: false, reason: "not_found" });
      return;
    }

    const wantsAdmin = role === "admin";
    if (wantsAdmin && !tokensMatch(session.adminToken, adminToken)) {
      if (callback) callback({ success: false, reason: "unauthorized" });
      return;
    }

    touchSession(session);
    socket.join(sessionId);
    socket.currentSession = sessionId;
    socket.isAdmin = wantsAdmin;

    emitSessionState(socket, sessionId, session);

    if (callback) callback({ success: true });
  });

  socket.on("timer:setTime", (ms) => {
    const session = getAdminSession(socket);
    const safeMs = sanitizeTimerMs(ms);
    if (!session || safeMs === null || session.status === "running") return;

    session.totalTime = safeMs;
    session.elapsed = 0;
    session.startTime = null;
    session.status = "stopped";
    broadcastSession(socket.currentSession);
  });

  socket.on("timer:start", () => {
    const session = getAdminSession(socket);
    if (!session || session.status === "running" || getRemaining(session) <= 0) return;

    session.startTime = Date.now();
    session.status = "running";
    touchSession(session);

    if (!session.interval) {
      const sessionId = socket.currentSession;
      session.interval = setInterval(() => broadcastSession(sessionId), 250);
    }

    broadcastSession(socket.currentSession);
  });

  socket.on("timer:pause", () => {
    const session = getAdminSession(socket);
    if (!session || session.status !== "running") return;

    session.elapsed += Date.now() - session.startTime;
    session.startTime = null;
    session.status = "paused";
    clearSessionInterval(session);
    broadcastSession(socket.currentSession);
  });

  socket.on("timer:reset", () => {
    const session = getAdminSession(socket);
    if (!session) return;

    session.elapsed = 0;
    session.startTime = null;
    session.status = "stopped";
    clearSessionInterval(session);
    broadcastSession(socket.currentSession);
  });
});

setInterval(cleanupExpiredSessions, SESSION_CLEANUP_MS).unref();

server.listen(PORT, () => {
  console.log(`Servidor em http://localhost:${PORT}`);
});

function createSession() {
  const now = Date.now();
  const id = randomBytes(4).toString("hex");
  const adminToken = randomBytes(18).toString("hex");

  const session = {
    id,
    adminToken,
    status: "stopped",
    elapsed: 0,
    startTime: null,
    totalTime: DEFAULT_TIMER_MS,
    interval: null,
    createdAt: now,
    lastAccessAt: now,
  };

  sessions.set(id, session);
  return session;
}

function getRemaining(session) {
  const elapsed =
    session.status === "running"
      ? session.elapsed + (Date.now() - session.startTime)
      : session.elapsed;

  return Math.max(0, session.totalTime - elapsed);
}

function touchSession(session) {
  session.lastAccessAt = Date.now();
}

function isSessionExpired(session) {
  return Date.now() - session.lastAccessAt > SESSION_TTL_MS;
}

function cleanupExpiredSessions() {
  for (const [sessionId, session] of sessions.entries()) {
    if (isSessionExpired(session)) {
      deleteSession(sessionId);
    }
  }
}

function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  clearSessionInterval(session);
  sessions.delete(sessionId);
}

function clearSessionInterval(session) {
  if (!session.interval) return;
  clearInterval(session.interval);
  session.interval = null;
}

function listActiveSessions() {
  return Array.from(sessions.values())
    .filter((session) => !isSessionExpired(session))
    .map((session) => {
      const remaining = getRemaining(session);
      return {
        id: session.id,
        status: session.status,
        remaining,
        totalTime: session.totalTime,
        pct: session.totalTime > 0 ? remaining / session.totalTime : 1,
        createdAt: session.createdAt,
        lastAccessAt: session.lastAccessAt,
      };
    })
    .sort((left, right) => {
      const statusRank = getStatusRank(left.status) - getStatusRank(right.status);
      if (statusRank !== 0) {
        return statusRank;
      }

      return right.createdAt - left.createdAt;
    });
}

function broadcastSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (isSessionExpired(session)) {
    deleteSession(sessionId);
    return;
  }

  const remaining = getRemaining(session);
  const pct = session.totalTime > 0 ? remaining / session.totalTime : 1;

  if (session.status === "running" && remaining <= 0) {
    session.elapsed = session.totalTime;
    session.startTime = null;
    session.status = "finished";
    clearSessionInterval(session);
  }

  touchSession(session);
  io.to(sessionId).emit("timer:tick", {
    status: session.status,
    remaining: getRemaining(session),
    totalTime: session.totalTime,
    pct,
  });
}

function emitSessionState(target, sessionId, session) {
  touchSession(session);
  const remaining = getRemaining(session);
  target.emit("timer:tick", {
    status: session.status,
    remaining,
    totalTime: session.totalTime,
    pct: session.totalTime > 0 ? remaining / session.totalTime : 1,
  });
}

function getAdminSession(socket) {
  if (!socket.isAdmin || !isValidSessionId(socket.currentSession)) {
    return null;
  }

  const session = sessions.get(socket.currentSession);
  if (!session || isSessionExpired(session)) {
    deleteSession(socket.currentSession);
    return null;
  }

  touchSession(session);
  return session;
}

function sanitizeTimerMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  const safeValue = Math.trunc(parsed);
  if (safeValue < 1000 || safeValue > MAX_TIMER_MS) {
    return null;
  }

  return safeValue;
}

function isValidSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function isValidAdminToken(value) {
  return typeof value === "string" && ADMIN_TOKEN_PATTERN.test(value);
}

function isValidRole(value) {
  return value === "admin" || value === "viewer";
}

function getStatusRank(status) {
  switch (status) {
    case "running":
      return 0;
    case "paused":
      return 1;
    case "stopped":
      return 2;
    case "finished":
      return 3;
    default:
      return 4;
  }
}

function tokensMatch(expected, received) {
  if (!isValidAdminToken(expected) || !isValidAdminToken(received)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isValidWebhookSignature(signature, payload) {
  if (typeof signature !== "string" || !Buffer.isBuffer(payload)) {
    return false;
  }

  const digest =
    "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  return timingSafeCompareString(signature, digest);
}

function timingSafeCompareString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOrigin(value) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(originHeader, requestHost) {
  if (!originHeader) {
    return true;
  }

  try {
    const requestOrigin = new URL(originHeader).origin;

    if (ALLOWED_ORIGIN) {
      return requestOrigin === ALLOWED_ORIGIN;
    }

    return new URL(`http://${requestHost}`).host === new URL(requestOrigin).host;
  } catch {
    return false;
  }
}

function logAccess(request, response, startedAt) {
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  logEvent("http_access", {
    ip: getRequestIp(request),
    method: request.method,
    path: request.originalUrl || request.url,
    status: response.statusCode,
    durationMs: durationMs.toFixed(1),
    userAgent: request.get("user-agent") || "unknown",
  });
}

function getRequestIp(request) {
  return request.ip || request.socket?.remoteAddress || "unknown";
}

function logEvent(event, details) {
  const timestamp = new Date().toISOString();
  const serializedDetails = Object.entries(details)
    .map(([key, value]) => `${key}=${serializeLogValue(value)}`)
    .join(" ");

  console.log(`[${timestamp}] ${event}${serializedDetails ? ` ${serializedDetails}` : ""}`);
}

function serializeLogValue(value) {
  return String(value).replace(/\s+/g, "_");
}
