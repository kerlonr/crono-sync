const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { randomBytes } = require("crypto");
const { exec } = require("child_process");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.WEBHOOK_SECRET)
      .update(req.body)
      .digest("hex");

  if (req.headers["x-hub-signature-256"] !== sig) {
    return res.status(401).send("Unauthorized");
  }

  res.status(200).send("OK");
  console.log("Push detectado! Atualizando...");

  setTimeout(() => {
    exec("cd /app && git pull origin main", (err, stdout, stderr) => {
      if (err) {
        console.error(stderr);
        return;
      }
      console.log(stdout);
      console.log("Reiniciando...");
      process.exit(0);
    });
  }, 100);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessions = new Map();

function createSession() {
  const id = randomBytes(4).toString("hex");
  sessions.set(id, {
    status: "stopped",
    elapsed: 0,
    startTime: null,
    totalTime: 5 * 60 * 1000,
    interval: null,
  });
  return id;
}

function getRemaining(s) {
  const elapsed =
    s.status === "running" ? s.elapsed + (Date.now() - s.startTime) : s.elapsed;
  return Math.max(0, s.totalTime - elapsed);
}

function broadcastSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  const remaining = getRemaining(s);
  const pct = s.totalTime > 0 ? remaining / s.totalTime : 1;

  if (s.status === "running" && remaining <= 0) {
    s.elapsed = s.totalTime;
    s.startTime = null;
    s.status = "stopped";
    clearInterval(s.interval);
    s.interval = null;
  }

  io.to(id).emit("timer:tick", {
    status: s.status,
    remaining: getRemaining(s),
    totalTime: s.totalTime,
    pct,
  });
}

// Criar nova sessão
app.post("/api/session/new", (req, res) => {
  const id = createSession();
  res.json({ id });
});

// SPA fallback — admin e viewer são servidos pelo HTML estático
app.get("/admin/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
app.get("/view/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "viewer.html"));
});

io.on("connection", (socket) => {
  socket.on("session:join", (sessionId, role, callback) => {
    const s = sessions.get(sessionId);
    if (!s) {
      if (callback) callback({ success: false });
      return;
    }
    socket.join(sessionId);
    socket.currentSession = sessionId;
    socket.isAdmin = role === "admin";
    const remaining = getRemaining(s);
    socket.emit("timer:tick", {
      status: s.status,
      remaining,
      totalTime: s.totalTime,
      pct: s.totalTime > 0 ? remaining / s.totalTime : 1,
    });
    if (callback) callback({ success: true });
  });

  socket.on("timer:setTime", (ms) => {
    if (!socket.isAdmin) return;
    const s = sessions.get(socket.currentSession);
    if (!s || s.status === "running") return;
    s.totalTime = ms;
    s.elapsed = 0;
    s.startTime = null;
    s.status = "stopped";
    broadcastSession(socket.currentSession);
  });

  socket.on("timer:start", () => {
    if (!socket.isAdmin) return;
    const id = socket.currentSession;
    const s = sessions.get(id);
    if (!s || s.status === "running" || getRemaining(s) <= 0) return;
    s.startTime = Date.now();
    s.status = "running";
    if (!s.interval) s.interval = setInterval(() => broadcastSession(id), 100);
  });

  socket.on("timer:pause", () => {
    if (!socket.isAdmin) return;
    const id = socket.currentSession;
    const s = sessions.get(id);
    if (!s || s.status !== "running") return;
    s.elapsed += Date.now() - s.startTime;
    s.startTime = null;
    s.status = "paused";
    clearInterval(s.interval);
    s.interval = null;
    broadcastSession(id);
  });

  socket.on("timer:reset", () => {
    if (!socket.isAdmin) return;
    const id = socket.currentSession;
    const s = sessions.get(id);
    if (!s) return;
    s.elapsed = 0;
    s.startTime = null;
    s.status = "stopped";
    clearInterval(s.interval);
    s.interval = null;
    broadcastSession(id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`));
