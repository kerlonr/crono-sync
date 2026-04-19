module.exports = {
  getRequestIp,
  logAccess,
  logEvent,
};

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

function logEvent(event, details = {}) {
  const timestamp = new Date().toISOString();
  const serializedDetails = Object.entries(details)
    .map(([key, value]) => `${key}=${serializeLogValue(value)}`)
    .join(" ");

  console.log(`[${timestamp}] ${event}${serializedDetails ? ` ${serializedDetails}` : ""}`);
}

function serializeLogValue(value) {
  return String(value).replace(/\s+/g, "_");
}
