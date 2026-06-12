/**
 * Utilidades compartilhadas entre as telas (admin, viewer e overview).
 *
 * Concentra a formatacao de tempo, a sanitizacao de valores recebidos do
 * servidor e as validacoes de identidade da sessao, evitando que cada tela
 * mantenha sua propria copia dessas funcoes.
 *
 * Exposto em `window.CronoUtils` porque o projeto carrega scripts simples
 * (IIFE, sem bundler) e mantem CSP `script-src 'self'`.
 */
(() => {
  const SESSION_ID_PATTERN = /^[a-f0-9]{8}$/i;
  const ADMIN_TOKEN_PATTERN = /^[a-f0-9]{36}$/i;

  /**
   * Formata milissegundos como `HH:MM:SS`, arredondando para cima para que o
   * ultimo segundo so desapareca quando o tempo realmente zera.
   * @param {number} ms
   * @returns {string}
   */
  function formatTime(ms) {
    const totalSeconds = Math.ceil(Math.max(0, sanitizeMs(ms)) / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  /**
   * Converte um valor desconhecido em milissegundos validos (inteiro >= 0).
   * @param {unknown} value
   * @returns {number}
   */
  function sanitizeMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed));
  }

  /**
   * Limita um percentual ao intervalo [0, 1]; usa 1 como padrao seguro.
   * @param {unknown} value
   * @returns {number}
   */
  function sanitizePct(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(1, Math.max(0, parsed));
  }

  /**
   * Mapeia o percentual restante para a fase visual do cronometro.
   * @param {number} pct
   * @returns {"blink"|"red"|"yellow"|"green"}
   */
  function getPhase(pct) {
    const safePct = sanitizePct(pct);
    if (safePct <= 0.1) return "blink";
    if (safePct <= 0.2) return "red";
    if (safePct <= 0.4) return "yellow";
    return "green";
  }

  /**
   * @param {unknown} value
   * @returns {boolean} `true` se for um id de sessao valido.
   */
  function isValidSessionId(value) {
    return typeof value === "string" && SESSION_ID_PATTERN.test(value);
  }

  /**
   * @param {unknown} value
   * @returns {boolean} `true` se for um token de admin valido.
   */
  function isValidAdminToken(value) {
    return typeof value === "string" && ADMIN_TOKEN_PATTERN.test(value);
  }

  window.CronoUtils = Object.freeze({
    formatTime,
    getPhase,
    isValidAdminToken,
    isValidSessionId,
    sanitizeMs,
    sanitizePct,
  });
})();
