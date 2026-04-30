const { randomBytes } = require("crypto");

module.exports = {
  createSessionStore,
};

function createSessionStore({
  adminTokenPattern,
  defaultTimerMs,
  io,
  maxTimerMs,
  sessionIdPattern,
  sessionTtlMs,
}) {
  const sessions = new Map();

  return {
    broadcastSession,
    clearSessionInterval,
    cleanupExpiredSessions,
    closeSession,
    createSession,
    deleteSession,
    emitSessionState,
    getAdminSession,
    getRemaining,
    getSession,
    isValidAdminToken,
    isValidRole,
    isValidSessionId,
    listActiveSessions,
    sanitizeTimerMs,
    touchSession,
  };

  function createSession() {
    const now = Date.now();
    const id = createSessionId();
    const adminToken = randomBytes(18).toString("hex");

    const session = {
      id,
      adminToken,
      status: "stopped",
      elapsed: 0,
      startTime: null,
      totalTime: defaultTimerMs,
      interval: null,
      createdAt: now,
      lastAccessAt: now,
    };

    sessions.set(id, session);
    return session;
  }

  function createSessionId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = randomBytes(4).toString("hex");
      if (!sessions.has(id)) {
        return id;
      }
    }

    throw new Error("Unable to allocate a unique session id.");
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
    return Date.now() - session.lastAccessAt > sessionTtlMs;
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

  function closeSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || isSessionExpired(session)) {
      deleteSession(sessionId);
      return false;
    }

    io.to(sessionId).emit("session:closed");
    deleteSession(sessionId);
    return true;
  }

  function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || isSessionExpired(session)) {
      deleteSession(sessionId);
      return null;
    }

    return session;
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
        return {
          id: session.id,
          ...buildSessionState(session),
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

  function broadcastSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    if (isSessionExpired(session)) {
      deleteSession(sessionId);
      return;
    }

    const remaining = getRemaining(session);

    if (session.status === "running" && remaining <= 0) {
      session.elapsed = session.totalTime;
      session.startTime = null;
      session.status = "finished";
      clearSessionInterval(session);
    }

    touchSession(session);
    io.to(sessionId).emit("timer:tick", buildSessionState(session));
  }

  function emitSessionState(target, session) {
    touchSession(session);
    target.emit("timer:tick", buildSessionState(session));
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
    if (safeValue < 1000 || safeValue > maxTimerMs) {
      return null;
    }

    return safeValue;
  }

  function isValidSessionId(value) {
    return typeof value === "string" && sessionIdPattern.test(value);
  }

  function isValidAdminToken(value) {
    return typeof value === "string" && adminTokenPattern.test(value);
  }

  function isValidRole(value) {
    return value === "admin" || value === "viewer";
  }

  function buildSessionState(session) {
    const remaining = getRemaining(session);

    return {
      status: session.status,
      remaining,
      totalTime: session.totalTime,
      pct: session.totalTime > 0 ? remaining / session.totalTime : 1,
    };
  }
}
