const assert = require("node:assert/strict");
const { afterEach, describe, it } = require("node:test");

const { createSessionStore } = require("../src/sessions");

const SESSION_ID_PATTERN = /^[a-f0-9]{8}$/i;
const ADMIN_TOKEN_PATTERN = /^[a-f0-9]{36}$/i;
const DEFAULT_TIMER_MS = 5 * 60 * 1000;
const MAX_TIMER_MS = 12 * 60 * 60 * 1000;
const SESSION_TTL_MS = 60 * 1000;

/** Coleta as emissoes para inspecao, no lugar do io real do Socket.IO. */
function createFakeIo() {
  const emissions = [];
  return {
    emissions,
    to(room) {
      return {
        emit(event, payload) {
          emissions.push({ room, event, payload });
        },
      };
    },
  };
}

function createStore(io = createFakeIo()) {
  const store = createSessionStore({
    adminTokenPattern: ADMIN_TOKEN_PATTERN,
    defaultTimerMs: DEFAULT_TIMER_MS,
    io,
    maxTimerMs: MAX_TIMER_MS,
    sessionIdPattern: SESSION_ID_PATTERN,
    sessionTtlMs: SESSION_TTL_MS,
  });
  return { store, io };
}

describe("createSession", () => {
  it("gera id e token validos com estado inicial parado", () => {
    const { store } = createStore();
    const session = store.createSession();

    assert.match(session.id, SESSION_ID_PATTERN);
    assert.match(session.adminToken, ADMIN_TOKEN_PATTERN);
    assert.equal(session.status, "stopped");
    assert.equal(session.totalTime, DEFAULT_TIMER_MS);
    assert.equal(session.elapsed, 0);
  });

  it("registra a sessao para consulta posterior", () => {
    const { store } = createStore();
    const session = store.createSession();
    assert.equal(store.getSession(session.id), session);
  });
});

describe("validacoes", () => {
  const { store } = createStore();

  it("isValidSessionId", () => {
    assert.equal(store.isValidSessionId("a1b2c3d4"), true);
    assert.equal(store.isValidSessionId("xyz"), false);
    assert.equal(store.isValidSessionId(123), false);
  });

  it("isValidAdminToken", () => {
    assert.equal(store.isValidAdminToken("a".repeat(36)), true);
    assert.equal(store.isValidAdminToken("a".repeat(10)), false);
  });

  it("isValidRole aceita apenas admin e viewer", () => {
    assert.equal(store.isValidRole("admin"), true);
    assert.equal(store.isValidRole("viewer"), true);
    assert.equal(store.isValidRole("hacker"), false);
  });
});

describe("sanitizeTimerMs", () => {
  const { store } = createStore();

  it("aceita valores dentro do intervalo e trunca decimais", () => {
    assert.equal(store.sanitizeTimerMs(1500.9), 1500);
  });

  it("rejeita abaixo do minimo, acima do maximo e nao-numerico", () => {
    assert.equal(store.sanitizeTimerMs(999), null);
    assert.equal(store.sanitizeTimerMs(MAX_TIMER_MS + 1), null);
    assert.equal(store.sanitizeTimerMs("abc"), null);
    assert.equal(store.sanitizeTimerMs(Infinity), null);
  });
});

describe("getRemaining", () => {
  it("para sessao parada retorna o tempo total", () => {
    const { store } = createStore();
    const session = store.createSession();
    assert.equal(store.getRemaining(session), DEFAULT_TIMER_MS);
  });

  it("para sessao rodando desconta o tempo decorrido", () => {
    const { store } = createStore();
    const session = store.createSession();
    session.totalTime = 5000;
    session.status = "running";
    session.startTime = Date.now() - 1000;

    const remaining = store.getRemaining(session);
    assert.ok(remaining <= 4000 && remaining > 3800, `remaining=${remaining}`);
  });

  it("nunca retorna valor negativo", () => {
    const { store } = createStore();
    const session = store.createSession();
    session.totalTime = 1000;
    session.status = "running";
    session.startTime = Date.now() - 5000;
    assert.equal(store.getRemaining(session), 0);
  });
});

describe("expiracao", () => {
  it("getSession remove e retorna null para sessao expirada", () => {
    const { store } = createStore();
    const session = store.createSession();
    session.lastAccessAt = Date.now() - (SESSION_TTL_MS + 1000);

    assert.equal(store.getSession(session.id), null);
    assert.equal(store.getSession(session.id), null);
  });

  it("listActiveSessions ignora as expiradas", () => {
    const { store } = createStore();
    const ativa = store.createSession();
    const expirada = store.createSession();
    expirada.lastAccessAt = Date.now() - (SESSION_TTL_MS + 1000);

    const ids = store.listActiveSessions().map((s) => s.id);
    assert.ok(ids.includes(ativa.id));
    assert.ok(!ids.includes(expirada.id));
  });
});

describe("closeSession", () => {
  it("emite session:closed e remove a sessao", () => {
    const { store, io } = createStore();
    const session = store.createSession();

    assert.equal(store.closeSession(session.id), true);
    assert.ok(
      io.emissions.some(
        (e) => e.room === session.id && e.event === "session:closed",
      ),
    );
    assert.equal(store.getSession(session.id), null);
  });

  it("retorna false para sessao inexistente", () => {
    const { store } = createStore();
    assert.equal(store.closeSession("ffffffff"), false);
  });
});

describe("broadcastSession", () => {
  it("marca como finished quando o tempo acaba", () => {
    const { store, io } = createStore();
    const session = store.createSession();
    session.totalTime = 1000;
    session.status = "running";
    session.startTime = Date.now() - 5000;

    store.broadcastSession(session.id);

    assert.equal(session.status, "finished");
    assert.equal(session.startTime, null);
    const tick = io.emissions.findLast((e) => e.event === "timer:tick");
    assert.equal(tick.payload.remaining, 0);
    assert.equal(tick.payload.status, "finished");
  });
});
