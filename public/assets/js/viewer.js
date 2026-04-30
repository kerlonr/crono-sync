(() => {
  const socket = io();
  const sessionId = window.location.pathname.split("/").pop();
  const timerDisplay = document.getElementById("timer-display");
  const glowBg = document.getElementById("glow-bg");
  const finishSound = window.CronoFinishSound?.create();
  let finishSoundArmed = false;
  let finishSoundPlayed = false;

  if (!timerDisplay || !glowBg) {
    return;
  }

  if (!isValidSessionId(sessionId)) {
    showError("Sessão não encontrada.");
    return;
  }

  socket.emit("session:join", sessionId, "viewer", (response) => {
    if (!response?.success) {
      showError("Sessão não encontrada.");
    }
  });

  socket.on("connect_error", () => {
    showError("Não foi possível conectar ao servidor.");
  });

  socket.on("session:closed", () => {
    showError("Sessão encerrada.");
  });

  socket.on("timer:tick", ({ status, remaining, pct }) => {
    const safeRemaining = sanitizeMs(remaining);
    const safePct = sanitizePct(pct);

    syncFinishSound(status, safeRemaining);
    timerDisplay.textContent = formatTime(safeRemaining);

    if (safeRemaining <= 0) {
      timerDisplay.className = "timer-display red";
      document.body.classList.add("flash-red", "finished");
      glowBg.style.background =
        "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(255,62,62,0.25) 0%, transparent 70%)";
      return;
    }

    document.body.classList.remove("flash-red", "finished");

    let phase = "green";
    if (safePct <= 0.1) phase = "blink";
    else if (safePct <= 0.2) phase = "red";
    else if (safePct <= 0.4) phase = "yellow";

    let className = "timer-display";
    if (status === "running") className += ` ${phase}`;
    else if (status === "paused") className += ` ${phase} paused`;
    else className += " green";

    timerDisplay.className = className;

    const glows = {
      green:
        "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(0,245,160,0.05) 0%, transparent 70%)",
      yellow:
        "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(255,184,0,0.07) 0%, transparent 70%)",
      red:
        "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(255,62,62,0.08) 0%, transparent 70%)",
      blink:
        "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(255,62,62,0.12) 0%, transparent 70%)",
    };

    glowBg.style.background = status === "running" ? glows[phase] || glows.green : "none";
  });

  function isValidSessionId(value) {
    return typeof value === "string" && /^[a-f0-9]{8}$/i.test(value);
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

  function syncFinishSound(status, remaining) {
    if (status === "running" && remaining > 0) {
      finishSoundArmed = true;
    }

    if (status === "finished" || remaining <= 0) {
      if (finishSoundArmed && !finishSoundPlayed) {
        finishSound?.play();
      }

      finishSoundPlayed = true;
      finishSoundArmed = false;
      return;
    }

    if (status === "stopped") {
      finishSoundArmed = false;
      finishSoundPlayed = false;
      return;
    }

    if (remaining > 0) {
      finishSoundPlayed = false;
    }
  }

  function formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
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
