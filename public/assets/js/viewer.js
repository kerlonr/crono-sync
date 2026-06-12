(() => {
  const { formatTime, getPhase, isValidSessionId, sanitizeMs, sanitizePct } =
    window.CronoUtils;
  const socket = io();
  const sessionId = window.location.pathname.split("/").pop();
  const timerDisplay = document.getElementById("timer-display");
  const glowBg = document.getElementById("glow-bg");
  const finishSoundWatcher = window.CronoFinishSound?.createWatcher();

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

    finishSoundWatcher?.sync(status, safeRemaining);
    timerDisplay.textContent = formatTime(safeRemaining);

    if (safeRemaining <= 0) {
      timerDisplay.className = "timer-display red";
      document.body.classList.add("flash-red", "finished");
      glowBg.style.background =
        "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(255,62,62,0.25) 0%, transparent 70%)";
      return;
    }

    document.body.classList.remove("flash-red", "finished");

    const phase = getPhase(safePct);

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
