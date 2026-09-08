/**
 * Visao geral das sessoes.
 *
 * Le `/api/sessions/active` a cada 3 segundos e desenha um cartao por sessao.
 * O DOM so e reconstruido quando a lista muda; nos demais ciclos os campos sao
 * atualizados no lugar, para as transicoes do CSS acontecerem de verdade e o
 * texto nao piscar.
 *
 * Esta tela e somente leitura. O botao "Finalizar" saiu daqui: ele chamava um
 * endpoint sem autenticacao nenhuma, e como a propria lista entrega os ids de
 * todas as sessoes, qualquer visitante podia derrubar todas - inclusive uma
 * aula em andamento. Encerrar virou acao do painel de admin, onde o socket ja
 * provou ter o token da sessao.
 */
(() => {
  const {
    formatTime,
    getDisplayMs,
    getPhase,
    getTimerLabel,
    sanitizeSessionState,
  } = window.CronoUtils;

  const POLL_INTERVAL_MS = 3000;

  const grid = document.getElementById("overview-grid");
  const empty = document.getElementById("overview-empty");
  const summary = document.getElementById("overview-summary");

  if (!grid || !empty || !summary) return;

  const cards = new Map();

  let currentSessions = [];
  let gridSignature = null;
  let pollTimer = 0;
  let requestInFlight = false;

  startPolling();

  window.addEventListener("beforeunload", stopPolling);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return stopPolling();
    startPolling();
  });

  // ------------------------------------------------------------- consulta

  async function loadSessions() {
    if (requestInFlight) return;
    requestInFlight = true;

    try {
      const response = await fetch("/api/sessions/active", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) throw new Error("Falha ao carregar as sessões.");

      const data = await response.json();
      currentSessions = Array.isArray(data?.sessions) ? data.sessions : [];
      render(currentSessions);
    } catch (error) {
      console.error(error);
      render([]);
    } finally {
      requestInFlight = false;
    }
  }

  function startPolling() {
    stopPolling();
    loadSessions();
    pollTimer = window.setInterval(loadSessions, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (!pollTimer) return;
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  // ------------------------------------------------------------- desenho

  function render(sessions) {
    summary.textContent = buildSummary(sessions);
    empty.hidden = sessions.length > 0;

    if (!sessions.length) {
      grid.replaceChildren();
      cards.clear();
      gridSignature = null;
      return;
    }

    const signature = sessions.map((session) => session.id).join(",");
    if (signature !== gridSignature) {
      const presentes = new Set(sessions.map((session) => session.id));
      for (const [id, card] of cards) {
        if (presentes.has(id)) continue;
        card.root.remove();
        cards.delete(id);
      }

      for (const session of sessions) {
        let card = cards.get(session.id);
        if (!card) {
          card = createCard(session);
          cards.set(session.id, card);
        }
        grid.appendChild(card.root);
      }

      gridSignature = signature;
    }

    for (const session of sessions) updateCard(cards.get(session.id), session);
  }

  /** Os dois numeros que antes ocupavam dois cartoes grandes, em uma linha. */
  function buildSummary(sessions) {
    if (!sessions.length) return "Nenhuma sessão no ar.";

    const rodando = sessions.filter(
      (session) => session?.status === "running",
    ).length;

    const total = `${sessions.length} ${sessions.length === 1 ? "sessão" : "sessões"}`;
    return rodando ? `${total} · ${rodando} rodando` : total;
  }

  function createCard(session) {
    const root = document.createElement("article");
    root.className = "session-card";

    const top = document.createElement("div");
    top.className = "session-card-top";

    const id = document.createElement("span");
    id.className = "session-id";
    id.textContent = session.id;

    const status = document.createElement("span");
    status.className = "status-pill";

    top.append(id, status);

    const primary = document.createElement("div");
    primary.className = "session-primary";

    const primaryLabel = document.createElement("span");
    primaryLabel.className = "session-primary-label";

    const time = document.createElement("span");
    time.className = "timer-digits session-time";

    const progress = document.createElement("div");
    progress.className = "progress";
    const progressFill = document.createElement("div");
    progressFill.className = "progress-fill";
    progress.appendChild(progressFill);

    primary.append(primaryLabel, time, progress);

    const others = document.createElement("div");
    others.className = "session-others";

    const foot = document.createElement("div");
    foot.className = "session-foot";

    const note = document.createElement("span");
    note.className = "session-note";

    const actions = document.createElement("div");
    actions.className = "session-actions";

    const viewerLink = document.createElement("a");
    viewerLink.className = "btn btn--plain btn--small";
    viewerLink.href = `/view/${session.id}`;
    viewerLink.target = "_blank";
    viewerLink.rel = "noopener noreferrer";
    viewerLink.textContent = "Viewer";

    // Caminho de volta para quem perdeu o link: a tela de admin pede usuario e
    // senha quando o token nao esta no endereco.
    const adminLink = document.createElement("a");
    adminLink.className = "btn btn--plain btn--small";
    adminLink.href = `/admin/${session.id}`;
    adminLink.target = "_blank";
    adminLink.rel = "noopener noreferrer";

    actions.append(viewerLink, adminLink);
    foot.append(note, actions);
    root.append(top, primary, others, foot);

    return {
      root,
      status,
      primaryLabel,
      time,
      progressFill,
      others,
      othersSignature: null,
      adminLink,
      note,
    };
  }

  function updateCard(card, session) {
    if (!card) return;

    const { timers, primaryTimerId } = sanitizeSessionState(session);
    const primary = timers.find((timer) => timer.id === primaryTimerId) ?? null;

    card.status.dataset.state = session.status;
    card.status.textContent = statusLabel(session.status);
    // Só uma sessão com contagem em andamento acende a barra por inteiro.
    card.root.dataset.active = String(session.status === "running");

    card.primaryLabel.textContent = primary
      ? getTimerLabel(primary)
      : "Sem cronômetros";
    card.time.textContent = primary ? formatTime(getDisplayMs(primary)) : "--:--:--";
    card.time.dataset.status = primary ? primary.status : "stopped";
    card.time.dataset.phase = primary ? phaseOf(primary) : "green";

    const fill = primary
      ? primary.direction === "up"
        ? 1 - primary.pct
        : primary.pct
      : 0;
    card.progressFill.style.width = `${Math.round(fill * 1000) / 10}%`;
    card.progressFill.dataset.phase = primary ? phaseOf(primary) : "green";

    renderOthers(card, timers.filter((timer) => timer !== primary));

    card.adminLink.textContent = session.hasAuth ? "Admin 🔒" : "Admin";
    card.adminLink.title = session.hasAuth
      ? "Entrar com usuário e senha"
      : "Esta sessão não tem usuário e senha definidos";

    card.note.textContent = `Atualizado ${formatRelative(session.lastAccessAt)}`;
  }

  function renderOthers(card, timers) {
    const signature = timers.map((timer) => timer.id).join(",");

    if (signature !== card.othersSignature) {
      card.others.replaceChildren();

      for (const timer of timers) {
        const row = document.createElement("div");
        row.className = "session-row";

        const label = document.createElement("span");
        label.className = "session-row-label";

        const value = document.createElement("span");
        value.className = "session-row-value";

        row.append(label, value);
        card.others.appendChild(row);
      }

      card.othersSignature = signature;
    }

    card.others.hidden = timers.length === 0;

    timers.forEach((timer, index) => {
      const row = card.others.children[index];
      if (!row) return;
      row.dataset.status = timer.status;
      row.firstChild.textContent = getTimerLabel(timer);
      row.lastChild.textContent = formatTime(getDisplayMs(timer));
    });
  }

  // --------------------------------------------------------------- apoio

  function statusLabel(status) {
    return (
      {
        running: "Rodando",
        paused: "Pausado",
        finished: "Finalizado",
      }[status] || "Parado"
    );
  }

  /** Mesmas faixas do resto do produto, sem repetir a tabela de cores. */
  function phaseOf(timer) {
    if (timer.status === "finished" || timer.remaining <= 0) return "red";
    if (timer.status === "stopped") return "green";
    return getPhase(timer.pct);
  }

  function formatRelative(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value)) return "há pouco";

    const diffSeconds = Math.max(0, Math.round((Date.now() - value) / 1000));
    if (diffSeconds < 5) return "agora";
    if (diffSeconds < 60) return `há ${diffSeconds}s`;

    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return `há ${diffMinutes}min`;

    return `há ${Math.round(diffMinutes / 60)}h`;
  }
})();
