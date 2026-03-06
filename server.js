const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PASSWORD = 'admin123';

let status = 'stopped';
let elapsed = 0;
let startTime = null;
let totalTime = 5 * 60 * 1000; // padrão 5 minutos em ms
let interval = null;

function getElapsed() {
  if (status === 'running') return elapsed + (Date.now() - startTime);
  return elapsed;
}

function getRemaining() {
  return Math.max(0, totalTime - getElapsed());
}

function broadcast() {
  const remaining = getRemaining();
  const pct = totalTime > 0 ? remaining / totalTime : 1;
  // Para automaticamente ao chegar em zero
  if (status === 'running' && remaining <= 0) {
    elapsed = totalTime;
    startTime = null;
    status = 'stopped';
    stopBroadcast();
  }
  io.emit('timer:tick', { status, remaining: getRemaining(), totalTime, pct });
}

function startBroadcast() {
  if (interval) return;
  interval = setInterval(broadcast, 100);
}

function stopBroadcast() {
  clearInterval(interval);
  interval = null;
}

io.on('connection', (socket) => {
  const remaining = getRemaining();
  const pct = totalTime > 0 ? remaining / totalTime : 1;
  socket.emit('timer:tick', { status, remaining, totalTime, pct });

  socket.on('admin:login', (password, callback) => {
    if (password === ADMIN_PASSWORD) {
      socket.join('admins');
      callback({ success: true });
    } else {
      callback({ success: false });
    }
  });

  socket.on('timer:setTime', (ms) => {
    if (!socket.rooms.has('admins')) return;
    if (status === 'running') return;
    totalTime = ms;
    elapsed = 0;
    startTime = null;
    status = 'stopped';
    broadcast();
  });

  socket.on('timer:start', () => {
    if (!socket.rooms.has('admins')) return;
    if (status === 'running') return;
    if (getRemaining() <= 0) return;
    startTime = Date.now();
    status = 'running';
    startBroadcast();
  });

  socket.on('timer:pause', () => {
    if (!socket.rooms.has('admins')) return;
    if (status !== 'running') return;
    elapsed += Date.now() - startTime;
    startTime = null;
    status = 'paused';
    stopBroadcast();
    broadcast();
  });

  socket.on('timer:reset', () => {
    if (!socket.rooms.has('admins')) return;
    elapsed = 0;
    startTime = null;
    status = 'stopped';
    stopBroadcast();
    broadcast();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`));
