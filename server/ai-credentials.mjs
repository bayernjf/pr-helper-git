import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
const VERSION = "v1";
const IV_BYTES = 12;
function parseIpv6Groups(ip) {
  const normalized = ip.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const parts = normalized.slice(lastColon + 1).split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = (parts[0] << 8 | parts[1]).toString(16);
    const lo = (parts[2] << 8 | parts[3]).toString(16);
    return parseIpv6Groups(`${normalized.slice(0, lastColon)}:${hi}:${lo}`);
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (left.length + right.length > 8) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const parsed = groups.map((g) => parseInt(g, 16));
  return parsed.some((n) => Number.isNaN(n) || n < 0 || n > 65535) ? null : parsed;
}
function isPrivateIpv4(parts) {
  const [a, b] = parts;
  return a === 0 || // 0.0.0.0/8
  a === 10 || // 10/8
  a === 127 || // loopback
  a === 100 && b >= 64 && b <= 127 || // CGNAT 100.64/10
  a === 169 && b === 254 || // link-local (cloud metadata)
  a === 172 && b >= 16 && b <= 31 || // 172.16/12, all sixteen blocks
  a === 192 && b === 168 || // 192.168/16
  a === 192 && b === 0 || // 192.0.0.0/24 + 192.0.2.0/24
  a === 198 && (b === 18 || b === 19) || // 198.18/15 benchmarking
  a === 198 && b === 51 || // 198.51.100/24 documentation
  a === 203 && b === 0 || // 203.0.113/24 documentation
  a >= 224;
}
function isPrivateIpLiteral(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIpv4(host.split(".").map(Number));
  if (!host.includes(":")) return null;
  const groups = parseIpv6Groups(host);
  if (!groups) return true;
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 65535;
  const isNat64 = groups[0] === 100 && groups[1] === 65435 && groups.slice(2, 6).every((g) => g === 0);
  if (isMapped || isNat64) return isPrivateIpv4([groups[6] >> 8 & 255, groups[6] & 255, groups[7] >> 8 & 255, groups[7] & 255]);
  if (groups.every((g) => g === 0)) return true;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  if ((groups[0] & 65472) === 65152) return true;
  if ((groups[0] & 65024) === 64512) return true;
  if ((groups[0] & 65280) === 65280) return true;
  if (groups[0] === 8193 && groups[1] === 3512) return true;
  return false;
}
function validateAiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AI Base URL \u5FC5\u987B\u662F\u6709\u6548\u7684 HTTPS \u5730\u5740");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local")) throw new Error("AI Base URL \u53EA\u5141\u8BB8\u516C\u7F51 HTTPS \u5730\u5740");
  const literal = isPrivateIpLiteral(host);
  if (literal === true) throw new Error("AI Base URL \u53EA\u5141\u8BB8\u516C\u7F51 HTTPS \u5730\u5740");
  return url.toString().replace(/\/$/, "");
}
function masterKey(environment) {
  const raw = environment.AI_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("\u672A\u914D\u7F6E AI_CREDENTIALS_ENCRYPTION_KEY");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY \u5FC5\u987B\u662F 32 \u5B57\u8282 hex \u6216 base64");
  return key;
}
function encryptAiApiKey(environment, apiKey) {
  const key = masterKey(environment);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return `${VERSION}:${iv.toString("base64url")}:${ciphertext.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`;
}
function decryptAiApiKey(environment, value) {
  const [version, ivEncoded, ciphertextEncoded, tagEncoded] = value.split(":");
  if (version !== VERSION || !ivEncoded || !ciphertextEncoded || !tagEncoded) throw new Error("AI \u51ED\u636E\u5BC6\u6587\u683C\u5F0F\u65E0\u6548");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(environment), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
}
function credentialKeyHint(apiKey) {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
}
function maskAiApiKey(apiKey) {
  if (apiKey.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return `${apiKey.slice(0, 3)}\u2022\u2022\u2022\u2022${apiKey.slice(-4)}`;
}
export {
  credentialKeyHint,
  decryptAiApiKey,
  encryptAiApiKey,
  maskAiApiKey,
  validateAiBaseUrl
};
