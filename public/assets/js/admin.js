/**
 * Painel de administracao.
 *
 * O cronometro em destaque ocupa o centro da tela e os demais aparecem em
 * cartoes abaixo. Toda a configuracao vive em dois modais: ajustes do
 * cronometro selecionado e configuracoes da sessao.
 *
 * Os ajustes eram um painel unico que o JS movia para dentro do bloco aberto,
 * o que reordenava a grade a cada abertura e obrigava a reposicionar o painel
 * a cada estado recebido. Agora e um modal fixo: muda o conteudo, nao o lugar.
 *
 * O DOM dos secundarios so e reconstruido quando a lista muda; nos ticks de
 * 250ms apenas textos, atributos e larguras sao atualizados. O formulario do
 * modal so e preenchido ao abrir ou ao trocar de selecao - se fosse a cada
 * tick, apagaria o que estivesse sendo digitado.
 */
(() => {
  const {
    MAX_TIMERS_PER_SESSION,
    MAX_TIMER_MS,
    advanceTimer,
    formatCompactDuration,
    formatTime,
    getAccrualLabel,
    getBonusLabel,
    getDisplayMs,
    getLedgerLabel,
    getPhase,
    getTimerLabel,
    getTimerMetaLabel,
    isValidAdminToken,
    isValidSessionId,
    sanitizeSessionState,
    sanitizeTimerName,
    splitDuration,
  } = window.CronoUtils;

  const MODELS_KEY = "crono_sw_models";
  const MAX_MODELS = 20;
  const MAX_TIMER_HOURS = Math.floor(MAX_TIMER_MS / 3600000);
  const MIN_ACCRUAL_EVERY_MS = 60 * 1000;
  const RESET_CONFIRM_MS = 60 * 1000;
  const FEEDBACK_MS = 2600;
  const ATRASO_SUSPEITO_MS = 4000;

  const socket = io();
  const sessionId = window.location.pathname.split("/").pop();
  let adminToken = window.location.hash.slice(1);
  const legacyPresetsKey = `crono_sw_presets_${sessionId}`;

  const el = (id) => document.getElementById(id);

  const ui = {
    panel: el("admin-panel"),
    // destaque
    primaryBlock: el("primary-block"),
    primaryName: el("primary-name"),
    primaryTime: el("primary-time"),
    primaryMeta: el("primary-meta"),
    primaryProgress: el("primary-progress"),
    primaryDot: el("primary-dot"),
    primaryStatus: el("primary-status"),
    primaryStatusText: el("primary-status-text"),
    primaryStart: el("primary-start"),
    primaryPause: el("primary-pause"),
    primaryReset: el("primary-reset"),
    // secundarios
    strip: el("timer-strip"),
    miniTemplate: el("timer-mini-template"),
    boardEmpty: el("board-empty"),
    boardFeedback: el("board-feedback"),
    // barra superior
    modelsChips: el("models-chips"),
    addTimer: el("btn-add-timer"),
    fullscreen: el("btn-fs"),
    openModal: el("btn-open-modal"),
    // modal de configuracoes da sessao
    overlay: el("modal-overlay"),
    closeModal: el("btn-close-modal"),
    modelsManage: el("models-manage"),
    authUser: el("auth-user"),
    authPass: el("auth-pass"),
    saveAuth: el("btn-save-auth"),
    clearAuth: el("btn-clear-auth"),
    authFeedback: el("auth-feedback"),
    endSession: el("btn-end-session"),
    // modal de ajustes do cronometro
    config: el("timer-config"),
    configTitle: el("timer-config-title"),
    closeConfig: el("btn-close-config"),
    cfgName: el("cfg-name"),
    cfgDirectionHint: el("cfg-direction-hint"),
    cfgH: el("cfg-h"),
    cfgM: el("cfg-m"),
    cfgS: el("cfg-s"),
    cfgTimeLabel: el("cfg-time-label"),
    cfgTimeHint: el("cfg-time-hint"),
    applyTime: el("btn-apply-time"),
    applyStart: el("btn-apply-start"),
    saveModel: el("btn-save-model"),
    cfgOffsetLabel: el("cfg-offset-label"),
    cfgOffH: el("cfg-off-h"),
    cfgOffM: el("cfg-off-m"),
    cfgOffS: el("cfg-off-s"),
    cfgOffsetHint: el("cfg-offset-hint"),
    cfgLedger: el("cfg-ledger"),
    spendRow: el("cfg-spend-row"),
    applyOffset: el("btn-apply-offset"),
    offsetStart: el("btn-offset-start"),
    clearOffset: el("btn-clear-offset"),
    clockRow: el("clock-row"),
    clockLabel: el("clock-label"),
    clockHint: el("clock-hint"),
    cfgClock: el("cfg-clock"),
    fromClock: el("btn-from-clock"),
    clockNow: el("btn-clock-now"),
    clockSync: el("btn-clock-sync"),
    accrualEnabled: el("accrual-enabled"),
    accrualSentence: el("accrual-sentence"),
    accrualEveryH: el("accrual-every-h"),
    accrualEveryM: el("accrual-every-m"),
    accrualSource: el("accrual-source"),
    accrualAddM: el("accrual-add-m"),
    accrualStatus: el("accrual-status"),
    setPrimary: el("btn-set-primary"),
    moveUp: el("btn-move-up"),
    moveDown: el("btn-move-down"),
    removeTimer: el("btn-remove-timer"),
    // apoio
    linkStatus: el("link-status"),
    loginShell: el("login-shell"),
    loginForm: el("login-form"),
    loginUser: el("login-user"),
    loginPass: el("login-pass"),
    loginFeedback: el("login-feedback"),
    loginButton: el("btn-login"),
    viewerLinks: document.querySelectorAll(".viewer-direct-link"),
  };

  const minis = new Map();
  const finishWatchers = new Map();

  let state = { timers: [], primaryTimerId: null };
  let stripSignature = null;
  let openTimerId = null;
  let selectedTimerId = null;
  let feedbackTimer = 0;
  let entrou = false;
  let tentativasDeEntrada = 0;
  let estadoBase = null;
  let recebidoEm = 0;

  if (!ui.panel || !ui.strip || !ui.miniTemplate || !isValidSessionId(sessionId)) {
    return showError("Sessão não encontrada.");
  }

  bindLogin();

  if (!isValidAdminToken(adminToken)) {
    return showLogin();
  }

  bindEvents();
  connect();

  // ----------------------------------------------------------------- login

  /**
   * O token continua sendo a credencial de fato; usuario e senha servem para
   * recupera-lo quando o link se perde.
   */
  function bindLogin() {
    ui.loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const username = ui.loginUser.value.trim();
      const password = ui.loginPass.value;
      if (!username || !password) {
        return setLoginFeedback("Informe usuário e senha.", "error");
      }

      const botao = ui.loginButton;
      if (botao) botao.disabled = true;
      setLoginFeedback("Entrando…");

      try {
        const response = await fetch(`/api/session/${sessionId}/login`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username, password }),
        });

        if (response.status === 429) {
          return setLoginFeedback(
            "Muitas tentativas. Espere alguns minutos e tente de novo.",
            "error",
          );
        }
        if (!response.ok) {
          return setLoginFeedback("Usuário ou senha inválidos.", "error");
        }

        const data = await response.json();
        if (!isValidAdminToken(data?.adminToken)) {
          return setLoginFeedback("Resposta inválida do servidor.", "error");
        }

        // Guarda o token no hash para recarregar sem pedir login de novo.
        adminToken = data.adminToken;
        window.location.hash = adminToken;
        ui.loginShell.hidden = true;
        ui.loginPass.value = "";
        setLoginFeedback("");

        bindEvents();
        connect();
      } catch {
        setLoginFeedback("Não foi possível falar com o servidor.", "error");
      } finally {
        if (botao) botao.disabled = false;
      }
    });
  }

  function showLogin() {
    if (!ui.loginShell) {
      return showError("Acesso de admin inválido ou expirado.");
    }

    ui.loginShell.hidden = false;
    ui.loginUser?.focus();
  }

  function setLoginFeedback(message, kind) {
    if (!ui.loginFeedback) return;
    ui.loginFeedback.textContent = message;
    ui.loginFeedback.dataset.state = kind || "";
  }

  // --------------------------------------------------------------- conexao

  /**
   * Ao reconectar, o Socket.IO cria um socket NOVO no servidor - sem sala e
   * sem papel de admin. Sem reentrar na sessao a tela congela e os controles
   * param de responder em silencio, que era o sintoma de "a sessao caiu"
   * depois de um tempo com a aba fora de foco. Entrar no evento `connect`
   * cobre a primeira conexao e todas as reconexoes.
   */
  function connect() {
    socket.on("connect", entrarNaSessao);
    socket.on("disconnect", () => setConexao("Reconectando…"));

    if (socket.connected) entrarNaSessao();
  }

  function entrarNaSessao() {
    socket.emit("session:join", sessionId, "admin", adminToken, (response) => {
      if (response?.success) {
        tentativasDeEntrada = 0;
        setConexao("");

        if (entrou) return;
        entrou = true;

        ui.panel.hidden = false;
        for (const link of ui.viewerLinks) link.href = `/view/${sessionId}`;
        renderModels();
        syncFullscreen();
        return;
      }

      if (response?.reason === "unauthorized") {
        return showError("Acesso de admin inválido ou expirado.");
      }

      // "nao encontrada" logo apos um reinicio do servidor costuma ser corrida
      // com a restauracao do snapshot. Vale tentar de novo antes de derrubar a
      // tela do usuario, que so teria a opcao de recarregar na mao.
      if (tentativasDeEntrada < 6) {
        tentativasDeEntrada += 1;
        setConexao(`Reconectando… (${tentativasDeEntrada}/6)`);
        window.setTimeout(entrarNaSessao, 2000);
        return;
      }

      showError("Sessão não encontrada.");
    });
  }

  function setConexao(mensagem) {
    if (!ui.linkStatus) return;
    ui.linkStatus.textContent = mensagem;
    ui.linkStatus.hidden = !mensagem;
  }

  // --------------------------------------------------------------- eventos

  function bindEvents() {
    socket.on("session:state", applyState);
    // Falha de conexao nao e fatal: o Socket.IO segue tentando sozinho, e
    // derrubar a tela aqui apagaria um painel que volta a funcionar em
    // segundos.
    socket.on("connect_error", () => setConexao("Sem conexão. Tentando…"));
    socket.on("session:closed", () => showError("Sessão encerrada."));

    for (const root of [ui.primaryBlock, ui.strip]) {
      root.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button || button.disabled || !root.contains(button)) return;
        runAction(
          button.dataset.action,
          button.closest("[data-timer-id]")?.dataset.timerId,
        );
      });
    }

    ui.addTimer?.addEventListener("click", () => addTimer());
    ui.fullscreen?.addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", syncFullscreen);

    // Os dois modais fecham do mesmo jeito: botao, clique no fundo ou Esc.
    ui.openModal?.addEventListener("click", openModal);
    ui.closeModal?.addEventListener("click", closeModal);
    ui.closeConfig?.addEventListener("click", closeConfig);

    for (const [overlay, fechar] of [
      [ui.overlay, closeModal],
      [ui.config, closeConfig],
    ]) {
      overlay?.addEventListener("click", (event) => {
        if (event.target === overlay) fechar();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeModal();
      closeConfig();
    });

    // Titulo e modo valem na hora: sao so apresentacao, nao mexem na contagem.
    ui.cfgName?.addEventListener("change", () => {
      const name = sanitizeTimerName(ui.cfgName.value);
      ui.cfgName.value = name;
      emitUpdate({ name });
    });

    ui.config?.addEventListener("click", (event) => {
      const direcao = event.target.closest("[data-direction]");
      if (direcao) return emitUpdate({ direction: direcao.dataset.direction });

      // Ajuste rapido da duracao: mexer nos campos de hora um a um para somar
      // 5 minutos e o tipo de atrito que faz a tela parecer ruim de usar. O
      // passo so edita o campo - quem aplica e o botao do cartao.
      const passo = event.target.closest("[data-step]");
      if (passo) {
        return fillTimeInputs(
          Math.max(0, readTimeMs() + Number(passo.dataset.step)),
        );
      }

      // Registro rapido: soma ao que o servidor ja tem e aplica num clique.
      const consumo = event.target.closest("[data-spend-step]");
      if (consumo) registrarConsumo(Number(consumo.dataset.spendStep));
    });

    ui.applyTime?.addEventListener("click", () => applyTime(false));
    ui.applyStart?.addEventListener("click", () => applyTime(true));
    ui.applyOffset?.addEventListener("click", () =>
      applyOffset(readOffsetMs(), false),
    );
    ui.offsetStart?.addEventListener("click", () =>
      applyOffset(readOffsetMs(), true),
    );
    ui.clearOffset?.addEventListener("click", () => applyOffset(0, false));
    ui.fromClock?.addEventListener("click", () => sincronizarPeloRelogio(false));
    ui.clockSync?.addEventListener("click", () => sincronizarPeloRelogio(true));
    ui.clockNow?.addEventListener("click", preencherAgora);
    ui.saveModel?.addEventListener("click", saveModelFromSelected);

    ui.setPrimary?.addEventListener("click", () => {
      if (selectedTimerId) socket.emit("timer:setPrimary", selectedTimerId);
    });
    ui.moveUp?.addEventListener("click", () => moveSelected(-1));
    ui.moveDown?.addEventListener("click", () => moveSelected(1));
    ui.removeTimer?.addEventListener("click", removeSelected);

    ui.accrualEnabled?.addEventListener("change", applyAccrual);
    for (const field of [
      ui.accrualEveryH,
      ui.accrualEveryM,
      ui.accrualSource,
      ui.accrualAddM,
    ]) {
      field?.addEventListener("change", applyAccrual);
    }

    ui.saveAuth?.addEventListener("click", () => {
      const username = ui.authUser.value.trim();
      const password = ui.authPass.value;

      if (!username || !password) {
        return setAuthFeedback("Informe usuário e senha.", "error");
      }

      socket.emit("session:setAuth", { username, password }, (resposta) => {
        ui.authPass.value = "";
        setAuthFeedback(
          resposta?.success
            ? `Acesso salvo. Entre com "${username}" se perder o link.`
            : "Não foi possível salvar o acesso.",
          resposta?.success ? "success" : "error",
        );
      });
    });

    ui.clearAuth?.addEventListener("click", () => {
      if (!window.confirm("Remover usuário e senha desta sessão?")) return;

      socket.emit("session:setAuth", {}, (resposta) => {
        ui.authUser.value = "";
        ui.authPass.value = "";
        setAuthFeedback(
          resposta?.success
            ? "Acesso removido. Só o link controla esta sessão agora."
            : "Não foi possível remover o acesso.",
          resposta?.success ? "success" : "error",
        );
      });
    });

    // Encerrar a sessao vive aqui, e nao na visao geral: o socket ja provou
    // ter o token de admin, entao o servidor nao precisa confiar em quem
    // apenas conhece o id da sessao.
    ui.endSession?.addEventListener("click", () => {
      if (
        !window.confirm(
          "Encerrar esta sessão? Os viewers são desconectados e os cronômetros apagados.",
        )
      ) {
        return;
      }
      socket.emit("session:close");
    });
  }

  // ------------------------------------------------------------- desenho

  function applyState(raw) {
    estadoBase = sanitizeSessionState(raw);
    recebidoEm = performance.now();
    desenhar();
  }

  /**
   * Entre as mensagens do servidor a tela segue contando sozinha. Uma conexao
   * meio-morta demora ate ~45s para o Socket.IO perceber, e nesse tempo o
   * painel ficava parado num valor velho.
   */
  function desenhar() {
    if (!estadoBase) return;

    const atraso = performance.now() - recebidoEm;
    state = {
      primaryTimerId: estadoBase.primaryTimerId,
      timers: estadoBase.timers.map((timer) => advanceTimer(timer, atraso)),
    };

    // Silencio so e suspeito quando o servidor deveria estar falando: o tick
    // existe enquanto ha cronometro rodando e e liberado quando o ultimo para.
    // Sem esta condicao, um painel parado - o estado normal de quem acabou de
    // abrir a tela - acusava o servidor de nao responder depois de 4 segundos,
    // com a conexao perfeitamente viva.
    const esperandoTick = estadoBase.timers.some(
      (timer) => timer.status === "running",
    );

    if (entrou && socket.connected) {
      if (esperandoTick && atraso > ATRASO_SUSPEITO_MS) {
        setConexao("Sem resposta do servidor…");
      } else if (atraso <= ATRASO_SUSPEITO_MS) {
        setConexao("");
      }
    }

    renderizar();
  }

  function renderizar() {
    if (!findTimer(selectedTimerId)) {
      selectedTimerId = state.primaryTimerId;
    }

    const primary = findTimer(state.primaryTimerId);
    renderPrimary(primary);
    renderStrip(state.timers.filter((timer) => timer !== primary));
    syncConfigModal();
    syncWatchers();

    ui.boardEmpty.hidden = state.timers.length > 0;
    ui.primaryBlock.hidden = !primary;
  }

  // Mesmo ritmo do servidor, para o painel nunca ficar parado.
  window.setInterval(desenhar, 250);

  function renderPrimary(timer) {
    if (!timer) return;

    ui.primaryBlock.dataset.timerId = timer.id;

    ui.primaryName.textContent = getTimerLabel(timer);
    ui.primaryTime.textContent = formatTime(getDisplayMs(timer));
    applyTimerLook(ui.primaryTime, timer);

    ui.primaryMeta.replaceChildren(
      document.createTextNode(getTimerMetaLabel(timer)),
    );
    const bonus = getBonusLabel(timer);
    if (bonus) {
      const tag = document.createElement("span");
      tag.className = "bonus-tag";
      tag.textContent = bonus;
      ui.primaryMeta.appendChild(tag);
    }

    setProgress(ui.primaryProgress, timer);
    ui.primaryDot.dataset.status = timer.status;
    ui.primaryStatus.dataset.state = timer.status;
    ui.primaryStatusText.textContent = statusLabel(timer.status);

    ui.primaryStart.disabled =
      timer.status === "running" || timer.status === "finished";
    ui.primaryPause.disabled = timer.status !== "running";
    ui.primaryReset.disabled = timer.status === "stopped" && timer.elapsed === 0;
  }

  function renderStrip(timers) {
    const signature = timers.map((timer) => timer.id).join(",");

    if (signature !== stripSignature) {
      const present = new Set(timers.map((timer) => timer.id));
      for (const [id, mini] of minis) {
        if (present.has(id)) continue;
        mini.root.remove();
        minis.delete(id);
      }
      for (const timer of timers) {
        let mini = minis.get(timer.id);
        if (!mini) {
          mini = createMini(timer.id);
          minis.set(timer.id, mini);
        }
        ui.strip.appendChild(mini.root);
      }
      stripSignature = signature;
    }

    for (const timer of timers) updateMini(minis.get(timer.id), timer);
  }

  function createMini(timerId) {
    const root = ui.miniTemplate.content.firstElementChild.cloneNode(true);
    root.dataset.timerId = timerId;

    return {
      root,
      dot: root.querySelector(".dot"),
      name: root.querySelector(".mini-name"),
      time: root.querySelector(".mini-time"),
      meta: root.querySelector(".mini-meta"),
      progress: root.querySelector(".progress-fill"),
      start: root.querySelector('[data-action="start"]'),
      pause: root.querySelector('[data-action="pause"]'),
      reset: root.querySelector('[data-action="reset"]'),
    };
  }

  function updateMini(mini, timer) {
    if (!mini) return;

    const bonus = getBonusLabel(timer);

    mini.dot.dataset.status = timer.status;
    mini.name.textContent = getTimerLabel(timer);
    mini.time.textContent = formatTime(getDisplayMs(timer));
    applyTimerLook(mini.time, timer);
    mini.meta.textContent = bonus
      ? `${formatCompactDuration(timer.baseTotalTime)} · ${bonus}`
      : formatCompactDuration(timer.totalTime);
    setProgress(mini.progress, timer);

    mini.start.disabled =
      timer.status === "running" || timer.status === "finished";
    mini.pause.disabled = timer.status !== "running";
    mini.reset.disabled = timer.status === "stopped" && timer.elapsed === 0;
  }

  /**
   * Fase e estado viram atributos, e o CSS decide a cor. Antes a classe era
   * remontada a cada tick, o que apagava qualquer outra classe do elemento e
   * espalhava a tabela de cores pelo JS.
   */
  function applyTimerLook(element, timer) {
    element.dataset.status = timer.status;
    element.dataset.phase =
      timer.status === "stopped" ? "green" : getPhase(timer.pct);
  }

  function setProgress(element, timer) {
    const fill = timer.direction === "up" ? 1 - timer.pct : timer.pct;
    element.style.width = `${Math.round(fill * 1000) / 10}%`;
    element.dataset.phase =
      timer.status === "stopped" ? "green" : getPhase(timer.pct);
  }

  // ------------------------------------------------------------------ acoes

  function runAction(action, timerId) {
    const timer = findTimer(timerId);
    if (!timer) return;

    if (action === "config") {
      return openConfig(timer.id);
    }

    if (action === "reset") {
      if (
        timer.elapsed >= RESET_CONFIRM_MS &&
        !window.confirm(
          `Zerar "${getTimerLabel(timer)}"? A contagem atual será perdida.`,
        )
      ) {
        return;
      }
      return socket.emit("timer:reset", timer.id);
    }

    socket.emit(`timer:${action}`, timer.id);
  }

  function addTimer(model) {
    socket.emit(
      "timer:add",
      model
        ? {
            name: model.name,
            direction: model.direction,
            totalTime: model.secs * 1000,
          }
        : {},
      (response) => {
        if (!response?.success) {
          return showFeedback(
            response?.reason === "limit_reached"
              ? `Limite de ${MAX_TIMERS_PER_SESSION} cronômetros por sessão.`
              : "Não foi possível adicionar o cronômetro.",
            "error",
          );
        }

        // Abre os ajustes do recem-criado, que e o proximo passo obvio.
        openConfig(response.timerId);
      },
    );
  }

  function moveSelected(offset) {
    if (selectedTimerId) socket.emit("timer:move", selectedTimerId, offset);
  }

  function removeSelected() {
    const timer = findTimer(selectedTimerId);
    if (!timer) return;
    if (!window.confirm(`Remover "${getTimerLabel(timer)}" da sessão?`)) return;
    socket.emit("timer:remove", timer.id);
    closeConfig();
  }

  function emitUpdate(payload) {
    if (selectedTimerId) socket.emit("timer:update", selectedTimerId, payload);
  }

  function startSelected() {
    if (selectedTimerId) socket.emit("timer:start", selectedTimerId);
  }

  // ------------------------------------------------------ leitura dos campos

  function readTimeMs() {
    return (
      (readNumber(ui.cfgH, 0, MAX_TIMER_HOURS) * 3600 +
        readNumber(ui.cfgM, 0, 59) * 60 +
        readNumber(ui.cfgS, 0, 59)) *
      1000
    );
  }

  function readOffsetMs() {
    return (
      (readNumber(ui.cfgOffH, 0, MAX_TIMER_HOURS) * 3600 +
        readNumber(ui.cfgOffM, 0, 59) * 60 +
        readNumber(ui.cfgOffS, 0, 59)) *
      1000
    );
  }

  function fillTimeInputs(ms) {
    const { hours, minutes, seconds } = splitDuration(ms);
    ui.cfgH.value = String(hours);
    ui.cfgM.value = String(minutes);
    ui.cfgS.value = String(seconds);
  }

  function fillOffsetInputs(ms) {
    const { hours, minutes, seconds } = splitDuration(ms);
    ui.cfgOffH.value = String(hours);
    ui.cfgOffM.value = String(minutes);
    ui.cfgOffS.value = String(seconds);
  }

  /**
   * @param {boolean} iniciar tambem da Start, poupando o passo extra que era
   * a reclamacao principal: definir o tempo e sair procurando o botao.
   */
  function applyTime(iniciar) {
    const ms = readTimeMs();

    if (ms < 1000 || ms > MAX_TIMER_MS) {
      return showFeedback(
        `Informe um tempo entre 1 segundo e ${MAX_TIMER_HOURS} horas.`,
        "error",
      );
    }

    emitUpdate({ totalTime: ms });
    if (iniciar) startSelected();
    showFeedback(
      iniciar ? "Tempo aplicado e cronômetro iniciado." : "Tempo aplicado.",
      "success",
    );
  }

  /**
   * Registra quanto ja foi consumido/decorrido fora do cronometro.
   *
   * Nao recusa valores acima do total: um intervalo que ganha tempo por regra
   * pode ter sido usado alem do que ja foi concedido, e era exatamente esse
   * caso que ficava sem saida. O excesso vira divida, abatida sozinha conforme
   * a regra concede mais tempo.
   */
  function applyOffset(ms, iniciar) {
    const timer = findTimer(selectedTimerId);
    if (!timer) return;

    if (ms > MAX_TIMER_MS) {
      return showFeedback(
        `O valor precisa ser menor que ${MAX_TIMER_HOURS} horas.`,
        "error",
      );
    }

    emitUpdate({ offsetMs: ms });
    if (iniciar) startSelected();

    if (ms === 0) {
      return showFeedback("Voltou para zero.", "success");
    }

    const rotulo = timer.direction === "up" ? "Decorrido" : "Consumido";
    const excedente = ms - timer.totalTime;
    const sufixo =
      excedente > 0
        ? ` — ${formatTime(excedente)} além do disponível, abatidos do próximo ganho.`
        : iniciar
          ? " e iniciado."
          : ".";

    showFeedback(`${rotulo} definido em ${formatTime(ms)}${sufixo}`, "success");
  }

  /**
   * Soma ao consumo JA REGISTRADO no servidor e aplica na hora.
   *
   * Editar o valor absoluto exige lembrar do total anterior e somar de cabeca;
   * o gesto real e "acabei de gastar mais 10 minutos".
   */
  function registrarConsumo(delta) {
    const timer = findTimer(selectedTimerId);
    if (!timer) return;

    if (timer.status === "running") {
      return showFeedback("Pause o cronômetro para registrar consumo.", "error");
    }

    const alvo = Math.max(0, timer.offsetMs + delta);
    fillOffsetInputs(alvo);
    applyOffset(alvo, false);
  }

  const doisDigitos = (valor) => String(valor).padStart(2, "0");

  /** Monta o valor de um `datetime-local` a partir de uma data local. */
  function paraCampoDeData(data) {
    return (
      `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}` +
      `-${doisDigitos(data.getDate())}T${doisDigitos(data.getHours())}` +
      `:${doisDigitos(data.getMinutes())}:${doisDigitos(data.getSeconds())}`
    );
  }

  function preencherAgora() {
    if (ui.cfgClock) ui.cfgClock.value = paraCampoDeData(new Date());
  }

  /**
   * Calcula sozinho quanto ja correu desde o instante informado.
   *
   * O campo carrega data alem de hora porque uma contagem de 80 horas
   * atravessa dias: so "08:00" nao diz se foi hoje, ontem ou anteontem.
   *
   * @param {boolean} iniciar aplica e ja da Start, sem passo intermediario.
   */
  function sincronizarPeloRelogio(iniciar) {
    const valor = ui.cfgClock?.value;
    if (!valor) {
      return showFeedback("Informe a data e a hora em que começou.", "error");
    }

    const inicio = new Date(valor);
    if (Number.isNaN(inicio.getTime())) {
      return showFeedback("Data e hora inválidas.", "error");
    }

    const decorrido = Date.now() - inicio.getTime();
    if (decorrido < 0) {
      return showFeedback("Esse instante ainda não chegou.", "error");
    }

    const timer = findTimer(selectedTimerId);
    if (!timer) return;

    // Valida contra a duracao que esta NO FORMULARIO, nao contra a do
    // servidor: quem digita 80h e a data de inicio espera que as duas coisas
    // valham juntas.
    const totalDoFormulario = readTimeMs();
    if (totalDoFormulario < 1000 || totalDoFormulario > MAX_TIMER_MS) {
      return showFeedback(
        `Informe uma duração entre 1 segundo e ${MAX_TIMER_HOURS} horas.`,
        "error",
      );
    }

    // Mede contra o total EFETIVO (duracao do formulario + o que ja foi ganho
    // por regra), senao um cronometro com bonus era recusado por estourar uma
    // duracao que nao e mais a que vale.
    const totalEfetivo = totalDoFormulario + timer.bonusMs;
    if (decorrido > totalEfetivo) {
      return showFeedback(
        `Começou há ${formatTime(decorrido)}, mais que os ${formatTime(totalEfetivo)} disponíveis.`,
        "error",
      );
    }

    fillOffsetInputs(decorrido);
    ui.clockHint.textContent = `Corre há ${formatTime(decorrido)}.`;

    if (!iniciar) return;

    // Duracao e ponto de partida vao juntos numa unica atualizacao: o servidor
    // aplica o total primeiro e depois posiciona a contagem. So mandamos o
    // total quando ele realmente mudou, porque trocar o total zera o tempo
    // ganho por regra.
    const mudouDuracao = totalDoFormulario !== timer.baseTotalTime;
    emitUpdate(
      mudouDuracao
        ? { totalTime: totalDoFormulario, offsetMs: decorrido }
        : { offsetMs: decorrido },
    );
    startSelected();

    showFeedback(
      `Sincronizado: corre há ${formatTime(decorrido)} de ${formatTime(totalDoFormulario)}.`,
      "success",
    );
  }

  function applyAccrual() {
    if (!ui.accrualEnabled.checked) {
      ui.accrualSentence.dataset.enabled = "false";
      return emitUpdate({ accrual: null });
    }

    ui.accrualSentence.dataset.enabled = "true";

    const everyMs =
      (readNumber(ui.accrualEveryH, 0, 99) * 3600 +
        readNumber(ui.accrualEveryM, 0, 59) * 60) *
      1000;
    const addMs = readNumber(ui.accrualAddM, 0, 599) * 60 * 1000;
    const sourceTimerId = ui.accrualSource.value;

    if (everyMs < MIN_ACCRUAL_EVERY_MS) {
      return showFeedback(
        "O intervalo da regra precisa ser de ao menos 1 minuto.",
        "error",
      );
    }
    if (addMs < 1000) {
      return showFeedback("Informe quantos minutos somar.", "error");
    }
    if (!sourceTimerId) {
      return showFeedback("Escolha o cronômetro que dispara a regra.", "error");
    }

    emitUpdate({ accrual: { sourceTimerId, everyMs, addMs } });
  }

  // ------------------------------------------------------ modal de ajustes

  function openConfig(timerId) {
    const timer = findTimer(timerId);
    if (!timer) return;

    openTimerId = timerId;
    selectedTimerId = timerId;

    fillConfigForm(timer);
    syncConfigLive(timer);
    ui.configTitle.textContent = `Ajustes · ${getTimerLabel(timer)}`;
    ui.config.classList.add("open");
  }

  function closeConfig() {
    openTimerId = null;
    ui.config.classList.remove("open");
  }

  /** Mantem o modal aberto em dia a cada estado, sem reposicionar nada. */
  function syncConfigModal() {
    if (!openTimerId) return;

    const timer = findTimer(openTimerId);
    if (!timer) return closeConfig();

    ui.configTitle.textContent = `Ajustes · ${getTimerLabel(timer)}`;
    syncConfigLive(timer);
  }

  function fillConfigForm(timer) {
    ui.cfgName.value = timer.name;

    for (const button of ui.config.querySelectorAll("[data-direction]")) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.direction === timer.direction),
      );
    }

    fillTimeInputs(timer.baseTotalTime);
    fillOffsetInputs(timer.offsetMs);
    if (ui.clockHint) ui.clockHint.textContent = "";

    // Ja vem com o instante que a contagem atual implica: o campo serve de
    // conferencia, nao so de entrada.
    if (ui.cfgClock) {
      ui.cfgClock.value = paraCampoDeData(new Date(Date.now() - timer.elapsed));
    }

    fillAccrualForm(timer);
  }

  function fillAccrualForm(timer) {
    const others = state.timers.filter((item) => item.id !== timer.id);

    ui.accrualSource.replaceChildren();
    for (const other of others) {
      const option = document.createElement("option");
      option.value = other.id;
      option.textContent = getTimerLabel(other);
      ui.accrualSource.appendChild(option);
    }

    const rule = timer.accrual;
    ui.accrualEnabled.checked = Boolean(rule);
    ui.accrualEnabled.disabled = others.length === 0;
    ui.accrualSentence.dataset.enabled = String(Boolean(rule));

    if (rule) {
      const every = splitDuration(rule.everyMs);
      ui.accrualEveryH.value = String(every.hours);
      ui.accrualEveryM.value = String(every.minutes);
      ui.accrualAddM.value = String(Math.round(rule.addMs / 60000));
      ui.accrualSource.value = rule.sourceTimerId;
      return;
    }

    ui.accrualEveryH.value = "1";
    ui.accrualEveryM.value = "0";
    ui.accrualAddM.value = "5";
    if (others.length) ui.accrualSource.value = others[0].id;
  }

  /** Partes do formulario que refletem o estado e podem mudar a cada tick. */
  function syncConfigLive(timer) {
    const isPrimary = timer.id === state.primaryTimerId;
    const running = timer.status === "running";

    // Os mesmos campos servem aos dois modos, mas o nome muda o sentido: num
    // progressivo o valor e o que ja correu; num regressivo, o que ja foi
    // gasto. Chamar os dois de "comecar em" era o que confundia.
    const progressivo = timer.direction === "up";

    ui.cfgDirectionHint.textContent = progressivo
      ? "Conta para cima e mostra quanto já passou. O tempo abaixo é a meta."
      : "Conta para baixo e mostra quanto falta. O tempo abaixo é a duração.";

    ui.cfgTimeLabel.textContent = progressivo ? "Meta" : "Duração";
    ui.cfgOffsetLabel.textContent = progressivo ? "Já decorrido" : "Já consumido";
    ui.clockLabel.textContent = "Começou em";
    ui.clockSync.disabled = running;
    ui.clockNow.disabled = running;
    ui.fromClock.disabled = running;

    ui.applyTime.disabled = running;
    ui.applyStart.disabled = running;
    ui.cfgTimeHint.textContent = running
      ? "Pause o cronômetro para trocar o tempo."
      : "Zera a contagem. O tempo ganho por regra continua valendo.";

    ui.applyOffset.disabled = running;
    ui.offsetStart.disabled = running;
    ui.clearOffset.disabled = running || timer.offsetMs === 0;
    if (ui.spendRow) ui.spendRow.hidden = running;
    ui.cfgOffsetHint.textContent = running
      ? `Pause para ajustar ${progressivo ? "o decorrido" : "o consumido"}.`
      : timer.overspentMs > 0
        ? `${formatTime(timer.offsetMs)} usados de ${formatTime(timer.totalTime)} disponíveis: ${formatTime(timer.overspentMs)} saem do próximo ganho.`
        : timer.offsetMs > 0
          ? `Parte de ${formatTime(timer.offsetMs)}. O Zerar volta para cá, não para zero.`
          : progressivo
            ? "Use quando a contagem já vem de antes — ex.: a aula corre há 05:15:00."
            : "Use para registrar o que já foi gasto sem o cronômetro rodando.";

    if (ui.cfgLedger) {
      const extrato = getLedgerLabel(timer);
      ui.cfgLedger.textContent = extrato;
      ui.cfgLedger.hidden = !extrato;
      ui.cfgLedger.dataset.state = timer.overspentMs > 0 ? "over" : "ok";
    }

    ui.setPrimary.disabled = isPrimary;
    ui.setPrimary.textContent = isPrimary ? "Já é o destaque" : "Destacar no viewer";
    ui.moveUp.disabled = timer.index === 0;
    ui.moveDown.disabled = timer.index === state.timers.length - 1;

    const rule = timer.accrual;
    if (!rule) {
      ui.accrualStatus.textContent =
        state.timers.length < 2
          ? "Adicione outro cronômetro para poder usar esta regra."
          : "";
      return;
    }

    const source = findTimer(rule.sourceTimerId);
    const frase = getAccrualLabel(rule, source ? getTimerLabel(source) : "?");
    ui.accrualStatus.textContent = timer.bonusMs
      ? `${frase} · já somou ${formatCompactDuration(timer.bonusMs)} em ${rule.grantedCount}x`
      : frase;
  }

  // ------------------------------------------ modal de config da sessao

  function openModal() {
    ui.overlay.classList.add("open");
    renderModels();
  }

  function closeModal() {
    ui.overlay.classList.remove("open");
  }

  // ---------------------------------------------------------------- modelos

  function loadModels() {
    try {
      const raw =
        localStorage.getItem(MODELS_KEY) ??
        localStorage.getItem(legacyPresetsKey);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.map(sanitizeModel).filter(Boolean).slice(0, MAX_MODELS);
    } catch {
      return [];
    }
  }

  function sanitizeModel(raw) {
    if (!raw || typeof raw !== "object") return null;

    const name = sanitizeTimerName(raw.name);
    const secs = Math.trunc(Number(raw.secs));
    if (!name || !Number.isFinite(secs) || secs < 1 || secs > MAX_TIMER_MS / 1000) {
      return null;
    }

    return { name, secs, direction: raw.direction === "up" ? "up" : "down" };
  }

  function saveModelFromSelected() {
    const timer = findTimer(selectedTimerId);
    if (!timer) return;

    const name = sanitizeTimerName(ui.cfgName.value) || getTimerLabel(timer);
    const models = loadModels().filter(
      (item) => item.name.toLowerCase() !== name.toLowerCase(),
    );

    models.push({
      name,
      secs: Math.round(timer.baseTotalTime / 1000),
      direction: timer.direction,
    });

    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(models.slice(-MAX_MODELS)));
    } catch {
      return showFeedback("Não foi possível salvar o modelo.", "error");
    }

    renderModels();
    showFeedback(`Modelo "${name}" salvo.`, "success");
  }

  function deleteModel(index) {
    const models = loadModels();
    models.splice(index, 1);
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(models));
    } catch {
      /* nada a fazer alem de manter a tela como esta */
    }
    renderModels();
  }

  function renderModels() {
    const models = loadModels();

    // Chips da barra: um clique cria um cronometro a partir do modelo.
    ui.modelsChips.replaceChildren();
    if (!models.length) {
      const vazio = document.createElement("span");
      vazio.className = "hint";
      vazio.textContent = "Salve um cronômetro como modelo nos ajustes";
      ui.modelsChips.appendChild(vazio);
    } else {
      for (const model of models) {
        const chip = document.createElement("button");
        chip.className = "model-chip";
        chip.type = "button";
        chip.textContent = `${model.name} · ${formatCompactDuration(model.secs * 1000)}`;
        chip.title = `Adicionar cronômetro a partir de "${model.name}"`;
        chip.addEventListener("click", () => addTimer(model));
        ui.modelsChips.appendChild(chip);
      }
    }

    if (!ui.modelsManage) return;
    ui.modelsManage.replaceChildren();

    if (!models.length) {
      const vazio = document.createElement("p");
      vazio.className = "hint";
      vazio.textContent = "Nenhum modelo salvo ainda.";
      ui.modelsManage.appendChild(vazio);
      return;
    }

    models.forEach((model, index) => {
      const row = document.createElement("div");
      row.className = "model-row";

      const info = document.createElement("div");

      const name = document.createElement("div");
      name.className = "model-name";
      name.textContent = model.name;

      const detail = document.createElement("div");
      detail.className = "model-detail";
      detail.textContent = `${formatCompactDuration(model.secs * 1000)} · ${
        model.direction === "up" ? "progressivo" : "regressivo"
      }`;

      const del = document.createElement("button");
      del.className = "btn btn--danger btn--small";
      del.type = "button";
      del.textContent = "Excluir";
      del.setAttribute("aria-label", `Excluir modelo ${model.name}`);
      del.addEventListener("click", () => deleteModel(index));

      info.append(name, detail);
      row.append(info, del);
      ui.modelsManage.appendChild(row);
    });
  }

  // ------------------------------------------------------------------ apoio

  function findTimer(timerId) {
    if (!timerId) return null;
    return state.timers.find((timer) => timer.id === timerId) || null;
  }

  function readNumber(input, min, max) {
    const parsed = Number.parseInt(input?.value ?? "", 10);
    const safe = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : min;
    if (input) input.value = String(safe);
    return safe;
  }

  function statusLabel(status) {
    return (
      {
        running: "Rodando",
        paused: "Pausado",
        finished: "Finalizado",
      }[status] || "Parado"
    );
  }

  function syncWatchers() {
    const present = new Set(state.timers.map((timer) => timer.id));
    for (const id of finishWatchers.keys()) {
      if (!present.has(id)) finishWatchers.delete(id);
    }

    for (const timer of state.timers) {
      let watcher = finishWatchers.get(timer.id);
      if (!watcher) {
        watcher = window.CronoFinishSound?.createWatcher();
        if (!watcher) return;
        finishWatchers.set(timer.id, watcher);
      }
      watcher.sync(timer.status, timer.remaining);
    }
  }

  function setAuthFeedback(message, kind) {
    if (!ui.authFeedback) return;
    ui.authFeedback.textContent = message;
    ui.authFeedback.dataset.state = kind || "";
  }

  function showFeedback(message, kind) {
    window.clearTimeout(feedbackTimer);
    ui.boardFeedback.textContent = message;
    ui.boardFeedback.dataset.state = kind;

    feedbackTimer = window.setTimeout(() => {
      ui.boardFeedback.textContent = "";
      delete ui.boardFeedback.dataset.state;
    }, FEEDBACK_MS);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      return;
    }
    document.exitFullscreen().catch(() => {});
  }

  function syncFullscreen() {
    if (!ui.fullscreen) return;
    const cheia = Boolean(document.fullscreenElement);
    ui.fullscreen.setAttribute(
      "aria-label",
      cheia ? "Sair da tela cheia" : "Entrar em tela cheia",
    );
    ui.fullscreen.title = cheia ? "Sair da tela cheia" : "Tela cheia";
  }

  function showError(message) {
    socket.disconnect();
    const box = document.createElement("div");
    box.className = "screen-message";
    box.textContent = message;
    document.body.replaceChildren(box);
  }
})();
