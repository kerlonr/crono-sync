(() => {
  const overviewGrid = document.getElementById("overview-grid");
  const overviewEmpty = document.getElementById("overview-empty");
  const statOnline = document.getElementById("stat-online");
  const statRunning = document.getElementById("stat-running");
  const POLL_INTERVAL_MS = 3000;
  let pollTimer = 0;
  let requestInFlight = false;

  if (!overviewGrid || !overviewEmpty || !statOnline || !statRunning) {
    return;
  }

  startPolling();
  window.addEventListener("beforeunload", () => {
    stopPolling();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      return;
    }

    startPolling(true);
  });

  async function loadSessions() {
    if (requestInFlight) {
      return;
    }

    requestInFlight = true;

    try {
      const response = await fetch("/api/sessions/active", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Falha ao carregar os cronômetros.");
      }

      const data = await response.json();
      const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
      renderOverview(sessions);
    } catch (error) {
      console.error(error);
      renderOverview([]);
    } finally {
      requestInFlight = false;
    }
  }

  function startPolling(runImmediately = true) {
    stopPolling();

    if (runImmediately) {
      loadSessions();
    }

    pollTimer = window.setInterval(loadSessions, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (!pollTimer) {
      return;
    }

    window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  function renderOverview(sessions) {
    overviewGrid.replaceChildren();

    statOnline.textContent = String(sessions.length);
    statRunning.textContent = String(
      sessions.filter((session) => session?.status === "running").length
    );

    if (!sessions.length) {
      overviewEmpty.classList.add("visible");
      return;
    }

    overviewEmpty.classList.remove("visible");

    sessions.forEach((session) => {
      overviewGrid.appendChild(createTimerCard(session));
    });
  }

  function createTimerCard(session) {
    const safeRemaining = sanitizeMs(session.remaining);
    const safePct = sanitizePct(session.pct);
    const state = mapStatus(session.status, safeRemaining, safePct);

    const root = document.createElement("article");
    root.className = "timer-card";
    if (state.cardClass) {
      root.classList.add(state.cardClass);
    }

    const top = document.createElement("div");
    top.className = "card-top";

    const identity = document.createElement("div");

    const id = document.createElement("div");
    id.className = "card-id";
    id.textContent = `Sessão ${session.id}`;

    const created = document.createElement("div");
    created.className = "card-created";
    created.textContent = `Criado em ${formatDate(session.createdAt)}`;

    identity.append(id, created);

    const status = document.createElement("div");
    status.className = "card-status";
    status.dataset.state = state.className;
    status.textContent = state.label;

    const timer = document.createElement("div");
    timer.className = "card-timer";
    timer.textContent = formatTime(safeRemaining);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = state.copy;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const link = document.createElement("a");
    link.className = "card-link";
    link.href = `/view/${session.id}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Abrir viewer";

    const note = document.createElement("div");
    note.className = "card-note";
    note.textContent = `Atualizado ${formatRelative(session.lastAccessAt)}`;

    actions.append(link, note);
    top.append(identity, status);
    root.append(top, timer, meta, actions);

    return root;
  }

  function mapStatus(status, remaining, pct) {
    if (remaining <= 0 || status === "finished") {
      return {
        label: "Finalizado",
        className: "finished",
        cardClass: "is-finished",
        copy: "O cronômetro chegou ao fim.",
      };
    }

    if (status === "running") {
      if (pct <= 0.1) {
        return {
          label: "Urgente",
          className: "running",
          cardClass: "is-danger",
          copy: "Últimos segundos em contagem ativa.",
        };
      }

      if (pct <= 0.2) {
        return {
          label: "Atenção",
          className: "running",
          cardClass: "is-danger",
          copy: "Fase final do cronômetro.",
        };
      }

      if (pct <= 0.4) {
        return {
          label: "Em andamento",
          className: "running",
          cardClass: "is-warning",
          copy: "Contagem rodando com menos da metade restante.",
        };
      }

      return {
        label: "Rodando",
        className: "running",
        cardClass: "is-running",
        copy: "Cronômetro ativo em tempo real.",
      };
    }

    if (status === "paused") {
      return {
        label: "Pausado",
        className: "paused",
        cardClass: pct <= 0.2 ? "is-warning" : "",
        copy: "A sessão está pausada no momento.",
      };
    }

    return {
      label: "Parado",
      className: "stopped",
      cardClass: "",
      copy: "Pronto para ser iniciado pelo admin.",
    };
  }

  function formatTime(ms) {
    const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }

  function formatDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) {
      return "agora";
    }

    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  function formatRelative(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value)) {
      return "há pouco";
    }

    const diffSeconds = Math.max(0, Math.round((Date.now() - value) / 1000));

    if (diffSeconds < 5) return "agora";
    if (diffSeconds < 60) return `há ${diffSeconds}s`;

    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return `há ${diffMinutes}min`;

    const diffHours = Math.round(diffMinutes / 60);
    return `há ${diffHours}h`;
  }

  function sanitizeMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed));
  }

  function sanitizePct(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(1, Math.max(0, parsed));
  }
})();
