(() => {
  const MAX_PRESET_NAME_LENGTH = 24;
  const MAX_PRESETS = 20;
  const MAX_TIMER_SECONDS = 12 * 60 * 60;
  const socket = io();
  const sessionId = window.location.pathname.split("/").pop();
  const adminToken = window.location.hash.slice(1);
  const presetsKey = `crono_sw_presets_${sessionId}`;

  const elements = {
    adminPanel: document.getElementById("admin-panel"),
    desktopPresetsChips: document.getElementById("desktop-presets-chips"),
    desktopManage: document.getElementById("d-presets-manage"),
    desktopPresetName: document.getElementById("d-preset-name"),
    desktopPresetFeedback: document.getElementById("d-preset-feedback"),
    desktopTimer: document.getElementById("d-timer"),
    desktopProgress: document.getElementById("d-progress"),
    desktopStatusDot: document.getElementById("d-status-dot"),
    desktopStatusText: document.getElementById("d-status-text"),
    desktopStart: document.getElementById("d-btn-start"),
    desktopPause: document.getElementById("d-btn-pause"),
    desktopReset: document.getElementById("d-btn-reset"),
    desktopFs: document.getElementById("btn-fs-d"),
    desktopOpenModal: document.getElementById("btn-open-modal"),
    desktopApply: document.getElementById("btn-d-apply"),
    desktopSavePreset: document.getElementById("btn-d-save-preset"),
    desktopAddPreset: document.getElementById("btn-d-add-preset"),
    modalOverlay: document.getElementById("modal-overlay"),
    closeModal: document.getElementById("btn-close-modal"),
    mobilePresetsScroll: document.getElementById("m-presets-scroll"),
    mobileManage: document.getElementById("m-presets-manage"),
    mobilePresetName: document.getElementById("m-preset-name"),
    mobilePresetFeedback: document.getElementById("m-preset-feedback"),
    mobileTimer: document.getElementById("m-timer"),
    mobileProgress: document.getElementById("m-progress"),
    mobileStatusDot: document.getElementById("m-status-dot"),
    mobileStatusText: document.getElementById("m-status-text"),
    mobileStart: document.getElementById("m-btn-start"),
    mobilePause: document.getElementById("m-btn-pause"),
    mobileReset: document.getElementById("m-btn-reset"),
    mobileFs: document.getElementById("btn-fs-m"),
    mobileOpenDrawer: document.getElementById("btn-open-drawer"),
    mobileApply: document.getElementById("btn-m-apply"),
    mobileSavePreset: document.getElementById("btn-m-save-preset"),
    mobileAddPreset: document.getElementById("btn-m-add-preset"),
    drawerOverlay: document.getElementById("drawer-overlay"),
    drawer: document.getElementById("drawer"),
    closeDrawer: document.getElementById("btn-close-drawer"),
    viewerLinks: document.querySelectorAll(".viewer-link-d a, .viewer-link-m a"),
    desktopInputH: document.getElementById("d-input-h"),
    desktopInputM: document.getElementById("d-input-m"),
    desktopInputS: document.getElementById("d-input-s"),
    mobileInputH: document.getElementById("m-input-h"),
    mobileInputM: document.getElementById("m-input-m"),
    mobileInputS: document.getElementById("m-input-s"),
  };

  let touchStartY = 0;
  const presetFeedbackTimers = { desktop: 0, mobile: 0 };

  if (!elements.adminPanel || !elements.drawer || !isValidSessionId(sessionId)) {
    showError("Sessão não encontrada.");
    return;
  }

  if (!isValidAdminToken(adminToken)) {
    showError("Acesso de admin inválido ou expirado.");
    return;
  }

  bindEvents();
  connectToSession();

  function bindEvents() {
    elements.desktopFs?.addEventListener("click", toggleFullscreen);
    elements.mobileFs?.addEventListener("click", toggleFullscreen);
    elements.desktopOpenModal?.addEventListener("click", openModal);
    elements.closeModal?.addEventListener("click", closeModal);
    elements.mobileOpenDrawer?.addEventListener("click", openDrawer);
    elements.closeDrawer?.addEventListener("click", closeDrawer);
    elements.drawerOverlay?.addEventListener("click", closeDrawer);
    elements.desktopApply?.addEventListener("click", applyDesktopTime);
    elements.mobileApply?.addEventListener("click", applyMobileTimeAndClose);
    elements.desktopSavePreset?.addEventListener("click", saveDesktopPresetFromField);
    elements.mobileSavePreset?.addEventListener("click", saveMobilePresetFromField);
    elements.desktopAddPreset?.addEventListener("click", addDesktopPreset);
    elements.mobileAddPreset?.addEventListener("click", addMobilePreset);
    elements.desktopStart?.addEventListener("click", timerStart);
    elements.mobileStart?.addEventListener("click", timerStart);
    elements.desktopPause?.addEventListener("click", timerPause);
    elements.mobilePause?.addEventListener("click", timerPause);
    elements.desktopReset?.addEventListener("click", timerReset);
    elements.mobileReset?.addEventListener("click", timerReset);
    elements.desktopPresetName?.addEventListener("keydown", onPresetNameKeydown(addDesktopPreset));
    elements.mobilePresetName?.addEventListener("keydown", onPresetNameKeydown(addMobilePreset));
    elements.desktopPresetName?.addEventListener("input", () => clearPresetFeedback("desktop"));
    elements.mobilePresetName?.addEventListener("input", () => clearPresetFeedback("mobile"));
    elements.modalOverlay?.addEventListener("click", (event) => {
      if (event.target === elements.modalOverlay) {
        closeModal();
      }
    });

    elements.drawer?.addEventListener("touchstart", (event) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    });
    elements.drawer?.addEventListener("touchend", (event) => {
      const endY = event.changedTouches[0]?.clientY ?? 0;
      if (endY - touchStartY > 80) {
        closeDrawer();
      }
    });

    document.addEventListener("fullscreenchange", syncFullscreenButtons);
    socket.on("connect_error", () => {
      showError("Não foi possível conectar ao servidor.");
    });
    socket.on("timer:tick", ({ status, remaining, pct }) => {
      updateTimers(remaining, pct, status);
      updateControls(status);
    });
  }

  function connectToSession() {
    socket.emit("session:join", sessionId, "admin", adminToken, (response) => {
      if (!response?.success) {
        showError(
          response?.reason === "unauthorized"
            ? "Acesso de admin inválido ou expirado."
            : "Sessão não encontrada."
        );
        return;
      }

      elements.adminPanel.style.display = "block";
      const viewerUrl = `/view/${sessionId}`;
      for (const link of elements.viewerLinks) {
        link.href = viewerUrl;
        link.textContent = `${window.location.origin}${viewerUrl}`;
      }

      renderAll();
      syncFullscreenButtons();
    });
  }

  function onPresetNameKeydown(handler) {
    return (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handler();
      }
    };
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      return;
    }

    document.exitFullscreen().catch(() => {});
  }

  function syncFullscreenButtons() {
    const icon = document.fullscreenElement ? "✕" : "⛶";
    if (elements.desktopFs) elements.desktopFs.textContent = icon;
    if (elements.mobileFs) elements.mobileFs.textContent = icon;
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(presetsKey);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const safePresets = parsed
        .map((preset) => sanitizePreset(preset))
        .filter(Boolean)
        .slice(0, MAX_PRESETS);

      if (safePresets.length !== parsed.length) {
        savePresets(safePresets);
      }

      return safePresets;
    } catch {
      return [];
    }
  }

  function savePresets(presets) {
    localStorage.setItem(presetsKey, JSON.stringify(presets));
  }

  function sanitizePreset(preset) {
    if (!preset || typeof preset !== "object") return null;

    const name = normalizePresetName(preset.name);
    const secs = sanitizeSeconds(preset.secs);

    if (!name || secs === null) return null;
    return { name, secs };
  }

  function normalizePresetName(value) {
    if (typeof value !== "string") return "";

    return value
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, MAX_PRESET_NAME_LENGTH);
  }

  function sanitizeSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;

    const safeValue = Math.trunc(parsed);
    if (safeValue < 1 || safeValue > MAX_TIMER_SECONDS) {
      return null;
    }

    return safeValue;
  }

  function fmtPresetTime(secs) {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;

    if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
    if (minutes > 0 && seconds > 0) return `${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes} min`;
    return `${seconds}s`;
  }

  function applyPreset(secs) {
    const safeSeconds = sanitizeSeconds(secs);
    if (safeSeconds === null) return;

    syncTimeInputs(safeSeconds);
    socket.emit("timer:setTime", safeSeconds * 1000);
  }

  function syncTimeInputs(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    setInputValue(elements.desktopInputH, hours);
    setInputValue(elements.mobileInputH, hours);
    setInputValue(elements.desktopInputM, minutes);
    setInputValue(elements.mobileInputM, minutes);
    setInputValue(elements.desktopInputS, seconds);
    setInputValue(elements.mobileInputS, seconds);
  }

  function setInputValue(input, value) {
    if (input) input.value = String(value);
  }

  function deletePreset(index) {
    const presets = loadPresets();
    presets.splice(index, 1);
    savePresets(presets);
    renderAll();
  }

  function renderAll() {
    renderDesktopPresets();
    renderMobilePresets();
    renderDesktopManage();
    renderMobileManage();
  }

  function renderDesktopPresets() {
    const container = elements.desktopPresetsChips;
    if (!container) return;

    const presets = loadPresets();
    container.replaceChildren();

    if (!presets.length) {
      container.appendChild(createEmptyState("presets-empty-d", "Adicione nas configurações ⚙"));
      return;
    }

    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.className = "preset-chip-d";
      button.type = "button";
      button.textContent = preset.name;
      button.addEventListener("click", () => applyPreset(preset.secs));
      container.appendChild(button);
    });
  }

  function renderMobilePresets() {
    const container = elements.mobilePresetsScroll;
    if (!container) return;

    const presets = loadPresets();
    container.replaceChildren();

    if (!presets.length) {
      container.appendChild(
        createEmptyState("presets-empty-m", "Adicione presets nas configurações ⚙️")
      );
      return;
    }

    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.className = "preset-chip-m";
      button.type = "button";
      button.textContent = preset.name;
      button.addEventListener("click", () => applyPreset(preset.secs));
      container.appendChild(button);
    });
  }

  function renderDesktopManage() {
    const container = elements.desktopManage;
    if (!container) return;

    const presets = loadPresets();
    container.replaceChildren();

    if (!presets.length) {
      container.appendChild(createEmptyState("presets-empty", "Nenhum preset ainda."));
      return;
    }

    presets.forEach((preset, index) => {
      const row = document.createElement("div");
      row.className = "preset-manage-row";

      const info = document.createElement("div");
      info.className = "preset-manage-info";

      const name = document.createElement("div");
      name.className = "preset-manage-name";
      name.textContent = preset.name;

      const time = document.createElement("div");
      time.className = "preset-manage-time";
      time.textContent = fmtPresetTime(preset.secs);

      const button = document.createElement("button");
      button.className = "preset-del-btn";
      button.type = "button";
      button.textContent = "✕";
      button.addEventListener("click", () => deletePreset(index));

      info.append(name, time);
      row.append(info, button);
      container.appendChild(row);
    });
  }

  function renderMobileManage() {
    const container = elements.mobileManage;
    if (!container) return;

    const presets = loadPresets();
    container.replaceChildren();

    if (!presets.length) {
      container.appendChild(createEmptyState("presets-empty", "Nenhum preset ainda."));
      return;
    }

    presets.forEach((preset, index) => {
      const row = document.createElement("div");
      row.className = "preset-row-m";

      const info = document.createElement("div");
      info.className = "preset-row-info";

      const name = document.createElement("div");
      name.className = "preset-row-name";
      name.textContent = preset.name;

      const time = document.createElement("div");
      time.className = "preset-row-time";
      time.textContent = fmtPresetTime(preset.secs);

      const button = document.createElement("button");
      button.className = "preset-row-del";
      button.type = "button";
      button.textContent = "✕";
      button.addEventListener("click", () => deletePreset(index));

      info.append(name, time);
      row.append(info, button);
      container.appendChild(row);
    });
  }

  function createEmptyState(className, text) {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function readInputValue(input, min, max) {
    const parsed = Number.parseInt(input?.value ?? "", 10);
    if (!Number.isFinite(parsed)) return min;
    const safeValue = Math.min(max, Math.max(min, parsed));
    if (input) input.value = String(safeValue);
    return safeValue;
  }

  function getDesktopMs() {
    return getTimeFromInputs(elements.desktopInputH, elements.desktopInputM, elements.desktopInputS);
  }

  function getMobileMs() {
    return getTimeFromInputs(elements.mobileInputH, elements.mobileInputM, elements.mobileInputS);
  }

  function getTimeFromInputs(hoursInput, minutesInput, secondsInput) {
    const hours = readInputValue(hoursInput, 0, 23);
    const minutes = readInputValue(minutesInput, 0, 59);
    const seconds = readInputValue(secondsInput, 0, 59);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;

    if (totalSeconds < 1 || totalSeconds > MAX_TIMER_SECONDS) {
      return 0;
    }

    return totalSeconds * 1000;
  }

  function applyDesktopTime() {
    const ms = getDesktopMs();
    if (ms <= 0) return;
    socket.emit("timer:setTime", ms);
    closeModal();
  }

  function applyMobileTimeAndClose() {
    const ms = getMobileMs();
    if (ms <= 0) return;
    socket.emit("timer:setTime", ms);
    closeDrawer();
  }

  function saveDesktopPresetFromField() {
    savePresetFromField("desktop", getDesktopMs());
  }

  function saveMobilePresetFromField() {
    savePresetFromField("mobile", getMobileMs());
  }

  function savePresetFromField(mode, ms) {
    const input = mode === "desktop" ? elements.desktopPresetName : elements.mobilePresetName;
    const name = normalizePresetName(input?.value || "");

    if (ms <= 0) {
      showPresetFeedback(mode, "Defina um tempo válido antes de salvar.", "error");
      input?.focus();
      return;
    }

    if (!name) {
      showPresetFeedback(mode, "Digite um nome para o preset.", "error");
      input?.focus();
      return;
    }

    upsertPreset(name, ms);
    if (input) {
      input.value = "";
    }
    showPresetFeedback(mode, "Preset salvo com sucesso.", "success");
  }

  function addDesktopPreset() {
    savePresetFromField("desktop", getDesktopMs());
  }

  function addMobilePreset() {
    savePresetFromField("mobile", getMobileMs());
  }

  function upsertPreset(name, ms) {
    const secs = sanitizeSeconds(ms / 1000);
    if (secs === null) return;

    const presets = loadPresets();
    presets.push({ name, secs });
    savePresets(presets.slice(-MAX_PRESETS));
    renderAll();
  }

  function showPresetFeedback(mode, message, state) {
    const feedback = mode === "desktop" ? elements.desktopPresetFeedback : elements.mobilePresetFeedback;
    const input = mode === "desktop" ? elements.desktopPresetName : elements.mobilePresetName;

    if (presetFeedbackTimers[mode]) {
      window.clearTimeout(presetFeedbackTimers[mode]);
      presetFeedbackTimers[mode] = 0;
    }

    if (!feedback || !input) return;

    feedback.textContent = message;

    if (message) {
      feedback.dataset.state = state;
      input.dataset.state = state;
    } else {
      delete feedback.dataset.state;
      delete input.dataset.state;
    }

    if (state === "success" && message) {
      presetFeedbackTimers[mode] = window.setTimeout(() => {
        clearPresetFeedback(mode);
      }, 2200);
    }
  }

  function clearPresetFeedback(mode) {
    showPresetFeedback(mode, "", "");
  }

  function openModal() {
    elements.modalOverlay?.classList.add("open");
    renderDesktopManage();
  }

  function closeModal() {
    elements.modalOverlay?.classList.remove("open");
  }

  function openDrawer() {
    elements.drawerOverlay?.classList.add("open");
    elements.drawer?.classList.add("open");
    renderMobileManage();
  }

  function closeDrawer() {
    elements.drawerOverlay?.classList.remove("open");
    elements.drawer?.classList.remove("open");
  }

  function timerStart() {
    socket.emit("timer:start");
  }

  function timerPause() {
    socket.emit("timer:pause");
  }

  function timerReset() {
    socket.emit("timer:reset");
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

  function getPhase(pct) {
    if (pct <= 0.1) return "blink";
    if (pct <= 0.2) return "red";
    if (pct <= 0.4) return "yellow";
    return "green";
  }

  function updateTimers(remaining, pct, status) {
    const safeRemaining = sanitizeMs(remaining);
    const safePct = sanitizePct(pct);
    const time = formatTime(safeRemaining);
    const phase = getPhase(safePct);
    const isActiveOrFinished =
      status === "running" || status === "paused" || status === "finished";
    const className = `timer-display ${isActiveOrFinished ? phase : "green"}`;
    const barColor =
      safePct <= 0.2 ? "#ff3e3e" : safePct <= 0.4 ? "#ffb800" : "#00f5a0";

    if (elements.desktopTimer) {
      elements.desktopTimer.textContent = time;
      elements.desktopTimer.className = `${className} timer-display-d`;
    }
    if (elements.mobileTimer) {
      elements.mobileTimer.textContent = time;
      elements.mobileTimer.className = `${className} timer-display-m`;
    }
    if (elements.desktopProgress) {
      elements.desktopProgress.style.width = `${safePct * 100}%`;
      elements.desktopProgress.style.background = barColor;
    }
    if (elements.mobileProgress) {
      elements.mobileProgress.style.width = `${safePct * 100}%`;
      elements.mobileProgress.style.background = barColor;
    }
  }

  function updateControls(status) {
    [
      {
        dot: elements.desktopStatusDot,
        text: elements.desktopStatusText,
        start: elements.desktopStart,
        pause: elements.desktopPause,
      },
      {
        dot: elements.mobileStatusDot,
        text: elements.mobileStatusText,
        start: elements.mobileStart,
        pause: elements.mobilePause,
      },
    ].forEach((set) => {
      if (!set.dot || !set.text || !set.start || !set.pause) return;

      set.dot.className = `status-dot ${status}`;

      if (status === "running") {
        set.text.textContent = "RODANDO";
        set.start.disabled = true;
        set.start.textContent = "▶ Start";
        set.pause.disabled = false;
        return;
      }

      if (status === "paused") {
        set.text.textContent = "PAUSADO";
        set.start.disabled = false;
        set.start.textContent = "▶ Continuar";
        set.pause.disabled = true;
        return;
      }

      if (status === "finished") {
        set.text.textContent = "FINALIZADO";
        set.start.disabled = true;
        set.start.textContent = "▶ Start";
        set.pause.disabled = true;
        return;
      }

      set.text.textContent = "PARADO";
      set.start.disabled = false;
      set.start.textContent = "▶ Start";
      set.pause.disabled = true;
    });
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

  function isValidSessionId(value) {
    return typeof value === "string" && /^[a-f0-9]{8}$/i.test(value);
  }

  function isValidAdminToken(value) {
    return typeof value === "string" && /^[a-f0-9]{36}$/i.test(value);
  }

  function showError(message) {
    socket.disconnect();
    document.body.classList.add("message-mode");
    document.body.replaceChildren(createMessage(message));
  }

  function createMessage(message) {
    const element = document.createElement("div");
    element.className = "screen-message";
    element.textContent = message;
    return element;
  }

})();
