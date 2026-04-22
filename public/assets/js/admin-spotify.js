(() => {
  const sessionId = window.location.pathname.split("/").pop();
  const adminToken = window.location.hash.slice(1);

  if (!isValidSessionId(sessionId) || !isValidAdminToken(adminToken)) {
    return;
  }

  const elements = {
    deviceDesktop: document.getElementById("sp-device-d"),
    loginDesktop: document.getElementById("sp-login-btn-d"),
    loginDrawer: document.getElementById("sp-login-btn-drawer"),
    loginMobile: document.getElementById("sp-login-btn-m"),
    notAuthDesktop: document.getElementById("sp-not-auth-d"),
    notAuthMobile: document.getElementById("sp-not-auth-m"),
    authContentDesktop: document.getElementById("sp-auth-content-d"),
    authContentMobile: document.getElementById("sp-auth-content-m"),
    drawerAuth: document.getElementById("sp-drawer-auth"),
    drawerNotAuth: document.getElementById("sp-drawer-not-auth"),
    coverDesktop: document.getElementById("sp-cover-d"),
    coverMobile: document.getElementById("sp-cover-m"),
    nameDesktop: document.getElementById("sp-track-name-d"),
    nameMobile: document.getElementById("sp-track-name-m"),
    artistDesktop: document.getElementById("sp-track-artist-d"),
    artistMobile: document.getElementById("sp-track-artist-m"),
    progressBarDesktop: document.getElementById("sp-progress-bar-d"),
    progressFillDesktop: document.getElementById("sp-progress-fill-d"),
    timeCurrentDesktop: document.getElementById("sp-time-cur-d"),
    timeTotalDesktop: document.getElementById("sp-time-total-d"),
    playDesktop: document.getElementById("sp-btn-play-d"),
    playMobile: document.getElementById("sp-btn-play-m"),
    prevDesktop: document.getElementById("sp-btn-prev-d"),
    prevMobile: document.getElementById("sp-btn-prev-m"),
    nextDesktop: document.getElementById("sp-btn-next-d"),
    nextMobile: document.getElementById("sp-btn-next-m"),
    shuffleDesktop: document.getElementById("sp-btn-shuffle-d"),
    repeatDesktop: document.getElementById("sp-btn-repeat-d"),
    volumeDesktop: document.getElementById("sp-vol-d"),
    volumeDesktopValue: document.getElementById("sp-vol-val-d"),
    volumeMobile: document.getElementById("sp-vol-m"),
    volumeMobileValue: document.getElementById("sp-vol-val-m"),
    playlistDesktop: document.getElementById("sp-playlist-select-d"),
    playlistMobile: document.getElementById("sp-playlist-select-m"),
    tracklistDesktop: document.getElementById("sp-tracklist-d"),
    tracklistMobile: document.getElementById("sp-tracklist-m"),
  };

  const authButtons = [
    elements.loginDesktop,
    elements.loginMobile,
    elements.loginDrawer,
  ].filter(Boolean);

  const state = {
    authenticated: false,
    isPlaying: false,
    repeatState: "off",
    currentPlaylistUri: null,
    currentTrackId: null,
    durationMs: 0,
    progressMs: 0,
    progressTimer: 0,
    volumeTimer: 0,
  };

  bindEvents();
  initialize();

  function bindEvents() {
    for (const button of authButtons) {
      button.addEventListener("click", startAuthentication);
    }

    elements.playDesktop?.addEventListener("click", togglePlay);
    elements.playMobile?.addEventListener("click", togglePlay);
    elements.prevDesktop?.addEventListener("click", () => controlAndRefresh("POST", "/api/spotify/previous"));
    elements.prevMobile?.addEventListener("click", () => controlAndRefresh("POST", "/api/spotify/previous"));
    elements.nextDesktop?.addEventListener("click", () => controlAndRefresh("POST", "/api/spotify/next"));
    elements.nextMobile?.addEventListener("click", () => controlAndRefresh("POST", "/api/spotify/next"));

    elements.shuffleDesktop?.addEventListener("click", async () => {
      const nextState = !elements.shuffleDesktop.classList.contains("active");
      const result = await api(`/api/spotify/shuffle?state=${nextState}`, {
        method: "PUT",
      });

      if (result.ok) {
        elements.shuffleDesktop.classList.toggle("active", nextState);
      }
    });

    elements.repeatDesktop?.addEventListener("click", async () => {
      const nextState = getNextRepeatState(state.repeatState);
      const result = await api(`/api/spotify/repeat?state=${nextState}`, {
        method: "PUT",
      });

      if (result.ok) {
        updateRepeatButton(nextState);
      }
    });

    bindVolumeInput(
      elements.volumeDesktop,
      elements.volumeDesktopValue,
      elements.volumeMobile,
      elements.volumeMobileValue,
    );
    bindVolumeInput(
      elements.volumeMobile,
      elements.volumeMobileValue,
      elements.volumeDesktop,
      elements.volumeDesktopValue,
    );

    elements.progressBarDesktop?.addEventListener("click", async (event) => {
      if (!state.durationMs) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const offset = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      const progressMs = Math.floor((offset / rect.width) * state.durationMs);

      state.progressMs = progressMs;
      renderProgress();

      await api(`/api/spotify/seek?ms=${progressMs}`, { method: "PUT" });
    });

    bindPlaylistSelect(elements.playlistDesktop, elements.playlistMobile);
    bindPlaylistSelect(elements.playlistMobile, elements.playlistDesktop);

    window.addEventListener("focus", async () => {
      await refresh();
    });
  }

  async function initialize() {
    await refresh();
    window.setInterval(refreshStatusOnly, 5000);
  }

  async function refresh() {
    await refreshStatusOnly();

    if (state.authenticated) {
      await loadPlaylists();
    }
  }

  async function refreshStatusOnly() {
    const result = await api("/api/spotify/status");
    if (!result.ok || !result.data) {
      return;
    }

    if (!result.data.authenticated) {
      setAuthenticated(false);
      resetPlayer();
      return;
    }

    setAuthenticated(true);
    updatePlayer(result.data.player);
  }

  async function startAuthentication(event) {
    event.preventDefault();
    setAuthButtonsDisabled(true);

    const result = await api("/api/spotify/auth-url", {
      method: "POST",
      body: {
        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      },
    });

    if (!result.ok || !result.data?.url) {
      setAuthButtonsDisabled(false);
      return;
    }

    window.location.assign(result.data.url);
  }

  function setAuthenticated(authenticated) {
    state.authenticated = authenticated;

    toggleHidden(elements.loginDesktop, authenticated);
    toggleHidden(elements.loginMobile, authenticated);
    toggleHidden(elements.loginDrawer, authenticated);
    toggleHidden(elements.notAuthDesktop, authenticated);
    toggleHidden(elements.notAuthMobile, authenticated);
    toggleHidden(elements.authContentDesktop, !authenticated);
    toggleHidden(elements.authContentMobile, !authenticated);
    toggleHidden(elements.drawerAuth, !authenticated);
    toggleHidden(elements.drawerNotAuth, authenticated);

    if (!authenticated) {
      setAuthButtonsDisabled(false);
    }
  }

  function updatePlayer(player) {
    if (!player || !player.track) {
      resetPlayer();
      return;
    }

    state.isPlaying = player.isPlaying;
    state.repeatState = player.repeatState || "off";
    state.currentTrackId = player.track.id;
    state.durationMs = sanitizeMs(player.track.durationMs);
    state.progressMs = sanitizeMs(player.track.progressMs);

    setText(elements.nameDesktop, player.track.name || "Nenhuma faixa");
    setText(elements.nameMobile, player.track.name || "Nenhuma faixa");
    setText(elements.artistDesktop, player.track.artists || "—");
    setText(elements.artistMobile, player.track.artists || "—");

    updateCover(elements.coverDesktop, player.track.cover, false);
    updateCover(elements.coverMobile, player.track.cover, true);
    updatePlayButtons();
    updateRepeatButton(player.repeatState || "off");
    elements.shuffleDesktop?.classList.toggle("active", Boolean(player.shuffleState));

    if (player.device?.name) {
      setText(
        elements.deviceDesktop,
        `${player.device.name}${player.device.type ? ` · ${player.device.type}` : ""}`,
      );
      toggleHidden(elements.deviceDesktop, false);
    } else {
      toggleHidden(elements.deviceDesktop, true);
    }

    const volume = normalizeVolume(player.volume);
    syncVolume(volume);
    renderProgress();
    restartProgressTimer();
    highlightActiveTrack(state.currentTrackId);
  }

  function resetPlayer() {
    state.isPlaying = false;
    state.repeatState = "off";
    state.currentTrackId = null;
    state.currentPlaylistUri = null;
    state.durationMs = 0;
    state.progressMs = 0;
    clearProgressTimer();

    setText(elements.nameDesktop, "Nenhuma faixa");
    setText(elements.nameMobile, "Nenhuma faixa");
    setText(elements.artistDesktop, "—");
    setText(elements.artistMobile, "—");
    updateCover(elements.coverDesktop, "", false);
    updateCover(elements.coverMobile, "", true);
    updatePlayButtons();
    updateRepeatButton("off");
    elements.shuffleDesktop?.classList.remove("active");
    toggleHidden(elements.deviceDesktop, true);
    syncVolume(70);
    renderProgress();
    highlightActiveTrack("");
  }

  function renderProgress() {
    const percentage =
      state.durationMs > 0
        ? Math.min(100, (state.progressMs / state.durationMs) * 100)
        : 0;

    if (elements.progressFillDesktop) {
      elements.progressFillDesktop.style.width = `${percentage}%`;
    }

    setText(elements.timeCurrentDesktop, formatMs(state.progressMs));
    setText(elements.timeTotalDesktop, formatMs(state.durationMs));
  }

  function restartProgressTimer() {
    clearProgressTimer();

    if (!state.isPlaying) {
      return;
    }

    state.progressTimer = window.setInterval(() => {
      state.progressMs = Math.min(state.progressMs + 250, state.durationMs);
      renderProgress();
    }, 250);
  }

  function clearProgressTimer() {
    if (state.progressTimer) {
      window.clearInterval(state.progressTimer);
      state.progressTimer = 0;
    }
  }

  function updatePlayButtons() {
    const label = state.isPlaying ? "⏸" : "▶";
    setText(elements.playDesktop, label);
    setText(elements.playMobile, label);
  }

  function updateRepeatButton(repeatState) {
    state.repeatState = repeatState;

    if (!elements.repeatDesktop) {
      return;
    }

    elements.repeatDesktop.classList.toggle("active", repeatState !== "off");
    elements.repeatDesktop.textContent = repeatState === "track" ? "1" : "↺";
    elements.repeatDesktop.title =
      repeatState === "track"
        ? "Repetindo faixa"
        : repeatState === "context"
          ? "Repetindo playlist"
          : "Repetição desativada";
  }

  function updateCover(container, coverUrl, compact) {
    if (!container) {
      return;
    }

    container.replaceChildren();

    if (!coverUrl) {
      container.textContent = "♪";
      return;
    }

    const image = document.createElement("img");
    image.src = coverUrl;
    image.alt = "Capa da música";

    if (compact) {
      image.className = "sp-cover-mobile-image";
    }

    container.appendChild(image);
  }

  function bindVolumeInput(sourceSlider, sourceLabel, mirroredSlider, mirroredLabel) {
    if (!sourceSlider || !sourceLabel || !mirroredSlider || !mirroredLabel) {
      return;
    }

    sourceSlider.addEventListener("input", () => {
      const volume = normalizeVolume(sourceSlider.value);
      updateVolumeControl(sourceSlider, sourceLabel, volume);
      updateVolumeControl(mirroredSlider, mirroredLabel, volume);

      if (state.volumeTimer) {
        window.clearTimeout(state.volumeTimer);
      }

      state.volumeTimer = window.setTimeout(() => {
        api(`/api/spotify/volume?value=${volume}`, { method: "PUT" });
      }, 300);
    });
  }

  function syncVolume(volume) {
    updateVolumeControl(elements.volumeDesktop, elements.volumeDesktopValue, volume);
    updateVolumeControl(elements.volumeMobile, elements.volumeMobileValue, volume);
  }

  function updateVolumeControl(slider, label, volume) {
    if (!slider || !label) {
      return;
    }

    slider.value = String(volume);
    label.textContent = `${volume}%`;
    slider.style.background = `linear-gradient(90deg, #1DB954 ${volume}%, rgba(169,214,255,0.15) ${volume}%)`;
  }

  function bindPlaylistSelect(sourceSelect, mirroredSelect) {
    if (!sourceSelect || !mirroredSelect) {
      return;
    }

    sourceSelect.addEventListener("change", async () => {
      mirroredSelect.value = sourceSelect.value;
      const selectedOption = sourceSelect.options[sourceSelect.selectedIndex];
      const playlistId = sourceSelect.value;
      const playlistUri = selectedOption?.dataset?.uri || null;

      if (!playlistId || !playlistUri) {
        renderEmptyTracklists("Selecione uma playlist");
        return;
      }

      await loadTracks(playlistId, playlistUri);
    });
  }

  async function loadPlaylists() {
    const result = await api("/api/spotify/playlists");
    if (!result.ok || !Array.isArray(result.data?.playlists)) {
      return;
    }

    renderPlaylistOptions(elements.playlistDesktop, result.data.playlists);
    renderPlaylistOptions(elements.playlistMobile, result.data.playlists);
  }

  function renderPlaylistOptions(select, playlists) {
    if (!select) {
      return;
    }

    const currentValue = select.value;
    select.replaceChildren(createPlaylistPlaceholder());

    for (const playlist of playlists) {
      const option = document.createElement("option");
      option.value = playlist.id;
      option.dataset.uri = playlist.uri;
      option.textContent = `${playlist.name} (${playlist.tracks})`;
      select.appendChild(option);
    }

    if (playlists.some((playlist) => playlist.id === currentValue)) {
      select.value = currentValue;
    }
  }

  function createPlaylistPlaceholder() {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "— selecione uma playlist —";
    return option;
  }

  async function loadTracks(playlistId, playlistUri) {
    state.currentPlaylistUri = playlistUri;
    renderLoadingTracklists();

    const result = await api(`/api/spotify/playlists/${playlistId}/tracks`);
    if (!result.ok || !Array.isArray(result.data?.tracks) || !result.data.tracks.length) {
      renderEmptyTracklists("Playlist vazia");
      return;
    }

    renderTracklists(result.data.tracks);
  }

  function renderLoadingTracklists() {
    replaceTracklistContent(elements.tracklistDesktop, [createStateRow("sp-loading", "Carregando...")]);
    replaceTracklistContent(elements.tracklistMobile, [createStateRow("sp-loading", "Carregando...")]);
  }

  function renderEmptyTracklists(message) {
    replaceTracklistContent(elements.tracklistDesktop, [createStateRow("sp-empty", message)]);
    replaceTracklistContent(elements.tracklistMobile, [createStateRow("sp-empty", message)]);
  }

  function renderTracklists(tracks) {
    replaceTracklistContent(elements.tracklistDesktop, tracks.map((track, index) => createTrackRow(track, index)));
    replaceTracklistContent(elements.tracklistMobile, tracks.map((track, index) => createTrackRow(track, index)));
    highlightActiveTrack(state.currentTrackId);
  }

  function replaceTracklistContent(container, children) {
    if (!container) {
      return;
    }

    container.replaceChildren(...children);
  }

  function createStateRow(className, message) {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = message;
    return element;
  }

  function createTrackRow(track, index) {
    const row = document.createElement("button");
    row.className = "sp-track-row";
    row.type = "button";
    row.dataset.id = track.id;
    row.dataset.index = String(index + 1);
    row.dataset.uri = `spotify:track:${track.id}`;

    const number = document.createElement("div");
    number.className = "sp-track-num";
    number.textContent = String(index + 1);

    const info = document.createElement("div");
    info.className = "sp-track-row-info";

    const name = document.createElement("div");
    name.className = "sp-track-row-name";
    name.textContent = track.name;

    const artist = document.createElement("div");
    artist.className = "sp-track-row-artist";
    artist.textContent = track.artists;

    const duration = document.createElement("div");
    duration.className = "sp-track-row-dur";
    duration.textContent = formatMs(track.durationMs);

    info.append(name, artist);
    row.append(number, info, duration);
    row.addEventListener("click", async () => {
      const result = await api("/api/spotify/play/track", {
        method: "PUT",
        body: {
          contextUri: state.currentPlaylistUri,
          trackUri: row.dataset.uri,
        },
      });

      if (result.ok) {
        window.setTimeout(refreshStatusOnly, 600);
      }
    });

    return row;
  }

  function highlightActiveTrack(trackId) {
    document.querySelectorAll(".sp-track-row").forEach((row) => {
      const isActive = row.dataset.id === trackId;
      row.classList.toggle("active", isActive);

      const number = row.querySelector(".sp-track-num");
      if (!number) {
        return;
      }

      number.textContent = isActive ? "▶" : row.dataset.index || "";
    });
  }

  async function togglePlay() {
    const path = state.isPlaying ? "/api/spotify/pause" : "/api/spotify/play";
    const result = await api(path, { method: "PUT" });

    if (result.ok) {
      state.isPlaying = !state.isPlaying;
      updatePlayButtons();
      restartProgressTimer();
      window.setTimeout(refreshStatusOnly, 600);
    }
  }

  async function controlAndRefresh(method, path) {
    const result = await api(path, { method });
    if (result.ok) {
      window.setTimeout(refreshStatusOnly, 600);
    }
  }

  async function api(path, options = {}) {
    const method = options.method || "GET";
    const body = options.body;
    const headers = {
      "x-crono-admin-token": adminToken,
      "x-crono-session-id": sessionId,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    };

    try {
      const response = await fetch(path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();

      return {
        ok: response.ok,
        status: response.status,
        data: parseResponseBody(text),
      };
    } catch {
      return {
        ok: false,
        status: 0,
        data: null,
      };
    }
  }

  function parseResponseBody(text) {
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function toggleHidden(element, hidden) {
    if (element) {
      element.hidden = hidden;
    }
  }

  function setAuthButtonsDisabled(disabled) {
    for (const button of authButtons) {
      button.disabled = disabled;
    }
  }

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function formatMs(value) {
    const safeValue = sanitizeMs(value);
    const totalSeconds = Math.floor(safeValue / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function sanitizeMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.max(0, Math.trunc(parsed));
  }

  function normalizeVolume(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
      return 70;
    }

    return Math.min(100, Math.max(0, parsed));
  }

  function getNextRepeatState(value) {
    if (value === "off") {
      return "context";
    }

    if (value === "context") {
      return "track";
    }

    return "off";
  }

  function isValidSessionId(value) {
    return typeof value === "string" && /^[a-f0-9]{8}$/i.test(value);
  }

  function isValidAdminToken(value) {
    return typeof value === "string" && /^[a-f0-9]{36}$/i.test(value);
  }
})();
