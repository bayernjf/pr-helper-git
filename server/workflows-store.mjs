// docs/archive/pr-helper-source/api/_lib/workflows-store.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import postgres from "postgres";

// docs/archive/pr-helper-source/api/_lib/github-api.ts
import { AsyncLocalStorage } from "node:async_hooks";

// docs/archive/pr-helper-source/api/_lib/github-app.ts
import { createHmac, createSign, timingSafeEqual } from "node:crypto";
var requiredSettings = [
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

// docs/archive/pr-helper-source/api/_lib/github-api.ts
var githubApi = "https://api.github.com";
var GITHUB_REQUEST_TIMEOUT_MS = 15e3;
var INSTALLATION_TOKEN_REFRESH_BUFFER_MS = 6e4;
var installationTokenCache = /* @__PURE__ */ new Map();
var installationTokenRequests = /* @__PURE__ */ new Map();
var MAX_INSTALLATION_TOKEN_CACHE_ENTRIES = 500;
function cacheInstallationToken(key, entry) {
  if (entry.expiresAt <= Date.now() + INSTALLATION_TOKEN_REFRESH_BUFFER_MS) return;
  installationTokenCache.delete(key);
  installationTokenCache.set(key, entry);
  if (installationTokenCache.size <= MAX_INSTALLATION_TOKEN_CACHE_ENTRIES) return;
  const cutoff = Date.now() + INSTALLATION_TOKEN_REFRESH_BUFFER_MS;
  for (const [k, v] of installationTokenCache) {
    if (v.expiresAt <= cutoff) installationTokenCache.delete(k);
  }
  while (installationTokenCache.size > MAX_INSTALLATION_TOKEN_CACHE_ENTRIES) {
    const oldest = installationTokenCache.keys().next().value;
    if (oldest === void 0) break;
    installationTokenCache.delete(oldest);
  }
}
var callStats = new AsyncLocalStorage();
async function trackGitHubCalls(run) {
  const stats = { calls: 0, totalMs: 0, slowest: null, etagStable: 0, etagChanged: 0, etagFirstSeen: 0 };
  const value = await callStats.run(stats, run);
  return { value, stats };
}
var etagMemo = /* @__PURE__ */ new Map();
var ETAG_MEMO_MAX = 4096;
function noteEtag(path, etag, stats) {
  if (!etag) return;
  if (etagMemo.size >= ETAG_MEMO_MAX) etagMemo.clear();
  const previous = etagMemo.get(path);
  etagMemo.set(path, etag);
  if (!stats) return;
  if (previous === void 0) stats.etagFirstSeen += 1;
  else if (previous === etag) stats.etagStable += 1;
  else stats.etagChanged += 1;
}
var GitHubApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "GitHubApiError";
  }
};
function requestSignal(signal) {
  const timeout = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  return { timeout, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}
async function githubResponse(path, token, init) {
  const stats = callStats.getStore();
  const startedAt = stats ? performance.now() : 0;
  try {
    return await githubFetch(path, token, init);
  } finally {
    if (stats) {
      const ms = Math.round(performance.now() - startedAt);
      stats.calls += 1;
      stats.totalMs += ms;
      if (!stats.slowest || ms > stats.slowest.ms) stats.slowest = { path, ms };
    }
  }
}
async function githubFetch(path, token, init) {
  const { timeout, signal } = requestSignal(init?.signal);
  let response;
  try {
    response = await fetch(`${githubApi}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init?.headers
      }
    });
  } catch (error) {
    if (timeout.aborted) throw new Error("GitHub \u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    throw error;
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ message: response.statusText }));
    throw new GitHubApiError(response.status, detail.message || `GitHub \u8BF7\u6C42\u5931\u8D25 (${response.status})`);
  }
  if ((init?.method ?? "GET") === "GET") noteEtag(path, response.headers.get("etag"), callStats.getStore());
  if (response.status === 204 || response.headers.get("content-length") === "0") return {};
  return response.json();
}
function githubAppRequest(config, path, init) {
  return githubResponse(path, createGithubAppJwt(config), init);
}
async function installationAccessToken(config, installationId) {
  const key = `${config.appId}:${installationId}`;
  const cached = installationTokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + INSTALLATION_TOKEN_REFRESH_BUFFER_MS) return cached.token;
  if (cached) installationTokenCache.delete(key);
  const inFlight = installationTokenRequests.get(key);
  if (inFlight) return inFlight;
  const request = githubAppRequest(config, `/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: "POST" }).then((result) => {
    const expiresAt = Date.parse(result.expires_at || "") || Date.now() + 55 * 6e4;
    cacheInstallationToken(key, { token: result.token, expiresAt });
    return result.token;
  }).finally(() => installationTokenRequests.delete(key));
  installationTokenRequests.set(key, request);
  return request;
}
function installationRequest(config, installationId, path, init) {
  return installationAccessToken(config, installationId).then((token) => githubResponse(path, token, init));
}

// docs/archive/pr-helper-source/api/_lib/push.ts
import { createRequire } from "node:module";
const webpush = createRequire(import.meta.url)("web-push");
function vapid(environment) {
  const publicKey = environment.VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.VAPID_PRIVATE_KEY?.trim();
  const subject = environment.VAPID_SUBJECT?.trim() || "mailto:admin@pr-helper.app";
  if (!publicKey || !privateKey) return null;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return publicKey;
}
async function sendPushNotifications(environment, sql, userId, event) {
  if (!vapid(environment)) return 0;
  const recorded = await sql`INSERT INTO pr_helper_notification_deliveries (user_id, event_key, kind, title, body) VALUES (${userId}, ${event.eventKey}, ${event.kind}, ${event.title}, ${event.body}) ON CONFLICT (user_id, event_key) DO NOTHING RETURNING id`;
  if (!recorded.length) return 0;
  const subscriptions = await sql`SELECT endpoint, subscription FROM pr_helper_push_subscriptions WHERE user_id = ${userId}`;
  const payload = JSON.stringify({ title: event.title, body: event.body, url: event.url || "/" });
  const results = await Promise.allSettled(subscriptions.map((item) => webpush.sendNotification(item.subscription, payload)));
  const expired = results.flatMap((result, index) => result.status === "rejected" && [404, 410].includes(result.reason.statusCode || 0) ? [subscriptions[index].endpoint] : []);
  if (expired.length) await sql`DELETE FROM pr_helper_push_subscriptions WHERE endpoint = ANY(${expired})`;
  return results.filter((result) => result.status === "fulfilled").length;
}

// docs/archive/pr-helper-source/src/lib/team-permissions.ts
var roleOperations = {
  owner: ["workflow-view", "workflow-edit", "workflow-delete", "pr-create", "actions-rerun", "pull-merge", "deployment-rollback", "team-manage"],
  editor: ["workflow-view", "workflow-edit", "pr-create", "actions-rerun"],
  operator: ["workflow-view", "pr-create", "actions-rerun"],
  viewer: ["workflow-view"]
};
function canPerformTeamOperation(role, operation, environment = "preview") {
  if (!role || !roleOperations[role].includes(operation)) return false;
  if (environment === "production" && (operation === "pull-merge" || operation === "deployment-rollback")) return role === "owner";
  return true;
}
function teamRoleLabel(role) {
  return { owner: "Owner", editor: "Editor", operator: "Operator", viewer: "Viewer" }[role];
}
var operationLabel = {
  "workflow-view": "\u67E5\u770B\u6D41\u7A0B",
  "workflow-edit": "\u7F16\u8F91\u6D41\u7A0B",
  "workflow-delete": "\u5220\u9664\u6D41\u7A0B",
  "pr-create": "\u521B\u5EFA PR",
  "actions-rerun": "\u91CD\u8DD1 Actions",
  "pull-merge": "\u5408\u5E76 PR",
  "deployment-rollback": "\u90E8\u7F72\u56DE\u6EDA",
  "team-manage": "\u7BA1\u7406\u56E2\u961F"
};
function assertTeamOperation(role, operation, environment = "preview") {
  if (canPerformTeamOperation(role, operation, environment)) return;
  if (!role) throw new Error("\u672A\u83B7\u5F97\u5171\u4EAB\u6D41\u7A0B\u8BBF\u95EE\u6743\u9650");
  throw new Error(`\u56E2\u961F\u89D2\u8272 ${teamRoleLabel(role)} \u65E0\u6743\u6267\u884C${operationLabel[operation]}`);
}

// docs/archive/pr-helper-source/src/lib/domain.ts
function summarizeChecks(checks) {
  const passed = checks.filter((check) => ["success", "skipped", "neutral"].includes(check.conclusion || "")).length;
  const hasFailure = checks.some((check) => ["failure", "cancelled", "timed_out", "action_required"].includes(check.conclusion || ""));
  return { state: hasFailure ? "failure" : passed === checks.length && checks.length > 0 ? "success" : "pending", passed, total: checks.length };
}
function summarizeGitHubChecks(checkRuns, commitStatuses) {
  const legacyChecks = commitStatuses.map((status) => ({
    status: status.state === "pending" ? "in_progress" : "completed",
    conclusion: status.state === "success" ? "success" : ["failure", "error"].includes(status.state) ? "failure" : null
  }));
  return summarizeChecks([...checkRuns, ...legacyChecks]);
}

// docs/archive/pr-helper-source/api/_lib/ai-credentials.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
var VERSION = "v1";
var IV_BYTES = 12;
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

// docs/archive/pr-helper-source/src/lib/ai.ts
function aiChatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}
async function testAiConnection(config, signal) {
  const response = await fetch(aiChatCompletionsUrl(config.baseUrl), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, temperature: 0 }), signal: signal || AbortSignal.timeout(15e3) });
  if (!response.ok) throw new Error(`\u8FDE\u63A5\u5931\u8D25 (${response.status})`);
}
function buildPrPrompt(source, target, commits, generationRule = "") {
  const changes = commits.map((commit) => `- ${commit}`).join("\n");
  const rule = generationRule.trim();
  const ruleInstruction = rule ? `

\u8BF7\u9075\u5FAA\u4EE5\u4E0B Markdown \u751F\u6210\u89C4\u5219\uFF1A
${rule}` : "";
  return `\u4E3A GitHub Pull Request \u751F\u6210\u7B80\u6D01\u7684\u4E2D\u6587\u6807\u9898\u548C\u63CF\u8FF0\u3002\u5206\u652F\uFF1A${source} \u2192 ${target}\u3002\u63D0\u4EA4\uFF1A
${changes}${ruleInstruction}
\u4EC5\u8FD4\u56DE JSON\uFF1A{"title":"...","body":"..."}\u3002`;
}

// docs/archive/pr-helper-source/api/_lib/workflow-rows.ts
function automationColumns(automation) {
  const rule = automation?.generationRule;
  return {
    auto_create: automation ? automation.autoCreatePullRequest === true : null,
    auto_merge: automation ? automation.autoMergePullRequest === true : null,
    execution_mode: automation?.executionMode ?? null,
    trigger_min_commits: automation?.triggerMinCommits ?? null,
    rule_name: rule?.name ?? null,
    rule_captured_at: rule?.capturedAt ?? null,
    rule_content_hash: rule?.contentHash ?? null
  };
}
function workflowToRows(userId, workflow) {
  return {
    workflow: {
      user_id: userId,
      id: workflow.id,
      name: workflow.name,
      repository: workflow.repository,
      archived: workflow.archived === true,
      muted: workflow.muted === true,
      version: workflow.version ?? null,
      position: workflow.position ?? null,
      declared_created_at: workflow.createdAt ?? null,
      recovery_max_retries: workflow.recoveryPolicy?.maxRetries ?? null,
      recovery_cooldown_seconds: workflow.recoveryPolicy?.cooldownSeconds ?? null
    },
    stages: workflow.stages.map((stage, stage_index) => ({
      user_id: userId,
      workflow_id: workflow.id,
      stage_id: stage.stageId,
      stage_index,
      source_rule: stage.source,
      target: stage.target,
      independent: stage.independent ?? null,
      wait_for: stage.waitFor ?? null,
      ...automationColumns(stage.automation)
    })),
    deployments: (workflow.deployments || []).map((deployment, position) => ({
      user_id: userId,
      workflow_id: workflow.id,
      position,
      target: deployment.target,
      provider: deployment.provider,
      workflow_name: deployment.workflowName,
      environment: deployment.environment,
      github_environment: deployment.githubEnvironment ?? null,
      health_check_path: deployment.healthCheckPath ?? null,
      rollback_workflow_name: deployment.rollbackWorkflowName ?? null
    }))
  };
}
function automationFromRow(row) {
  if (!row.execution_mode) return void 0;
  if (row.execution_mode === "browser-session") {
    return { autoCreatePullRequest: true, executionMode: "browser-session", ...row.trigger_min_commits === null ? {} : { triggerMinCommits: row.trigger_min_commits } };
  }
  if (!row.auto_create) return { autoMergePullRequest: true, executionMode: "server" };
  return {
    autoCreatePullRequest: true,
    ...row.auto_merge ? { autoMergePullRequest: true } : {},
    executionMode: "server",
    ...row.trigger_min_commits === null ? {} : { triggerMinCommits: row.trigger_min_commits },
    generationRule: { name: row.rule_name || "", capturedAt: row.rule_captured_at || "", ...row.rule_content_hash ? { contentHash: row.rule_content_hash } : {} }
  };
}
function stageFromRow(row) {
  const automation = automationFromRow(row);
  return {
    source: row.source_rule,
    target: row.target,
    ...row.independent === null ? {} : { independent: row.independent },
    ...row.wait_for === null ? {} : { waitFor: row.wait_for },
    stageId: row.stage_id,
    ...automation ? { automation } : {}
  };
}
function deploymentFromRow(row) {
  return {
    target: row.target,
    provider: row.provider,
    workflowName: row.workflow_name,
    environment: row.environment,
    ...row.github_environment === null ? {} : { githubEnvironment: row.github_environment },
    ...row.health_check_path === null ? {} : { healthCheckPath: row.health_check_path },
    ...row.rollback_workflow_name === null ? {} : { rollbackWorkflowName: row.rollback_workflow_name }
  };
}
function workflowFromRows(rows) {
  const { workflow } = rows;
  const deployments = [...rows.deployments].sort((left, right) => left.position - right.position).map(deploymentFromRow);
  return {
    id: workflow.id,
    name: workflow.name,
    repository: workflow.repository,
    stages: [...rows.stages].sort((left, right) => left.stage_index - right.stage_index).map(stageFromRow),
    ...workflow.declared_created_at === null ? {} : { createdAt: workflow.declared_created_at },
    ...deployments.length ? { deployments } : {},
    ...workflow.position === null ? {} : { position: workflow.position },
    ...workflow.recovery_max_retries === null || workflow.recovery_cooldown_seconds === null ? {} : { recoveryPolicy: { maxRetries: workflow.recovery_max_retries, cooldownSeconds: workflow.recovery_cooldown_seconds } },
    ...workflow.version === null ? {} : { version: workflow.version },
    ...workflow.archived ? { archived: true } : {},
    ...workflow.muted ? { muted: true } : {}
  };
}

// docs/archive/pr-helper-source/api/_lib/workflows-store.ts
async function getAiAutomationCredential(environment, identity) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const rows = await query(environment)`SELECT base_url, model, key_hint, ciphertext, auto_generate_pr_message, auto_confirm_pr_creation, updated_at, last_used_at FROM pr_helper_ai_automation_credentials WHERE user_id = ${user.id}`;
  const row = rows[0];
  if (!row) return { configured: false, baseUrl: null, model: null, keyHint: null, keyMask: null, autoGeneratePrMessage: false, autoConfirmPrCreation: false, updatedAt: null, lastUsedAt: null };
  let keyMask = null;
  try {
    keyMask = maskAiApiKey(decryptAiApiKey(environment, row.ciphertext));
  } catch {
    keyMask = null;
  }
  return { configured: Boolean(keyMask), baseUrl: row.base_url, model: row.model, keyHint: row.key_hint, keyMask, autoGeneratePrMessage: row.auto_generate_pr_message, autoConfirmPrCreation: row.auto_confirm_pr_creation, updatedAt: row.updated_at, lastUsedAt: row.last_used_at };
}
async function saveAiAutomationCredential(environment, identity, input) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const ciphertext = encryptAiApiKey(environment, input.apiKey);
  const hint = credentialKeyHint(input.apiKey);
  await query(environment)`INSERT INTO pr_helper_ai_automation_credentials (user_id, base_url, model, ciphertext, key_version, key_hint, auto_generate_pr_message, auto_confirm_pr_creation) VALUES (${user.id}, ${input.baseUrl}, ${input.model}, ${ciphertext}, ${"v1"}, ${hint}, ${input.autoGeneratePrMessage}, ${input.autoConfirmPrCreation}) ON CONFLICT (user_id) DO UPDATE SET base_url = EXCLUDED.base_url, model = EXCLUDED.model, ciphertext = EXCLUDED.ciphertext, key_version = EXCLUDED.key_version, key_hint = EXCLUDED.key_hint, auto_generate_pr_message = EXCLUDED.auto_generate_pr_message, auto_confirm_pr_creation = EXCLUDED.auto_confirm_pr_creation, updated_at = now()`;
  return getAiAutomationCredential(environment, identity);
}
async function readAiAutomationCredential(environment, identity) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  return readAiAutomationCredentialForUser(environment, user.id);
}
async function testSavedAiAutomationCredential(environment, identity) {
  const credential = await readAiAutomationCredential(environment, identity);
  if (!credential) throw new Error("\u5C1A\u672A\u914D\u7F6E\u670D\u52A1\u7AEF AI \u51ED\u636E");
  await testAiConnection(credential, AbortSignal.timeout(15e3));
  return { ok: true, baseUrl: credential.baseUrl, model: credential.model };
}
async function readAiAutomationCredentialForUser(environment, userId) {
  const rows = await query(environment)`SELECT base_url, model, ciphertext, auto_generate_pr_message, auto_confirm_pr_creation FROM pr_helper_ai_automation_credentials WHERE user_id = ${userId}`;
  const row = rows[0];
  return row ? { baseUrl: row.base_url, model: row.model, apiKey: decryptAiApiKey(environment, row.ciphertext), autoGeneratePrMessage: row.auto_generate_pr_message, autoConfirmPrCreation: row.auto_confirm_pr_creation } : null;
}
async function deleteAiAutomationCredential(environment, identity) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  await query(environment)`DELETE FROM pr_helper_ai_automation_credentials WHERE user_id = ${user.id}`;
}
async function enqueueWorkflowAutomationAction(environment, identity, input) {
  if (!input.workflowId || !input.source || !input.idempotencyKey || !Number.isInteger(input.stageIndex) || input.stageIndex < 0) throw new Error("\u65E0\u6548\u7684\u81EA\u52A8\u5316\u52A8\u4F5C");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await requireWorkflowOperation(sql, user.id, input.workflowId, "workflow-edit");
  const workflow = access.workflow;
  const stage = workflow ? stageForIndex(workflow, input.stageIndex) : void 0;
  if (!workflow || !stage || !stage.stageId || !branchRuleMatches(stage.source, input.source)) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B\u6B65\u9AA4");
  if (workflow.archived) throw new Error("\u6D41\u7A0B\u5DF2\u5F52\u6863\uFF0C\u8BF7\u5148\u6062\u590D\u540E\u518D\u6267\u884C\u81EA\u52A8\u5316");
  if (input.kind === "create-pr" && stage.automation?.autoCreatePullRequest !== true) throw new Error("\u5F53\u524D\u6B65\u9AA4\u672A\u5F00\u542F\u81EA\u52A8\u521B\u5EFA PR");
  const generationRule = input.kind === "create-pr" && stage.automation?.autoCreatePullRequest === true && stage.automation.executionMode === "server" ? await resolveGenerationRuleContent(sql, access.ownerUserId, stage.automation.generationRule) : "";
  const existing = await sql`SELECT id, run_id, workflow_id, stage_id, source, target, kind, idempotency_key, state, attempts, failure_reason, created_at, updated_at FROM workflow_automation_actions WHERE user_id = ${access.ownerUserId} AND idempotency_key = ${input.idempotencyKey} LIMIT 1`;
  if (existing[0]) {
    const row2 = existing[0];
    return { id: Number(row2.id), runId: Number(row2.run_id), workflowId: row2.workflow_id, stageId: row2.stage_id, stageIndex: input.stageIndex, source: row2.source, target: row2.target, kind: row2.kind, idempotencyKey: row2.idempotency_key, state: row2.state, attempts: row2.attempts, failureReason: row2.failure_reason, createdAt: row2.created_at, updatedAt: row2.updated_at };
  }
  const version = (await sql`SELECT COALESCE(MAX(version), 0)::int AS version FROM workflow_versions WHERE user_id = ${access.ownerUserId} AND workflow_id = ${workflow.id}`)[0]?.version || workflow.version || 1;
  const snapshot = { ...workflow, stages: workflow.stages.map((item) => ({ ...item })) };
  const runRows = await sql`INSERT INTO workflow_automation_runs (user_id, workflow_id, workflow_version, stage_index, stage_id, source, target, workflow_snapshot) VALUES (${access.ownerUserId}, ${workflow.id}, ${version}, ${input.stageIndex}, ${stage.stageId}, ${input.source}, ${stage.target}, ${sql.json(snapshot)}) RETURNING id`;
  const runId = Number(runRows[0].id);
  const rows = await sql`INSERT INTO workflow_automation_actions (user_id, run_id, workflow_id, stage_id, source, target, kind, idempotency_key, payload) VALUES (${access.ownerUserId}, ${runId}, ${workflow.id}, ${stage.stageId}, ${input.source}, ${stage.target}, ${input.kind}, ${input.idempotencyKey}, ${sql.json({ generationRule })}) ON CONFLICT (user_id, idempotency_key) DO UPDATE SET updated_at = workflow_automation_actions.updated_at RETURNING id, run_id, workflow_id, stage_id, source, target, kind, idempotency_key, state, attempts, failure_reason, created_at, updated_at`;
  const row = rows[0];
  return { id: Number(row.id), runId: Number(row.run_id), workflowId: row.workflow_id, stageId: row.stage_id, stageIndex: input.stageIndex, source: row.source, target: row.target, kind: row.kind, idempotencyKey: row.idempotency_key, state: row.state, attempts: row.attempts, failureReason: row.failure_reason, createdAt: row.created_at, updatedAt: row.updated_at };
}
function automationActionId(value) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function automationIdempotencyKey(route) {
  return `${route.workflowId}:${route.stageId}:${route.source}:${route.target}:${route.headSha}:${route.kind}`;
}
function automationSkipLine(fields) {
  return `[automation-skip] ${logFields(fields)}`;
}
function autoCreateCommitThreshold(automation) {
  const value = automation?.triggerMinCommits;
  return typeof value === "number" && Number.isInteger(value) ? Math.min(20, Math.max(1, value)) : 1;
}
function autoCreateReachedThreshold(automation, aheadBy) {
  return aheadBy > 0 && aheadBy >= autoCreateCommitThreshold(automation);
}
async function enqueueServerAutoCreate(environment, sql, row, workflow, stageIndex, source, headSha, aheadBy) {
  const stage = stageForIndex(workflow, stageIndex);
  const automation = stage?.automation;
  const skip = (reason, detail = {}) => {
    console.info(automationSkipLine({ kind: "create-pr", repository: workflow.repository, route: `${source} \u2192 ${stage?.target || "?"}`, reason, ...detail }));
    return null;
  };
  if (!stage || !stage.stageId || !row.github_installation_id) return skip("stage-unusable", { stageId: stage?.stageId, installed: Boolean(row.github_installation_id) });
  if (automation?.autoCreatePullRequest !== true || automation.executionMode !== "server") {
    return skip("policy-off", { autoCreate: automation?.autoCreatePullRequest === true, mode: automation?.executionMode });
  }
  let generationRule;
  try {
    generationRule = await resolveGenerationRuleContent(sql, row.user_id, automation.generationRule);
  } catch {
    return skip("generation-rule-unresolved", { contentHash: automation.generationRule.contentHash });
  }
  const credentialRows = await sql`SELECT user_id AS id FROM pr_helper_ai_automation_credentials WHERE user_id = ${row.user_id} AND auto_generate_pr_message = true AND auto_confirm_pr_creation = true LIMIT 1`;
  if (!credentialRows[0]) return skip("no-automation-credential");
  const triggerMinCommits = autoCreateCommitThreshold(automation);
  if (!autoCreateReachedThreshold(automation, aheadBy)) return skip("below-threshold", { aheadBy, threshold: triggerMinCommits });
  const idempotencyKey = automationIdempotencyKey({ workflowId: workflow.id, stageId: stage.stageId, source, target: stage.target, headSha, kind: "create-pr" });
  const existing = await sql`SELECT id, state, updated_at FROM workflow_automation_actions WHERE user_id = ${row.user_id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
  if (existing[0]) {
    const stale = ["running", "paused"].includes(existing[0].state) && Date.now() - Date.parse(existing[0].updated_at) > 12e4;
    if (stale) {
      const reset = await sql`UPDATE workflow_automation_actions SET state = 'queued', failure_reason = NULL, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${existing[0].id} AND state IN ('running', 'paused') RETURNING id`;
      return automationActionId(reset[0]?.id);
    }
    return existing[0].state === "queued" ? automationActionId(existing[0].id) : skip("already-attempted", { state: existing[0].state, headSha });
  }
  const version = (await sql`SELECT COALESCE(MAX(version), 0)::int AS version FROM workflow_versions WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id}`)[0]?.version || workflow.version || 1;
  const snapshot = { ...workflow, stages: workflow.stages.map((item) => ({ ...item })) };
  const run = await sql`INSERT INTO workflow_automation_runs (user_id, workflow_id, workflow_version, stage_index, stage_id, source, target, workflow_snapshot) VALUES (${row.user_id}, ${workflow.id}, ${version}, ${stageIndex}, ${stage.stageId}, ${source}, ${stage.target}, ${sql.json(snapshot)}) RETURNING id`;
  const actions = await sql`INSERT INTO workflow_automation_actions (user_id, run_id, workflow_id, stage_id, source, target, kind, idempotency_key, payload) VALUES (${row.user_id}, ${run[0].id}, ${workflow.id}, ${stage.stageId}, ${source}, ${stage.target}, 'create-pr', ${idempotencyKey}, ${sql.json({ generationRule })}) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`;
  if (actions[0]) return automationActionId(actions[0].id);
  await sql`DELETE FROM workflow_automation_runs WHERE user_id = ${row.user_id} AND id = ${run[0].id}`;
  const concurrent = await sql`SELECT id, state FROM workflow_automation_actions WHERE user_id = ${row.user_id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
  return concurrent[0]?.state === "queued" ? automationActionId(concurrent[0].id) : skip("already-attempted", { state: concurrent[0]?.state, headSha });
}
async function enqueueServerAutoMerge(sql, row, workflow, stageIndex, source, pullNumber, headSha) {
  const stage = stageForIndex(workflow, stageIndex);
  const automation = stage?.automation;
  if (!stage || !stage.stageId || !row.github_installation_id || !Number.isInteger(pullNumber) || pullNumber <= 0) return null;
  if (automation?.autoMergePullRequest !== true || automation.executionMode !== "server") return null;
  const idempotencyKey = automationIdempotencyKey({ workflowId: workflow.id, stageId: stage.stageId, source, target: stage.target, headSha, kind: "merge-pr" });
  const existing = await sql`SELECT id, state, attempts, updated_at FROM workflow_automation_actions WHERE user_id = ${row.user_id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
  if (existing[0]) {
    if (existing[0].state === "queued") return automationActionId(existing[0].id);
    const stale = ["running", "paused"].includes(existing[0].state) && Date.now() - Date.parse(existing[0].updated_at) > 12e4;
    if (!stale || automationRetryIsExhausted(existing[0].attempts, workflow.recoveryPolicy)) return null;
    const reset = await sql`UPDATE workflow_automation_actions SET state = 'queued', failure_reason = NULL, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${existing[0].id} AND state IN ('running', 'paused') RETURNING id`;
    return automationActionId(reset[0]?.id);
  }
  const version = (await sql`SELECT COALESCE(MAX(version), 0)::int AS version FROM workflow_versions WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id}`)[0]?.version || workflow.version || 1;
  const snapshot = { ...workflow, stages: workflow.stages.map((item) => ({ ...item })) };
  const run = await sql`INSERT INTO workflow_automation_runs (user_id, workflow_id, workflow_version, stage_index, stage_id, source, target, workflow_snapshot) VALUES (${row.user_id}, ${workflow.id}, ${version}, ${stageIndex}, ${stage.stageId}, ${source}, ${stage.target}, ${sql.json(snapshot)}) RETURNING id`;
  const actions = await sql`INSERT INTO workflow_automation_actions (user_id, run_id, workflow_id, stage_id, source, target, kind, idempotency_key, payload) VALUES (${row.user_id}, ${run[0].id}, ${workflow.id}, ${stage.stageId}, ${source}, ${stage.target}, 'merge-pr', ${idempotencyKey}, ${sql.json({ pullNumber, headSha })}) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`;
  if (actions[0]) return automationActionId(actions[0].id);
  await sql`DELETE FROM workflow_automation_runs WHERE user_id = ${row.user_id} AND id = ${run[0].id}`;
  const concurrent = await sql`SELECT id, state FROM workflow_automation_actions WHERE user_id = ${row.user_id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
  return concurrent[0]?.state === "queued" ? automationActionId(concurrent[0].id) : null;
}
async function scheduleServerAutoMerge(sql, row, workflow, stageIndex, source, pullNumber, headSha, gate) {
  const actionId = await enqueueServerAutoMerge(sql, row, workflow, stageIndex, source, pullNumber, headSha);
  if (!actionId) return;
  const outcome = automationMergeOutcome({ number: pullNumber, state: "open" }, gate);
  if (outcome.kind === "paused") {
    await sql`UPDATE workflow_automation_actions SET failure_reason = ${outcome.reason.slice(0, 800)} WHERE user_id = ${row.user_id} AND id = ${actionId} AND state = 'queued'`.catch(() => void 0);
    return;
  }
  await sql`UPDATE workflow_automation_actions SET failure_reason = NULL, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${actionId} AND state = 'queued' AND failure_reason IS NOT NULL`.catch(() => void 0);
}
function automationAdvanceIdempotencyKey(route) {
  return `${route.workflowId}:${route.stageId}:${route.source}:${route.target}:advance`;
}
function stageRoutesComplete(routes) {
  return routes.length > 0 && routes.every((route) => route.pull_state === "merged" && route.checks_state === "success");
}
function automationAdvanceVerdict(input) {
  const route = input.route;
  if (!route) return { kind: "paused", reason: "\u6B65\u9AA4\u72B6\u6001\u7F3A\u5931\uFF0C\u65E0\u6CD5\u786E\u8BA4\u81EA\u52A8\u63A8\u8FDB" };
  if (route.pull_state !== "merged") return { kind: "paused", reason: "\u8BE5\u6B65\u9AA4\u5C1A\u672A\u5408\u5E76\uFF0C\u4E0D\u80FD\u63A8\u8FDB\u4E0B\u4E00\u6B65" };
  if (route.checks_state !== "success") return { kind: "waiting", reason: `\u95E8\u7981\u5C1A\u672A\u5168\u7EFF\uFF08checks=${route.checks_state}\uFF09\uFF0C\u7B49\u5F85\u5408\u5E76\u540E\u9A8C\u8BC1\u5B8C\u6210` };
  const liveRoutes = input.siblingRoutes.filter((item) => item.pull_state !== "closed");
  if (!stageRoutesComplete(liveRoutes)) {
    const done = liveRoutes.filter((item) => item.pull_state === "merged" && item.checks_state === "success").length;
    return { kind: "waiting", reason: `\u8BE5\u6B65\u9AA4\u5171 ${liveRoutes.length} \u6761\u8DEF\u5F84\uFF0C\u4EC5 ${done} \u6761\u5408\u5E76\u4E14\u95E8\u7981\u7EFF\uFF0C\u7B49\u5F85\u591A\u8DEF\u5F84\u6C47\u805A\u5B8C\u6210` };
  }
  if (input.deployments.some((deployment) => deployment.state === "pending")) return { kind: "waiting", reason: "\u90E8\u7F72\u5C1A\u672A\u5B8C\u6210\uFF0C\u7B49\u5F85\u90E8\u7F72\u95E8\u7981\u51FA\u7ED3\u679C" };
  const failed = input.deployments.filter((deployment) => deployment.state === "failure");
  if (failed.length) {
    const reasons = failed.map((deployment) => deployment.failure_summary?.trim() || (deployment.health_state === "failure" ? `\u5065\u5EB7\u68C0\u67E5\u5931\u8D25${deployment.health_detail ? `\uFF08${deployment.health_detail}\uFF09` : ""}` : "\u90E8\u7F72\u5931\u8D25")).filter(Boolean);
    return { kind: "paused", reason: reasons.length ? `\u90E8\u7F72\u6216\u5065\u5EB7\u68C0\u67E5\u5931\u8D25\uFF0C\u9700\u8981\u5904\u7406\uFF1A${reasons.join("\uFF1B")}` : "\u90E8\u7F72\u6216\u5065\u5EB7\u68C0\u67E5\u5931\u8D25\uFF0C\u9700\u8981\u5904\u7406" };
  }
  return { kind: "succeeded" };
}
async function scheduleServerAdvance(sql, row, workflow, stageIndex, source) {
  const stage = workflow.stages[stageIndex];
  const automation = stage?.automation;
  if (!stage || !stage.stageId || automation?.executionMode !== "server" || automation?.autoAdvanceNext !== true) return;
  const routes = await sql`SELECT pull_state, checks_state FROM workflow_stage_states WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stage.stageId} AND pull_state <> 'closed'`;
  if (!stageRoutesComplete(routes)) {
    console.info(automationSkipLine({ kind: "advance-stage", repository: workflow.repository, route: `${source} \u2192 ${stage.target}`, reason: "routes-incomplete", routes: routes.length, merged: routes.filter((item) => item.pull_state === "merged" && item.checks_state === "success").length }));
    return;
  }
  const idempotencyKey = automationAdvanceIdempotencyKey({ workflowId: workflow.id, stageId: stage.stageId, source, target: stage.target });
  const existing = await sql`SELECT id, state, attempts, updated_at FROM workflow_automation_actions WHERE user_id = ${row.user_id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
  if (existing[0]) {
    if (existing[0].state === "queued") return automationActionId(existing[0].id);
    const stale = ["running", "paused"].includes(existing[0].state) && Date.now() - Date.parse(existing[0].updated_at) > 12e4;
    if (!stale || automationRetryIsExhausted(existing[0].attempts, workflow.recoveryPolicy)) return null;
    const reset = await sql`UPDATE workflow_automation_actions SET state = 'queued', failure_reason = NULL, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${existing[0].id} AND state IN ('running', 'paused') RETURNING id`;
    return automationActionId(reset[0]?.id);
  }
  const version = (await sql`SELECT COALESCE(MAX(version), 0)::int AS version FROM workflow_versions WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id}`)[0]?.version || workflow.version || 1;
  const snapshot = { ...workflow, stages: workflow.stages.map((item) => ({ ...item })) };
  const run = await sql`INSERT INTO workflow_automation_runs (user_id, workflow_id, workflow_version, stage_index, stage_id, source, target, workflow_snapshot) VALUES (${row.user_id}, ${workflow.id}, ${version}, ${stageIndex}, ${stage.stageId}, ${source}, ${stage.target}, ${sql.json(snapshot)}) RETURNING id`;
  const actions = await sql`INSERT INTO workflow_automation_actions (user_id, run_id, workflow_id, stage_id, source, target, kind, idempotency_key, payload) VALUES (${row.user_id}, ${run[0].id}, ${workflow.id}, ${stage.stageId}, ${source}, ${stage.target}, 'advance-stage', ${idempotencyKey}, ${sql.json({})}) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`;
  if (actions[0]) return automationActionId(actions[0].id);
  await sql`DELETE FROM workflow_automation_runs WHERE user_id = ${row.user_id} AND id = ${run[0].id}`;
  const concurrent = await sql`SELECT id, state FROM workflow_automation_actions WHERE user_id = ${row.user_id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
  return concurrent[0]?.state === "queued" ? automationActionId(concurrent[0].id) : null;
}
async function scheduleServerAutoCreate(environment, sql, row, workflow, stageIndex, source, headSha) {
  const states = await sql`SELECT workflow_id, stage_index, stage_id, repository, source, target, pull_number, pull_state, merged_at, head_sha, checks_state, checks_passed, checks_total, approvals, required_approvals, mergeable, mergeable_state, ahead_by, last_event, updated_at FROM workflow_stage_states WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id}`;
  const current = states.find((state) => state.stage_id === workflow.stages[stageIndex]?.stageId && state.source === source);
  const decision = current ? deriveStageDecision(workflow, stageIndex, current, states) : null;
  if (!current || !decision?.canCreateNext) {
    const missing = await sql`SELECT run_name FROM workflow_stage_deployments WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND run_id IS NULL`;
    console.info(automationSkipLine({ kind: "create-pr", repository: workflow.repository, route: `${source} \u2192 ${workflow.stages[stageIndex]?.target || "?"}`, reason: "not-creatable", decision: decision?.kind || "no-state", pullState: current?.pull_state, checks: current?.checks_state, aheadBy: current?.ahead_by, missingDeployments: missing.length ? missing.map((deployment) => deployment.run_name).join(",") : void 0 }));
    return;
  }
  const actionId = await enqueueServerAutoCreate(environment, sql, row, workflow, stageIndex, source, headSha, current.ahead_by);
  if (!actionId) return;
  try {
    await executeWorkflowAutomationActionForUser(environment, row.user_id, row.github_installation_id, actionId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "\u81EA\u52A8\u521B\u5EFA PR \u5931\u8D25";
    await sql`UPDATE workflow_automation_actions SET failure_reason = ${reason.slice(0, 800)}, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${actionId} AND state = 'queued'`.catch(() => void 0);
  }
}
function jsonFromModelText(content) {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpening = trimmed.slice(trimmed.indexOf("\n") + 1);
  const closing = withoutOpening.lastIndexOf("```");
  const fenced = (closing >= 0 ? withoutOpening.slice(0, closing) : withoutOpening).trim();
  return fenced || trimmed;
}
function parseAutomationMessage(content, finishReason) {
  if (finishReason === "length") {
    throw new Error("AI \u751F\u6210\u5185\u5BB9\u8FC7\u957F\u88AB\u622A\u65AD\uFF0C\u8BF7\u7F29\u77ED\u751F\u6210\u89C4\u5219\u6216\u51CF\u5C11\u63D0\u4EA4\u6570\u91CF\u540E\u91CD\u8BD5");
  }
  const raw = content.trim();
  if (!raw) {
    throw new Error("AI \u8FD4\u56DE\u5185\u5BB9\u4E3A\u7A7A\uFF08\u591A\u534A\u662F API Key \u5931\u6548\u6216 model \u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5 AI \u51ED\u8BC1\u914D\u7F6E\uFF09");
  }
  const candidate = jsonFromModelText(content);
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const preview = raw.replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`AI \u8FD4\u56DE\u7684 PR \u5185\u5BB9\u4E0D\u662F\u6709\u6548 JSON\uFF08\u539F\u59CB\u8FD4\u56DE\u524D 200 \u5B57\uFF1A${preview}\uFF09`);
  }
  if (typeof parsed.title !== "string" || !parsed.title.trim() || typeof parsed.body !== "string") {
    throw new Error("AI \u8FD4\u56DE\u7684 PR \u5185\u5BB9\u683C\u5F0F\u65E0\u6548");
  }
  return { title: parsed.title.trim().slice(0, 256), body: parsed.body.slice(0, 5e4) };
}
async function generateAutomationMessage(baseUrl, apiKey, model, source, target, commits, generationRule) {
  const response = await fetch(aiChatCompletionsUrl(baseUrl), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: buildPrPrompt(source, target, commits, generationRule) }], temperature: 0.2, max_tokens: 6e3 }), signal: AbortSignal.timeout(2e4) });
  if (!response.ok) throw new Error(`AI \u751F\u6210\u5931\u8D25 (${response.status})`);
  const payload = await response.json();
  const choice = payload.choices?.[0];
  const content = choice?.message?.content || "";
  return parseAutomationMessage(content, choice?.finish_reason);
}
function automationCreateOutcome(openPulls, commitCount) {
  const existing = openPulls.find((pull) => Number.isInteger(pull.number) && pull.number > 0);
  if (existing) return { kind: "idempotent", pullNumber: existing.number, pullUrl: existing.html_url || null };
  if (commitCount <= 0) return { kind: "cancelled", reason: "Source \u5206\u652F\u6CA1\u6709\u53EF\u521B\u5EFA PR \u7684\u65B0\u63D0\u4EA4" };
  return { kind: "create" };
}
function automationMergeOutcome(pull, gate) {
  if (!pull || !Number.isInteger(pull.number) || pull.number <= 0) return { kind: "paused", reason: "\u6CA1\u6709\u53EF\u5408\u5E76\u7684 PR" };
  if (pull.merged === true) return { kind: "idempotent", pullNumber: pull.number, pullUrl: pull.html_url || null };
  if (pull.state !== "open") return { kind: "cancelled", reason: "PR \u5DF2\u5173\u95ED\u4E14\u672A\u5408\u5E76" };
  if (gate.checksState !== "success") return { kind: "paused", reason: `\u95E8\u7981\u5C1A\u672A\u5168\u7EFF\uFF08\u5F53\u524D ${gate.checksState}\uFF09`, ...gate.checksState === "pending" ? { retryable: true } : {} };
  if (gate.approvals < gate.requiredApprovals) return { kind: "paused", reason: `PR \u8FD8\u9700\u8981 ${gate.requiredApprovals - gate.approvals} \u4E2A Approval`, retryable: true };
  if (gate.mergeable !== true) return { kind: "paused", reason: "GitHub \u672A\u5224\u5B9A\u8BE5 PR \u53EF\u5408\u5E76", ...gate.mergeable === null ? { retryable: true } : {} };
  if (gate.mergeableState === "behind") return { kind: "paused", reason: "\u5206\u652F\u843D\u540E\u4E8E\u76EE\u6807\u5206\u652F\uFF0C\u9700\u8981\u5148\u5728 GitHub \u66F4\u65B0\u5206\u652F" };
  if (gate.mergeableState !== "clean") return { kind: "paused", reason: `GitHub \u5408\u5E76\u72B6\u6001\u4E3A ${gate.mergeableState}`, ...gate.mergeableState === "unknown" || gate.mergeableState === "blocked" ? { retryable: true } : {} };
  return { kind: "merge", pullNumber: pull.number };
}
var AUTOMATION_ACTION_ABANDON_MS = 12e4;
var AUTOMATION_ACTION_STALE_MS = 12 * 60 * 60 * 1e3;
var AUTOMATION_TRANSIENT_REQUEUE_COOLDOWN_MS = 15 * 60 * 1e3;
var AUTOMATION_TRANSIENT_REQUEUE_MAX_ATTEMPTS = 3;
var AUTOMATION_GATE_WAIT_MAX_MS = 30 * 60 * 1e3;
function automationGateWaitDelayMs(attempts, policy) {
  const configured = policy?.cooldownSeconds;
  const base = (typeof configured === "number" && Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_RECOVERY_POLICY.cooldownSeconds) * 1e3;
  return Math.min(base * 2 ** Math.max(0, Math.min(attempts, 8) - 1), AUTOMATION_GATE_WAIT_MAX_MS);
}
function automationCancelReason(reason) {
  if (reason === "superseded") return "\u5DF2\u88AB\u540E\u7EED\u63D0\u4EA4\u7684\u81EA\u52A8\u5316\u52A8\u4F5C\u53D6\u4EE3";
  if (reason === "archived") return "\u6D41\u7A0B\u5DF2\u5F52\u6863\uFF0C\u81EA\u52A8\u5316\u52A8\u4F5C\u4E0D\u518D\u6267\u884C";
  if (reason === "fulfilled") return "\u8BE5\u6B65\u9AA4\u7684 PR \u5DF2\u5408\u5E76\uFF0C\u81EA\u52A8\u5316\u52A8\u4F5C\u65E0\u9700\u518D\u6267\u884C";
  return "\u8D85\u8FC7\u81EA\u52A8\u5316\u65F6\u9650\uFF0C\u672A\u518D\u5C1D\u8BD5";
}
function automationDrainDecision(action, now, policy) {
  if (action.archived) return { kind: "cancel", reason: "archived" };
  if (action.state === "paused") {
    if (action.routeMerged) return { kind: "cancel", reason: "fulfilled" };
    if (action.hasNewer) return { kind: "cancel", reason: "superseded" };
    if (action.hasNewerSucceeded) return { kind: "cancel", reason: "superseded" };
    if (!action.failureReason || automationAttemptWasReached(action.failureReason)) return { kind: "skip" };
    if (now - Date.parse(action.createdAt) > AUTOMATION_ACTION_STALE_MS) return { kind: "cancel", reason: "stale" };
    if (now - Date.parse(action.updatedAt) < AUTOMATION_TRANSIENT_REQUEUE_COOLDOWN_MS) return { kind: "skip" };
    if (action.attempts >= AUTOMATION_TRANSIENT_REQUEUE_MAX_ATTEMPTS) return { kind: "skip" };
    return { kind: "requeue" };
  }
  if (action.state !== "queued" && action.state !== "running") return { kind: "skip" };
  const abandoned = action.state === "running" && now - Date.parse(action.updatedAt) > AUTOMATION_ACTION_ABANDON_MS;
  if (action.state === "running" && !abandoned) return { kind: "skip" };
  if (action.hasNewer) return { kind: "cancel", reason: "superseded" };
  if (now - Date.parse(action.createdAt) > AUTOMATION_ACTION_STALE_MS) return { kind: "cancel", reason: "stale" };
  if (abandoned) return { kind: "reclaim", refundAttempt: action.failureReason === null };
  if (action.state === "queued" && action.failureReason && now - Date.parse(action.updatedAt) < automationGateWaitDelayMs(action.attempts, policy)) return { kind: "skip" };
  return { kind: "execute" };
}
var AUTOMATION_FUNCTION_CEILING_MS = 6e4;
var AUTOMATION_DRAIN_START_BUDGET_MS = 25e3;
var AUTOMATION_DRAIN_BATCH_SIZE = 10;
function automationDrainHasStartBudget(startedAt, now) {
  return now - startedAt < AUTOMATION_DRAIN_START_BUDGET_MS;
}
function automationDrainFailureReason(error) {
  return `\u6392\u7A7A\u65F6\u6267\u884C\u5931\u8D25\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}`.slice(0, 800);
}
async function drainWorkflowAutomationActions(environment) {
  const sql = query(environment);
  const startedAt = Date.now();
  const rows = await sql`
    SELECT actions.id, actions.user_id, actions.kind, actions.state, actions.attempts, actions.failure_reason,
           actions.created_at, actions.updated_at, actions.source, actions.target,
           workflows.repository, users.github_installation_id AS installation_id,
           workflows.archived,
           workflows.recovery_cooldown_seconds AS cooldown_seconds,
           (SELECT count(*) FROM workflow_automation_actions newer
              WHERE newer.user_id = actions.user_id AND newer.workflow_id = actions.workflow_id
                AND newer.stage_id = actions.stage_id AND newer.source = actions.source
                AND newer.kind = actions.kind AND newer.created_at > actions.created_at)::int AS newer,
           (SELECT count(*) FROM workflow_automation_actions done
              WHERE done.user_id = actions.user_id AND done.workflow_id = actions.workflow_id
                AND done.stage_id = actions.stage_id AND done.source = actions.source
                AND done.state = 'succeeded' AND done.created_at > actions.created_at)::int AS newer_succeeded,
           (SELECT count(*) FROM workflow_stage_states states
              WHERE states.user_id = actions.user_id AND states.workflow_id = actions.workflow_id
                AND states.stage_id = actions.stage_id AND states.source = actions.source
                AND states.pull_state = 'merged' AND states.merged_at > actions.created_at)::int AS route_merged
    FROM workflow_automation_actions actions
    JOIN pr_helper_users users ON users.id = actions.user_id
    LEFT JOIN pr_helper_workflows workflows ON workflows.user_id = actions.user_id AND workflows.id = actions.workflow_id
    WHERE actions.state IN ('queued', 'running', 'paused')
    ORDER BY (actions.state = 'paused'), actions.created_at
    LIMIT ${AUTOMATION_DRAIN_BATCH_SIZE}`;
  const counts = { examined: rows.length, executed: 0, reclaimed: 0, requeued: 0, cancelled: 0, failed: 0, skipped: 0, deferred: 0, failures: [] };
  for (const row of rows) {
    const decision = automationDrainDecision({ state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, failureReason: row.failure_reason, hasNewer: row.newer > 0, hasNewerSucceeded: row.newer_succeeded > 0, routeMerged: row.route_merged > 0, attempts: row.attempts, archived: row.archived }, Date.now(), { cooldownSeconds: row.cooldown_seconds === null ? void 0 : Number(row.cooldown_seconds) });
    const line = (reason, detail = {}) => console.info(automationSkipLine({ kind: row.kind, repository: row.repository || "?", route: `${row.source} \u2192 ${row.target}`, reason, action: row.id, ...detail }));
    if (decision.kind === "skip") {
      counts.skipped += 1;
      continue;
    }
    if (decision.kind === "cancel") {
      const cancelled = await sql`UPDATE workflow_automation_actions SET state = 'cancelled', failure_reason = ${automationCancelReason(decision.reason)}, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${row.id} AND state = ${row.state} RETURNING id`;
      if (cancelled.length) {
        await sql`UPDATE workflow_automation_runs SET state = 'cancelled', updated_at = now(), completed_at = now() WHERE user_id = ${row.user_id} AND id = (SELECT run_id FROM workflow_automation_actions WHERE user_id = ${row.user_id} AND id = ${row.id})`.catch(() => void 0);
        counts.cancelled += 1;
        line(`drain-cancelled-${decision.reason}`);
      }
      continue;
    }
    if (decision.kind === "requeue") {
      const requeued = await sql`UPDATE workflow_automation_actions SET state = 'queued', failure_reason = NULL, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${row.id} AND state = 'paused' RETURNING id`;
      if (!requeued.length) {
        counts.skipped += 1;
        continue;
      }
      counts.requeued += 1;
      line("drain-requeued", { detail: (row.failure_reason || "").slice(0, 120) });
    }
    if (decision.kind === "reclaim") {
      const reclaimed = await sql`UPDATE workflow_automation_actions SET state = 'queued', failure_reason = NULL, attempts = ${decision.refundAttempt ? sql`GREATEST(attempts - 1, 0)` : sql`attempts`}, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${row.id} AND state = 'running' RETURNING id`;
      if (!reclaimed.length) {
        counts.skipped += 1;
        continue;
      }
      counts.reclaimed += 1;
      line("drain-reclaimed", { refunded: decision.refundAttempt });
    }
    if (!row.installation_id) {
      counts.skipped += 1;
      line("drain-no-installation");
      continue;
    }
    const actionId = automationActionId(row.id);
    if (!actionId) {
      counts.skipped += 1;
      line("drain-invalid-action");
      continue;
    }
    if (!automationDrainHasStartBudget(startedAt, Date.now())) {
      counts.deferred += 1;
      line("drain-deferred", { elapsedMs: Date.now() - startedAt });
      continue;
    }
    try {
      await executeWorkflowAutomationActionForUser(environment, row.user_id, row.installation_id, actionId);
      counts.executed += 1;
    } catch (error) {
      const reason = automationDrainFailureReason(error);
      counts.failed += 1;
      counts.failures.push({ action: actionId, reason });
      await sql`UPDATE workflow_automation_actions SET state = 'paused', failure_reason = ${reason}, updated_at = now() WHERE user_id = ${row.user_id} AND id = ${row.id} AND state IN ('queued', 'running')`.catch(() => void 0);
      line("drain-failed", { detail: reason.slice(0, 200) });
    }
  }
  return counts;
}
function automationRetryIsExhausted(attempts, policy) {
  const configured = policy?.maxRetries;
  const maxRetries = Number.isInteger(configured) && configured > 0 ? Math.min(10, configured) : DEFAULT_RECOVERY_POLICY.maxRetries;
  return attempts >= maxRetries;
}
function automationAttemptWasReached(reason) {
  return !/rate limit|请求超时|timed? ?out|aborted|internal server error|bad gateway|service unavailable/i.test(reason);
}
async function runAutomationMergeAction(environment, sql, userId, installationId, actionId, action, workflow, stage) {
  if (stage.automation?.autoMergePullRequest !== true || stage.automation.executionMode !== "server") throw new Error("\u6D41\u7A0B\u6B65\u9AA4\u81EA\u52A8\u5408\u5E76\u7B56\u7565\u5DF2\u5931\u6548");
  const pullNumber = automationActionId(action.payload?.pullNumber);
  if (!pullNumber) throw new Error("\u81EA\u52A8\u5316\u52A8\u4F5C\u7F3A\u5C11\u8981\u5408\u5E76\u7684 PR \u7F16\u53F7");
  const states = await sql`SELECT workflow_id, stage_index, stage_id, repository, source, target, pull_number, pull_state, merged_at, head_sha, checks_state, checks_passed, checks_total, approvals, required_approvals, mergeable, mergeable_state, ahead_by, last_event, updated_at FROM workflow_stage_states WHERE user_id = ${userId} AND workflow_id = ${workflow.id}`;
  const current = states.find((state) => state.stage_id === action.stage_id && state.source === action.source);
  if (!current || current.pull_number !== pullNumber) throw new Error("\u6B65\u9AA4\u72B6\u6001\u4E0E\u8981\u5408\u5E76\u7684 PR \u4E0D\u4E00\u81F4");
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const pull = await installationRequest(config, installationId, `/repos/${owner}/${name}/pulls/${pullNumber}`);
  const outcome = automationMergeOutcome(
    { number: pull.number, state: pull.state, merged: Boolean(pull.merged_at), html_url: pull.html_url },
    { checksState: current.checks_state, approvals: current.approvals, requiredApprovals: current.required_approvals, mergeable: pull.mergeable ?? null, mergeableState: pull.mergeable_state || "unknown" }
  );
  if (outcome.kind === "paused" && outcome.retryable === true) {
    await sql`UPDATE workflow_automation_actions SET state = 'queued', failure_reason = ${outcome.reason.slice(0, 800)}, updated_at = now() WHERE user_id = ${userId} AND id = ${actionId}`;
    await sql`UPDATE workflow_automation_runs SET state = 'waiting-gates', updated_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
    console.info(automationSkipLine({ kind: "merge-pr", repository: workflow.repository, route: `${action.source} \u2192 ${action.target}`, reason: "gate-not-ready", gate: outcome.reason, pullNumber, attempts: action.attempts + 1 }));
    return { state: "queued", pullNumber: null };
  }
  if (outcome.kind === "paused") throw new Error(outcome.reason);
  if (outcome.kind === "cancelled") {
    await sql`UPDATE workflow_automation_actions SET state = 'cancelled', failure_reason = ${outcome.reason}, updated_at = now() WHERE user_id = ${userId} AND id = ${actionId}`;
    await sql`UPDATE workflow_automation_runs SET state = 'cancelled', updated_at = now(), completed_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
    return { state: "cancelled", pullNumber: null };
  }
  if (outcome.kind === "merge") {
    await installationRequest(config, installationId, `/repos/${owner}/${name}/pulls/${pullNumber}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "merge", sha: pull.head.sha }) });
  }
  await sql`UPDATE workflow_automation_actions SET state = 'succeeded', failure_reason = NULL, updated_at = now(), payload = ${sql.json({ ...action.payload || {}, pullNumber })} WHERE user_id = ${userId} AND id = ${actionId}`;
  await sql`UPDATE workflow_automation_runs SET state = 'succeeded', updated_at = now(), completed_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
  await recordOperationAuditForUser(sql, userId, installationId, {
    action: "pull-merged",
    outcome: "success",
    repository: workflow.repository,
    workflowId: workflow.id,
    stageId: action.stage_id,
    source: action.source,
    target: action.target,
    pullNumber,
    runId: action.run_id,
    metadata: { via: "workflow-automation", ...outcome.kind === "idempotent" ? { idempotent: true } : {} },
    failureReason: null
  });
  return { state: "succeeded", pullNumber };
}
async function runAutomationAdvanceAction(environment, sql, userId, installationId, actionId, action, workflow, stage) {
  if (stage.automation?.executionMode !== "server" || stage.automation?.autoAdvanceNext !== true) throw new Error("\u6D41\u7A0B\u6B65\u9AA4\u81EA\u52A8\u63A8\u8FDB\u7B56\u7565\u5DF2\u5931\u6548");
  const states = await sql`SELECT workflow_id, stage_index, stage_id, repository, source, target, pull_number, pull_state, merged_at, head_sha, checks_state, checks_passed, checks_total, approvals, required_approvals, mergeable, mergeable_state, ahead_by, last_event, updated_at FROM workflow_stage_states WHERE user_id = ${userId} AND workflow_id = ${workflow.id}`;
  const current = states.find((state) => state.stage_id === action.stage_id && state.source === action.source);
  if (!current) throw new Error("\u6B65\u9AA4\u72B6\u6001\u7F3A\u5931\uFF0C\u65E0\u6CD5\u786E\u8BA4\u81EA\u52A8\u63A8\u8FDB");
  const siblingRoutes = states.filter((state) => state.stage_id === action.stage_id && state.pull_state !== "closed");
  const deployments = await sql`SELECT state, health_state, health_detail, failure_summary FROM workflow_stage_deployments WHERE user_id = ${userId} AND workflow_id = ${workflow.id} AND stage_id = ${action.stage_id} AND source = ${action.source}`;
  const verdict = automationAdvanceVerdict({ route: current, siblingRoutes, deployments });
  if (verdict.kind === "paused") throw new Error(verdict.reason);
  if (verdict.kind === "waiting") {
    await sql`UPDATE workflow_automation_actions SET failure_reason = ${verdict.reason.slice(0, 800)}, updated_at = now() WHERE user_id = ${userId} AND id = ${actionId} AND state = 'queued'`;
    await sql`UPDATE workflow_automation_runs SET state = 'waiting-gates', updated_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
    return { state: "queued" };
  }
  await sql`UPDATE workflow_automation_actions SET state = 'succeeded', failure_reason = NULL, updated_at = now() WHERE user_id = ${userId} AND id = ${actionId}`;
  await sql`UPDATE workflow_automation_runs SET state = 'succeeded', updated_at = now(), completed_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
  await recordOperationAuditForUser(sql, userId, installationId, {
    action: "stage-advanced",
    outcome: "success",
    repository: workflow.repository,
    workflowId: workflow.id,
    stageId: action.stage_id,
    source: action.source,
    target: action.target,
    pullNumber: current.pull_number,
    runId: action.run_id,
    metadata: { via: "workflow-automation", mergedAt: current.merged_at },
    failureReason: null
  });
  return { state: "succeeded", pullNumber: current.pull_number };
}
async function executeWorkflowAutomationActionForUser(environment, userId, installationId, actionId) {
  if (!Number.isInteger(actionId) || actionId <= 0 || !installationId) throw new Error("\u65E0\u6548\u7684\u81EA\u52A8\u5316\u6267\u884C\u8BF7\u6C42");
  const sql = query(environment);
  const rows = await sql`SELECT actions.id, actions.run_id, actions.workflow_id, actions.stage_id, runs.stage_index, actions.source, actions.target, actions.kind, actions.state, actions.attempts, actions.payload FROM workflow_automation_actions actions JOIN workflow_automation_runs runs ON runs.user_id = actions.user_id AND runs.id = actions.run_id WHERE actions.user_id = ${userId} AND actions.id = ${actionId} LIMIT 1`;
  const action = rows[0];
  if (!action) throw new Error("\u672A\u627E\u5230\u81EA\u52A8\u5316\u52A8\u4F5C");
  if (action.state === "succeeded") return { state: action.state, pullNumber: null };
  if (action.state !== "queued") throw new Error(`\u5F53\u524D\u52A8\u4F5C\u72B6\u6001\u4E3A ${action.state}\uFF0C\u4E0D\u80FD\u6267\u884C`);
  if (action.kind !== "create-pr" && action.kind !== "merge-pr" && action.kind !== "advance-stage") throw new Error("\u5F53\u524D\u4EC5\u652F\u6301\u6267\u884C\u81EA\u52A8\u521B\u5EFA\u3001\u81EA\u52A8\u5408\u5E76\u548C\u81EA\u52A8\u63A8\u8FDB\u52A8\u4F5C");
  const claimed = await sql`UPDATE workflow_automation_actions SET state = 'running', attempts = attempts + 1, updated_at = now() WHERE user_id = ${userId} AND id = ${actionId} AND state = 'queued' RETURNING id`;
  if (!claimed.length) throw new Error("\u52A8\u4F5C\u5DF2\u88AB\u5176\u4ED6\u6267\u884C\u8BF7\u6C42\u9886\u53D6");
  try {
    const workflowRows = await sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${userId} AND workflows.id = ${action.workflow_id}`;
    const workflow = trackedWorkflowFromSingleRow(workflowRows);
    const stage = workflow ? stageForIndex(workflow, action.stage_index) : void 0;
    if (!workflow || !stage || stage.stageId !== action.stage_id) throw new Error("\u6D41\u7A0B\u6B65\u9AA4\u81EA\u52A8\u5316\u7B56\u7565\u5DF2\u5931\u6548");
    if (action.kind === "merge-pr") return await runAutomationMergeAction(environment, sql, userId, installationId, actionId, action, workflow, stage);
    if (action.kind === "advance-stage") return await runAutomationAdvanceAction(environment, sql, userId, installationId, actionId, action, workflow, stage);
    if (stage.automation?.autoCreatePullRequest !== true || stage.automation.executionMode !== "server") throw new Error("\u6D41\u7A0B\u6B65\u9AA4\u81EA\u52A8\u521B\u5EFA\u7B56\u7565\u5DF2\u5931\u6548");
    if (!action.payload?.generationRule?.trim()) throw new Error("\u81EA\u52A8\u5316\u52A8\u4F5C\u7F3A\u5C11\u751F\u6210\u89C4\u5219\u5FEB\u7167");
    const currentStates = await sql`SELECT workflow_id, stage_index, stage_id, repository, source, target, pull_number, pull_state, merged_at, head_sha, checks_state, checks_passed, checks_total, approvals, required_approvals, mergeable, mergeable_state, ahead_by, last_event, updated_at FROM workflow_stage_states WHERE user_id = ${userId} AND workflow_id = ${workflow.id}`;
    const current = currentStates.find((state) => state.stage_id === action.stage_id && state.source === action.source);
    if (!current || !deriveStageDecision(workflow, action.stage_index, current, currentStates).canCreateNext) throw new Error("\u5F53\u524D\u6B65\u9AA4\u5C1A\u672A\u6EE1\u8DB3\u81EA\u52A8\u521B\u5EFA PR \u7684\u95E8\u7981");
    if (!autoCreateReachedThreshold(stage.automation, current.ahead_by)) throw new Error(`\u65B0\u63D0\u4EA4\u6570\u672A\u8FBE\u5230\u81EA\u52A8\u521B\u5EFA\u9608\u503C\uFF08\u9700\u8981 ${autoCreateCommitThreshold(stage.automation)} \u4E2A\uFF09`);
    const credential = await readAiAutomationCredentialForUser(environment, userId);
    if (!credential || !credential.autoGeneratePrMessage || !credential.autoConfirmPrCreation) throw new Error("\u670D\u52A1\u7AEF AI \u81EA\u52A8\u751F\u6210\u6216\u81EA\u52A8\u786E\u8BA4\u8BBE\u7F6E\u672A\u5F00\u542F");
    const { owner, name } = ownerAndName(workflow.repository);
    const config = parseGithubAppConfig(environment);
    const openPulls = await installationRequest(config, installationId, `/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${action.source}`)}&base=${encodeURIComponent(action.target)}&per_page=10`);
    const comparison = openPulls[0] ? { commits: [] } : await installationRequest(config, installationId, `/repos/${owner}/${name}/compare/${encodeURIComponent(action.target)}...${encodeURIComponent(action.source)}`);
    const outcome = automationCreateOutcome(openPulls, comparison.commits.length);
    if (outcome.kind === "idempotent") {
      await sql`UPDATE workflow_automation_actions SET state = 'succeeded', failure_reason = NULL, updated_at = now(), payload = ${sql.json({ ...action.payload || {}, pullNumber: outcome.pullNumber })} WHERE user_id = ${userId} AND id = ${actionId}`;
      await sql`UPDATE workflow_automation_runs SET state = 'succeeded', updated_at = now(), completed_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
      await recordOperationAuditForUser(sql, userId, installationId, {
        action: "pull-created",
        outcome: "success",
        repository: workflow.repository,
        workflowId: workflow.id,
        stageId: action.stage_id,
        source: action.source,
        target: action.target,
        pullNumber: outcome.pullNumber,
        runId: action.run_id,
        metadata: { via: "workflow-automation", idempotent: true },
        failureReason: null
      });
      return { state: "succeeded", pullNumber: outcome.pullNumber, pullUrl: outcome.pullUrl };
    }
    if (outcome.kind === "cancelled") {
      await sql`UPDATE workflow_automation_actions SET state = 'cancelled', failure_reason = ${outcome.reason}, updated_at = now() WHERE user_id = ${userId} AND id = ${actionId}`;
      await sql`UPDATE workflow_automation_runs SET state = 'cancelled', updated_at = now(), completed_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
      return { state: "cancelled", pullNumber: null };
    }
    const message = await generateAutomationMessage(credential.baseUrl, credential.apiKey, credential.model, action.source, action.target, comparison.commits.map((item) => item.commit.message), action.payload?.generationRule || "");
    const created = await installationRequest(config, installationId, `/repos/${owner}/${name}/pulls`, { method: "POST", body: JSON.stringify({ title: message.title, head: action.source, base: action.target, body: message.body }) });
    await sql`UPDATE workflow_automation_actions SET state = 'succeeded', updated_at = now(), payload = ${sql.json({ ...action.payload || {}, pullNumber: created.number })} WHERE user_id = ${userId} AND id = ${actionId}`;
    await sql`UPDATE workflow_automation_runs SET state = 'succeeded', updated_at = now(), completed_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
    await recordOperationAuditForUser(sql, userId, installationId, {
      action: "pull-created",
      outcome: "success",
      repository: workflow.repository,
      workflowId: workflow.id,
      stageId: action.stage_id,
      source: action.source,
      target: action.target,
      pullNumber: created.number,
      runId: action.run_id,
      metadata: { via: "workflow-automation" },
      failureReason: null
    });
    return { state: "succeeded", pullNumber: created.number, pullUrl: created.html_url };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "\u81EA\u52A8\u521B\u5EFA PR \u5931\u8D25";
    await sql`UPDATE workflow_automation_actions SET state = 'paused', failure_reason = ${reason.slice(0, 800)}, attempts = ${automationAttemptWasReached(reason) ? sql`attempts` : sql`GREATEST(attempts - 1, 0)`}, updated_at = now() WHERE user_id = ${userId} AND id = ${actionId}`;
    await sql`UPDATE workflow_automation_runs SET state = 'paused', updated_at = now() WHERE user_id = ${userId} AND id = ${action.run_id}`;
    throw error;
  }
}
async function executeWorkflowAutomationAction(environment, identity, actionId) {
  if (!identity.installationId) throw new Error("\u65E0\u6548\u7684\u81EA\u52A8\u5316\u6267\u884C\u8BF7\u6C42");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  return executeWorkflowAutomationActionForUser(environment, user.id, identity.installationId, actionId);
}
async function resolveAutomationActionForTakeover(environment, userId, installationId, actionId, expectedState) {
  if (!Number.isInteger(actionId) || actionId <= 0 || !installationId) throw new Error("\u65E0\u6548\u7684\u63A5\u7BA1\u8BF7\u6C42");
  const sql = query(environment);
  const rows = await sql`SELECT actions.id, actions.run_id, actions.workflow_id, actions.stage_id, runs.stage_index, actions.source, actions.target, actions.kind, actions.state, actions.attempts, actions.payload FROM workflow_automation_actions actions JOIN workflow_automation_runs runs ON runs.user_id = actions.user_id AND runs.id = actions.run_id WHERE actions.user_id = ${userId} AND actions.id = ${actionId} LIMIT 1`;
  const action = rows[0];
  if (!action) throw new Error("\u672A\u627E\u5230\u81EA\u52A8\u5316\u52A8\u4F5C");
  if (action.state !== expectedState) throw new Error(`\u5F53\u524D\u52A8\u4F5C\u72B6\u6001\u4E3A ${action.state}\uFF0C\u4E0D\u80FD\u63A5\u7BA1`);
  if (action.kind !== "create-pr") throw new Error("\u5F53\u524D\u4EC5\u652F\u6301\u63A5\u7BA1\u81EA\u52A8\u521B\u5EFA PR \u52A8\u4F5C");
  if (!action.payload?.generationRule?.trim()) throw new Error("\u81EA\u52A8\u5316\u52A8\u4F5C\u7F3A\u5C11\u751F\u6210\u89C4\u5219\u5FEB\u7167");
  const workflowRows = await sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${userId} AND workflows.id = ${action.workflow_id}`;
  const workflow = trackedWorkflowFromSingleRow(workflowRows);
  const stage = workflow ? stageForIndex(workflow, action.stage_index) : void 0;
  if (!workflow || !stage || stage.stageId !== action.stage_id) throw new Error("\u6D41\u7A0B\u6B65\u9AA4\u81EA\u52A8\u5316\u7B56\u7565\u5DF2\u5931\u6548");
  if (stage.automation?.autoCreatePullRequest !== true || stage.automation.executionMode !== "server") throw new Error("\u6D41\u7A0B\u6B65\u9AA4\u81EA\u52A8\u521B\u5EFA\u7B56\u7565\u5DF2\u5931\u6548");
  const credential = await readAiAutomationCredentialForUser(environment, userId);
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const openPulls = await installationRequest(config, installationId, `/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${action.source}`)}&base=${encodeURIComponent(action.target)}&per_page=10`);
  const comparison = openPulls[0] ? { commits: [] } : await installationRequest(config, installationId, `/repos/${owner}/${name}/compare/${encodeURIComponent(action.target)}...${encodeURIComponent(action.source)}`);
  return { sql, action, workflow, stage, credential, config, installationId, owner, name, openPulls, comparison };
}
async function regenerateAutomationMessage(environment, identity, actionId) {
  if (!identity.installationId) throw new Error("\u65E0\u6548\u7684\u63A5\u7BA1\u8BF7\u6C42");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const { action, stage, credential, comparison, workflow } = await resolveAutomationActionForTakeover(environment, user.id, identity.installationId, actionId, "paused");
  if (!credential || !credential.autoGeneratePrMessage) throw new Error("\u670D\u52A1\u7AEF AI \u81EA\u52A8\u751F\u6210\u8BBE\u7F6E\u672A\u5F00\u542F");
  const message = await generateAutomationMessage(credential.baseUrl, credential.apiKey, credential.model, action.source, action.target, comparison.commits.map((item) => item.commit.message), action.payload?.generationRule || "");
  return { message, workflow: { repository: workflow.repository }, stage: { source: action.source, target: stage.target } };
}
async function takeoverAutomationAction(environment, identity, actionId, title, body) {
  if (!identity.installationId) throw new Error("\u65E0\u6548\u7684\u63A5\u7BA1\u8BF7\u6C42");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const { sql, action, workflow, stage, owner, name, comparison, openPulls, config, installationId } = await resolveAutomationActionForTakeover(environment, user.id, identity.installationId, actionId, "paused");
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle) throw new Error("PR \u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A");
  const currentStates = await sql`SELECT workflow_id, stage_index, stage_id, repository, source, target, pull_number, pull_state, merged_at, head_sha, checks_state, checks_passed, checks_total, approvals, required_approvals, mergeable, mergeable_state, ahead_by, last_event, updated_at FROM workflow_stage_states WHERE user_id = ${user.id} AND workflow_id = ${workflow.id}`;
  const current = currentStates.find((state) => state.stage_id === action.stage_id && state.source === action.source);
  if (!current || !deriveStageDecision(workflow, action.stage_index, current, currentStates).canCreateNext) throw new Error("\u5F53\u524D\u6B65\u9AA4\u5C1A\u672A\u6EE1\u8DB3\u81EA\u52A8\u521B\u5EFA PR \u7684\u95E8\u7981");
  if (!autoCreateReachedThreshold(stage.automation, current.ahead_by)) throw new Error(`\u65B0\u63D0\u4EA4\u6570\u672A\u8FBE\u5230\u81EA\u52A8\u521B\u5EFA\u9608\u503C\uFF08\u9700\u8981 ${autoCreateCommitThreshold(stage.automation)} \u4E2A\uFF09`);
  const outcome = automationCreateOutcome(openPulls, comparison.commits.length);
  if (outcome.kind === "idempotent") {
    await sql`UPDATE workflow_automation_actions SET state = 'succeeded', failure_reason = NULL, updated_at = now(), payload = ${sql.json({ ...action.payload || {}, pullNumber: outcome.pullNumber })} WHERE user_id = ${user.id} AND id = ${actionId}`;
    await sql`UPDATE workflow_automation_runs SET state = 'succeeded', updated_at = now(), completed_at = now() WHERE user_id = ${user.id} AND id = ${action.run_id}`;
    await recordOperationAuditForUser(sql, user.id, installationId, {
      action: "pull-created",
      outcome: "success",
      repository: workflow.repository,
      workflowId: workflow.id,
      stageId: action.stage_id,
      source: action.source,
      target: action.target,
      pullNumber: outcome.pullNumber,
      runId: action.run_id,
      metadata: { via: "user-takeover", idempotent: true },
      failureReason: null
    });
    return { state: "succeeded", pullNumber: outcome.pullNumber, pullUrl: outcome.pullUrl };
  }
  if (outcome.kind === "cancelled") {
    await sql`UPDATE workflow_automation_actions SET state = 'cancelled', failure_reason = ${outcome.reason}, updated_at = now() WHERE user_id = ${user.id} AND id = ${actionId}`;
    await sql`UPDATE workflow_automation_runs SET state = 'cancelled', updated_at = now(), completed_at = now() WHERE user_id = ${user.id} AND id = ${action.run_id}`;
    return { state: "cancelled", pullNumber: null };
  }
  const created = await installationRequest(config, installationId, `/repos/${owner}/${name}/pulls`, { method: "POST", body: JSON.stringify({ title: trimmedTitle, head: action.source, base: action.target, body: trimmedBody }) });
  await sql`UPDATE workflow_automation_actions SET state = 'succeeded', updated_at = now(), payload = ${sql.json({ ...action.payload || {}, pullNumber: created.number })} WHERE user_id = ${user.id} AND id = ${actionId}`;
  await sql`UPDATE workflow_automation_runs SET state = 'succeeded', updated_at = now(), completed_at = now() WHERE user_id = ${user.id} AND id = ${action.run_id}`;
  await recordOperationAuditForUser(sql, user.id, installationId, {
    action: "pull-created",
    outcome: "success",
    repository: workflow.repository,
    workflowId: workflow.id,
    stageId: action.stage_id,
    source: action.source,
    target: action.target,
    pullNumber: created.number,
    runId: action.run_id,
    metadata: { via: "user-takeover" },
    failureReason: null
  });
  return { state: "succeeded", pullNumber: created.number, pullUrl: created.html_url };
}
var AUTOMATION_ACTION_VIEW_LIMIT = 200;
async function listWorkflowAutomationActions(environment, identity, workflowId, unfinishedOnly = false, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId, reads);
  const sql = query(environment);
  const rows = await sql`SELECT actions.id, actions.run_id, actions.workflow_id, actions.stage_id, runs.stage_index, actions.source, actions.target, actions.kind, actions.idempotency_key, actions.state, actions.attempts, actions.failure_reason, actions.created_at, actions.updated_at FROM workflow_automation_actions actions JOIN workflow_automation_runs runs ON runs.user_id = actions.user_id AND runs.id = actions.run_id WHERE ${visibleWorkflowPredicate(sql, user.id, "actions.user_id", "actions.workflow_id")} ${workflowId ? sql`AND actions.workflow_id = ${workflowId}` : sql``} ${unfinishedOnly ? sql`AND actions.state IN ('queued', 'running', 'paused', 'failed')` : sql``} ORDER BY actions.created_at DESC LIMIT ${AUTOMATION_ACTION_VIEW_LIMIT}`;
  return rows.map((row) => ({ id: Number(row.id), runId: Number(row.run_id), workflowId: row.workflow_id, stageId: row.stage_id, stageIndex: row.stage_index, source: row.source, target: row.target, kind: row.kind, idempotencyKey: row.idempotency_key, state: row.state, attempts: row.attempts, failureReason: row.failure_reason, createdAt: row.created_at, updatedAt: row.updated_at }));
}
function trackedWorkflowColumns(sql) {
  return sql`workflows.user_id, workflows.id, workflows.name, workflows.repository, workflows.archived, workflows.muted, workflows.version, workflows.position, workflows.declared_created_at, workflows.recovery_max_retries, workflows.recovery_cooldown_seconds,
    (SELECT coalesce(jsonb_agg(to_jsonb(stages) ORDER BY stages.stage_index), '[]'::jsonb) FROM workflow_stages stages WHERE stages.user_id = workflows.user_id AND stages.workflow_id = workflows.id) AS stages,
    (SELECT coalesce(jsonb_agg(to_jsonb(deployments) ORDER BY deployments.position), '[]'::jsonb) FROM workflow_deployment_configs deployments WHERE deployments.user_id = workflows.user_id AND deployments.workflow_id = workflows.id) AS deployments`;
}
function trackedWorkflowFromRow(row) {
  if (!row.stages.length) {
    console.error(`workflow ${row.user_id}/${row.id} has no stage rows; reconciliation is skipping it. Re-run supabase/migrations/037_workflow_relational_backfill.sql.`);
    return null;
  }
  return workflowFromRows({ workflow: row, stages: row.stages, deployments: row.deployments });
}
function trackedWorkflowFromSingleRow(rows) {
  const row = rows[0];
  if (!row) return void 0;
  const workflow = trackedWorkflowFromRow(row);
  if (!workflow) throw new Error(`\u6D41\u7A0B ${row.id} \u7684\u5173\u7CFB\u8868\u955C\u50CF\u7F3A\u5931\uFF0C\u8BF7\u91CD\u8DD1 supabase/migrations/037_workflow_relational_backfill.sql`);
  return workflow;
}
function requiredApprovalsFromProtection(protection, rules) {
  const classic = protection?.required_pull_request_reviews?.required_approving_review_count || 0;
  const ruleset = rules.reduce((most, rule) => Math.max(most, rule.parameters?.required_approving_review_count || 0), 0);
  return Math.max(classic, ruleset);
}
function rollbackDeploymentIsAvailable(run) {
  return run.state === "success" && Boolean(run.deploymentUrl);
}
function canCheckDeploymentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname) && !url.hostname.endsWith(".local");
  } catch {
    return false;
  }
}
var defaultDeploymentConfigs = [
  { target: "dev", provider: "vercel", workflowName: "Deploy frontend to Vercel", environment: "preview", githubEnvironment: "preview-vercel" },
  { target: "dev", provider: "cloudflare", workflowName: "Deploy frontend to Cloudflare Pages", environment: "preview", githubEnvironment: "preview-cloudflare-pages" },
  { target: "main", provider: "vercel", workflowName: "Deploy frontend to Vercel", environment: "production", githubEnvironment: "production-vercel" },
  { target: "main", provider: "cloudflare", workflowName: "Deploy frontend to Cloudflare Pages", environment: "production", githubEnvironment: "production-cloudflare-pages" }
];
var bundledRollbackRepository = "bayernjf/pr-helper";
var bundledRollbackWorkflow = "Rollback frontend deployment";
function deploymentConfigs(workflow) {
  const configured = workflow.deployments || [];
  if (workflow.repository !== bundledRollbackRepository) return configured;
  return configured.map((deployment) => deployment.environment === "production" && deployment.workflowName === (deployment.provider === "vercel" ? "Deploy frontend to Vercel" : "Deploy frontend to Cloudflare Pages") && !deployment.rollbackWorkflowName ? { ...deployment, rollbackWorkflowName: bundledRollbackWorkflow } : deployment);
}
function workflowConfigurationWarnings(workflow, context) {
  const configured = deploymentConfigs(workflow);
  if (!configured.length) return [{ workflowId: workflow.id, code: "no-deployments" }];
  if (!context.actionsAvailable) return [{ workflowId: workflow.id, code: "actions-unavailable" }];
  const warnings = [];
  const workflowExists = (value) => context.workflows.some((candidate) => candidate.name === value || candidate.path === value);
  configured.forEach((deployment) => {
    const base = { workflowId: workflow.id, target: deployment.target, provider: deployment.provider };
    if (!workflowExists(deployment.workflowName)) warnings.push({ ...base, code: "workflow-not-found", value: deployment.workflowName });
    if (!deployment.githubEnvironment) warnings.push({ ...base, code: "environment-missing" });
    else if (context.environmentsAvailable && !context.environments.includes(deployment.githubEnvironment)) warnings.push({ ...base, code: "environment-not-found", value: deployment.githubEnvironment });
    if (deployment.rollbackWorkflowName && !workflowExists(deployment.rollbackWorkflowName)) warnings.push({ ...base, code: "rollback-workflow-not-found", value: deployment.rollbackWorkflowName });
  });
  return warnings;
}
function deploymentProviderForWorkflowRun(name, configurations = defaultDeploymentConfigs) {
  return configurations.find((configuration) => configuration.workflowName === name)?.provider || null;
}
function deploymentRunState(run) {
  if (run.status !== "completed" || !run.conclusion) return "pending";
  return run.conclusion === "success" ? "success" : "failure";
}
function deploymentStateWithHealth(actionState, healthState) {
  return actionState === "success" && healthState === "failure" ? "failure" : actionState;
}
function deploymentFailureSummary(jobs) {
  const job = jobs.find((candidate) => ["failure", "cancelled", "timed_out", "action_required"].includes(candidate.conclusion || ""));
  if (!job) return { summary: "GitHub Actions \u90E8\u7F72\u5931\u8D25\uFF0C\u8BF7\u6253\u5F00\u65E5\u5FD7\u67E5\u770B\u8BE6\u60C5\u3002", jobUrl: null };
  const failedSteps = job.steps?.filter((step) => ["failure", "cancelled", "timed_out", "action_required"].includes(step.conclusion || "")).map((step) => step.name) || [];
  return { summary: `${job.name}${failedSteps.length ? `\uFF1A\u5931\u8D25\u6B65\u9AA4 ${failedSteps.join("\u3001")}` : "\uFF1A\u90E8\u7F72\u5931\u8D25"}`, jobUrl: job.html_url || null };
}
function deploymentNotification(provider, environment, state) {
  const providerName = provider === "vercel" ? "Vercel" : "Cloudflare Pages";
  const environmentName = environment === "preview" ? "Preview" : "Production";
  if (state === "success") return { kind: "deployment-success", title: `${providerName} ${environmentName} \u90E8\u7F72\u6210\u529F`, message: `${providerName} ${environmentName} \u5DF2\u4E0A\u7EBF\u3002` };
  return { kind: "deployment-failure", title: `${providerName} ${environmentName} \u90E8\u7F72\u5931\u8D25`, message: "\u8BF7\u6253\u5F00\u5931\u8D25 Job \u65E5\u5FD7\u5904\u7406\u540E\u91CD\u8BD5\u3002" };
}
function repairCommitSha(pull) {
  return pull.merged_at ? pull.merge_commit_sha || pull.head.sha : pull.head.sha;
}
function selectRepairPullNumber(rows, requestedPullNumber) {
  const persisted = rows.find((row) => Number.isInteger(row.pull_number) && (row.pull_number || 0) > 0)?.pull_number;
  return persisted || (Number.isInteger(requestedPullNumber) && requestedPullNumber > 0 ? requestedPullNumber : null);
}
function generateStageId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function ensureStageIds(workflow) {
  let changed = false;
  const stages = workflow.stages.map((stage) => {
    if (stage.stageId) return stage;
    changed = true;
    return { ...stage, stageId: generateStageId() };
  });
  return changed ? { ...workflow, stages } : workflow;
}
function stageIdentity(workflow, stageIndex) {
  const stage = ensureStageIds(workflow).stages[stageIndex];
  if (!stage?.stageId) throw new Error("\u6D41\u7A0B\u6B65\u9AA4\u7F3A\u5C11\u7A33\u5B9A\u8EAB\u4EFD");
  return stage.stageId;
}
function findWorkflowStageIndexForRemoval(workflow, stageId, stageIndex, source, target) {
  const byId = workflow.stages.findIndex((stage) => stage.stageId === stageId);
  if (byId !== -1) return byId;
  if (!Number.isInteger(stageIndex)) return -1;
  const index = stageIndex;
  if (index < 0 || index >= workflow.stages.length) return -1;
  const candidate = workflow.stages[index];
  return candidate?.source === source && candidate.target === target ? index : -1;
}
function stageForIndex(workflow, stageIndex) {
  const normalized = ensureStageIds(workflow);
  const stage = normalized.stages[stageIndex];
  if (!stage?.stageId) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B\u6B65\u9AA4");
  return stage;
}
function compactFailureDetails(parts) {
  return parts.filter((part) => Boolean(part)).join(" ").replace(/\s+/g, " ").trim().slice(0, 800);
}
function reconciliationState(stagesFailed, stagesReconciled) {
  if (stagesFailed <= 0) return "success";
  return stagesReconciled > 0 ? "degraded" : "failure";
}
function workflowRunCompletionState(merged, checksState) {
  if (!merged) return null;
  if (checksState === "success") return "completed";
  if (checksState === "failure") return "failed";
  return null;
}
var STAGE_STALE_THRESHOLD_SECONDS = 15 * 60;
var STAGE_UNCONVERGED_THRESHOLD_SECONDS = 45 * 60;
function stageUnconvergedThresholdSeconds(environment) {
  const configured = Number(environment.STAGE_UNCONVERGED_THRESHOLD_SECONDS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return STAGE_UNCONVERGED_THRESHOLD_SECONDS;
}
function stageConvergenceVerdict(sample, thresholdSeconds) {
  const age = sample.oldestStageAgeSeconds;
  if (!sample.stageCount || age === null) return { healthy: true, reason: null };
  if (age <= thresholdSeconds) return { healthy: true, reason: null };
  return { healthy: false, reason: `oldest stage projection is ${age}s old, over the ${thresholdSeconds}s threshold` };
}
var DEFAULT_RECOVERY_POLICY = { maxRetries: 3, cooldownSeconds: 300 };
function databaseUrl(environment) {
  const value = environment.DATABASE_URL?.trim();
  if (!value) throw new Error("\u672A\u914D\u7F6E DATABASE_URL\uFF0C\u6D41\u7A0B\u4ECD\u4EC5\u4FDD\u5B58\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u3002");
  return value;
}
var client;
var clientUrl = "";
function query(environment) {
  const url = databaseUrl(environment);
  if (!client || clientUrl !== url) {
    client = postgres(url, { max: 4, prepare: false, idle_timeout: 20, connect_timeout: 10, ssl: "require" });
    clientUrl = url;
  }
  return client;
}
async function recordWorkflowStageEvent(sql, userId, workflowId, stageIndex, source, eventKey, kind, message, stageId, target = null) {
  await sql`INSERT INTO workflow_stage_events (user_id, workflow_id, stage_index, stage_id, source, target, event_key, kind, message) VALUES (${userId}, ${workflowId}, ${stageIndex}, ${stageId}, ${source}, ${target}, ${eventKey}, ${kind}, ${message}) ON CONFLICT (user_id, event_key) DO NOTHING`;
}
async function recordOperationAuditForUser(sql, userId, installationId, entry) {
  await sql`INSERT INTO workflow_operation_audit_logs (user_id, installation_id, action, outcome, repository, workflow_id, stage_id, source, target, pull_number, run_id, metadata, failure_reason) VALUES (${userId}, ${installationId || null}, ${entry.action}, ${entry.outcome}, ${entry.repository}, ${entry.workflowId}, ${entry.stageId}, ${entry.source}, ${entry.target}, ${entry.pullNumber}, ${entry.runId}, ${sql.json(JSON.parse(JSON.stringify(entry.metadata)))}, ${entry.failureReason?.slice(0, 800) || null})`;
}
async function recordOperationAudit(environment, identity, entry) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  await recordOperationAuditForUser(query(environment), user.id, identity.installationId, entry);
}
async function listOperationAuditLogs(environment, identity, limit = 100) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const safeLimit = Math.max(1, Math.min(500, Number.isInteger(limit) ? limit : 100));
  const rows = await query(environment)`SELECT id, action, outcome, repository, workflow_id, stage_id, source, target, pull_number, run_id, metadata, failure_reason, occurred_at FROM workflow_operation_audit_logs WHERE user_id = ${user.id} ORDER BY occurred_at DESC, id DESC LIMIT ${safeLimit}`;
  return rows.map((row) => ({ id: row.id, action: row.action, outcome: row.outcome, repository: row.repository, workflowId: row.workflow_id, stageId: row.stage_id, source: row.source, target: row.target, pullNumber: row.pull_number, runId: row.run_id === null ? null : Number(row.run_id), metadata: row.metadata || {}, failureReason: row.failure_reason, occurredAt: row.occurred_at }));
}
function requestUser(reads, load) {
  if (!reads) return load();
  return reads.user ??= load();
}
async function userForLogin(environment, login, githubUserId, installationId, reads) {
  return requestUser(reads, async () => {
    const sql = query(environment);
    const rows = await sql`INSERT INTO pr_helper_users (github_login, github_user_id, github_installation_id) VALUES (${login}, ${githubUserId || null}, ${installationId || null}) ON CONFLICT (github_login) DO UPDATE SET github_user_id = COALESCE(EXCLUDED.github_user_id, pr_helper_users.github_user_id), github_installation_id = COALESCE(EXCLUDED.github_installation_id, pr_helper_users.github_installation_id), updated_at = now() RETURNING id`;
    return rows[0];
  });
}
async function hasPushSubscription(environment, identity) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const rows = await sql`SELECT id FROM pr_helper_push_subscriptions WHERE user_id = ${user.id} LIMIT 1`;
  return rows.length > 0;
}
async function savePushSubscription(environment, identity, subscription) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  await sql`INSERT INTO pr_helper_push_subscriptions (user_id, endpoint, subscription) VALUES (${user.id}, ${subscription.endpoint}, ${sql.json(subscription)}) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription, updated_at = now()`;
}
async function removePushSubscription(environment, identity, endpoint) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  await sql`DELETE FROM pr_helper_push_subscriptions WHERE user_id = ${user.id} AND endpoint = ${endpoint}`;
}
async function recordRecoveryEvent(environment, identity, input) {
  if (!input.workflowId || !input.source || !Number.isInteger(input.stageIndex) || input.stageIndex < 0) throw new Error("\u65E0\u6548\u7684\u5931\u8D25\u6062\u590D\u8BB0\u5F55");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await requireWorkflowOperation(sql, user.id, input.workflowId, "actions-rerun");
  const workflow = access.workflow;
  const stage = workflow ? stageForIndex(workflow, input.stageIndex) : void 0;
  if (!workflow || !stage || !branchRuleMatches(stage.source, input.source)) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B\u6B65\u9AA4");
  await recordWorkflowStageEvent(sql, access.ownerUserId, input.workflowId, input.stageIndex, input.source, `${input.workflowId}:${stage.stageId}:${input.source}:actions-rerun:manual:${Date.now()}`, "actions-rerun", "\u5DF2\u91CD\u65B0\u89E6\u53D1\u5931\u8D25\u7684 GitHub Actions", stage.stageId, stage.target);
}
async function rerunFailedActions(environment, identity, input) {
  if (!input.workflowId || !input.source || !Number.isInteger(input.stageIndex) || input.stageIndex < 0) throw new Error("\u65E0\u6548\u7684\u5931\u8D25\u6062\u590D\u8BF7\u6C42");
  if (!identity.installationId) throw new Error("\u5C1A\u672A\u9009\u62E9 GitHub App \u53EF\u8BBF\u95EE\u7684\u4ED3\u5E93");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await requireWorkflowOperation(sql, user.id, input.workflowId, "actions-rerun");
  const workflow = access.workflow;
  const stage = workflow ? stageForIndex(workflow, input.stageIndex) : void 0;
  if (!workflow || !stage || !branchRuleMatches(stage.source, input.source)) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B\u6B65\u9AA4");
  const policy = workflow.recoveryPolicy || DEFAULT_RECOVERY_POLICY;
  const retryRows = await sql`SELECT occurred_at FROM workflow_stage_events WHERE user_id = ${access.ownerUserId} AND workflow_id = ${input.workflowId} AND stage_id = ${stage.stageId} AND source = ${input.source} AND kind = 'actions-rerun' ORDER BY occurred_at DESC LIMIT 100`;
  if (retryRows.length >= policy.maxRetries) throw new Error(`\u5DF2\u8FBE\u5230\u6700\u5927\u91CD\u8BD5\u6B21\u6570\uFF08${policy.maxRetries} \u6B21\uFF09\uFF0C\u8BF7\u4EBA\u5DE5\u5904\u7406\u540E\u518D\u7EE7\u7EED\u3002`);
  const lastRetryAt = retryRows[0]?.occurred_at ? new Date(retryRows[0].occurred_at).getTime() : 0;
  const cooldownRemaining = lastRetryAt ? policy.cooldownSeconds * 1e3 - (Date.now() - lastRetryAt) : 0;
  if (cooldownRemaining > 0) throw new Error(`\u8BF7\u7B49\u5F85 ${Math.ceil(cooldownRemaining / 1e3)} \u79D2\u540E\u518D\u91CD\u8BD5\u3002`);
  const stateRows = await sql`SELECT head_sha FROM workflow_stage_states WHERE user_id = ${access.ownerUserId} AND workflow_id = ${input.workflowId} AND stage_id = ${stage.stageId} AND source = ${input.source} LIMIT 1`;
  const headSha = stateRows[0]?.head_sha;
  if (!headSha) throw new Error("\u5F53\u524D\u6B65\u9AA4\u6CA1\u6709\u53EF\u91CD\u8BD5\u7684\u63D0\u4EA4\u72B6\u6001");
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const runs = await installationRequest(config, identity.installationId, `/repos/${owner}/${name}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=100`);
  const failed = runs.workflow_runs.filter((run) => ["failure", "cancelled", "timed_out", "action_required"].includes(run.conclusion || ""));
  if (!failed.length) throw new Error("\u6CA1\u6709\u627E\u5230\u53EF\u91CD\u8BD5\u7684\u5931\u8D25 Actions");
  await Promise.all(failed.map((run) => installationRequest(config, identity.installationId, `/repos/${owner}/${name}/actions/runs/${run.id}/rerun`, { method: "POST" })));
  await recordWorkflowStageEvent(sql, access.ownerUserId, input.workflowId, input.stageIndex, input.source, `${input.workflowId}:${stage.stageId}:${input.source}:actions-rerun:${headSha}:${retryRows.length + 1}`, "actions-rerun", "\u5DF2\u91CD\u65B0\u89E6\u53D1\u5931\u8D25\u7684 GitHub Actions", stage.stageId, stage.target);
  await recordOperationAuditForUser(sql, access.ownerUserId, identity.installationId, {
    action: "actions-rerun",
    outcome: "success",
    repository: workflow.repository,
    workflowId: input.workflowId,
    stageId: stage.stageId,
    source: input.source,
    target: stage.target,
    pullNumber: null,
    runId: null,
    metadata: { headSha, runs: failed.map((run) => run.id), retry: retryRows.length + 1 },
    failureReason: null
  });
  return { count: failed.length };
}
async function requestDeploymentRollback(environment, identity, input) {
  if (!input.workflowId || !input.source || !Number.isInteger(input.stageIndex) || input.stageIndex < 0 || !["vercel", "cloudflare"].includes(input.provider) || !Number.isInteger(input.runId) || input.runId <= 0) throw new Error("\u65E0\u6548\u7684\u90E8\u7F72\u56DE\u6EDA\u8BF7\u6C42");
  if (!identity.installationId) throw new Error("\u5C1A\u672A\u9009\u62E9 GitHub App \u53EF\u8BBF\u95EE\u7684\u4ED3\u5E93");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await requireWorkflowOperation(sql, user.id, input.workflowId, "deployment-rollback");
  const workflow = access.workflow;
  const stage = workflow ? stageForIndex(workflow, input.stageIndex) : void 0;
  if (!workflow || !stage) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B\u6B65\u9AA4");
  const deployment = deploymentConfigsForTarget(workflow, stage.target).find((candidate) => candidate.provider === input.provider);
  if (!deployment?.rollbackWorkflowName) throw new Error("\u8BE5\u90E8\u7F72\u95E8\u7981\u672A\u914D\u7F6E\u56DE\u6EDA\u5DE5\u4F5C\u6D41");
  if (access.team) assertTeamOperation(access.team.role, "deployment-rollback", deployment.environment);
  const runs = await sql`SELECT deployment_url, state FROM workflow_stage_deployment_runs WHERE user_id = ${access.ownerUserId} AND workflow_id = ${input.workflowId} AND stage_id = ${stage.stageId} AND source = ${input.source} AND provider = ${input.provider} AND run_id = ${input.runId} LIMIT 1`;
  if (!runs.length || !rollbackDeploymentIsAvailable({ state: runs[0].state, deploymentUrl: runs[0].deployment_url })) throw new Error("\u53EA\u80FD\u56DE\u6EDA\u5230\u5DF2\u6210\u529F\u4E14\u5E26\u6709\u90E8\u7F72\u5730\u5740\u7684\u5386\u53F2\u7248\u672C");
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const available = await installationRequest(config, identity.installationId, `/repos/${owner}/${name}/actions/workflows?per_page=100`);
  const rollbackWorkflow = available.workflows.find((candidate) => candidate.state === "active" && (candidate.name === deployment.rollbackWorkflowName || candidate.path === deployment.rollbackWorkflowName));
  if (!rollbackWorkflow) throw new Error(`\u672A\u627E\u5230\u53EF\u7528\u7684\u56DE\u6EDA\u5DE5\u4F5C\u6D41\uFF1A${deployment.rollbackWorkflowName}`);
  const rollbackEventKey = `${input.workflowId}:${stage.stageId}:${input.source}:rollback:${input.provider}:${input.runId}`;
  const alreadyTriggered = await sql`SELECT id FROM workflow_stage_events WHERE user_id = ${access.ownerUserId} AND event_key = ${rollbackEventKey} LIMIT 1`;
  if (alreadyTriggered.length) throw new Error("\u8BE5\u90E8\u7F72\u56DE\u6EDA\u5DF2\u89E6\u53D1\uFF0C\u8BF7\u7B49\u5F85 GitHub Actions \u8FD4\u56DE\u7ED3\u679C\u3002");
  await installationRequest(config, identity.installationId, `/repos/${owner}/${name}/actions/workflows/${encodeURIComponent(String(rollbackWorkflow.id))}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: deployment.target,
      inputs: {
        target_run_id: String(input.runId),
        deployment_url: runs[0].deployment_url || "",
        environment: deployment.environment,
        provider: deployment.provider
      }
    })
  });
  const providerName = input.provider === "vercel" ? "Vercel" : "Cloudflare Pages";
  await recordWorkflowStageEvent(sql, access.ownerUserId, input.workflowId, input.stageIndex, input.source, rollbackEventKey, "deployment-rollback", `\u5DF2\u786E\u8BA4\u89E6\u53D1 ${providerName} \u56DE\u6EDA\u5230\u90E8\u7F72 #${input.runId}`, stage.stageId, stage.target);
  await recordOperationAuditForUser(sql, access.ownerUserId, identity.installationId, {
    action: "deployment-rollback",
    outcome: "success",
    repository: workflow.repository,
    workflowId: input.workflowId,
    stageId: stage.stageId,
    source: input.source,
    target: stage.target,
    pullNumber: null,
    runId: input.runId,
    metadata: { provider: input.provider, environment: deployment.environment, rollbackWorkflow: rollbackWorkflow.name },
    failureReason: null
  });
  return { workflowName: rollbackWorkflow.name };
}
async function codexRepairContext(environment, identity, workflowId, stageIndex, source, requestedPullNumber) {
  if (!Number.isInteger(stageIndex) || stageIndex < 0) throw new Error("\u65E0\u6548\u7684\u6D41\u7A0B\u6B65\u9AA4");
  if (!identity.installationId) throw new Error("\u5C1A\u672A\u9009\u62E9 GitHub App \u53EF\u8BBF\u95EE\u7684\u4ED3\u5E93");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await requireWorkflowOperation(sql, user.id, workflowId, "workflow-view");
  const workflow = access.workflow;
  const stage = workflow ? stageForIndex(workflow, stageIndex) : void 0;
  if (!workflow || !stage) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B\u6B65\u9AA4");
  const states = source ? await sql`SELECT pull_number FROM workflow_stage_states WHERE user_id = ${access.ownerUserId} AND workflow_id = ${workflowId} AND stage_id = ${stage.stageId} AND source = ${source}` : await sql`SELECT pull_number FROM workflow_stage_states WHERE user_id = ${access.ownerUserId} AND workflow_id = ${workflowId} AND stage_id = ${stage.stageId}`;
  const pullNumber = selectRepairPullNumber(states, requestedPullNumber);
  if (!pullNumber) throw new Error("\u8BE5\u6B65\u9AA4\u6CA1\u6709\u53EF\u7528\u4E8E\u4FEE\u590D\u7684 PR");
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const pull = await installationRequest(config, identity.installationId, `/repos/${owner}/${name}/pulls/${pullNumber}`);
  const expectedSource = source || stage.source;
  if (expectedSource.includes("*") || pull.head.ref !== expectedSource || pull.base.ref !== stage.target) throw new Error("\u8BE5 PR \u4E0E\u5F53\u524D\u6D41\u7A0B\u6B65\u9AA4\u4E0D\u5339\u914D");
  const checkedSha = repairCommitSha(pull);
  const [checks, commitStatuses, files, actionRuns] = await Promise.all([
    installationRequest(config, identity.installationId, `/repos/${owner}/${name}/commits/${checkedSha}/check-runs?per_page=100`),
    installationRequest(config, identity.installationId, `/repos/${owner}/${name}/commits/${checkedSha}/status`),
    installationRequest(config, identity.installationId, `/repos/${owner}/${name}/pulls/${pullNumber}/files?per_page=100`),
    installationRequest(config, identity.installationId, `/repos/${owner}/${name}/actions/runs?head_sha=${checkedSha}&per_page=20`).catch(() => ({ workflow_runs: [] }))
  ]);
  const failedRuns = actionRuns.workflow_runs.filter((run) => ["failure", "cancelled", "timed_out", "action_required"].includes(run.conclusion || ""));
  const failedJobs = (await Promise.all(failedRuns.map(async (run) => ({ run, jobs: await installationRequest(config, identity.installationId, `/repos/${owner}/${name}/actions/runs/${run.id}/jobs?per_page=100`).catch(() => ({ jobs: [] })) })))).flatMap(({ run, jobs }) => jobs.jobs.filter((job) => ["failure", "cancelled", "timed_out", "action_required"].includes(job.conclusion || "")).map((job) => ({ ...job, run })));
  const failedChecks = [
    ...checks.check_runs.filter((check) => ["failure", "cancelled", "timed_out", "action_required"].includes(check.conclusion || "")).map((check) => {
      const details = compactFailureDetails([check.output?.title, check.output?.summary, check.output?.text]);
      return `- ${check.name || "Check"}${check.details_url ? `: ${check.details_url}` : ""}${details ? `
  - \u9519\u8BEF\u6458\u8981\uFF1A${details}` : ""}`;
    }),
    ...commitStatuses.statuses.filter((status) => ["failure", "error"].includes(status.state)).map((status) => `- ${status.context || "Commit status"}${status.target_url ? `: ${status.target_url}` : ""}`)
  ];
  const fileSummary = files.map((file) => `- \`${file.filename}\` (${file.status}, +${file.additions}/-${file.deletions})${file.patch ? `
  - diff: \`${file.patch.replaceAll("`", "'").replace(/\s+/g, " ").slice(0, 360)}\`` : ""}`).join("\n");
  const failedJobSummary = failedJobs.length ? failedJobs.map((job) => {
    const failedSteps = job.steps?.filter((step) => ["failure", "cancelled", "timed_out", "action_required"].includes(step.conclusion || "")).map((step) => step.name) || [];
    return `- [${job.run.name} / ${job.name}](${job.html_url || job.run.html_url})${failedSteps.length ? `
  - \u5931\u8D25\u6B65\u9AA4\uFF1A${failedSteps.join("\u3001")}` : ""}`;
  }).join("\n") : failedRuns.length ? failedRuns.map((run) => `- [${run.name}](${run.html_url})
  - \u672A\u8BFB\u53D6\u5230\u5931\u8D25 Job\uFF1B\u8BF7\u6253\u5F00\u8BE5\u8FD0\u884C\u65E5\u5FD7\u786E\u8BA4\u3002`).join("\n") : "- \u672A\u8BFB\u53D6\u5230 Actions Job\uFF1B\u8BF7\u4ECE PR \u94FE\u63A5\u8FDB\u5165 Actions \u65E5\u5FD7\u3002";
  const failedDeployments = failedRuns.flatMap((run) => {
    const provider = deploymentProviderForWorkflowRun(run.name, deploymentConfigsForTarget(workflow, stage.target));
    return provider ? [`- ${provider === "vercel" ? "Vercel" : "Cloudflare Pages"} \u516C\u7F51\u90E8\u7F72\uFF1A[${run.name}](${run.html_url})`] : [];
  });
  const markdown = `# \u4FEE\u590D CI \u5931\u8D25

## \u76EE\u6807
\u4FEE\u590D\u5F53\u524D PR \u7684\u5931\u8D25\u95E8\u7981\uFF1B\u8FD0\u884C\u76F8\u5173\u6D4B\u8BD5\u540E\u6C47\u62A5\u7ED3\u679C\u3002\u4E0D\u8981\u6267\u884C git push\u3001\u521B\u5EFA PR \u6216\u5408\u5E76\u3002

## PR
- \u4ED3\u5E93\uFF1A\`${workflow.repository}\`
- PR\uFF1A[#${pullNumber} ${pull.title}](${pull.html_url})
- \u5206\u652F\uFF1A\`${pull.head.ref}\` \u2192 \`${pull.base.ref}\`
- \u68C0\u67E5 SHA\uFF1A\`${checkedSha}\`${pull.merged_at ? "\uFF08\u5408\u5E76\u63D0\u4EA4\uFF09" : ""}
- \u6D41\u7A0B\u6B65\u9AA4\uFF1A${stageIndex + 1}\uFF08\`${stage.source}\` \u2192 \`${stage.target}\`\uFF09

## \u5931\u8D25\u68C0\u67E5
${failedChecks.length ? failedChecks.join("\n") : "- GitHub \u672A\u8FD4\u56DE\u5177\u4F53\u5931\u8D25 check\uFF1B\u8BF7\u6253\u5F00 PR \u7684 Actions \u9875\u9762\u786E\u8BA4\u3002"}

## \u5931\u8D25 Actions Job
${failedJobSummary}

${failedDeployments.length ? `## \u5931\u8D25\u7684\u516C\u7F51\u90E8\u7F72
${failedDeployments.join("\n")}

` : ""}## PR \u6539\u52A8\u6458\u8981
${fileSummary || "- \u672A\u8BFB\u53D6\u5230\u6539\u52A8\u6587\u4EF6\u3002"}

## \u6267\u884C\u8981\u6C42
1. \u5728\u672C\u5730\u590D\u73B0\u5931\u8D25\uFF0C\u4F18\u5148\u9605\u8BFB\u4E0A\u65B9\u5931\u8D25 Job \u65E5\u5FD7\u4E0E\u9519\u8BEF\u6458\u8981\u3002
2. \u53EA\u4FEE\u6539\u89E3\u51B3\u672C\u6B21 CI \u5931\u8D25\u6240\u9700\u7684\u4EE3\u7801\u3002
3. \u8FD0\u884C\u6700\u5C0F\u76F8\u5173\u6D4B\u8BD5\uFF1B\u82E5\u53EF\u884C\u518D\u8FD0\u884C\u5B8C\u6574\u68C0\u67E5\u3002
4. \u8F93\u51FA\u6839\u56E0\u3001\u4FEE\u6539\u5185\u5BB9\u3001\u6267\u884C\u8FC7\u7684\u547D\u4EE4\u548C\u7ED3\u679C\u3002`;
  return { markdown, pullNumber, pullUrl: pull.html_url };
}
function generationRuleContentHash(content) {
  return createHash2("sha256").update(content).digest("hex");
}
function generationRuleContent(rule, contentByHash) {
  if (rule.content?.trim()) return rule.content;
  const stored = rule.contentHash ? contentByHash.get(rule.contentHash) : void 0;
  if (!stored?.trim()) throw new Error("\u81EA\u52A8\u5316\u52A8\u4F5C\u7F3A\u5C11\u751F\u6210\u89C4\u5219\u5185\u5BB9");
  return stored;
}
function dehydrateGenerationRules(workflow) {
  const rules = /* @__PURE__ */ new Map();
  const stages = workflow.stages.map((stage) => {
    const rule = stage.automation?.generationRule;
    if (!rule?.content) return stage;
    const contentHash = generationRuleContentHash(rule.content);
    rules.set(contentHash, rule.content);
    return { ...stage, automation: { ...stage.automation, generationRule: { name: rule.name, capturedAt: rule.capturedAt, contentHash } } };
  });
  if (!rules.size) return { workflow, rules: [] };
  return { workflow: { ...workflow, stages }, rules: [...rules].map(([contentHash, content]) => ({ contentHash, content })) };
}
function generationRuleHashes(workflow) {
  return workflow.stages.flatMap((stage) => {
    const rule = stage.automation?.generationRule;
    return rule?.contentHash && !rule.content?.trim() ? [rule.contentHash] : [];
  });
}
function generationRuleKey(userId, contentHash) {
  return `${userId}:${contentHash}`;
}
function hydrateGenerationRules(workflow, userId, contentByKey) {
  let filled = false;
  const stages = workflow.stages.map((stage) => {
    const rule = stage.automation?.generationRule;
    if (!rule?.contentHash || rule.content?.trim()) return stage;
    const content = contentByKey.get(generationRuleKey(userId, rule.contentHash));
    if (!content) return stage;
    filled = true;
    return { ...stage, automation: { ...stage.automation, generationRule: { ...rule, content } } };
  });
  return filled ? { ...workflow, stages } : workflow;
}
async function generationRuleContentsFor(sql, entries) {
  const wanted = /* @__PURE__ */ new Set();
  const userIds = /* @__PURE__ */ new Set();
  const hashes = /* @__PURE__ */ new Set();
  for (const entry of entries) for (const hash of generationRuleHashes(entry.workflow)) {
    wanted.add(generationRuleKey(entry.userId, hash));
    userIds.add(entry.userId);
    hashes.add(hash);
  }
  if (!wanted.size) return /* @__PURE__ */ new Map();
  const rows = await sql`SELECT user_id, content_hash, content FROM pr_helper_generation_rules WHERE user_id = ANY(${[...userIds]}::uuid[]) AND content_hash = ANY(${[...hashes]}::text[])`;
  return new Map(rows.map((row) => [generationRuleKey(row.user_id, row.content_hash), row.content]).filter(([key]) => wanted.has(key)));
}
async function resolveGenerationRuleContent(sql, userId, rule) {
  if (rule.content?.trim()) return rule.content;
  const rows = rule.contentHash ? await sql`SELECT content FROM pr_helper_generation_rules WHERE user_id = ${userId} AND content_hash = ${rule.contentHash} LIMIT 1` : [];
  return generationRuleContent(rule, new Map(rows.map((row) => [rule.contentHash, row.content])));
}
function isStoredStageAutomation(value) {
  if (!value || typeof value !== "object") return false;
  const automation = value;
  if (automation.autoCreatePullRequest !== true) return automation.autoMergePullRequest === true && automation.executionMode === "server";
  if (automation.executionMode === "browser-session") return automation.autoMergePullRequest === void 0;
  const rule = automation.generationRule;
  const resolvable = typeof rule?.content === "string" && rule.content.length > 0 || typeof rule?.contentHash === "string" && rule.contentHash.length > 0;
  return automation.executionMode === "server" && typeof rule?.name === "string" && rule.name.length > 0 && resolvable && typeof rule?.capturedAt === "string" && !Number.isNaN(Date.parse(rule.capturedAt));
}
function isStoredWorkflow(value) {
  if (!value || typeof value !== "object") return false;
  const workflow = value;
  return typeof workflow.id === "string" && typeof workflow.name === "string" && typeof workflow.repository === "string" && (workflow.createdAt === void 0 || typeof workflow.createdAt === "string" && !Number.isNaN(Date.parse(workflow.createdAt))) && (workflow.position === void 0 || Number.isInteger(workflow.position) && workflow.position >= 0) && (workflow.version === void 0 || Number.isInteger(workflow.version) && workflow.version >= 0) && (workflow.archived === void 0 || workflow.archived === true) && Array.isArray(workflow.stages) && workflow.stages.length > 0 && (workflow.deployments === void 0 || Array.isArray(workflow.deployments) && workflow.deployments.every((deployment) => Boolean(deployment) && typeof deployment.target === "string" && deployment.target.length > 0 && ["vercel", "cloudflare"].includes(deployment.provider || "") && typeof deployment.workflowName === "string" && deployment.workflowName.length > 0 && ["preview", "production"].includes(deployment.environment || "") && (deployment.githubEnvironment === void 0 || typeof deployment.githubEnvironment === "string") && (deployment.healthCheckPath === void 0 || typeof deployment.healthCheckPath === "string" && deployment.healthCheckPath.startsWith("/")) && (deployment.rollbackWorkflowName === void 0 || typeof deployment.rollbackWorkflowName === "string" && deployment.rollbackWorkflowName.length > 0))) && (workflow.recoveryPolicy === void 0 || typeof workflow.recoveryPolicy === "object" && typeof workflow.recoveryPolicy.maxRetries === "number" && workflow.recoveryPolicy.maxRetries >= 0 && workflow.recoveryPolicy.maxRetries <= 20 && typeof workflow.recoveryPolicy.cooldownSeconds === "number" && workflow.recoveryPolicy.cooldownSeconds >= 0 && workflow.recoveryPolicy.cooldownSeconds <= 86400) && workflow.stages.every((stage, index) => Boolean(stage) && typeof stage.source === "string" && typeof stage.target === "string" && stage.source.length > 0 && stage.target.length > 0 && (stage.independent === void 0 || typeof stage.independent === "boolean") && (stage.waitFor === void 0 || Array.isArray(stage.waitFor) && stage.waitFor.every((dependency) => Number.isInteger(dependency) && dependency >= 0 && dependency < index)) && (stage.stageId === void 0 || typeof stage.stageId === "string" && stage.stageId.length > 0) && (stage.automation === void 0 || isStoredStageAutomation(stage.automation)));
}
function sortStoredWorkflows(workflows) {
  return workflows.map((workflow, index) => ({ workflow, index })).sort((left, right) => {
    const leftPosition = left.workflow.position;
    const rightPosition = right.workflow.position;
    if (leftPosition === void 0 && rightPosition === void 0) return left.index - right.index;
    if (leftPosition === void 0) return 1;
    if (rightPosition === void 0) return -1;
    return leftPosition - rightPosition || left.index - right.index;
  }).map(({ workflow }) => workflow);
}
function storedWorkflowFromPayload(payload) {
  const value = typeof payload === "string" ? (() => {
    try {
      return JSON.parse(payload);
    } catch {
      return void 0;
    }
  })() : payload;
  return isStoredWorkflow(value) ? value : void 0;
}
function matchingWorkflowStages(workflows, pull) {
  return workflows.flatMap((workflow) => workflow.repository !== pull.repository ? [] : workflow.stages.flatMap((stage, stageIndex) => branchRuleMatches(stage.source, pull.source) && stage.target === pull.target ? [{ workflow, stageIndex }] : []));
}
function isBranchRule(source) {
  return source.length > 2 && source.endsWith("*") && source.indexOf("*") === source.length - 1;
}
function branchRuleMatches(rule, branch) {
  return isBranchRule(rule) ? branch.startsWith(rule.slice(0, -1)) : rule === branch;
}
function webhookCanChangeStageState(eventName, action) {
  if (eventName === "check_run") return action !== "created";
  if (eventName === "workflow_run") return action !== "in_progress";
  return true;
}
function webhookBranchesForEvent(eventName, payload) {
  const candidates = (() => {
    switch (eventName) {
      case "push": {
        const ref = typeof payload.ref === "string" ? payload.ref : "";
        return ref.startsWith("refs/heads/") ? [ref.slice("refs/heads/".length)] : [];
      }
      case "pull_request":
        return [payload.pull_request?.head?.ref, payload.pull_request?.base?.ref];
      case "check_run":
        return [payload.check_run?.check_suite?.head_branch];
      case "check_suite":
        return [payload.check_suite?.head_branch];
      case "workflow_run":
        return [payload.workflow_run?.head_branch];
      case "status":
        return (Array.isArray(payload.branches) ? payload.branches : []).map((branch) => branch?.name);
      default:
        return null;
    }
  })();
  return candidates && [...new Set(candidates.filter((branch) => typeof branch === "string" && branch.length > 0))];
}
function reconciliationBranchScope(stage, branches) {
  if (branches.includes(stage.target)) return "all";
  return branches.some((branch) => branchRuleMatches(stage.source, branch)) ? "matching" : "none";
}
function branchSourcesForRule(rule, candidates) {
  return [...new Set(candidates.filter((source) => branchRuleMatches(rule, source)))];
}
function dynamicSourceCandidates(rule, branchNames, pullSources, savedSources, target) {
  return branchSourcesForRule(rule, [
    ...branchNames,
    ...pullSources.filter((pull) => !pull.target || pull.target === target).map((pull) => pull.source || "").filter(Boolean),
    ...savedSources
  ]);
}
function withoutTeamAccess(workflow) {
  const { team: _team, ...stored } = workflow;
  return stored;
}
async function workflowAccessForUser(sql, userId, workflowId) {
  const owned = await sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${userId} AND workflows.id = ${workflowId} LIMIT 1`;
  const ownedWorkflow = trackedWorkflowFromSingleRow(owned);
  if (ownedWorkflow) return { ownerUserId: userId, workflow: ensureStageIds(ownedWorkflow) };
  const shared = await sql`
    SELECT shared.owner_user_id, ${trackedWorkflowColumns(sql)}, teams.id AS team_id, teams.name AS team_name, members.role
    FROM pr_helper_team_workflows shared
    JOIN pr_helper_team_members members ON members.team_id = shared.team_id
    JOIN pr_helper_teams teams ON teams.id = shared.team_id
    JOIN pr_helper_workflows workflows ON workflows.user_id = shared.owner_user_id AND workflows.id = shared.workflow_id
    WHERE members.user_id = ${userId} AND shared.workflow_id = ${workflowId}
    ORDER BY CASE members.role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END DESC
    LIMIT 1`;
  const row = shared[0];
  const workflow = trackedWorkflowFromSingleRow(shared);
  return row && workflow ? {
    ownerUserId: row.owner_user_id,
    workflow: { ...ensureStageIds(workflow), team: { id: row.team_id, name: row.team_name, role: row.role } },
    team: { id: row.team_id, name: row.team_name, role: row.role }
  } : null;
}
async function requireWorkflowOperation(sql, userId, workflowId, operation, environment = "preview") {
  const access = await workflowAccessForUser(sql, userId, workflowId);
  if (!access) throw new Error("\u672A\u627E\u5230\u6D41\u7A0B\u6216\u672A\u83B7\u5F97\u5171\u4EAB\u6D41\u7A0B\u8BBF\u95EE\u6743\u9650");
  if (access.team) assertTeamOperation(access.team.role, operation, environment);
  return access;
}
function visibleWorkflowPredicate(sql, userId, ownerColumn, workflowColumn) {
  const owner = sql.unsafe(ownerColumn);
  const workflow = sql.unsafe(workflowColumn);
  return sql`${owner} = ${userId} OR EXISTS (
    SELECT 1 FROM pr_helper_team_workflows shared
    JOIN pr_helper_team_members members ON members.team_id = shared.team_id
    WHERE shared.owner_user_id = ${owner} AND shared.workflow_id = ${workflow} AND members.user_id = ${userId}
  )`;
}
function visibleWorkflowRows(sql, userId, reads) {
  const read = () => sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE ${visibleWorkflowPredicate(sql, userId, "workflows.user_id", "workflows.id")}`;
  if (!reads) return read();
  return reads.workflows ??= read();
}
function visibleStageStateRows(sql, userId, reads) {
  const read = () => sql`SELECT states.workflow_id, states.stage_index, states.stage_id, states.repository, states.source, states.target, states.pull_number, states.pull_state, states.merged_at, states.head_sha, states.checks_state, states.checks_passed, states.checks_total, states.approvals, states.required_approvals, states.mergeable, states.mergeable_state, states.ahead_by, states.last_event, states.updated_at FROM workflow_stage_states states WHERE ${visibleWorkflowPredicate(sql, userId, "states.user_id", "states.workflow_id")} ORDER BY states.workflow_id, states.stage_index`;
  if (!reads) return read();
  return reads.stageStates ??= read();
}
async function authorizeWorkflowOperation(environment, identity, input) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const access = await requireWorkflowOperation(query(environment), user.id, input.workflowId, input.operation, input.environment);
  if (access.workflow.repository !== input.repository) throw new Error("\u6D41\u7A0B\u4E0E GitHub \u4ED3\u5E93\u4E0D\u5339\u914D");
  if (input.source && input.target && !access.workflow.stages.some((stage) => branchRuleMatches(stage.source, input.source) && stage.target === input.target)) throw new Error("\u6D41\u7A0B\u4E2D\u4E0D\u5B58\u5728\u5BF9\u5E94\u7684 Source \u548C Target \u8DEF\u5F84");
  return access;
}
function workflowStageStateMatchesDefinition(workflow, state) {
  const stage = state.stageId ? workflow.stages.find((candidate) => candidate.stageId === state.stageId) : workflow.stages[state.stageIndex];
  return Boolean(stage && stage.target === state.target && branchRuleMatches(stage.source, state.source));
}
async function writeWorkflowRows(sql, userId, workflow) {
  const rows = workflowToRows(userId, workflow);
  const { user_id, id, ...columns } = rows.workflow;
  await sql`UPDATE pr_helper_workflows SET ${sql(columns)} WHERE user_id = ${userId} AND id = ${id}`;
  await sql`DELETE FROM workflow_stages WHERE user_id = ${userId} AND workflow_id = ${id}`;
  if (rows.stages.length) await sql`INSERT INTO workflow_stages ${sql(rows.stages)}`;
  await sql`DELETE FROM workflow_deployment_configs WHERE user_id = ${userId} AND workflow_id = ${id}`;
  if (rows.deployments.length) await sql`INSERT INTO workflow_deployment_configs ${sql(rows.deployments)}`;
}
async function pruneStaleWorkflowStageData(sql, userId, workflow) {
  const states = await sql`SELECT stage_index, stage_id, source, target FROM workflow_stage_states WHERE user_id = ${userId} AND workflow_id = ${workflow.id}`;
  for (const state of states) {
    if (workflowStageStateMatchesDefinition(workflow, { stageIndex: state.stage_index, stageId: state.stage_id, source: state.source, target: state.target })) continue;
    await sql`DELETE FROM workflow_stage_events WHERE user_id = ${userId} AND workflow_id = ${workflow.id} AND stage_id = ${state.stage_id} AND (source = ${state.source} OR source IS NULL)`;
    await sql`DELETE FROM workflow_stage_states WHERE user_id = ${userId} AND workflow_id = ${workflow.id} AND stage_id = ${state.stage_id} AND source = ${state.source}`;
  }
}
function dependencyStageSatisfied(dependencyId, states) {
  const routes = dependencyId ? states.filter((state) => state.stage_id === dependencyId && state.pull_state !== "closed") : [];
  return routes.length > 0 && routes.every((state) => state.pull_state === "merged" && state.checks_state === "success");
}
function stageIsUnlocked(workflow, stageIndex, states) {
  const waitFor = workflow.stages[stageIndex]?.waitFor;
  if (waitFor?.length) return waitFor.every((dependency) => dependencyStageSatisfied(workflow.stages[dependency]?.stageId, states));
  if (workflow.stages[stageIndex]?.independent === true || stageIndex === 0) return true;
  return dependencyStageSatisfied(workflow.stages[stageIndex - 1]?.stageId, states);
}
function stageGateSatisfactionAdvanced(before, after) {
  const satisfied = (pullState, checksState) => pullState === "merged" && checksState === "success";
  return satisfied(after.pullState, after.checksState) && !(before && satisfied(before.pull_state, before.checks_state));
}
function downstreamStagesToRecheck(workflow, advanced) {
  if (!advanced.length) return [];
  return workflow.stages.flatMap((stage, stageIndex) => {
    if (advanced.includes(stageIndex) || stage.independent === true) return [];
    const waitFor = stage.waitFor;
    const waits = waitFor?.length ? waitFor.some((dependency) => advanced.includes(dependency)) : advanced.includes(stageIndex - 1);
    return waits ? [stageIndex] : [];
  });
}
function deriveStageDecision(workflow, stageIndex, state, allStates) {
  const stage = workflow.stages[stageIndex];
  if (!stage || !state.stage_id || state.stage_id !== stage.stageId) return { kind: "none", actionable: false, canCreateNext: false, message: "\u6682\u65E0\u72B6\u6001" };
  const comparableStates = allStates.filter((candidate) => Boolean(candidate.stage_id)).map((candidate) => ({ ...candidate, stage_id: candidate.stage_id }));
  const unlocked = stageIsUnlocked(workflow, stageIndex, comparableStates);
  const canCreateNext = unlocked && state.ahead_by > 0 && state.checks_state !== "failure" && (state.pull_state === "none" || state.pull_state === "merged");
  if (state.pull_state === "merged" && state.checks_state === "failure" && state.ahead_by > 0) {
    return { kind: "superseded", actionable: false, canCreateNext: true, message: "\u4E0A\u4E00\u6B65\u5DF2\u5408\u5E76\uFF0C\u5176\u95E8\u7981\u5931\u8D25\u5C5E\u4E8E\u5DF2\u5408\u5E76\u7684\u63D0\u4EA4\uFF1B\u65B0\u63D0\u4EA4\u53EF\u4EE5\u521B\u5EFA PR" };
  }
  if (state.checks_state === "failure") return { kind: "checks-failed", actionable: true, canCreateNext, message: `\u7B2C ${stageIndex + 1} \u6B65 Actions \u5931\u8D25` };
  if (state.pull_state === "open" && state.approvals < state.required_approvals) return { kind: "needs-approval", actionable: true, canCreateNext, message: `PR \u8FD8\u9700\u8981 ${state.required_approvals - state.approvals} \u4E2A Approval` };
  if (state.pull_state === "open" && state.checks_state === "success" && state.approvals >= state.required_approvals && state.mergeable === true && state.mergeable_state === "clean") return { kind: "ready-to-merge", actionable: true, canCreateNext, message: "PR \u5DF2\u6EE1\u8DB3\u5408\u5E76\u6761\u4EF6" };
  if (state.pull_state === "merged" && state.checks_state === "success") return { kind: "merged", actionable: canCreateNext, canCreateNext, message: canCreateNext ? "\u5DF2\u5408\u5E76\uFF0C\u6709\u65B0\u63D0\u4EA4\u53EF\u4EE5\u521B\u5EFA\u65B0 PR" : "\u5DF2\u5408\u5E76\u4E14\u95E8\u7981\u901A\u8FC7" };
  if (canCreateNext && state.pull_state === "none") return { kind: "ready-to-create", actionable: true, canCreateNext, message: "\u53EF\u4EE5\u521B\u5EFA\u4E0B\u4E00\u6B65 PR" };
  if (canCreateNext) return { kind: "ready-to-create", actionable: true, canCreateNext, message: "\u6709\u65B0\u63D0\u4EA4\uFF0C\u53EF\u4EE5\u521B\u5EFA\u65B0 PR" };
  if (unlocked) return { kind: "waiting", actionable: false, canCreateNext, message: "\u7B49\u5F85 GitHub \u72B6\u6001\u66F4\u65B0" };
  const dependencies = workflow.stages[stageIndex]?.waitFor?.length ? workflow.stages[stageIndex].waitFor : stageIndex > 0 ? [stageIndex - 1] : [];
  const dependencyIds = dependencies.map((index) => workflow.stages[index]?.stageId).filter((id) => Boolean(id));
  const dependencyStates = allStates.filter((candidate) => candidate.stage_id !== null && dependencyIds.includes(candidate.stage_id));
  const checksConfigured = dependencyStates.some((candidate) => (candidate.checks_total || 0) > 0 || candidate.checks_state !== "success");
  return { kind: "locked", actionable: false, canCreateNext, message: checksConfigured ? "\u7B49\u5F85\u524D\u5E8F\u6B65\u9AA4\u5408\u5E76\u4E14\u5408\u5E76\u540E Actions \u6210\u529F\u3002" : "\u7B49\u5F85\u524D\u5E8F\u6B65\u9AA4\u5408\u5E76\u3002" };
}
function actionableStageEntry(decision) {
  if (decision.kind === "merged") return decision.canCreateNext ? { kind: "ready-to-create", message: decision.message } : null;
  if (decision.kind === "superseded") return null;
  if (!decision.actionable || decision.kind === "none" || decision.kind === "locked" || decision.kind === "waiting") return null;
  return { kind: decision.kind, message: decision.message };
}
function initialWebhookChecksState(mergedAt) {
  return mergedAt ? "pending" : "unknown";
}
async function listWorkflows(environment, identity) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const [ownedRows, sharedRows] = await Promise.all([
    sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${user.id} ORDER BY workflows.updated_at DESC`,
    sql`
      SELECT ${trackedWorkflowColumns(sql)}, shared.owner_user_id, teams.id AS team_id, teams.name AS team_name, members.role
      FROM pr_helper_team_workflows shared
      JOIN pr_helper_team_members members ON members.team_id = shared.team_id
      JOIN pr_helper_teams teams ON teams.id = shared.team_id
      JOIN pr_helper_workflows workflows ON workflows.user_id = shared.owner_user_id AND workflows.id = shared.workflow_id
      WHERE members.user_id = ${user.id}
      ORDER BY workflows.updated_at DESC`
  ]);
  const owned = ownedRows.map((row) => {
    const workflow = trackedWorkflowFromRow(row);
    if (!workflow) return void 0;
    const normalized = ensureStageIds(workflow);
    return row.version && row.version > 0 ? { ...normalized, version: row.version } : normalized;
  }).filter((workflow) => Boolean(workflow)).map((workflow) => ({ userId: user.id, workflow }));
  const sharedByWorkflow = /* @__PURE__ */ new Map();
  for (const row of sharedRows) {
    const workflow = trackedWorkflowFromRow(row);
    if (!workflow || sharedByWorkflow.has(workflow.id)) continue;
    const normalized = ensureStageIds(workflow);
    sharedByWorkflow.set(workflow.id, {
      userId: row.owner_user_id,
      workflow: {
        ...row.version && row.version > 0 ? { ...normalized, version: row.version } : normalized,
        team: { id: row.team_id, name: row.team_name, role: row.role }
      }
    });
  }
  const entries = [...owned, ...sharedByWorkflow.values()];
  const contentByKey = await generationRuleContentsFor(sql, entries);
  return sortStoredWorkflows(entries.map((entry) => hydrateGenerationRules(entry.workflow, entry.userId, contentByKey)));
}
function workflowArchiveTransition(previous, next) {
  const before = previous?.archived === true;
  const after = next.archived === true;
  if (before === after) return "none";
  return after ? "archived" : "restored";
}
function serverAutomationActivated(previous, next) {
  const serverMode = (stage) => stage?.automation?.executionMode === "server";
  const create = (stage) => serverMode(stage) && stage.automation.autoCreatePullRequest === true;
  const merge = (stage) => serverMode(stage) && stage.automation.autoMergePullRequest === true;
  const before = new Map((previous?.stages || []).map((stage) => [stage.stageId, stage]));
  return {
    create: next.stages.some((stage) => create(stage) && !create(before.get(stage.stageId))),
    merge: next.stages.some((stage) => merge(stage) && !merge(before.get(stage.stageId)))
  };
}
function stageGateChanged(previous, next) {
  if (!previous) return false;
  const gate = (stage) => `${stage?.independent === true}|${(stage?.waitFor || []).join(",")}`;
  const before = new Map(previous.stages.map((stage) => [stage.stageId, stage]));
  return next.stages.some((stage) => before.has(stage.stageId) && gate(stage) !== gate(before.get(stage.stageId)));
}
function workflowSaveConflicts(hasPrevious, latestVersion, version) {
  if (!hasPrevious || latestVersion === null || latestVersion === void 0 || latestVersion === 0) return false;
  return typeof version !== "number" || version !== latestVersion;
}
async function upsertWorkflow(environment, identity, workflow) {
  if (!isStoredWorkflow(workflow)) throw new Error("\u6D41\u7A0B\u6570\u636E\u65E0\u6548");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const existingAccess = await workflowAccessForUser(sql, user.id, workflow.id);
  if (existingAccess?.team) assertTeamOperation(existingAccess.team.role, "workflow-edit");
  const ownerUserId = existingAccess?.ownerUserId || user.id;
  const previousRows = await sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${ownerUserId} AND workflows.id = ${workflow.id}`;
  const previous = previousRows[0] ? trackedWorkflowFromRow(previousRows[0]) ?? void 0 : void 0;
  const withIds = ensureStageIds(withoutTeamAccess(workflow));
  const dehydrated = dehydrateGenerationRules(withIds);
  let savedWorkflow = dehydrated.workflow;
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${`${ownerUserId}:${withIds.id}`}))`;
    const latestRows = await transaction`SELECT version FROM pr_helper_workflows WHERE user_id = ${ownerUserId} AND id = ${withIds.id}`;
    const latestVersion = latestRows[0]?.version ?? null;
    if (workflowSaveConflicts(latestRows.length > 0, latestVersion, workflow.version)) throw new Error("\u6D41\u7A0B\u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u540E\u518D\u4FDD\u5B58\u3002");
    savedWorkflow = { ...dehydrated.workflow, version: (latestVersion || 0) + 1 };
    for (const rule of dehydrated.rules) await transaction`INSERT INTO pr_helper_generation_rules (user_id, content_hash, content) VALUES (${ownerUserId}, ${rule.contentHash}, ${rule.content}) ON CONFLICT (user_id, content_hash) DO NOTHING`;
    await transaction`INSERT INTO pr_helper_workflows (id, user_id, name, repository, archived, muted, version, position, declared_created_at, recovery_max_retries, recovery_cooldown_seconds) VALUES (${savedWorkflow.id}, ${ownerUserId}, ${savedWorkflow.name}, ${savedWorkflow.repository}, ${savedWorkflow.archived === true}, ${savedWorkflow.muted === true}, ${savedWorkflow.version ?? null}, ${savedWorkflow.position ?? null}, ${savedWorkflow.createdAt ?? null}, ${savedWorkflow.recoveryPolicy?.maxRetries ?? null}, ${savedWorkflow.recoveryPolicy?.cooldownSeconds ?? null}) ON CONFLICT (user_id, id) DO UPDATE SET name = EXCLUDED.name, repository = EXCLUDED.repository, archived = EXCLUDED.archived, muted = EXCLUDED.muted, version = EXCLUDED.version, position = EXCLUDED.position, declared_created_at = EXCLUDED.declared_created_at, recovery_max_retries = EXCLUDED.recovery_max_retries, recovery_cooldown_seconds = EXCLUDED.recovery_cooldown_seconds, updated_at = now()`;
    await writeWorkflowRows(transaction, ownerUserId, savedWorkflow);
    if (previous) {
      const changedStageIds = previous.stages.flatMap((stage, index) => {
        const next = withIds.stages[index];
        return !next || stage.stageId !== next.stageId || stage.source !== next.source || stage.target !== next.target ? [stage.stageId].filter((value) => Boolean(value)) : [];
      });
      for (const stageId of changedStageIds) await transaction`DELETE FROM workflow_stage_events WHERE user_id = ${ownerUserId} AND workflow_id = ${savedWorkflow.id} AND stage_id = ${stageId}`;
    }
    await pruneStaleWorkflowStageData(transaction, ownerUserId, savedWorkflow);
    await saveWorkflowVersion(transaction, ownerUserId, savedWorkflow);
    await recordOperationAuditForUser(transaction, ownerUserId, identity.installationId, {
      action: previous ? "workflow-updated" : "workflow-created",
      outcome: "success",
      repository: savedWorkflow.repository,
      workflowId: savedWorkflow.id,
      stageId: null,
      source: null,
      target: null,
      pullNumber: null,
      runId: null,
      metadata: { version: savedWorkflow.version, stageCount: savedWorkflow.stages.length, archived: savedWorkflow.archived === true, muted: savedWorkflow.muted === true },
      failureReason: null
    });
  });
  const archiveTransition = workflowArchiveTransition(previous ?? null, savedWorkflow);
  if (archiveTransition === "archived") {
    await sql`UPDATE workflow_automation_actions SET state = 'cancelled', failure_reason = ${"\u6D41\u7A0B\u5DF2\u5F52\u6863\uFF0C\u81EA\u52A8\u5316\u52A8\u4F5C\u4E0D\u518D\u6267\u884C"}, updated_at = now() WHERE user_id = ${ownerUserId} AND workflow_id = ${savedWorkflow.id} AND state IN ('queued', 'paused')`.catch(() => void 0);
    await sql`UPDATE pr_helper_workflows SET reconcile_pending_since = NULL WHERE user_id = ${ownerUserId} AND id = ${savedWorkflow.id}`.catch(() => void 0);
  }
  const activated = serverAutomationActivated(previous ?? null, savedWorkflow);
  const gatesChanged = stageGateChanged(previous ?? null, savedWorkflow);
  if (activated.create || activated.merge || gatesChanged || archiveTransition === "restored") await sql`UPDATE pr_helper_workflows SET reconcile_pending_since = coalesce(reconcile_pending_since, now()) WHERE user_id = ${ownerUserId} AND id = ${savedWorkflow.id}`.catch(() => void 0);
  return { workflow: existingAccess?.team ? { ...savedWorkflow, team: existingAccess.team } : savedWorkflow, automationActivated: activated, gatesChanged };
}
async function removeWorkflowStage(environment, identity, workflowId, stageId, stageIndex, source, target) {
  if (!workflowId || !stageId) throw new Error("\u65E0\u6548\u7684\u6D41\u7A0B\u6B65\u9AA4");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await requireWorkflowOperation(sql, user.id, workflowId, "workflow-edit");
  let savedWorkflow = null;
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${`${access.ownerUserId}:${workflowId}`}))`;
    const versionRows = await transaction`SELECT version FROM pr_helper_workflows WHERE user_id = ${access.ownerUserId} AND id = ${workflowId} FOR UPDATE`;
    const definitionRows = await transaction`SELECT ${trackedWorkflowColumns(transaction)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${access.ownerUserId} AND workflows.id = ${workflowId}`;
    const previous = trackedWorkflowFromSingleRow(definitionRows);
    if (!previous) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B");
    const removalIndex = findWorkflowStageIndexForRemoval(previous, stageId, stageIndex, source, target);
    if (removalIndex === -1) {
      savedWorkflow = previous;
      return;
    }
    if (previous.stages.length === 1) throw new Error("\u6D41\u7A0B\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u6B65\u9AA4");
    const stages = previous.stages.filter((stage, index) => index !== removalIndex && stage.stageId !== stageId).map((stage) => !stage.waitFor ? stage : { ...stage, waitFor: stage.waitFor.filter((dependency) => dependency !== removalIndex).map((dependency) => dependency > removalIndex ? dependency - 1 : dependency) });
    savedWorkflow = { ...ensureStageIds({ ...previous, stages }), version: (versionRows[0]?.version || 0) + 1 };
    await transaction`UPDATE pr_helper_workflows SET updated_at = now() WHERE user_id = ${access.ownerUserId} AND id = ${workflowId}`;
    await writeWorkflowRows(transaction, access.ownerUserId, savedWorkflow);
    await transaction`DELETE FROM workflow_stage_events WHERE user_id = ${access.ownerUserId} AND workflow_id = ${workflowId} AND stage_id = ${stageId}`;
    await pruneStaleWorkflowStageData(transaction, access.ownerUserId, savedWorkflow);
    await saveWorkflowVersion(transaction, access.ownerUserId, savedWorkflow);
    await recordOperationAuditForUser(transaction, access.ownerUserId, identity.installationId, {
      action: "workflow-updated",
      outcome: "success",
      repository: savedWorkflow.repository,
      workflowId,
      stageId,
      source: null,
      target: null,
      pullNumber: null,
      runId: null,
      metadata: { version: savedWorkflow.version, stageCount: savedWorkflow.stages.length, operation: "stage-deleted" },
      failureReason: null
    });
  });
  if (!savedWorkflow) throw new Error("\u5220\u9664\u6D41\u7A0B\u6B65\u9AA4\u5931\u8D25");
  const result = savedWorkflow;
  return access.team ? { ...result, team: access.team } : result;
}
async function removeWorkflow(environment, identity, workflowId) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await requireWorkflowOperation(sql, user.id, workflowId, "workflow-delete");
  const rows = await sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${access.ownerUserId} AND workflows.id = ${workflowId}`;
  const workflow = rows[0] ? trackedWorkflowFromRow(rows[0]) ?? void 0 : void 0;
  const deleted = await sql`DELETE FROM pr_helper_workflows WHERE user_id = ${access.ownerUserId} AND id = ${workflowId} RETURNING id`;
  if (deleted.length) await recordOperationAuditForUser(sql, access.ownerUserId, identity.installationId, {
    action: "workflow-deleted",
    outcome: "success",
    repository: workflow?.repository || null,
    workflowId,
    stageId: null,
    source: null,
    target: null,
    pullNumber: null,
    runId: null,
    metadata: { name: workflow?.name || null },
    failureReason: null
  });
}
async function recordWebhookDelivery(environment, delivery) {
  const sql = query(environment);
  const rows = await sql`INSERT INTO github_webhook_deliveries (delivery_id, event_name, action, repository, installation_id) VALUES (${delivery.deliveryId}, ${delivery.eventName}, ${delivery.action || null}, ${delivery.repository || null}, ${delivery.installationId || null}) ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id`;
  return rows.length > 0;
}
async function projectPullRequestWebhook(environment, pull) {
  const sql = query(environment);
  if (!pull.installationId) return 0;
  const rows = await sql`SELECT ${trackedWorkflowColumns(sql)}, users.github_installation_id FROM pr_helper_workflows workflows JOIN pr_helper_users users ON users.id = workflows.user_id WHERE workflows.archived = false AND workflows.repository = ${pull.repository} AND users.github_installation_id = ${pull.installationId}`;
  const tracked = rows.flatMap((row) => {
    const workflow = trackedWorkflowFromRow(row);
    return workflow ? [{ userId: row.user_id, workflowId: row.id, workflow: ensureStageIds(workflow) }] : [];
  });
  const matches = tracked.flatMap((item) => matchingWorkflowStages([item.workflow], pull).map((match) => ({ ...item, stageIndex: match.stageIndex, stageId: stageIdentity(item.workflow, match.stageIndex) })));
  const checksState = initialWebhookChecksState(pull.mergedAt);
  await Promise.all(matches.map((match) => sql`INSERT INTO workflow_stage_states (user_id, workflow_id, stage_index, stage_id, repository, source, target, pull_number, pull_state, merged_at, checks_state, checks_passed, checks_total) VALUES (${match.userId}, ${match.workflowId}, ${match.stageIndex}, ${match.stageId}, ${pull.repository}, ${pull.source}, ${pull.target}, ${pull.number}, ${pull.mergedAt ? "merged" : pull.state}, ${pull.mergedAt || null}, ${checksState}, ${0}, ${0}) ON CONFLICT (user_id, workflow_id, stage_id, source) DO UPDATE SET stage_index = EXCLUDED.stage_index, pull_number = EXCLUDED.pull_number, pull_state = EXCLUDED.pull_state, merged_at = EXCLUDED.merged_at, checks_state = CASE WHEN EXCLUDED.merged_at IS NOT NULL THEN EXCLUDED.checks_state ELSE workflow_stage_states.checks_state END, checks_passed = CASE WHEN EXCLUDED.merged_at IS NOT NULL THEN 0 ELSE workflow_stage_states.checks_passed END, checks_total = CASE WHEN EXCLUDED.merged_at IS NOT NULL THEN 0 ELSE workflow_stage_states.checks_total END, updated_at = now()`));
  return matches.length;
}
function missingDeploymentSummary(workflowName) {
  return `\u4ED3\u5E93\u4E2D\u627E\u4E0D\u5230\u540D\u4E3A\u300C${workflowName}\u300D\u7684 Actions \u5DE5\u4F5C\u6D41\uFF0C\u8BE5\u90E8\u7F72\u95E8\u7981\u4F1A\u4E00\u76F4\u505C\u5728\u8FDB\u884C\u4E2D`;
}
function mergeChecksWithDeployments(checks, deployments) {
  if (checks.state === "failure") return checks;
  if (deployments.includes("failure")) return { ...checks, state: "failure" };
  if (deployments.includes("pending")) return { ...checks, state: "pending" };
  return checks;
}
function ownerAndName(repository) {
  const [owner, name] = repository.split("/");
  if (!owner || !name) throw new Error(`\u65E0\u6548\u4ED3\u5E93\uFF1A${repository}`);
  return { owner, name };
}
function pullDetailPath(repository, pullNumber) {
  const { owner, name } = ownerAndName(repository);
  return `/repos/${owner}/${name}/pulls/${pullNumber}`;
}
async function pullForStage(environment, installationId, workflow, stage) {
  const config = parseGithubAppConfig(environment);
  const { owner, name } = ownerAndName(workflow.repository);
  const path = `/repos/${owner}/${name}/pulls?state=all&head=${encodeURIComponent(`${owner}:${stage.source}`)}&base=${encodeURIComponent(stage.target)}&per_page=10`;
  const pulls = await installationRequest(config, installationId, path);
  const pull = pulls[0];
  return pull ? installationRequest(config, installationId, pullDetailPath(workflow.repository, pull.number)) : void 0;
}
async function routeSourcesForStage(environment, sql, row, workflow, stageIndex) {
  const stage = workflow.stages[stageIndex];
  if (!isBranchRule(stage.source)) return [stage.source];
  if (!row.github_installation_id) return [];
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const [branches, pullsByTarget, pulls, saved] = await Promise.all([
    installationRequest(config, row.github_installation_id, `/repos/${owner}/${name}/branches?per_page=100`).catch(() => []),
    installationRequest(config, row.github_installation_id, `/repos/${owner}/${name}/pulls?state=all&base=${encodeURIComponent(stage.target)}&per_page=100`).catch(() => []),
    installationRequest(config, row.github_installation_id, `/repos/${owner}/${name}/pulls?state=all&per_page=100`).catch(() => []),
    sql`SELECT source FROM workflow_stage_states WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageIdentity(workflow, stageIndex)}`
  ]);
  return dynamicSourceCandidates(stage.source, branches.map((branch) => branch.name), [
    ...pullsByTarget.map((pull) => ({ source: pull.head?.ref, target: pull.base?.ref || stage.target })),
    ...pulls.map((pull) => ({ source: pull.head?.ref, target: pull.base?.ref }))
  ], saved.map((state) => state.source), stage.target);
}
function deploymentConfigsForTarget(workflow, target) {
  return deploymentConfigs(workflow).filter((deployment) => deployment.target === target);
}
var STAGE_DEPLOYMENT_COLUMNS = ["stage_index", "environment", "run_id", "run_name", "run_url", "deployment_url", "state", "conclusion", "failure_summary", "failure_job_url", "health_state", "health_url", "health_detail"];
function deploymentRowChanged(previous, next) {
  if (!previous) return true;
  return STAGE_DEPLOYMENT_COLUMNS.some((column) => String(previous[column] ?? "") !== String(next[column] ?? ""));
}
function staleDeploymentProviders(stored, configured) {
  return stored.map((row) => row.provider).filter((provider) => !configured.includes(provider));
}
var TERMINAL_PULL_STATES = ["merged", "closed"];
var TERMINAL_CHECKS_STATES = ["success", "failure"];
function stageReconciliationIsSettled(input) {
  if (input.aheadBy !== 0 || Number(input.storedAheadBy ?? 0) !== 0) return false;
  if (!input.previous) return false;
  if (!TERMINAL_PULL_STATES.includes(input.previous.pull_state)) return false;
  if (!TERMINAL_CHECKS_STATES.includes(input.previous.checks_state)) return false;
  if (input.previous.pull_state === "merged" && input.previous.checks_state === "failure") return false;
  if (!input.deploymentConfigured) return true;
  return input.deploymentStates.length > 0 && input.deploymentStates.every((state) => TERMINAL_CHECKS_STATES.includes(state));
}
function deploymentParentState(workflow, stageIndex, source, headSha) {
  const stage = workflow.stages[stageIndex];
  if (!stage) throw new Error("\u672A\u627E\u5230\u90E8\u7F72\u6240\u5C5E\u7684\u6D41\u7A0B\u6B65\u9AA4");
  return { repository: workflow.repository, source, target: stage.target, headSha };
}
function githubEnvironment(provider, environment) {
  if (provider === "vercel") return `${environment}-vercel`;
  return `${environment}-cloudflare-pages`;
}
async function reconcileStageDeployments(environment, sql, row, workflow, stageIndex, source, target, sha, phase) {
  const configurations = deploymentConfigsForTarget(workflow, target);
  const stageId = stageIdentity(workflow, stageIndex);
  if (!configurations.length) {
    await phase("deployWrite", () => sql`DELETE FROM workflow_stage_deployments WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source}`);
    return [];
  }
  if (!row.github_installation_id) return [];
  const parent = deploymentParentState(workflow, stageIndex, source, sha);
  await phase("deployWrite", () => sql`INSERT INTO workflow_stage_states (user_id, workflow_id, stage_index, stage_id, repository, source, target, pull_state, head_sha, checks_state, checks_passed, checks_total) VALUES (${row.user_id}, ${workflow.id}, ${stageIndex}, ${stageId}, ${parent.repository}, ${parent.source}, ${parent.target}, 'merged', ${parent.headSha}, 'pending', ${0}, ${0}) ON CONFLICT (user_id, workflow_id, stage_id, source) DO UPDATE SET stage_index = EXCLUDED.stage_index, head_sha = EXCLUDED.head_sha`);
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const previousDeployments = await phase("deployRead", () => sql`SELECT provider, stage_index, environment, run_id, run_name, run_url, deployment_url, state, conclusion, failure_summary, failure_job_url, health_state, health_url, health_detail FROM workflow_stage_deployments WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source}`);
  const previousByProvider = new Map(previousDeployments.map((deployment) => [deployment.provider, deployment]));
  const stale = staleDeploymentProviders(previousDeployments, configurations.map((configuration) => configuration.provider));
  if (stale.length) await phase("deployWrite", () => sql`DELETE FROM workflow_stage_deployments WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source} AND provider IN ${sql(stale)}`);
  const actionRuns = await phase("deployRuns", () => installationRequest(config, row.github_installation_id, `/repos/${owner}/${name}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`).catch(() => ({ workflow_runs: [] })));
  const deployments = actionRuns.workflow_runs.map((run) => ({ run, provider: deploymentProviderForWorkflowRun(run.name, configurations) })).filter((item) => Boolean(item.provider)).sort((left, right) => (right.run.created_at || "").localeCompare(left.run.created_at || ""));
  const latestByProvider = /* @__PURE__ */ new Map();
  const stateByProvider = /* @__PURE__ */ new Map();
  deployments.forEach(({ run, provider }) => {
    if (!latestByProvider.has(provider)) latestByProvider.set(provider, run);
  });
  await Promise.all([...latestByProvider].map(async ([provider, run]) => {
    const configuration = configurations.find((item) => item.provider === provider);
    const environmentName = configuration.githubEnvironment || githubEnvironment(provider, configuration.environment);
    const githubDeployments = await phase("deployLookup", () => installationRequest(config, row.github_installation_id, `/repos/${owner}/${name}/deployments?sha=${encodeURIComponent(sha)}&environment=${encodeURIComponent(environmentName)}&per_page=1`).catch(() => []));
    const status = githubDeployments[0] ? await phase("deployLookup", () => installationRequest(config, row.github_installation_id, `/repos/${owner}/${name}/deployments/${githubDeployments[0].id}/statuses?per_page=1`).catch(() => [])) : [];
    const latestStatus = status[0];
    const failure = deploymentRunState(run) === "failure" ? deploymentFailureSummary((await phase("deployJobs", () => installationRequest(config, row.github_installation_id, `/repos/${owner}/${name}/actions/runs/${run.id}/jobs?per_page=100`).catch(() => ({ jobs: [] })))).jobs) : { summary: null, jobUrl: null };
    const actionState = deploymentRunState(run);
    const healthUrl = actionState === "success" && latestStatus?.environment_url && configuration.healthCheckPath ? new URL(configuration.healthCheckPath, latestStatus.environment_url).toString() : null;
    const health = healthUrl && canCheckDeploymentUrl(healthUrl) ? await phase("deployHealth", () => fetch(healthUrl, { signal: AbortSignal.timeout(1e4), redirect: "follow" }).then((response) => ({ state: response.ok ? "success" : "failure", detail: `HTTP ${response.status}` })).catch((error) => ({ state: "failure", detail: error instanceof Error ? error.message.slice(0, 240) : "\u8BF7\u6C42\u5931\u8D25" }))) : { state: null, detail: null };
    const state = deploymentStateWithHealth(actionState, health.state);
    stateByProvider.set(provider, state);
    const snapshot = { stage_index: stageIndex, environment: configuration.environment, run_id: run.id, run_name: run.name, run_url: run.html_url || null, deployment_url: latestStatus?.environment_url || null, state, conclusion: run.conclusion, failure_summary: failure.summary, failure_job_url: failure.jobUrl, health_state: health.state, health_url: healthUrl, health_detail: health.detail };
    if (deploymentRowChanged(previousByProvider.get(provider), snapshot)) await phase("deployWrite", () => sql`INSERT INTO workflow_stage_deployments (user_id, workflow_id, stage_index, stage_id, source, provider, environment, run_id, run_name, run_url, deployment_url, state, conclusion, failure_summary, failure_job_url, health_state, health_url, health_detail) VALUES (${row.user_id}, ${workflow.id}, ${stageIndex}, ${stageId}, ${source}, ${provider}, ${configuration.environment}, ${run.id}, ${run.name}, ${run.html_url || null}, ${latestStatus?.environment_url || null}, ${state}, ${run.conclusion}, ${failure.summary}, ${failure.jobUrl}, ${health.state}, ${healthUrl}, ${health.detail}) ON CONFLICT (user_id, workflow_id, stage_id, source, provider) DO UPDATE SET stage_index = EXCLUDED.stage_index, environment = EXCLUDED.environment, run_id = EXCLUDED.run_id, run_name = EXCLUDED.run_name, run_url = EXCLUDED.run_url, deployment_url = EXCLUDED.deployment_url, state = EXCLUDED.state, conclusion = EXCLUDED.conclusion, failure_summary = EXCLUDED.failure_summary, failure_job_url = EXCLUDED.failure_job_url, health_state = EXCLUDED.health_state, health_url = EXCLUDED.health_url, health_detail = EXCLUDED.health_detail, updated_at = now()`);
    await phase("deployWrite", () => sql`INSERT INTO workflow_stage_deployment_runs (user_id, workflow_id, stage_index, stage_id, source, provider, run_id, environment, run_name, run_url, deployment_url, state, conclusion, health_state, health_url, health_detail) VALUES (${row.user_id}, ${workflow.id}, ${stageIndex}, ${stageId}, ${source}, ${provider}, ${run.id}, ${configuration.environment}, ${run.name}, ${run.html_url || null}, ${latestStatus?.environment_url || null}, ${state}, ${run.conclusion}, ${health.state}, ${healthUrl}, ${health.detail}) ON CONFLICT (user_id, workflow_id, stage_id, source, provider, run_id) DO UPDATE SET stage_index = EXCLUDED.stage_index, run_url = EXCLUDED.run_url, deployment_url = EXCLUDED.deployment_url, state = EXCLUDED.state, conclusion = EXCLUDED.conclusion, health_state = EXCLUDED.health_state, health_url = EXCLUDED.health_url, health_detail = EXCLUDED.health_detail, updated_at = now()`);
    const previous = previousByProvider.get(provider);
    if (["success", "failure"].includes(state) && (previous?.state !== state || previous.run_id !== run.id)) {
      const notification = deploymentNotification(provider, configuration.environment, state);
      await phase("deployWrite", () => recordWorkflowStageEvent(sql, row.user_id, workflow.id, stageIndex, source, `${workflow.id}:${stageId}:${source}:deployment:${provider}:${run.id}:${state}`, notification.kind, notification.title, stageId, target));
      await phase("notify", () => stagePush(workflow, environment, sql, row.user_id, { eventKey: `${workflow.id}:${stageIndex}:${source}:deployment:${provider}:${run.id}:${state}`, kind: notification.kind, title: notification.title, body: `${workflow.repository} \xB7 ${source} \u2192 ${target} \xB7 ${notification.message}`, url: run.html_url || "/" }));
    }
  }));
  const placeholders = configurations.filter((configuration) => !latestByProvider.has(configuration.provider)).filter((configuration) => deploymentRowChanged(previousByProvider.get(configuration.provider), { stage_index: stageIndex, environment: configuration.environment, run_id: null, run_name: configuration.workflowName, run_url: null, deployment_url: null, state: "pending", conclusion: null, failure_summary: missingDeploymentSummary(configuration.workflowName), failure_job_url: null, health_state: null, health_url: null, health_detail: null }));
  if (placeholders.length) await phase("deployWrite", () => Promise.all(placeholders.map((configuration) => sql`INSERT INTO workflow_stage_deployments (user_id, workflow_id, stage_index, stage_id, source, provider, environment, run_id, run_name, run_url, deployment_url, state, conclusion, failure_summary, failure_job_url, health_state, health_url, health_detail) VALUES (${row.user_id}, ${workflow.id}, ${stageIndex}, ${stageId}, ${source}, ${configuration.provider}, ${configuration.environment}, ${null}, ${configuration.workflowName}, ${null}, ${null}, 'pending', ${null}, ${missingDeploymentSummary(configuration.workflowName)}, ${null}, ${null}, ${null}, ${null}) ON CONFLICT (user_id, workflow_id, stage_id, source, provider) DO UPDATE SET stage_index = EXCLUDED.stage_index, environment = EXCLUDED.environment, run_id = NULL, run_name = EXCLUDED.run_name, run_url = NULL, deployment_url = NULL, state = EXCLUDED.state, conclusion = NULL, failure_summary = EXCLUDED.failure_summary, failure_job_url = NULL, health_state = NULL, health_url = NULL, health_detail = NULL, updated_at = now()`)));
  return configurations.map((configuration) => stateByProvider.get(configuration.provider) ?? "pending");
}
function reconcileTimingLine(fields) {
  return `[reconcile-timing] ${logFields(fields)}`;
}
function etagTelemetryLine(fields) {
  return `[reconcile-etag] ${logFields(fields)}`;
}
function logFields(fields) {
  return Object.entries(fields).filter(([, value]) => value !== void 0).map(([key, value]) => `${key}=${typeof value === "string" && /[\s"]/.test(value) ? JSON.stringify(value) : value}`).join(" ");
}
function addPhaseTotals(totals, phases) {
  for (const [name, ms] of Object.entries(phases)) totals[name] = (totals[name] || 0) + ms;
}
function pendingPhaseTotals(trackers) {
  const totals = {};
  for (const tracker of trackers) {
    const name = tracker.current || "unstarted";
    totals[name] = (totals[name] || 0) + 1;
  }
  return totals;
}
function createPhaseRecorder(tracker) {
  const phases = {};
  const phase = async (name, work) => {
    const at = performance.now();
    const parent = tracker?.current ?? null;
    if (tracker) tracker.current = name;
    try {
      return await work();
    } finally {
      phases[name] = (phases[name] || 0) + Math.round(performance.now() - at);
      if (tracker) tracker.current = parent;
    }
  };
  return { phases, phase };
}
async function reconcileOneStage(environment, row, workflow, stageIndex, source, eventName, budget) {
  const startedAt = performance.now();
  const tracker = { current: null };
  budget?.pending.add(tracker);
  const tracked = await trackGitHubCalls(() => reconcileStageWork(environment, row, workflow, stageIndex, source, eventName, tracker)).finally(() => budget?.pending.delete(tracker));
  if (budget) {
    budget.calls += tracked.stats.calls;
    budget.ms += tracked.stats.totalMs;
    budget.etagStable += tracked.stats.etagStable;
    budget.etagChanged += tracked.stats.etagChanged;
    budget.etagFirstSeen += tracked.stats.etagFirstSeen;
    addPhaseTotals(budget.phases, tracked.value.phases);
  }
  console.log(reconcileTimingLine({
    scope: "stage",
    repository: workflow.repository,
    route: `${source} \u2192 ${workflow.stages[stageIndex]?.target || "?"}`,
    ...tracked.value.phases,
    githubCalls: tracked.stats.calls,
    githubMs: tracked.stats.totalMs,
    slowest: tracked.stats.slowest?.path,
    slowestMs: tracked.stats.slowest?.ms,
    total: Math.round(performance.now() - startedAt)
  }));
  return { reconciled: tracked.value.reconciled, advanced: tracked.value.advanced === true };
}
function stagePush(workflow, environment, sql, userId, event) {
  return workflow.muted === true ? Promise.resolve(0) : sendPushNotifications(environment, sql, userId, event);
}
async function reconcileStageWork(environment, row, workflow, stageIndex, source, eventName, tracker) {
  const { phases, phase } = createPhaseRecorder(tracker);
  if (!row.github_installation_id) return { reconciled: false, phases };
  const installationId = row.github_installation_id;
  const stage = { ...stageForIndex(workflow, stageIndex), source };
  const stageId = stage.stageId;
  const sql = query(environment);
  const { owner, name } = ownerAndName(workflow.repository);
  const config = parseGithubAppConfig(environment);
  const comparison = await phase("compare", () => installationRequest(config, installationId, `/repos/${owner}/${name}/compare/${encodeURIComponent(stage.target)}...${encodeURIComponent(stage.source)}`).catch(() => ({ ahead_by: 0, head_commit: void 0, commits: void 0 })));
  const previous = await phase("dbRead", () => sql`SELECT pull_number, pull_state, checks_state, approvals, required_approvals, ahead_by FROM workflow_stage_states WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source}`);
  const deploymentConfigured = deploymentConfigsForTarget(workflow, stage.target).length > 0;
  const settledDeployments = comparison.ahead_by === 0 && deploymentConfigured ? await phase("dbRead", () => sql`SELECT state FROM workflow_stage_deployments WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source}`) : [];
  if (stageReconciliationIsSettled({ aheadBy: comparison.ahead_by, storedAheadBy: previous[0]?.ahead_by, previous: previous[0], deploymentConfigured, deploymentStates: settledDeployments.map((deployment) => deployment.state) })) {
    await phase("write", () => sql`UPDATE workflow_stage_states SET updated_at = now() WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source}`);
    return { reconciled: true, phases };
  }
  const pull = await phase("pull", () => pullForStage(environment, installationId, workflow, stage));
  const preceding = stageIndex ? await phase("dbRead", () => sql`SELECT stage_index, stage_id, pull_state, checks_state FROM workflow_stage_states WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id}`) : [];
  const comparisonHeadSha = comparison.head_commit?.id || comparison.commits?.at(-1)?.sha;
  if (!pull) {
    await phase("write", () => sql`DELETE FROM workflow_stage_deployments WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source}`);
    await phase("write", () => sql`INSERT INTO workflow_stage_states (user_id, workflow_id, stage_index, stage_id, repository, source, target, pull_state, checks_state, ahead_by, last_event) VALUES (${row.user_id}, ${workflow.id}, ${stageIndex}, ${stageId}, ${workflow.repository}, ${stage.source}, ${stage.target}, 'none', 'unknown', ${comparison.ahead_by}, ${eventName || null}) ON CONFLICT (user_id, workflow_id, stage_id, source) DO UPDATE SET stage_index = EXCLUDED.stage_index, pull_number = NULL, pull_state = 'none', merged_at = NULL, head_sha = NULL, checks_state = 'unknown', checks_passed = 0, checks_total = 0, approvals = 0, required_approvals = 0, mergeable = NULL, mergeable_state = NULL, ahead_by = EXCLUDED.ahead_by, last_event = EXCLUDED.last_event, updated_at = now()`);
    if (previous[0]?.pull_state && previous[0].pull_state !== "none") await phase("write", () => recordWorkflowStageEvent(sql, row.user_id, workflow.id, stageIndex, source, `${workflow.id}:${stageId}:${source}:pull-cleared:${Date.now()}`, "pull-cleared", "PR \u72B6\u6001\u5DF2\u6E05\u9664\uFF0C\u7B49\u5F85\u65B0\u63D0\u4EA4", stageId, stage.target));
    const unlocked2 = stageIsUnlocked(workflow, stageIndex, preceding);
    if (unlocked2 && comparison.ahead_by > 0 && (previous[0]?.ahead_by || 0) === 0) {
      await phase("notify", () => stagePush(workflow, environment, sql, row.user_id, { eventKey: `${workflow.id}:${stageIndex}:${source}:new-pr:none`, kind: "new-pr-ready", title: "\u53EF\u4EE5\u521B\u5EFA\u4E0B\u4E00\u6B65 PR", body: `${workflow.repository} \xB7 ${stage.source} \u2192 ${stage.target}`, url: "/" }));
    }
    if (comparison.ahead_by > 0 && comparisonHeadSha) await phase("queue", () => scheduleServerAutoCreate(environment, sql, row, workflow, stageIndex, source, comparisonHeadSha));
    return { reconciled: true, phases };
  }
  const branchHead = pull.merged_at ? await phase("targetHead", () => installationRequest(config, installationId, `/repos/${owner}/${name}/branches/${encodeURIComponent(stage.target)}`).catch(() => null)) : null;
  const sha = pull.merged_at ? pull.merge_commit_sha : pull.head.sha;
  const gateSha = pull.merged_at ? branchHead?.commit?.sha || pull.merge_commit_sha : pull.head.sha;
  if (!pull.merged_at) await phase("write", () => sql`DELETE FROM workflow_stage_deployments WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND stage_id = ${stageId} AND source = ${source}`);
  const [runs, statuses, reviews, protection, rules] = await phase("checks", () => Promise.all([
    gateSha ? installationRequest(config, installationId, `/repos/${owner}/${name}/commits/${gateSha}/check-runs?per_page=100`).catch(() => ({ check_runs: [] })) : Promise.resolve({ check_runs: [] }),
    gateSha ? installationRequest(config, installationId, `/repos/${owner}/${name}/commits/${gateSha}/status`).catch(() => ({ statuses: [] })) : Promise.resolve({ statuses: [] }),
    pull.merged_at ? Promise.resolve([]) : installationRequest(config, installationId, `/repos/${owner}/${name}/pulls/${pull.number}/reviews?per_page=100`).catch(() => []),
    pull.merged_at ? Promise.resolve(null) : installationRequest(config, installationId, `/repos/${owner}/${name}/branches/${encodeURIComponent(stage.target)}/protection`).catch(() => null),
    pull.merged_at ? Promise.resolve([]) : installationRequest(config, installationId, `/repos/${owner}/${name}/rules/branches/${encodeURIComponent(stage.target)}`).catch(() => [])
  ]));
  const deploymentStates = pull.merged_at && gateSha ? await phase("deploy", () => reconcileStageDeployments(environment, sql, row, workflow, stageIndex, source, stage.target, gateSha, phase)) : [];
  const observedChecks = runs.check_runs.length || statuses.statuses.length ? summarizeGitHubChecks(runs.check_runs, statuses.statuses) : { state: "success", passed: 0, total: 0 };
  const checks = mergeChecksWithDeployments(observedChecks, deploymentStates);
  const requiredApprovals = requiredApprovalsFromProtection(protection, rules);
  const approvals = reviews.filter((review) => review.state === "APPROVED").length;
  await phase("write", () => sql`INSERT INTO workflow_stage_states (user_id, workflow_id, stage_index, stage_id, repository, source, target, pull_number, pull_state, merged_at, head_sha, gate_sha, checks_state, checks_passed, checks_total, approvals, required_approvals, mergeable, mergeable_state, ahead_by, last_event) VALUES (${row.user_id}, ${workflow.id}, ${stageIndex}, ${stageId}, ${workflow.repository}, ${stage.source}, ${stage.target}, ${pull.number}, ${pull.merged_at ? "merged" : pull.state}, ${pull.merged_at || null}, ${sha || null}, ${gateSha || null}, ${checks.state}, ${checks.passed}, ${checks.total}, ${approvals}, ${requiredApprovals}, ${pull.mergeable ?? null}, ${pull.mergeable_state || null}, ${comparison.ahead_by}, ${eventName || null}) ON CONFLICT (user_id, workflow_id, stage_id, source) DO UPDATE SET stage_index = EXCLUDED.stage_index, pull_number = EXCLUDED.pull_number, pull_state = EXCLUDED.pull_state, merged_at = EXCLUDED.merged_at, head_sha = EXCLUDED.head_sha, gate_sha = EXCLUDED.gate_sha, checks_state = EXCLUDED.checks_state, checks_passed = EXCLUDED.checks_passed, checks_total = EXCLUDED.checks_total, approvals = EXCLUDED.approvals, required_approvals = EXCLUDED.required_approvals, mergeable = EXCLUDED.mergeable, mergeable_state = EXCLUDED.mergeable_state, ahead_by = EXCLUDED.ahead_by, last_event = EXCLUDED.last_event, updated_at = now()`);
  const before = previous[0];
  if (!before || before.pull_number !== pull.number) await phase("write", () => recordWorkflowStageEvent(sql, row.user_id, workflow.id, stageIndex, source, `${workflow.id}:${stageId}:${source}:pull:${pull.number}`, "pull-detected", `\u5DF2\u53D1\u73B0 PR #${pull.number}`, stageId, stage.target));
  if (before?.pull_state !== (pull.merged_at ? "merged" : pull.state) && pull.merged_at) {
    await phase("write", () => recordWorkflowStageEvent(sql, row.user_id, workflow.id, stageIndex, source, `${workflow.id}:${stageId}:${source}:merged:${pull.number}`, "pull-merged", `PR #${pull.number} \u5DF2\u5408\u5E76`, stageId, stage.target));
    const versionRow = await phase("dbRead", () => sql`SELECT version FROM workflow_versions WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} ORDER BY version DESC LIMIT 1`);
    const stageSnapshot = { source: stage.source, target: stage.target, stageId };
    await phase("write", () => sql`INSERT INTO workflow_runs (user_id, workflow_id, version, stage_index, stage_id, source, target, stage_snapshot, pull_number) VALUES (${row.user_id}, ${workflow.id}, ${versionRow[0]?.version || 1}, ${stageIndex}, ${stageId}, ${source}, ${stage.target}, ${sql.json(stageSnapshot)}, ${pull.number})`);
  }
  if (before?.checks_state !== checks.state && ["success", "failure"].includes(checks.state)) await phase("write", () => recordWorkflowStageEvent(sql, row.user_id, workflow.id, stageIndex, source, `${workflow.id}:${stageId}:${source}:checks:${gateSha}:${checks.state}`, `checks-${checks.state}`, checks.state === "success" ? "Actions \u5DF2\u5168\u7EFF" : "Actions \u5931\u8D25\uFF0C\u9700\u8981\u5904\u7406", stageId, stage.target));
  const route = `${stage.source} \u2192 ${stage.target}`;
  if (before?.checks_state !== checks.state && ["success", "failure"].includes(checks.state)) {
    await phase("notify", () => stagePush(workflow, environment, sql, row.user_id, { eventKey: `${workflow.id}:${stageIndex}:${source}:checks:${gateSha}:${checks.state}`, kind: `checks-${checks.state}`, title: checks.state === "failure" ? "Actions \u5931\u8D25\uFF0C\u9700\u8981\u5904\u7406" : "Actions \u5DF2\u5168\u7EFF", body: `${workflow.repository} \xB7 ${route}`, url: `/` }));
  }
  const runState = workflowRunCompletionState(Boolean(pull.merged_at), checks.state);
  if (runState) await phase("write", () => sql`UPDATE workflow_runs SET state = ${runState}, completed_at = now() WHERE user_id = ${row.user_id} AND workflow_id = ${workflow.id} AND pull_number = ${pull.number} AND state = 'active'`);
  if (!pull.merged_at && requiredApprovals > 0 && approvals >= requiredApprovals && (!before || before.approvals < before.required_approvals)) {
    await phase("notify", () => stagePush(workflow, environment, sql, row.user_id, { eventKey: `${workflow.id}:${stageIndex}:${source}:merge-ready:${pull.number}:${pull.head.sha}`, kind: "merge-ready", title: "PR \u5DF2\u6EE1\u8DB3\u5408\u5E76\u6761\u4EF6", body: `${workflow.repository} \xB7 ${route} \xB7 PR #${pull.number}`, url: `/` }));
  }
  const unlocked = stageIsUnlocked(workflow, stageIndex, preceding);
  if (pull.merged_at && unlocked && comparison.ahead_by > 0 && (before?.ahead_by || 0) === 0) {
    await phase("notify", () => stagePush(workflow, environment, sql, row.user_id, { eventKey: `${workflow.id}:${stageIndex}:${source}:new-pr:${pull.number}`, kind: "new-pr-ready", title: "\u6709\u65B0\u63D0\u4EA4\uFF0C\u53EF\u4EE5\u521B\u5EFA\u65B0 PR", body: `${workflow.repository} \xB7 ${route}`, url: "/" }));
  }
  if (comparison.ahead_by > 0 && comparisonHeadSha) await phase("queue", () => scheduleServerAutoCreate(environment, sql, row, workflow, stageIndex, source, comparisonHeadSha));
  if (pull.merged_at && checks.state === "success") await phase("queue", () => scheduleServerAdvance(sql, row, workflow, stageIndex, source));
  if (!pull.merged_at && pull.state === "open" && pull.head.sha) await phase("queue", () => scheduleServerAutoMerge(sql, row, workflow, stageIndex, source, pull.number, pull.head.sha, { checksState: checks.state, approvals, requiredApprovals, mergeable: pull.mergeable ?? null, mergeableState: pull.mergeable_state || "" }));
  return { reconciled: true, phases, advanced: stageGateSatisfactionAdvanced(before, { pullState: pull.merged_at ? "merged" : pull.state, checksState: checks.state }) };
}
function reconciliationLockKey(userId, repository) {
  return `pr-helper:reconcile:${userId}:${repository || "*"}`;
}
var RECONCILIATION_LEASE_TTL_SECONDS = 30;
function reconciliationLeaseTtlSeconds(environment) {
  const configured = Number(environment.RECONCILIATION_LEASE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? configured : RECONCILIATION_LEASE_TTL_SECONDS;
}
function reconciliationLeaseRenewIntervalMs(ttlSeconds) {
  return Math.max(1e3, Math.floor(ttlSeconds * 1e3 / 3));
}
async function reconcileWorkflowScope(environment, sql, workflowsToReconcile, filter, trigger, deadlineMs, onRunStarted) {
  const startedAt = Date.now();
  const userId = workflowsToReconcile[0]?.row.user_id;
  if (!userId) return { reconciled: 0, outcome: "completed" };
  const repositories = [...new Set(workflowsToReconcile.map((item) => item.workflow.repository))];
  const repository = filter.repository || (repositories.length === 1 ? repositories[0] : null);
  const lockKey = reconciliationLockKey(userId, repository);
  const ttlSeconds = reconciliationLeaseTtlSeconds(environment);
  const holder = randomUUID();
  const lease = await sql`
    INSERT INTO reconciliation_leases (lock_key, holder, trigger, acquired_at, expires_at)
    VALUES (${lockKey}, ${holder}, ${trigger}, now(), now() + (${ttlSeconds} * interval '1 second'))
    ON CONFLICT (lock_key) DO UPDATE SET holder = EXCLUDED.holder, trigger = EXCLUDED.trigger, acquired_at = now(), expires_at = EXCLUDED.expires_at
    WHERE reconciliation_leases.expires_at < now()
    RETURNING holder`;
  if (lease[0]?.holder !== holder) {
    await sql`INSERT INTO reconciliation_runs (user_id, trigger, state, repository, stages_total, stages_reconciled, stages_failed, duration_ms, finished_at) VALUES (${userId}, ${trigger}, 'skipped', ${repository}, 0, 0, 0, ${Date.now() - startedAt}, now())`.catch(() => void 0);
    return { reconciled: 0, outcome: "skipped" };
  }
  const renewal = setInterval(() => {
    void sql`UPDATE reconciliation_leases SET expires_at = now() + (${ttlSeconds} * interval '1 second') WHERE lock_key = ${lockKey} AND holder = ${holder}`.catch(() => void 0);
  }, reconciliationLeaseRenewIntervalMs(ttlSeconds));
  const runRow = await sql`INSERT INTO reconciliation_runs (user_id, trigger, state, repository, claimed_workflow_ids) VALUES (${userId}, ${trigger}, 'running', ${repository}, ${workflowsToReconcile.map((item) => item.row.id)}) RETURNING id`;
  const runId = runRow[0].id;
  onRunStarted?.(runId);
  const rotatingIds = workflowsToReconcile.filter((item) => !(filter.branches && item.branchScoped)).map((item) => item.row.id);
  if (rotatingIds.length) await sql`UPDATE pr_helper_workflows SET last_reconcile_attempt_at = now() WHERE user_id = ${userId} AND id IN ${sql(rotatingIds)}`.catch(() => void 0);
  const workflowIds = workflowsToReconcile.map((item) => item.row.id);
  const markPending = async (pending) => {
    if (pending) await sql`UPDATE pr_helper_workflows SET reconcile_pending_since = coalesce(reconcile_pending_since, now()) WHERE user_id = ${userId} AND id IN ${sql(workflowIds)}`.catch(() => void 0);
    else if (!filter.branches) await sql`UPDATE pr_helper_workflows SET reconcile_pending_since = NULL WHERE user_id = ${userId} AND id IN ${sql(workflowIds)}`.catch(() => void 0);
  };
  try {
    const githubBudget = { calls: 0, ms: 0, etagStable: 0, etagChanged: 0, etagFirstSeen: 0, phases: {}, pending: /* @__PURE__ */ new Set() };
    const pruneAt = performance.now();
    for (const item of workflowsToReconcile) await pruneStaleWorkflowStageData(sql, item.row.user_id, item.workflow);
    githubBudget.phases.prune = Math.round(performance.now() - pruneAt);
    const tracked = workflowsToReconcile.flatMap(({ row, workflow, branchScoped }) => workflow.stages.map((_, stageIndex) => ({ row, workflow, branchScoped, stageIndex })));
    const scoped = tracked.flatMap((item) => {
      const stage = item.workflow.stages[item.stageIndex];
      const scope = filter.branches && item.branchScoped ? reconciliationBranchScope(stage, filter.branches) : "all";
      return scope === "none" ? [] : [{ ...item, scope }];
    });
    const routesAt = performance.now();
    const routes = await trackGitHubCalls(() => Promise.all(scoped.map(async (item) => {
      const sources = await routeSourcesForStage(environment, sql, item.row, item.workflow, item.stageIndex);
      const inScope = item.scope === "matching" && filter.branches ? sources.filter((source) => filter.branches.includes(source)) : sources;
      return inScope.map((source) => ({ ...item, source }));
    })));
    githubBudget.calls += routes.stats.calls;
    githubBudget.ms += routes.stats.totalMs;
    githubBudget.etagStable += routes.stats.etagStable;
    githubBudget.etagChanged += routes.stats.etagChanged;
    githubBudget.etagFirstSeen += routes.stats.etagFirstSeen;
    const flatTasks = routes.value.flat();
    const routesMs = Math.round(performance.now() - routesAt);
    githubBudget.phases.routes = routesMs;
    await sql`UPDATE reconciliation_runs SET stages_total = ${flatTasks.length} WHERE id = ${runId} AND state = 'running'`;
    let reconciled = 0;
    let failed = 0;
    let firstFailure;
    const advancedByWorkflow = /* @__PURE__ */ new Map();
    const stageWork = Promise.allSettled(flatTasks.map((item) => reconcileOneStage(environment, item.row, item.workflow, item.stageIndex, item.source, filter.eventName, githubBudget).then(
      (value) => {
        if (value.reconciled) reconciled += 1;
        if (value.advanced) advancedByWorkflow.set(item.workflow.id, [...advancedByWorkflow.get(item.workflow.id) || [], item.stageIndex]);
        return value;
      },
      (error) => {
        failed += 1;
        firstFailure ||= error;
        throw error;
      }
    )));
    const raced = await withStageDeadline(stageWork, deadlineMs);
    const recheck = raced.outcome === "completed" && advancedByWorkflow.size ? flatTasks.filter((item) => downstreamStagesToRecheck(item.workflow, advancedByWorkflow.get(item.workflow.id) || []).includes(item.stageIndex)) : [];
    if (recheck.length) {
      const remainingMs = deadlineMs === void 0 ? void 0 : deadlineMs - (Date.now() - startedAt);
      if (remainingMs === void 0 || remainingMs > 0) await withStageDeadline(Promise.allSettled(recheck.map((item) => reconcileOneStage(environment, item.row, item.workflow, item.stageIndex, item.source, filter.eventName, githubBudget))), remainingMs);
    }
    const durationMs = Date.now() - startedAt;
    console.log(reconcileTimingLine({
      scope: "sweep",
      trigger,
      repository: repository || "*",
      workflows: workflowsToReconcile.length,
      stages: flatTasks.length,
      routesMs,
      reconciled,
      failed,
      budgetMs: deadlineMs,
      outcome: raced.outcome,
      total: durationMs
    }));
    if (githubBudget.etagStable + githubBudget.etagChanged + githubBudget.etagFirstSeen > 0) {
      console.log(etagTelemetryLine({
        scope: "sweep",
        trigger,
        repository: repository || "*",
        calls: githubBudget.calls,
        stable: githubBudget.etagStable,
        changed: githubBudget.etagChanged,
        firstSeen: githubBudget.etagFirstSeen
      }));
    }
    const errorMessage = firstFailure ? String(firstFailure instanceof Error ? firstFailure.message : firstFailure).slice(0, 800) : null;
    if (raced.outcome === "deferred") {
      const pending = pendingPhaseTotals(githubBudget.pending);
      const breakdown = Object.keys(pending).length ? { ...githubBudget.phases, pending } : githubBudget.phases;
      await sql`UPDATE reconciliation_runs SET state = ${deferredRunState(reconciled, failed, flatTasks.length)}, stages_reconciled = ${reconciled}, stages_failed = ${failed}, duration_ms = ${durationMs}, github_calls = ${githubBudget.calls}, github_ms = ${Math.round(githubBudget.ms)}, phase_ms = ${sql.json(breakdown)}, error_message = ${errorMessage || RECONCILIATION_DEFERRED_MESSAGE}, finished_at = now() WHERE id = ${runId} AND state = 'running'`;
      await markPending(true);
      return { reconciled, outcome: "deferred" };
    }
    const finalState = reconciliationState(failed, reconciled);
    await sql`UPDATE reconciliation_runs SET state = ${finalState}, stages_total = ${flatTasks.length}, stages_reconciled = ${reconciled}, stages_failed = ${failed}, duration_ms = ${durationMs}, github_calls = ${githubBudget.calls}, github_ms = ${Math.round(githubBudget.ms)}, phase_ms = ${sql.json(githubBudget.phases)}, error_message = ${errorMessage}, finished_at = now() WHERE id = ${runId} AND state = 'running'`;
    await markPending(failed > 0);
    if (failed > 0 && reconciled === 0) throw firstFailure || new Error("Reconciliation failed");
    return { reconciled, outcome: "completed" };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    await markPending(true);
    await sql`UPDATE reconciliation_runs SET state = 'failure', duration_ms = ${durationMs}, error_message = ${String(error instanceof Error ? error.message : error).slice(0, 800)}, finished_at = now() WHERE id = ${runId} AND state = 'running'`.catch(() => void 0);
    throw error;
  } finally {
    clearInterval(renewal);
    await sql`DELETE FROM reconciliation_leases WHERE lock_key = ${lockKey} AND holder = ${holder}`.catch(() => void 0);
  }
}
var RECONCILIATION_RUN_GRACE_SECONDS = 5 * 60;
function reconciliationRunIsAbandoned(startedAt, now) {
  const started = Date.parse(startedAt);
  return Number.isFinite(started) && now - started > RECONCILIATION_RUN_GRACE_SECONDS * 1e3;
}
function reconciliationRunInterrupted(run, now) {
  return run.state === "running" && reconciliationRunIsAbandoned(run.startedAt, now);
}
var REALTIME_RECONCILE_BUDGET_MS = 8e3;
var INBOX_REFRESH_RECONCILE_BUDGET_MS = 6e3;
var INBOX_REFRESH_RECONCILE_CEILING_GAP_MS = 5e3;
var WEBHOOK_RECONCILE_BUDGET_MS = 25e3;
var CRON_RECONCILE_BUDGET_MS = AUTOMATION_FUNCTION_CEILING_MS - 2e4;
function cronReconcileBudgetMs(environment) {
  const configured = Number(environment.CRON_RECONCILE_BUDGET_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : CRON_RECONCILE_BUDGET_MS;
}
function realtimeReconcileBudgetMs(environment, trigger) {
  const configured = Number(environment.REALTIME_RECONCILE_BUDGET_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (trigger === "webhook") return WEBHOOK_RECONCILE_BUDGET_MS;
  if (trigger === "inbox_refresh") return INBOX_REFRESH_RECONCILE_BUDGET_MS;
  return REALTIME_RECONCILE_BUDGET_MS;
}
function realtimeReconcileCeilingMs(budgetMs, trigger) {
  const gap = trigger === "inbox_refresh" ? INBOX_REFRESH_RECONCILE_CEILING_GAP_MS : 15e3;
  return Math.min(budgetMs + gap, AUTOMATION_FUNCTION_CEILING_MS - 15e3);
}
async function withStageDeadline(work, deadlineMs) {
  if (deadlineMs === void 0) return { outcome: "completed", value: await work };
  let timer;
  const deferred = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ outcome: "deferred" }), deadlineMs);
  });
  try {
    return await Promise.race([work.then((value) => ({ outcome: "completed", value })), deferred]);
  } finally {
    clearTimeout(timer);
  }
}
function deferredRunState(reconciled, failed, total) {
  return reconciled + failed >= total ? reconciliationState(failed, reconciled) : "degraded";
}
var RECONCILE_WORKFLOW_BATCH_SIZE = 8;
function reconciliationBatchSize(environment) {
  const configured = Number(environment.CRON_RECONCILE_BATCH_SIZE);
  return Number.isInteger(configured) && configured >= 0 ? configured : RECONCILE_WORKFLOW_BATCH_SIZE;
}
function reconciliationStaleness(lastAttemptAt) {
  return (lastAttemptAt ? Date.parse(lastAttemptAt) : 0) || 0;
}
var REALTIME_CATCH_UP_LIMIT = 4;
function mergeCatchUpCandidates(inScope, pending, limit) {
  const covered = new Set(inScope.map((item) => item.key));
  const catchUp = pending.filter((item) => !covered.has(item.key)).sort((left, right) => reconciliationStaleness(left.pendingSince) - reconciliationStaleness(right.pendingSince)).slice(0, Math.max(0, limit));
  return [...inScope, ...catchUp];
}
function selectReconciliationBatch(candidates, limit) {
  if (limit <= 0 || candidates.length <= limit) return [...candidates];
  return candidates.map((candidate, index) => ({ candidate, index })).sort((left, right) => Number(Boolean(right.candidate.pendingSince)) - Number(Boolean(left.candidate.pendingSince)) || (left.candidate.pendingSince && right.candidate.pendingSince ? reconciliationStaleness(left.candidate.pendingSince) - reconciliationStaleness(right.candidate.pendingSince) : 0) || reconciliationStaleness(left.candidate.lastAttemptAt) - reconciliationStaleness(right.candidate.lastAttemptAt) || left.index - right.index).slice(0, limit).map((item) => item.candidate);
}
var RECONCILIATION_DEFERRED_MESSAGE = "\u6821\u51C6\u672A\u5728\u9884\u7B97\u5185\u5B8C\u6210\uFF0C\u5DF2\u8BA9\u7ED9\u4E0B\u4E00\u6B21\u89E6\u53D1";
var RECONCILIATION_ABANDONED_MESSAGE = "\u6821\u51C6\u8D85\u51FA\u5B9E\u65F6\u4E0A\u9650\uFF0C\u5DF2\u4EA4\u7ED9\u4E0B\u4E00\u6B21\u89E6\u53D1\u63A5\u624B";
async function closeAbandonedReconciliationRuns(environment, runIds) {
  if (!runIds.length) return;
  const sql = query(environment);
  await sql`WITH abandoned AS (
    UPDATE reconciliation_runs SET state = 'degraded', error_message = coalesce(error_message, ${RECONCILIATION_ABANDONED_MESSAGE}), duration_ms = round(extract(epoch from (now() - started_at)) * 1000), finished_at = now()
    WHERE id = ANY(${runIds}) AND state = 'running'
    RETURNING user_id, claimed_workflow_ids)
  UPDATE pr_helper_workflows workflows SET reconcile_pending_since = coalesce(workflows.reconcile_pending_since, now())
  FROM abandoned WHERE workflows.user_id = abandoned.user_id AND workflows.id = ANY(abandoned.claimed_workflow_ids)`.catch(() => void 0);
}
async function reconcileWorkflowStages(environment, filter = {}, trigger = "cron", options = {}) {
  const sql = query(environment);
  if (trigger === "cron") {
    await sql`WITH reaped AS (
      UPDATE reconciliation_runs SET state = 'failure', error_message = coalesce(error_message, '校准中断：函数实例在完成前被回收'), finished_at = now()
      WHERE state = 'running' AND started_at < now() - (${RECONCILIATION_RUN_GRACE_SECONDS} * interval '1 second')
      RETURNING user_id, claimed_workflow_ids)
    UPDATE pr_helper_workflows workflows SET reconcile_pending_since = coalesce(workflows.reconcile_pending_since, now())
    FROM reaped WHERE workflows.user_id = reaped.user_id AND workflows.id = ANY(reaped.claimed_workflow_ids)`.catch(() => void 0);
  }
  const boundedInSql = trigger === "cron" && !filter.branches;
  const rows = await sql`SELECT ${trackedWorkflowColumns(sql)}, users.github_installation_id, workflows.last_reconcile_attempt_at, workflows.reconcile_pending_since FROM pr_helper_workflows workflows JOIN pr_helper_users users ON users.id = workflows.user_id WHERE workflows.archived = false ${filter.repository ? sql`AND workflows.repository = ${filter.repository}` : sql``} ${filter.installationId ? sql`AND users.github_installation_id = ${filter.installationId}` : sql``} ${boundedInSql ? sql`ORDER BY (workflows.reconcile_pending_since IS NULL), workflows.reconcile_pending_since, workflows.last_reconcile_attempt_at NULLS FIRST, workflows.user_id, workflows.id LIMIT ${reconciliationBatchSize(environment)}` : sql``}`;
  const tracked = rows.flatMap((row) => {
    const workflow = trackedWorkflowFromRow(row);
    if (!workflow) return [];
    return [{ row, workflow: ensureStageIds(workflow), lastAttemptAt: row.last_reconcile_attempt_at ?? null, pendingSince: row.reconcile_pending_since ?? null, key: `${row.user_id}:${row.id}`, branchScoped: Boolean(filter.branches) }];
  });
  const candidates = tracked.filter((item) => !filter.branches || item.workflow.stages.some((stage) => reconciliationBranchScope(stage, filter.branches) !== "none"));
  const workflowsToReconcile = trigger === "cron" ? selectReconciliationBatch(candidates, reconciliationBatchSize(environment)) : mergeCatchUpCandidates(candidates, tracked.filter((item) => item.pendingSince).map((item) => ({ ...item, branchScoped: false })), REALTIME_CATCH_UP_LIMIT);
  const byUser = /* @__PURE__ */ new Map();
  for (const item of workflowsToReconcile) byUser.set(item.row.user_id, [...byUser.get(item.row.user_id) || [], item]);
  let reconciledTotal = 0;
  let deferred = false;
  let firstError;
  const deadlineAt = options.deadlineMs === void 0 ? void 0 : Date.now() + options.deadlineMs;
  for (const scopedWorkflows of byUser.values()) {
    try {
      const remaining = deadlineAt === void 0 ? void 0 : Math.max(0, deadlineAt - Date.now());
      const scope = await reconcileWorkflowScope(environment, sql, scopedWorkflows, filter, trigger, remaining, options.onRunStarted);
      reconciledTotal += scope.reconciled;
      deferred ||= scope.outcome === "deferred";
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError && reconciledTotal === 0) throw firstError;
  return { reconciled: reconciledTotal, outcome: deferred ? "deferred" : "completed" };
}
async function reconcileRealtime(environment, filter, trigger) {
  const budgetMs = realtimeReconcileBudgetMs(environment, trigger);
  const startedRunIds = [];
  const sweep = reconcileWorkflowStages(environment, filter, trigger, { deadlineMs: budgetMs, onRunStarted: (runId) => startedRunIds.push(runId) }).catch(() => ({ outcome: "failed", reconciled: 0 }));
  const raced = await withStageDeadline(sweep, realtimeReconcileCeilingMs(budgetMs, trigger));
  if (raced.outcome !== "completed") await closeAbandonedReconciliationRuns(environment, startedRunIds);
  return raced.outcome === "completed" ? raced.value : { outcome: "deferred", reconciled: 0 };
}
async function listWorkflowStageStates(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const [rows, workflowRows] = await Promise.all([
    visibleStageStateRows(sql, user.id, reads),
    visibleWorkflowRows(sql, user.id, reads)
  ]);
  const workflowById = new Map(workflowRows.flatMap((row) => {
    const workflow = trackedWorkflowFromRow(row);
    return workflow ? [[workflow.id, ensureStageIds(workflow)]] : [];
  }));
  return rows.map((row) => ({
    workflowId: row.workflow_id,
    stageIndex: row.stage_index,
    stageId: row.stage_id,
    repository: row.repository,
    source: row.source,
    target: row.target,
    pullNumber: row.pull_number,
    pullState: row.pull_state,
    mergedAt: row.merged_at,
    headSha: row.head_sha,
    checksState: row.checks_state,
    checksPassed: row.checks_passed,
    checksTotal: row.checks_total,
    approvals: row.approvals,
    requiredApprovals: row.required_approvals,
    mergeable: row.mergeable,
    mergeableState: row.mergeable_state,
    aheadBy: row.ahead_by,
    lastEvent: row.last_event,
    updatedAt: row.updated_at,
    decision: workflowById.has(row.workflow_id) ? deriveStageDecision(workflowById.get(row.workflow_id), row.stage_index, row, rows.filter((candidate) => candidate.workflow_id === row.workflow_id)) : { kind: "none", actionable: false, canCreateNext: false, message: "\u6682\u65E0\u72B6\u6001" }
  }));
}
async function listWorkflowStageDeployments(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId, reads);
  const sql = query(environment);
  const rows = await sql`SELECT deployments.workflow_id, deployments.stage_index, deployments.stage_id, deployments.source, deployments.provider, deployments.environment, deployments.run_id, deployments.run_name, deployments.run_url, deployments.deployment_url, deployments.state, deployments.conclusion, deployments.failure_summary, deployments.failure_job_url, deployments.health_state, deployments.health_url, deployments.health_detail, deployments.updated_at FROM workflow_stage_deployments deployments WHERE ${visibleWorkflowPredicate(sql, user.id, "deployments.user_id", "deployments.workflow_id")} ORDER BY deployments.workflow_id, deployments.stage_id, deployments.provider`;
  return rows.map((row) => ({ workflowId: row.workflow_id, stageIndex: row.stage_index, stageId: row.stage_id, source: row.source, provider: row.provider, environment: row.environment, runId: row.run_id, runName: row.run_name, runUrl: row.run_url, deploymentUrl: row.deployment_url, state: row.state, conclusion: row.conclusion, failureSummary: row.failure_summary, failureJobUrl: row.failure_job_url, healthState: row.health_state, healthUrl: row.health_url, healthDetail: row.health_detail, updatedAt: row.updated_at }));
}
async function listWorkflowStageDeploymentRuns(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId, reads);
  const sql = query(environment);
  const rows = await sql`SELECT workflow_id, stage_index, stage_id, source, provider, environment, run_id, run_name, run_url, deployment_url, state, conclusion, NULL::text AS failure_summary, NULL::text AS failure_job_url, health_state, health_url, health_detail, first_seen_at, updated_at FROM (SELECT runs.*, row_number() OVER (PARTITION BY workflow_id, stage_id, source ORDER BY updated_at DESC) AS position FROM workflow_stage_deployment_runs runs WHERE ${visibleWorkflowPredicate(sql, user.id, "runs.user_id", "runs.workflow_id")}) recent WHERE position <= 8 ORDER BY workflow_id, stage_id, source, updated_at DESC`;
  return rows.map((row) => ({ workflowId: row.workflow_id, stageIndex: row.stage_index, stageId: row.stage_id, source: row.source, provider: row.provider, environment: row.environment, runId: row.run_id, runName: row.run_name, runUrl: row.run_url, deploymentUrl: row.deployment_url, state: row.state, conclusion: row.conclusion, failureSummary: null, failureJobUrl: null, healthState: row.health_state, healthUrl: row.health_url, healthDetail: row.health_detail, firstSeenAt: row.first_seen_at, updatedAt: row.updated_at }));
}
async function listWorkflowConfigurationWarnings(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const rows = await visibleWorkflowRows(sql, user.id, reads);
  const stored = rows.map((row) => trackedWorkflowFromRow(row)).filter((workflow) => Boolean(workflow) && !workflow.archived);
  if (!identity.installationId) return stored.flatMap((workflow) => workflowConfigurationWarnings(workflow, { actionsAvailable: false, workflows: [], environmentsAvailable: false, environments: [] }));
  const config = parseGithubAppConfig(environment);
  const results = await Promise.all(stored.map(async (workflow) => {
    if (workflow.deployments?.length === 0) return workflowConfigurationWarnings(workflow, { actionsAvailable: true, workflows: [], environmentsAvailable: true, environments: [] });
    const { owner, name } = ownerAndName(workflow.repository);
    const [actions, environmentsResult] = await Promise.all([
      installationRequest(config, identity.installationId, `/repos/${owner}/${name}/actions/workflows?per_page=100`).then((result) => ({ available: true, values: result.workflows.filter((item) => item.state === "active") })).catch(() => ({ available: false, values: [] })),
      installationRequest(config, identity.installationId, `/repos/${owner}/${name}/environments?per_page=100`).then((result) => ({ available: true, values: result.environments.map((item) => item.name) })).catch(() => ({ available: false, values: [] }))
    ]);
    return workflowConfigurationWarnings(workflow, { actionsAvailable: actions.available, workflows: actions.values, environmentsAvailable: environmentsResult.available, environments: environmentsResult.values });
  }));
  return results.flat();
}
async function listRecentWorkflowStageEvents(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId, reads);
  const sql = query(environment);
  const rows = await sql`SELECT events.workflow_id, events.stage_index, events.stage_id, events.source, events.target, events.kind, events.message, events.occurred_at FROM workflow_stage_events events WHERE ${visibleWorkflowPredicate(sql, user.id, "events.user_id", "events.workflow_id")} ORDER BY events.occurred_at DESC LIMIT 100`;
  return rows.map((row) => ({ workflowId: row.workflow_id, stageIndex: row.stage_index, stageId: row.stage_id, source: row.source, target: row.target, kind: row.kind, message: row.message, occurredAt: row.occurred_at }));
}
async function listActionableStages(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const workflows = await visibleWorkflowRows(sql, user.id, reads);
  const states = await visibleStageStateRows(sql, user.id, reads);
  return workflows.flatMap((row) => {
    const stored = trackedWorkflowFromRow(row);
    const workflow = stored && !stored.archived ? ensureStageIds(stored) : void 0;
    if (!workflow) return [];
    return workflow.stages.reduce((items, stage, stageIndex) => {
      const routeStates = states.filter((state) => state.workflow_id === workflow.id && state.stage_id === stage.stageId);
      const preceding = states.filter((state) => state.workflow_id === workflow.id);
      routeStates.forEach((state) => {
        const base = { workflowId: workflow.id, workflowName: workflow.name, repository: workflow.repository, stageIndex, source: state.source, target: stage.target, pullNumber: state.pull_number || null };
        const entry = actionableStageEntry(deriveStageDecision(workflow, stageIndex, state, preceding));
        if (entry) items.push({ ...base, ...entry });
      });
      return items;
    }, []);
  });
}
async function listRecoveryStatuses(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const workflowRows = await visibleWorkflowRows(sql, user.id, reads);
  const policyByWorkflow = /* @__PURE__ */ new Map();
  const stageIndexByIdentity = /* @__PURE__ */ new Map();
  for (const row of workflowRows) {
    const wf = trackedWorkflowFromRow(row);
    if (!wf || wf.archived) continue;
    const normalized = ensureStageIds(wf);
    if (normalized.recoveryPolicy) policyByWorkflow.set(normalized.id, normalized.recoveryPolicy);
    normalized.stages.forEach((stage, index) => {
      if (stage.stageId) stageIndexByIdentity.set(`${normalized.id}:${stage.stageId}`, index);
    });
  }
  const now = Date.now();
  const rows = await sql`SELECT events.workflow_id, events.stage_id, events.source, events.kind, events.occurred_at FROM workflow_stage_events events WHERE ${visibleWorkflowPredicate(sql, user.id, "events.user_id", "events.workflow_id")} AND events.kind = 'actions-rerun' ORDER BY events.occurred_at DESC LIMIT 500`;
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = `${row.workflow_id}:${row.stage_id}:${row.source}`;
    const entry = grouped.get(key) || { workflowId: row.workflow_id, stageId: row.stage_id, source: row.source, retries: [] };
    entry.retries.push(row.occurred_at);
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((entry) => {
    const policy = policyByWorkflow.get(entry.workflowId) || DEFAULT_RECOVERY_POLICY;
    const cooldownMs = policy.cooldownSeconds * 1e3;
    const retryCount = entry.retries.length;
    const lastRetryAt = entry.retries[0] || null;
    const lastRetryMs = lastRetryAt ? new Date(lastRetryAt).getTime() : 0;
    const elapsed = now - lastRetryMs;
    const cooldownRemainingSeconds = elapsed < cooldownMs ? Math.ceil((cooldownMs - elapsed) / 1e3) : 0;
    const exhausted = retryCount >= policy.maxRetries;
    const escalationNeeded = exhausted && cooldownRemainingSeconds === 0;
    return { workflowId: entry.workflowId, stageIndex: stageIndexByIdentity.get(`${entry.workflowId}:${entry.stageId}`) ?? 0, source: entry.source, retryCount, maxRetries: policy.maxRetries, lastRetryAt, cooldownRemainingSeconds, exhausted, escalationNeeded };
  });
}
async function saveWorkflowVersion(sql, userId, workflow) {
  await sql`INSERT INTO workflow_versions (user_id, workflow_id, version) VALUES (${userId}, ${workflow.id}, ${workflow.version})`;
}
async function recordWorkflowRun(environment, identity, workflowId, stageIndex, source, pullNumber) {
  if (!Number.isInteger(stageIndex) || stageIndex < 0) throw new Error("\u65E0\u6548\u7684\u6D41\u7A0B\u6B65\u9AA4");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const rows = await sql`SELECT ${trackedWorkflowColumns(sql)} FROM pr_helper_workflows workflows WHERE workflows.user_id = ${user.id} AND workflows.id = ${workflowId}`;
  const workflow = trackedWorkflowFromSingleRow(rows);
  if (!workflow) throw new Error("\u672A\u627E\u5230\u5BF9\u5E94\u6D41\u7A0B");
  const stage = stageForIndex(workflow, stageIndex);
  const versionRow = await sql`SELECT version FROM workflow_versions WHERE user_id = ${user.id} AND workflow_id = ${workflowId} ORDER BY version DESC LIMIT 1`;
  const version = versionRow[0]?.version || 1;
  const stageSnapshot = { source: stage.source, target: stage.target, stageId: stage.stageId };
  await sql`INSERT INTO workflow_runs (user_id, workflow_id, version, stage_index, stage_id, source, target, stage_snapshot, pull_number) VALUES (${user.id}, ${workflowId}, ${version}, ${stageIndex}, ${stage.stageId}, ${source}, ${stage.target}, ${sql.json(stageSnapshot)}, ${pullNumber})`;
}
async function completeWorkflowRun(environment, identity, workflowId, pullNumber, state) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  await sql`UPDATE workflow_runs SET state = ${state}, completed_at = now() WHERE user_id = ${user.id} AND workflow_id = ${workflowId} AND pull_number = ${pullNumber} AND state = 'active'`;
}
async function listWorkflowRuns(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId, reads);
  const sql = query(environment);
  const rows = await sql`SELECT runs.id, runs.workflow_id, runs.version, runs.stage_index, runs.stage_id, runs.source, runs.target, runs.pull_number, runs.state, runs.started_at, runs.completed_at FROM workflow_runs runs WHERE ${visibleWorkflowPredicate(sql, user.id, "runs.user_id", "runs.workflow_id")} ORDER BY runs.started_at DESC LIMIT 50`;
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    version: row.version,
    stageIndex: row.stage_index,
    stageId: row.stage_id,
    source: row.source,
    target: row.target,
    pullNumber: row.pull_number,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }));
}
async function listSyncHealth(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId, reads);
  const sql = query(environment);
  const [runs, triggerRuns, stageStates, webhookCount] = await Promise.all([
    sql`SELECT id, trigger, state, stages_total, stages_reconciled, stages_failed, duration_ms, error_message, repository, started_at, finished_at FROM reconciliation_runs WHERE user_id = ${user.id} AND state <> 'skipped' ORDER BY started_at DESC LIMIT 1`,
    sql`SELECT DISTINCT ON (trigger) id, trigger, state, stages_total, stages_reconciled, stages_failed, duration_ms, error_message, repository, started_at, finished_at FROM reconciliation_runs WHERE user_id = ${user.id} AND state <> 'skipped' AND started_at > now() - interval '24 hours' ORDER BY trigger, started_at DESC`,
    sql`SELECT states.workflow_id, states.stage_index, states.stage_id, states.repository, states.source, states.target, states.updated_at FROM workflow_stage_states states WHERE ${visibleWorkflowPredicate(sql, user.id, "states.user_id", "states.workflow_id")}`,
    sql`SELECT count(*)::int AS count FROM github_webhook_deliveries WHERE installation_id = ${identity.installationId || null} AND received_at > now() - interval '24 hours'`
  ]);
  const now = Date.now();
  const lastRun = runs[0];
  const asReconciliationRun = (row) => ({
    id: row.id,
    trigger: row.trigger,
    state: row.state,
    stagesTotal: row.stages_total,
    stagesReconciled: row.stages_reconciled,
    stagesFailed: row.stages_failed,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    repository: row.repository,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    interrupted: reconciliationRunInterrupted({ state: row.state, startedAt: row.started_at }, now)
  });
  const lastReconciliation = lastRun ? asReconciliationRun(lastRun) : null;
  const stages = stageStates.map((row) => {
    const updatedAt = row.updated_at;
    const ageSeconds = Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 1e3));
    return { workflowId: row.workflow_id, stageIndex: row.stage_index, stageId: row.stage_id, source: row.source, target: row.target, updatedAt, ageSeconds, stale: ageSeconds > STAGE_STALE_THRESHOLD_SECONDS };
  });
  return { lastReconciliation, triggerHealth: triggerRuns.map(asReconciliationRun), stages, webhookDeliveriesLast24h: webhookCount[0]?.count || 0 };
}
async function readConvergenceHealth(environment) {
  const sql = query(environment);
  const [stageSample, cronSample] = await Promise.all([
    sql`SELECT count(*)::int AS stage_count, floor(extract(epoch from (now() - min(states.updated_at))))::int AS oldest_age_seconds, count(*) FILTER (WHERE states.updated_at < now() - make_interval(secs => ${STAGE_STALE_THRESHOLD_SECONDS}))::int AS stale_count FROM workflow_stage_states states JOIN pr_helper_workflows workflows ON workflows.user_id = states.user_id AND workflows.id = states.workflow_id WHERE workflows.archived = false`,
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'degraded')::int AS degraded FROM reconciliation_runs WHERE trigger = 'cron' AND state <> 'skipped' AND started_at > now() - interval '1 hour'`
  ]);
  const stageCount = stageSample[0]?.stage_count || 0;
  const oldestStageAgeSeconds = stageCount ? stageSample[0]?.oldest_age_seconds ?? null : null;
  const thresholdSeconds = stageUnconvergedThresholdSeconds(environment);
  const verdict = stageConvergenceVerdict({ stageCount, oldestStageAgeSeconds }, thresholdSeconds);
  return {
    healthy: verdict.healthy,
    reason: verdict.reason,
    thresholdSeconds,
    stageCount,
    oldestStageAgeSeconds,
    staleStageCount: stageSample[0]?.stale_count || 0,
    cronRunsLastHour: cronSample[0]?.total || 0,
    cronDegradedLastHour: cronSample[0]?.degraded || 0
  };
}
async function listWorkflowTimeline(environment, identity, reads) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const [events, runs] = await Promise.all([
    sql`SELECT events.workflow_id, events.stage_index, events.stage_id, events.source, events.target, events.kind, events.message, events.occurred_at FROM workflow_stage_events events WHERE ${visibleWorkflowPredicate(sql, user.id, "events.user_id", "events.workflow_id")} ORDER BY events.occurred_at DESC LIMIT 200`,
    sql`SELECT runs.workflow_id, runs.stage_index, runs.stage_id, runs.source, runs.target, runs.pull_number, runs.id, runs.state, runs.started_at, runs.completed_at FROM workflow_runs runs WHERE ${visibleWorkflowPredicate(sql, user.id, "runs.user_id", "runs.workflow_id")} ORDER BY runs.started_at DESC LIMIT 100`
  ]);
  const workflows = await visibleWorkflowRows(sql, user.id, reads);
  const workflowMap = new Map(workflows.map((row) => {
    const wf = trackedWorkflowFromRow(row);
    return [row.id, wf];
  }));
  const timeline = [];
  for (const event of events) {
    const wf = workflowMap.get(event.workflow_id);
    const stage = event.stage_id ? wf?.stages.find((candidate) => candidate.stageId === event.stage_id) : wf?.stages[event.stage_index];
    if (!stage && !event.target) continue;
    timeline.push({
      workflowId: event.workflow_id,
      stageIndex: event.stage_index,
      source: event.source || stage?.source || "",
      target: event.target || stage?.target || "",
      stageId: event.stage_id,
      kind: event.kind,
      message: event.message,
      occurredAt: event.occurred_at,
      pullNumber: null,
      runId: null
    });
  }
  for (const run of runs) {
    timeline.push({
      workflowId: run.workflow_id,
      stageIndex: run.stage_index,
      stageId: run.stage_id,
      source: run.source,
      target: run.target,
      kind: `run-${run.state}`,
      message: run.state === "active" ? `\u53D1\u5E03\u8FD0\u884C\u4E2D (PR #${run.pull_number || "?"})` : run.state === "completed" ? `\u53D1\u5E03\u5B8C\u6210 (PR #${run.pull_number || "?"})` : `\u53D1\u5E03\u5931\u8D25 (PR #${run.pull_number || "?"})`,
      occurredAt: run.completed_at || run.started_at,
      pullNumber: run.pull_number,
      runId: run.id
    });
  }
  timeline.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  return timeline.slice(0, 200);
}
function encryptedSyncScope(scope) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(scope)) throw new Error("\u540C\u6B65\u8303\u56F4\u65E0\u6548");
  return scope;
}
function encryptedSyncMetadata(keyId, deviceId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(keyId)) throw new Error("\u5BC6\u94A5\u6807\u8BC6\u65E0\u6548");
  if (deviceId !== void 0 && deviceId !== null && !/^[a-zA-Z0-9_-]{1,120}$/.test(deviceId)) throw new Error("\u8BBE\u5907\u6807\u8BC6\u65E0\u6548");
  return { keyId, deviceId: deviceId || null };
}
async function saveEncryptedSync(environment, identity, ciphertext, scope = "default", expectedRevision, keyId = "legacy", deviceId) {
  if (!ciphertext || ciphertext.length > 2e6) throw new Error("\u52A0\u5BC6\u6570\u636E\u65E0\u6548");
  const safeScope = encryptedSyncScope(scope);
  const metadata = encryptedSyncMetadata(keyId, deviceId);
  if (expectedRevision !== void 0 && expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) throw new Error("\u540C\u6B65\u7248\u672C\u65E0\u6548");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  return sql.begin(async (transaction) => {
    const rows = await transaction`SELECT ciphertext, updated_at, revision, key_id, device_id FROM pr_helper_encrypted_sync WHERE user_id = ${user.id} AND scope = ${safeScope} FOR UPDATE`;
    const current = rows[0] ? { ciphertext: rows[0].ciphertext, updatedAt: rows[0].updated_at, revision: Number(rows[0].revision), keyId: rows[0].key_id, deviceId: rows[0].device_id } : null;
    if (current && expectedRevision !== current.revision) return { ok: false, conflict: true, record: current };
    if (current) await transaction`INSERT INTO pr_helper_encrypted_sync_history (user_id, scope, revision, ciphertext, key_id, device_id) VALUES (${user.id}, ${safeScope}, ${current.revision}, ${current.ciphertext}, ${current.keyId}, ${current.deviceId}) ON CONFLICT (user_id, scope, revision) DO NOTHING`;
    const nextRevision = current ? current.revision + 1 : 1;
    const saved = await transaction`INSERT INTO pr_helper_encrypted_sync (user_id, scope, ciphertext, revision, key_id, device_id) VALUES (${user.id}, ${safeScope}, ${ciphertext}, ${nextRevision}, ${metadata.keyId}, ${metadata.deviceId}) ON CONFLICT (user_id, scope) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, revision = EXCLUDED.revision, key_id = EXCLUDED.key_id, device_id = EXCLUDED.device_id, updated_at = now() RETURNING ciphertext, updated_at, revision, key_id, device_id`;
    const row = saved[0];
    return { ok: true, record: { ciphertext: row.ciphertext, updatedAt: row.updated_at, revision: Number(row.revision), keyId: row.key_id, deviceId: row.device_id } };
  });
}
async function loadEncryptedSync(environment, identity, scope = "default") {
  const safeScope = encryptedSyncScope(scope);
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const rows = await sql`SELECT ciphertext, updated_at, revision, key_id, device_id FROM pr_helper_encrypted_sync WHERE user_id = ${user.id} AND scope = ${safeScope} LIMIT 1`;
  if (!rows.length) return null;
  return { ciphertext: rows[0].ciphertext, updatedAt: rows[0].updated_at, revision: Number(rows[0].revision), keyId: rows[0].key_id, deviceId: rows[0].device_id };
}
var RETENTION_DAYS = { webhookDeliveries: 30, encryptedSyncHistory: 30, reconciliationRuns: 90, stageEvents: 180, deploymentRuns: 180, operationAudit: 365 };
var RETENTION_BATCH_SIZE = 2e3;
function retentionCutoffs(now = /* @__PURE__ */ new Date()) {
  const cutoff = (days) => new Date(now.getTime() - days * 864e5).toISOString();
  return Object.fromEntries(Object.entries(RETENTION_DAYS).map(([key, days]) => [key, cutoff(days)]));
}
async function cleanupRetainedData(environment) {
  const sql = query(environment);
  const cutoffs = retentionCutoffs();
  const started = await sql`INSERT INTO data_retention_runs DEFAULT VALUES RETURNING id`;
  const runId = started[0].id;
  try {
    const [webhooks, history, reconciliation, events, deployments, audit] = await Promise.all([
      sql`WITH stale AS (SELECT ctid FROM github_webhook_deliveries WHERE received_at < ${cutoffs.webhookDeliveries} LIMIT ${RETENTION_BATCH_SIZE}) DELETE FROM github_webhook_deliveries USING stale WHERE github_webhook_deliveries.ctid = stale.ctid RETURNING 1`,
      sql`WITH stale AS (SELECT ctid FROM pr_helper_encrypted_sync_history WHERE replaced_at < ${cutoffs.encryptedSyncHistory} LIMIT ${RETENTION_BATCH_SIZE}) DELETE FROM pr_helper_encrypted_sync_history USING stale WHERE pr_helper_encrypted_sync_history.ctid = stale.ctid RETURNING 1`,
      sql`WITH stale AS (SELECT ctid FROM reconciliation_runs WHERE finished_at < ${cutoffs.reconciliationRuns} LIMIT ${RETENTION_BATCH_SIZE}) DELETE FROM reconciliation_runs USING stale WHERE reconciliation_runs.ctid = stale.ctid RETURNING 1`,
      sql`WITH stale AS (SELECT ctid FROM workflow_stage_events WHERE occurred_at < ${cutoffs.stageEvents} LIMIT ${RETENTION_BATCH_SIZE}) DELETE FROM workflow_stage_events USING stale WHERE workflow_stage_events.ctid = stale.ctid RETURNING 1`,
      sql`WITH stale AS (SELECT ctid FROM workflow_stage_deployment_runs WHERE updated_at < ${cutoffs.deploymentRuns} LIMIT ${RETENTION_BATCH_SIZE}) DELETE FROM workflow_stage_deployment_runs USING stale WHERE workflow_stage_deployment_runs.ctid = stale.ctid RETURNING 1`,
      sql`WITH stale AS (SELECT ctid FROM workflow_operation_audit_logs WHERE occurred_at < ${cutoffs.operationAudit} LIMIT ${RETENTION_BATCH_SIZE}) DELETE FROM workflow_operation_audit_logs USING stale WHERE workflow_operation_audit_logs.ctid = stale.ctid RETURNING 1`
    ]);
    await sql`DELETE FROM reconciliation_leases WHERE expires_at < now() - interval '1 hour'`.catch(() => void 0);
    const deleted = { webhooks: webhooks.length, encryptedSyncHistory: history.length, reconciliationRuns: reconciliation.length, stageEvents: events.length, deploymentRuns: deployments.length, operationAudit: audit.length };
    await sql`UPDATE data_retention_runs SET state = 'success', finished_at = now(), deleted_counts = ${sql.json(deleted)} WHERE id = ${runId}`;
    return deleted;
  } catch (error) {
    await sql`UPDATE data_retention_runs SET state = 'failure', finished_at = now(), error_message = ${error instanceof Error ? error.message.slice(0, 800) : "\u4FDD\u7559\u6E05\u7406\u5931\u8D25"} WHERE id = ${runId}`.catch(() => void 0);
    throw error;
  }
}
async function requireTeamOwner(sql, teamId, userId) {
  const rows = await sql`SELECT role FROM pr_helper_team_members WHERE team_id = ${teamId} AND user_id = ${userId} LIMIT 1`;
  if (rows[0]?.role !== "owner") throw new Error("\u53EA\u6709\u56E2\u961F Owner \u53EF\u4EE5\u7BA1\u7406\u6210\u5458\u548C\u5171\u4EAB\u6D41\u7A0B");
}
async function listTeams(environment, identity) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const rows = await query(environment)`SELECT teams.id, teams.name, members.role, teams.created_at FROM pr_helper_teams teams JOIN pr_helper_team_members members ON members.team_id = teams.id WHERE members.user_id = ${user.id} ORDER BY teams.created_at ASC`;
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role, createdAt: row.created_at }));
}
async function createTeam(environment, identity, name) {
  const normalized = name.trim();
  if (!normalized || normalized.length > 120) throw new Error("\u56E2\u961F\u540D\u79F0\u5E94\u4E3A 1 \u81F3 120 \u4E2A\u5B57\u7B26");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  return sql.begin(async (transaction) => {
    const teams = await transaction`INSERT INTO pr_helper_teams (name, created_by) VALUES (${normalized}, ${user.id}) RETURNING id, name, created_at`;
    const team = teams[0];
    await transaction`INSERT INTO pr_helper_team_members (team_id, user_id, role) VALUES (${team.id}, ${user.id}, 'owner')`;
    return { id: team.id, name: team.name, role: "owner", createdAt: team.created_at };
  });
}
async function addTeamMember(environment, identity, teamId, githubLogin, role) {
  if (!["owner", "editor", "operator", "viewer"].includes(role)) throw new Error("\u56E2\u961F\u89D2\u8272\u65E0\u6548");
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  await requireTeamOwner(sql, teamId, user.id);
  const members = await sql`SELECT id FROM pr_helper_users WHERE github_login = ${githubLogin.trim()} LIMIT 1`;
  if (!members[0]) throw new Error("\u8BE5 GitHub \u7528\u6237\u5C1A\u672A\u767B\u5F55 PR Helper\uFF0C\u6682\u65F6\u65E0\u6CD5\u52A0\u5165\u56E2\u961F");
  await sql`INSERT INTO pr_helper_team_members (team_id, user_id, role) VALUES (${teamId}, ${members[0].id}, ${role}) ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
}
async function listTeamMembers(environment, identity, teamId) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  const access = await sql`SELECT role FROM pr_helper_team_members WHERE team_id = ${teamId} AND user_id = ${user.id} LIMIT 1`;
  if (!access.length) throw new Error("\u672A\u83B7\u5F97\u56E2\u961F\u8BBF\u95EE\u6743\u9650");
  const rows = await sql`SELECT users.github_login, members.role FROM pr_helper_team_members members JOIN pr_helper_users users ON users.id = members.user_id WHERE members.team_id = ${teamId} ORDER BY CASE members.role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END DESC, users.github_login ASC`;
  return rows.map((row) => ({ githubLogin: row.github_login, role: row.role }));
}
async function removeTeamMember(environment, identity, teamId, githubLogin) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  await requireTeamOwner(sql, teamId, user.id);
  const members = await sql`SELECT users.id, members.role FROM pr_helper_team_members members JOIN pr_helper_users users ON users.id = members.user_id WHERE members.team_id = ${teamId} AND users.github_login = ${githubLogin.trim()} LIMIT 1`;
  const member = members[0];
  if (!member) throw new Error("\u56E2\u961F\u6210\u5458\u4E0D\u5B58\u5728");
  if (member.role === "owner") {
    const owners = await sql`SELECT count(*)::int AS count FROM pr_helper_team_members WHERE team_id = ${teamId} AND role = 'owner'`;
    if ((owners[0]?.count || 0) <= 1) throw new Error("\u56E2\u961F\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4F4D Owner");
  }
  await sql`DELETE FROM pr_helper_team_members WHERE team_id = ${teamId} AND user_id = ${member.id}`;
}
async function shareWorkflowWithTeam(environment, identity, teamId, workflowId) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  await requireTeamOwner(sql, teamId, user.id);
  const workflows = await sql`SELECT id FROM pr_helper_workflows WHERE user_id = ${user.id} AND id = ${workflowId} LIMIT 1`;
  if (!workflows[0]) throw new Error("\u53EA\u80FD\u5171\u4EAB\u81EA\u5DF1\u62E5\u6709\u7684\u6D41\u7A0B");
  await sql`INSERT INTO pr_helper_team_workflows (team_id, owner_user_id, workflow_id, shared_by) VALUES (${teamId}, ${user.id}, ${workflowId}, ${user.id}) ON CONFLICT DO NOTHING`;
}
async function deleteAccount(environment, identity) {
  const user = await userForLogin(environment, identity.login, identity.githubUserId, identity.installationId);
  const sql = query(environment);
  await sql.begin(async (transaction) => {
    await transaction`DELETE FROM pr_helper_team_workflows WHERE shared_by = ${user.id}`;
    await transaction`DELETE FROM pr_helper_teams WHERE created_by = ${user.id}`;
    await transaction`DELETE FROM pr_helper_users WHERE id = ${user.id}`;
  });
  return { deleted: true };
}
export {
  AUTOMATION_ACTION_ABANDON_MS,
  AUTOMATION_ACTION_STALE_MS,
  AUTOMATION_ACTION_VIEW_LIMIT,
  AUTOMATION_DRAIN_BATCH_SIZE,
  AUTOMATION_DRAIN_START_BUDGET_MS,
  AUTOMATION_FUNCTION_CEILING_MS,
  AUTOMATION_GATE_WAIT_MAX_MS,
  AUTOMATION_TRANSIENT_REQUEUE_COOLDOWN_MS,
  AUTOMATION_TRANSIENT_REQUEUE_MAX_ATTEMPTS,
  CRON_RECONCILE_BUDGET_MS,
  DEFAULT_RECOVERY_POLICY,
  INBOX_REFRESH_RECONCILE_BUDGET_MS,
  INBOX_REFRESH_RECONCILE_CEILING_GAP_MS,
  REALTIME_CATCH_UP_LIMIT,
  REALTIME_RECONCILE_BUDGET_MS,
  RECONCILE_WORKFLOW_BATCH_SIZE,
  RECONCILIATION_ABANDONED_MESSAGE,
  RECONCILIATION_DEFERRED_MESSAGE,
  RECONCILIATION_LEASE_TTL_SECONDS,
  RECONCILIATION_RUN_GRACE_SECONDS,
  RETENTION_DAYS,
  STAGE_STALE_THRESHOLD_SECONDS,
  STAGE_UNCONVERGED_THRESHOLD_SECONDS,
  WEBHOOK_RECONCILE_BUDGET_MS,
  actionableStageEntry,
  addPhaseTotals,
  addTeamMember,
  authorizeWorkflowOperation,
  autoCreateCommitThreshold,
  autoCreateReachedThreshold,
  automationActionId,
  automationAdvanceIdempotencyKey,
  automationAdvanceVerdict,
  automationAttemptWasReached,
  automationCancelReason,
  automationCreateOutcome,
  automationDrainDecision,
  automationDrainFailureReason,
  automationDrainHasStartBudget,
  automationGateWaitDelayMs,
  automationIdempotencyKey,
  automationMergeOutcome,
  automationRetryIsExhausted,
  automationSkipLine,
  branchRuleMatches,
  branchSourcesForRule,
  canCheckDeploymentUrl,
  cleanupRetainedData,
  codexRepairContext,
  compactFailureDetails,
  completeWorkflowRun,
  createPhaseRecorder,
  createTeam,
  cronReconcileBudgetMs,
  deferredRunState,
  dehydrateGenerationRules,
  deleteAccount,
  deleteAiAutomationCredential,
  deploymentFailureSummary,
  deploymentNotification,
  deploymentParentState,
  deploymentProviderForWorkflowRun,
  deploymentRowChanged,
  deploymentRunState,
  deploymentStateWithHealth,
  deriveStageDecision,
  downstreamStagesToRecheck,
  drainWorkflowAutomationActions,
  dynamicSourceCandidates,
  enqueueWorkflowAutomationAction,
  ensureStageIds,
  etagTelemetryLine,
  executeWorkflowAutomationAction,
  findWorkflowStageIndexForRemoval,
  generateStageId,
  generationRuleContent,
  generationRuleContentHash,
  generationRuleHashes,
  getAiAutomationCredential,
  hasPushSubscription,
  hydrateGenerationRules,
  initialWebhookChecksState,
  isBranchRule,
  isStoredWorkflow,
  jsonFromModelText,
  listActionableStages,
  listOperationAuditLogs,
  listRecentWorkflowStageEvents,
  listRecoveryStatuses,
  listSyncHealth,
  listTeamMembers,
  listTeams,
  listWorkflowAutomationActions,
  listWorkflowConfigurationWarnings,
  listWorkflowRuns,
  listWorkflowStageDeploymentRuns,
  listWorkflowStageDeployments,
  listWorkflowStageStates,
  listWorkflowTimeline,
  listWorkflows,
  loadEncryptedSync,
  matchingWorkflowStages,
  mergeCatchUpCandidates,
  mergeChecksWithDeployments,
  missingDeploymentSummary,
  parseAutomationMessage,
  pendingPhaseTotals,
  projectPullRequestWebhook,
  pullDetailPath,
  readAiAutomationCredential,
  readConvergenceHealth,
  realtimeReconcileBudgetMs,
  realtimeReconcileCeilingMs,
  reconcileRealtime,
  reconcileTimingLine,
  reconcileWorkflowStages,
  reconciliationBatchSize,
  reconciliationBranchScope,
  reconciliationLeaseRenewIntervalMs,
  reconciliationLeaseTtlSeconds,
  reconciliationLockKey,
  reconciliationRunInterrupted,
  reconciliationRunIsAbandoned,
  reconciliationState,
  recordOperationAudit,
  recordRecoveryEvent,
  recordWebhookDelivery,
  recordWorkflowRun,
  regenerateAutomationMessage,
  removePushSubscription,
  removeTeamMember,
  removeWorkflow,
  removeWorkflowStage,
  repairCommitSha,
  requestDeploymentRollback,
  requestUser,
  requiredApprovalsFromProtection,
  rerunFailedActions,
  retentionCutoffs,
  rollbackDeploymentIsAvailable,
  saveAiAutomationCredential,
  saveEncryptedSync,
  savePushSubscription,
  selectReconciliationBatch,
  selectRepairPullNumber,
  serverAutomationActivated,
  shareWorkflowWithTeam,
  sortStoredWorkflows,
  stageConvergenceVerdict,
  stageGateChanged,
  stageGateSatisfactionAdvanced,
  stageIdentity,
  stageReconciliationIsSettled,
  stageRoutesComplete,
  stageUnconvergedThresholdSeconds,
  staleDeploymentProviders,
  storedWorkflowFromPayload,
  takeoverAutomationAction,
  testSavedAiAutomationCredential,
  trackedWorkflowFromSingleRow,
  upsertWorkflow,
  webhookBranchesForEvent,
  webhookCanChangeStageState,
  withStageDeadline,
  workflowArchiveTransition,
  workflowConfigurationWarnings,
  workflowRunCompletionState,
  workflowSaveConflicts,
  workflowStageStateMatchesDefinition
};
