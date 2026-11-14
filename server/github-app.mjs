import { createHmac, createSign, timingSafeEqual } from "node:crypto";
const requiredSettings = [
  ["GITHUB_APP_ID", "appId"],
  ["GITHUB_APP_CLIENT_ID", "clientId"],
  ["GITHUB_APP_CLIENT_SECRET", "clientSecret"],
  ["GITHUB_APP_PRIVATE_KEY", "privateKey"],
  ["GITHUB_APP_SLUG", "appSlug"],
  ["AUTH_SESSION_SECRET", "sessionSecret"],
  ["APP_ORIGIN", "appOrigin"]
];
function parseGithubAppConfig(environment) {
  const result = {};
  for (const [environmentName, configName] of requiredSettings) {
    const value = environment[environmentName]?.trim();
    if (!value) throw new Error(`\u7F3A\u5C11 GitHub App \u914D\u7F6E\uFF1A${environmentName}`);
    result[configName] = configName === "privateKey" ? value.replaceAll("\\n", "\n") : value;
  }
  return result;
}
function appJwtClaims(appId, now = Date.now()) {
  const issuedAt = Math.floor(now / 1e3) - 60;
  return { iat: issuedAt, exp: issuedAt + 600, iss: appId };
}
function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}
function createGithubAppJwt(config, now = Date.now()) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify(appJwtClaims(config.appId, now)));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(config.privateKey).toString("base64url")}`;
}
function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function createSignedState(input, secret, now = Date.now()) {
  const payload = base64Url(JSON.stringify({ ...input, expiresAt: now + 10 * 6e4 }));
  return `${payload}.${sign(payload, secret)}`;
}
function readSignedState(value, secret, now = Date.now()) {
  const [payload, signature, extra] = value?.split(".") || [];
  if (!payload || !signature || extra || !safeEquals(signature, sign(payload, secret))) throw new Error("\u65E0\u6548\u7684 GitHub \u6388\u6743\u72B6\u6001");
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!state.nonce || !state.returnTo || typeof state.expiresAt !== "number") throw new Error("invalid state");
    if (state.expiresAt < now) throw new Error("expired state");
    return state;
  } catch (error) {
    if (error instanceof Error && error.message === "expired state") throw new Error("GitHub \u6388\u6743\u5DF2\u8FC7\u671F");
    throw new Error("\u65E0\u6548\u7684 GitHub \u6388\u6743\u72B6\u6001");
  }
}
function createSignedSession(input, secret, now = Date.now()) {
  const payload = base64Url(JSON.stringify({ ...input, expiresAt: now + 7 * 24 * 60 * 6e4 }));
  return `${payload}.${sign(payload, secret)}`;
}
function readSignedSession(value, secret, now = Date.now()) {
  const [payload, signature, extra] = value?.split(".") || [];
  if (!payload || !signature || extra || !safeEquals(signature, sign(payload, secret))) throw new Error("\u65E0\u6548\u7684 GitHub \u4F1A\u8BDD");
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!session.login || typeof session.expiresAt !== "number") throw new Error("invalid session");
    if (session.expiresAt < now) throw new Error("expired session");
    return session;
  } catch (error) {
    if (error instanceof Error && error.message === "expired session") throw new Error("GitHub \u4F1A\u8BDD\u5DF2\u8FC7\u671F");
    throw new Error("\u65E0\u6548\u7684 GitHub \u4F1A\u8BDD");
  }
}
export {
  appJwtClaims,
  createGithubAppJwt,
  createSignedSession,
  createSignedState,
  parseGithubAppConfig,
  readSignedSession,
  readSignedState
};
