module.exports = {
  formatTimerMs,
  getRequestIp,
  logAccess,
  logEvent,
};

function logAccess(request, response, startedAt) {
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const method = request.method || "GET";
  const path = request.originalUrl || request.url || "/";

  if (shouldSkipAccessLog(method, path)) {
    return;
  }

  if (isPageVisit(method, path, response.statusCode)) {
    logEvent("page_visit", {
      page: getPageName(path),
      path,
      status: response.statusCode,
      duration: formatDurationMs(durationMs),
      ip: getRequestIp(request),
      userAgent: request.get("user-agent") || "unknown",
    });
    return;
  }

  logEvent("http_access", {
    method,
    path,
    status: response.statusCode,
    duration: formatDurationMs(durationMs),
    ip: getRequestIp(request),
    userAgent: request.get("user-agent") || "unknown",
  });
}

function getRequestIp(request) {
  const rawIp = request.ip || request.socket?.remoteAddress || "unknown";
  return String(rawIp).replace(/^::ffff:/, "");
}

function logEvent(event, details = {}) {
  const timestamp = new Date().toISOString();
  const meta = getEventMeta(event);
  const header = `[${timestamp}] [${meta.section.padEnd(8, " ")}] ${meta.label}`;
  const detailLines = formatDetails(details);

  console.log([header, ...detailLines].join("\n"));
}

function shouldSkipAccessLog(method, path) {
  if (method === "OPTIONS" || method === "HEAD") {
    return true;
  }

  return (
    path.startsWith("/assets/") ||
    path.startsWith("/socket.io/") ||
    path === "/favicon.ico" ||
    path === "/health" ||
    path === "/api/session/new" ||
    path === "/api/sessions/active"
  );
}

function isPageVisit(method, path, statusCode) {
  return (
    method === "GET" &&
    statusCode < 400 &&
    !path.startsWith("/api/") &&
    !path.startsWith("/webhook")
  );
}

function getPageName(path) {
  if (path === "/" || path === "/index.html") return "landing";
  if (path === "/overview") return "overview";
  if (/^\/admin\/[a-f0-9]+$/i.test(path)) return "admin";
  if (/^\/view\/[a-f0-9]+$/i.test(path)) return "viewer";
  return "page";
}

function getEventMeta(event) {
  const knownEvents = {
    deploy_error: { section: "DEPLOY", label: "Deploy Error" },
    deploy_finished: { section: "DEPLOY", label: "Deploy Finished" },
    deploy_started: { section: "DEPLOY", label: "Deploy Started" },
    deploy_stderr: { section: "DEPLOY", label: "Deploy stderr" },
    deploy_stdout: { section: "DEPLOY", label: "Deploy stdout" },
    deploy_trigger_error: { section: "DEPLOY", label: "Trigger Error" },
    deploy_trigger_failed: { section: "DEPLOY", label: "Trigger Failed" },
    deploy_triggered: { section: "DEPLOY", label: "Trigger Sent" },
    deployer_started: { section: "DEPLOY", label: "Deployer Ready" },
    http_access: { section: "HTTP", label: "Request" },
    page_visit: { section: "ACCESS", label: "Page Visit" },
    server_started: { section: "SYSTEM", label: "Server Ready" },
    session_created: { section: "SESSION", label: "Session Created" },
    session_join_denied: { section: "SESSION", label: "Join Denied" },
    session_joined: { section: "SESSION", label: "Joined" },
    timer_paused: { section: "TIMER", label: "Paused" },
    timer_reset: { section: "TIMER", label: "Reset" },
    timer_started: { section: "TIMER", label: "Started" },
    timer_updated: { section: "TIMER", label: "Time Updated" },
    webhook_accepted: { section: "WEBHOOK", label: "Accepted" },
    webhook_ignored: { section: "WEBHOOK", label: "Ignored" },
  };

  return (
    knownEvents[event] || {
      section: "APP",
      label: humanizeEventName(event),
    }
  );
}

function formatDetails(details) {
  const entries = Object.entries(details).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return [];
  }

  const longestKey = entries.reduce(
    (max, [key]) => Math.max(max, key.length),
    0,
  );

  return entries.map(
    ([key, value]) => `  ${key.padEnd(longestKey, " ")} : ${formatDetailValue(value)}`,
  );
}

function formatDetailValue(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => formatDetailValue(item)).join(", ");

  if (typeof value === "object") {
    return truncateText(JSON.stringify(value));
  }

  const sanitized = String(value).replace(/\s+/g, " ").trim();

  if (!sanitized) {
    return "\"\"";
  }

  const shortened = truncateText(sanitized);
  return /\s/.test(shortened) ? JSON.stringify(shortened) : shortened;
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

function humanizeEventName(value) {
  return String(value)
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateText(value, maxLength = 120) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
