const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { describe, it } = require("node:test");

const {
  getBranchFromRef,
  isAllowedOrigin,
  isValidWebhookSignature,
  parseWebhookPayload,
  tokensMatch,
} = require("../src/security");

describe("getBranchFromRef", () => {
  it("extrai o branch de um ref simples", () => {
    assert.equal(getBranchFromRef("refs/heads/main"), "main");
  });

  it("preserva branches com barras", () => {
    assert.equal(getBranchFromRef("refs/heads/feature/login"), "feature/login");
  });

  it("retorna null para refs invalidos ou nao-string", () => {
    assert.equal(getBranchFromRef("invalid"), null);
    assert.equal(getBranchFromRef(123), null);
    assert.equal(getBranchFromRef(null), null);
  });
});

describe("parseWebhookPayload", () => {
  it("converte um Buffer JSON em objeto", () => {
    const payload = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
    assert.deepEqual(parseWebhookPayload(payload), { ref: "refs/heads/main" });
  });

  it("retorna null para entrada nao-Buffer", () => {
    assert.equal(parseWebhookPayload("{}"), null);
  });

  it("retorna null para JSON invalido", () => {
    assert.equal(parseWebhookPayload(Buffer.from("nao-json")), null);
  });
});

describe("tokensMatch", () => {
  const isValid = (value) =>
    typeof value === "string" && /^[a-f0-9]{36}$/i.test(value);
  const token = "a".repeat(36);

  it("aceita tokens iguais e validos", () => {
    assert.equal(tokensMatch(token, token, isValid), true);
  });

  it("rejeita tokens diferentes", () => {
    assert.equal(tokensMatch(token, "b".repeat(36), isValid), false);
  });

  it("rejeita quando algum token e invalido", () => {
    assert.equal(tokensMatch(token, "curto", isValid), false);
    assert.equal(tokensMatch(null, token, isValid), false);
  });
});

describe("isValidWebhookSignature", () => {
  const secret = "segredo-de-teste";
  const payload = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
  const signature =
    "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  it("aceita uma assinatura HMAC valida", () => {
    assert.equal(isValidWebhookSignature(signature, payload, secret), true);
  });

  it("rejeita assinatura incorreta", () => {
    assert.equal(
      isValidWebhookSignature("sha256=" + "0".repeat(64), payload, secret),
      false,
    );
  });

  it("rejeita quando faltam dados obrigatorios", () => {
    assert.equal(isValidWebhookSignature(signature, payload, ""), false);
    assert.equal(isValidWebhookSignature(null, payload, secret), false);
    assert.equal(isValidWebhookSignature(signature, "nao-buffer", secret), false);
  });
});

describe("isAllowedOrigin", () => {
  it("permite quando nao ha header de origem", () => {
    assert.equal(isAllowedOrigin(undefined, "localhost:3000", null), true);
  });

  it("compara contra APP_ORIGIN quando definido", () => {
    const allowed = "https://app.exemplo.com";
    assert.equal(isAllowedOrigin("https://app.exemplo.com", "x", allowed), true);
    assert.equal(isAllowedOrigin("https://evil.com", "x", allowed), false);
  });

  it("sem APP_ORIGIN, exige que origin e host coincidam", () => {
    assert.equal(
      isAllowedOrigin("http://localhost:3000", "localhost:3000", null),
      true,
    );
    assert.equal(
      isAllowedOrigin("http://outro:3000", "localhost:3000", null),
      false,
    );
  });

  it("rejeita origin malformado", () => {
    assert.equal(isAllowedOrigin("nao-e-url", "localhost:3000", null), false);
  });
});
