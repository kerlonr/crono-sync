/**
 * Viewer publico: um cronometro em destaque ocupando a tela e os demais em
 * cards menores no rodape.
 *
 * Como no admin, os cards secundarios so sao recriados quando a lista muda; os
 * ticks apenas atualizam texto, cor e largura da barra.
 */
(() => {
  const {
    advanceTimer,
    formatTime,
    getDisplayMs,
    getPhase,
    getTimerLabel,
    getTimerMetaLabel,
    isValidSessionId,
    sanitizeSessionState,
  } = window.CronoUtils;

  const socket = io();
  const sessionId = window.location.pathname.split("/").pop();

  const elements = {
    message: document.getElementById("viewer-message"),
    primary: document.getElementById("viewer-primary"),
    primaryLabel: document.getElementById("viewer-primary-label"),
    primaryMeta: document.getElementById("viewer-primary-meta"),
    primaryProgress: document.getElementById("viewer-primary-progress"),
    primaryTime: document.getElementById("viewer-primary-time"),
    secondaries: document.getElementById("viewer-secondaries"),
    state: document.getElementById("viewer-state"),
    cardTemplate: document.getElementById("viewer-card-template"),
  };

  const cards = new Map();
  const finishWatchers = new Map();
  const linkStatus = document.getElementById("link-status");

  let secondarySignature = null;

  if (!elements.primary || !elements.cardTemplate) {
    return;
  }

  if (!isValidSessionId(sessionId)) {
    showError("Sessão não encontrada.");
    return;
  }

  let tentativasDeEntrada = 0;
  let estadoBase = null;
  let recebidoEm = 0;
  const ATRASO_SUSPEITO_MS = 4000;

  // O viewer costuma ficar horas projetado, sem ninguem tocando. Quando o
  // socket cai por ociosidade, o Socket.IO reconecta com um socket novo, que
  // nao esta em sala nenhuma - sem reentrar aqui, a tela congela no ultimo
  // valor recebido, parecendo travada.
  socket.on("connect", entrarNaSessao);
  socket.on("disconnect", () => setConexao("Reconectando..."));
  socket.on("connect_error", () => setConexao("Sem conexão. Tentando..."));

  if (socket.connected) entrarNaSessao();

  function entrarNaSessao() {
    socket.emit("session:join", sessionId, "viewer", (response) => {
      if (response?.success) {
        tentativasDeEntrada = 0;
        return setConexao("");
      }

      if (tentativasDeEntrada < 6) {
        tentativasDeEntrada += 1;
        setConexao(`Reconectando... (${tentativasDeEntrada}/6)`);
        return window.setTimeout(entrarNaSessao, 2000);
      }

      showError("Sessão não encontrada.");
    });
  }

  function setConexao(mensagem) {
    if (!linkStatus) return;
    linkStatus.textContent = mensagem;
    linkStatus.hidden = !mensagem;
  }

  socket.on("session:closed", () => {
    showError("Sessão encerrada.");
  });

  socket.on("session:state", (raw) => {
    estadoBase = sanitizeSessionState(raw);
    recebidoEm = performance.now();
    desenhar();
  });

  // Redesenha entre as mensagens do servidor, avancando localmente o que esta
  // em execucao. Sem isso a tela congelava sempre que o socket ficava mudo.
  window.setInterval(desenhar, 250);

  function desenhar() {
    if (!estadoBase) return;

    const atraso = performance.now() - recebidoEm;
    const timers = estadoBase.timers.map((timer) => advanceTimer(timer, atraso));
    const primary =
      timers.find((timer) => timer.id === estadoBase.primaryTimerId) ?? null;

    syncFinishWatchers(timers);
    renderPrimary(primary);
    renderSecondaries(timers.filter((timer) => timer !== primary));

    // Avisa que os dados estao velhos, mas segue contando: o cronometro de
    // parede nao para so porque a conexao parou.
    if (atraso > ATRASO_SUSPEITO_MS && socket.connected) {
      setConexao("Sem resposta do servidor...");
    }
  }

  function renderPrimary(timer) {
    const hasPrimary = Boolean(timer);

    elements.primary.hidden = !hasPrimary;
    if (elements.message) {
      elements.message.hidden = hasPrimary;
    }

    if (!hasPrimary) return;

    elements.primaryLabel.textContent = getTimerLabel(timer);
    setEstado(timer);
    elements.primaryMeta.textContent = getTimerMetaLabel(timer);
    elements.primaryTime.textContent = formatTime(getDisplayMs(timer));
    applyTimerLook(elements.primaryTime, timer);
    setProgress(elements.primaryProgress, timer, getPhase(timer.pct));
  }

  /**
   * Estado escrito por extenso. Antes o unico sinal de pausado era a opacidade
   * mais baixa - quem abrisse a tela ja pausada nao tinha como saber, porque
   * nao viu a mudanca acontecer.
   */
  function setEstado(timer) {
    if (!elements.state) return;

    const rotulo = {
      paused: "Pausado",
      stopped: "Parado",
      finished: "Encerrado",
    }[timer.status];

    elements.state.textContent = rotulo || "";
    elements.state.dataset.state = timer.status;
    elements.state.hidden = !rotulo;
  }

  function renderSecondaries(timers) {
    const signature = timers.map((timer) => timer.id).join(",");

    if (signature !== secondarySignature) {
      rebuildSecondaries(timers);
      secondarySignature = signature;
    }

    elements.secondaries.hidden = timers.length === 0;
    elements.secondaries.dataset.count = String(timers.length);

    for (const timer of timers) {
      const card = cards.get(timer.id);
      if (card) {
        updateSecondary(card, timer);
      }
    }
  }

  function rebuildSecondaries(timers) {
    const present = new Set(timers.map((timer) => timer.id));

    for (const [timerId, card] of cards) {
      if (present.has(timerId)) continue;
      card.root.remove();
      cards.delete(timerId);
    }

    for (const timer of timers) {
      let card = cards.get(timer.id);
      if (!card) {
        card = createSecondary();
        cards.set(timer.id, card);
      }

      elements.secondaries.appendChild(card.root);
    }
  }

  function createSecondary() {
    const root = elements.cardTemplate.content.firstElementChild.cloneNode(true);

    return {
      root,
      label: root.querySelector(".viewer-card-label"),
      time: root.querySelector(".viewer-card-time"),
      progress: root.querySelector(".progress-fill"),
    };
  }

  function updateSecondary(card, timer) {
    card.root.dataset.status = timer.status;
    card.label.textContent = getTimerLabel(timer);
    card.time.textContent = formatTime(getDisplayMs(timer));
    applyTimerLook(card.time, timer);
    setProgress(card.progress, timer, getPhase(timer.pct));
  }

  /**
   * Fase e estado viram atributos, e o CSS decide a cor. Antes a classe era
   * remontada a cada tick (`viewer-card-time red paused`), o que apagava
   * qualquer outra classe do elemento e espalhava a regra de cor pelo JS.
   *
   * Parado fica neutro; pausado mantem a cor da fase, esmaecida; terminado e
   * sempre vermelho.
   */
  function applyTimerLook(element, timer) {
    const encerrado = timer.status === "finished" || timer.remaining <= 0;

    element.dataset.status = timer.status;
    element.dataset.phase = encerrado
      ? "red"
      : timer.status === "stopped"
        ? "green"
        : getPhase(timer.pct);
  }

  function setProgress(element, timer, phase) {
    if (!element) return;

    const fillPct = timer.direction === "up" ? 1 - timer.pct : timer.pct;
    element.style.width = `${Math.round(fillPct * 1000) / 10}%`;
    element.dataset.phase = phase;
  }

  function syncFinishWatchers(timers) {
    const present = new Set(timers.map((timer) => timer.id));

    for (const timerId of finishWatchers.keys()) {
      if (!present.has(timerId)) {
        finishWatchers.delete(timerId);
      }
    }

    for (const timer of timers) {
      let watcher = finishWatchers.get(timer.id);
      if (!watcher) {
        watcher = window.CronoFinishSound?.createWatcher();
        if (!watcher) return;
        finishWatchers.set(timer.id, watcher);
      }

      watcher.sync(timer.status, timer.remaining);
    }
  }

  function showError(message) {
    socket.disconnect();
    document.body.replaceChildren(createMessage(message));
  }

  function createMessage(message) {
    const element = document.createElement("div");
    element.className = "screen-message";
    element.textContent = message;
    return element;
  }
})();
