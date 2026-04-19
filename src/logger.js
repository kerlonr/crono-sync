const fs = require("fs");
const path = require("path");

const LOG_HEADER = (process.env.LOG_HEADER || "CRONO").trim() || "CRONO";
const LOG_FILE = process.env.LOG_FILE || path.join(process.cwd(), "logs", "app.log");

let fileLoggingReady = false;
let fileLoggingDisabled = false;
const KNOWN_EVENTS = {
  deploy_error: {
    section: "DEPLOY",
    action: "error",
    consoleKeys: ["message"],
  },
  deploy_finished: {
    section: "DEPLOY",
    action: "finished",
    consoleKeys: ["code", "signal"],
  },
  deploy_started: {
    section: "DEPLOY",
    action: "started",
    consoleKeys: ["branch", "repository"],
  },
  deploy_stderr: {
    section: "DEPLOY",
    action: "stderr",
    consoleKeys: ["line"],
  },
  deploy_stdout: {
    section: "DEPLOY",
    action: "stdout",
    consoleKeys: ["line"],
  },
  deploy_trigger_error: {
    section: "DEPLOY",
    action: "trigger_error",
    consoleKeys: ["branch", "message"],
  },
  deploy_trigger_failed: {
    section: "DEPLOY",
    action: "trigger_failed",
    consoleKeys: ["branch", "status"],
  },
  deploy_triggered: {
    section: "DEPLOY",
    action: "triggered",
    consoleKeys: ["branch"],
  },
  deployer_started: {
    section: "SYSTEM",
    action: "ready",
    consoleKeys: ["port", "file"],
  },
  http_access: {
    section: "HTTP",
    action: "request",
    consoleKeys: ["method", "path", "status"],
  },
  page_visit: {
    section: "ACCESS",
    action: "visit",
    consoleKeys: ["page", "ip"],
  },
  server_started: {
    section: "SYSTEM",
    action: "ready",
    consoleKeys: ["url", "file"],
  },
  session_created: {
    section: "SESSION",
    action: "created",
    consoleKeys: ["sessionId", "totalTime", "ip"],
  },
  session_join_denied: {
    section: "SESSION",
    action: "denied",
    consoleKeys: ["role", "sessionId", "reason", "ip"],
  },
  session_joined: {
    section: "SESSION",
    action: "joined",
    consoleKeys: ["role", "sessionId", "ip"],
  },
  webhook_accepted: {
    section: "WEBHOOK",
    action: "accepted",
    consoleKeys: ["branch", "repository"],
  },
  webhook_ignored: {
    section: "WEBHOOK",
    action: "ignored",
    consoleKeys: ["branch", "expectedBranch"],
  },
};

module.exports = {
  formatTimerMs,
  getLogFile,
  getRequestIp,
  logAccess,
  logEvent,
};

function logAccess(request, response, startedAt) {
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const method = request.method || "GET";
  const requestPath = request.originalUrl || request.url || "/";

  if (shouldSkipAccessLog(method, requestPath)) {
    return;
  }

  if (isPageVisit(method, requestPath, response.statusCode)) {
    logEvent("page_visit", {
      page: getPageName(requestPath),
      path: requestPath,
      status: response.statusCode,
      duration: formatDurationMs(durationMs),
      ip: getRequestIp(request),
    });
    return;
  }

  logEvent("http_access", {
    method,
    path: requestPath,
    status: response.statusCode,
    duration: formatDurationMs(durationMs),
    ip: getRequestIp(request),
  });
}

function getRequestIp(request) {
  const rawIp = request.ip || request.socket?.remoteAddress || "unknown";
  return String(rawIp).replace(/^::ffff:/, "");
}

function logEvent(event, details = {}) {
  const timestamp = new Date().toISOString();
  const meta = getEventMeta(event);
  const safeDetails = sanitizeDetails(details);

  console.log(buildConsoleLine(meta, safeDetails));
  writeToFile(`${timestamp} ${buildFileLine(meta, safeDetails)}\n`);
}

function getLogFile() {
  return LOG_FILE;
}

function shouldSkipAccessLog(method, requestPath) {
  if (method === "OPTIONS" || method === "HEAD") {
    return true;
  }

  return (
    requestPath.startsWith("/assets/") ||
    requestPath.startsWith("/socket.io/") ||
    requestPath === "/favicon.ico" ||
    requestPath === "/health" ||
    requestPath === "/api/session/new" ||
    requestPath === "/api/sessions/active"
  );
}

function isPageVisit(method, requestPath, statusCode) {
  return (
    method === "GET" &&
    statusCode < 400 &&
    !requestPath.startsWith("/api/") &&
    !requestPath.startsWith("/webhook")
  );
}

function getPageName(requestPath) {
  if (requestPath === "/" || requestPath === "/index.html") return "landing";
  if (requestPath === "/overview") return "overview";
  if (/^\/admin\/[a-f0-9]+$/i.test(requestPath)) return "admin";
  if (/^\/view\/[a-f0-9]+$/i.test(requestPath)) return "viewer";
  return "page";
}

function getEventMeta(event) {
  return (
    KNOWN_EVENTS[event] || {
      section: "APP",
      action: String(event).trim() || "event",
      consoleKeys: [],
    }
  );
}

function sanitizeDetails(details) {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, formatDetailValue(value)]),
  );
}

function buildConsoleLine(meta, details) {
  const prefix = `[${LOG_HEADER}][${meta.section}] ${meta.action}`;
  const summary = meta.consoleKeys
    .filter((key) => details[key] !== undefined)
    .map((key) => `${key}=${details[key]}`)
    .join(" ");

  return summary ? `${prefix} ${summary}` : prefix;
}

function buildFileLine(meta, details) {
  const prefix = `[${LOG_HEADER}][${meta.section}] ${meta.action}`;
  const payload = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  return payload ? `${prefix} ${payload}` : `${prefix}`;
}

function formatDetailValue(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => formatDetailValue(item)).join(",");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  const sanitized = String(value).replace(/\s+/g, " ").trim();
  return sanitized || "\"\"";
}

function writeToFile(line) {
  if (fileLoggingDisabled) {
    return;
  }

  try {
    ensureFileLoggingReady();
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (error) {
    fileLoggingDisabled = true;
    console.error(
      `[${LOG_HEADER}][LOGGER] file_disabled path=${LOG_FILE} message=${formatDetailValue(error.message)}`,
    );
  }
}

function ensureFileLoggingReady() {
  if (fileLoggingReady) {
    return;
  }

  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fileLoggingReady = true;
}

function formatDurationMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatTimerMs(value) {
  const safeValue = Math.max(0, Number(value) || 0);
  const totalSeconds = Math.floor(safeValue / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds,
  ).padStart(2, "0")}`;
}
