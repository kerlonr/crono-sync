(() => {
  const DEFAULT_FINISH_SOUND = "/assets/audio/trompeta.mp3";
  const UNLOCK_EVENTS = ["click", "keydown", "pointerdown", "touchstart"];

  window.CronoFinishSound = {
    create(src = DEFAULT_FINISH_SOUND) {
      const audio = new Audio(src);
      audio.preload = "auto";

      const unlock = () => {
        removeUnlockListeners();

        const wasMuted = audio.muted;
        audio.muted = true;

        const playAttempt = audio.play();
        if (playAttempt && typeof playAttempt.then === "function") {
          playAttempt
            .then(() => {
              audio.pause();
              resetAudio(audio);
              audio.muted = wasMuted;
            })
            .catch(() => {
              audio.muted = wasMuted;
            });
          return;
        }

        audio.muted = wasMuted;
      };

      const addUnlockListeners = () => {
        for (const eventName of UNLOCK_EVENTS) {
          window.addEventListener(eventName, unlock, {
            once: true,
            passive: true,
          });
        }
      };

      function removeUnlockListeners() {
        for (const eventName of UNLOCK_EVENTS) {
          window.removeEventListener(eventName, unlock);
        }
      }

      addUnlockListeners();

      return {
        play() {
          audio.muted = false;
          audio.pause();
          resetAudio(audio);

          const playAttempt = audio.play();
          if (playAttempt && typeof playAttempt.catch === "function") {
            playAttempt.catch(() => {});
          }
        },
      };
    },
  };

  function resetAudio(audio) {
    try {
      audio.currentTime = 0;
    } catch {
      // The browser may reject seeking before metadata is loaded.
    }
  }
})();
