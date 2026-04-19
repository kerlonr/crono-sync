const { createHmac, timingSafeEqual } = require("crypto");

module.exports = {
  getBranchFromRef,
  isAllowedOrigin,
  isValidWebhookSignature,
  parseWebhookPayload,
  tokensMatch,
};

function isAllowedOrigin(originHeader, requestHost, allowedOrigin) {
  if (!originHeader) {
    return true;
  }

  try {
    const requestOrigin = new URL(originHeader).origin;

    if (allowedOrigin) {
      return requestOrigin === allowedOrigin;
    }

    return new URL(`http://${requestHost}`).host === new URL(requestOrigin).host;
  } catch {
    return false;
  }
}

function tokensMatch(expected, received, isValidToken) {
  if (!isValidToken(expected) || !isValidToken(received)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isValidWebhookSignature(signature, payload, secret) {
  if (typeof signature !== "string" || !Buffer.isBuffer(payload) || !secret) {
    return false;
  }

  const digest = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  return timingSafeCompareString(signature, digest);
}

function timingSafeCompareString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseWebhookPayload(payload) {
  if (!Buffer.isBuffer(payload)) {
    return null;
  }

  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
}

function getBranchFromRef(ref) {
  if (typeof ref !== "string") {
    return null;
  }

  const parts = ref.split("/");
  return parts.length >= 3 ? parts.slice(2).join("/") : null;
}
