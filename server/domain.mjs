function plainTextSummary(value) {
  if (!value) return null;
  const text = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
  return text || null;
}
function getStageAction({ previous, stage }) {
  if (stage.pr === "open") return "monitor";
  if (!previous) return "create-pr";
  if (previous.pr !== "merged" || previous.checks !== "success") return "locked";
  return stage.previewApproved ? "create-pr" : "confirm-preview";
}
function githubCompareUrl(repository, source, target) {
  return `https://github.com/${repository}/compare/${target}...${source}?expand=1`;
}
function githubPullUrl(repository, number) {
  return `https://github.com/${repository}/pull/${number}`;
}
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
function checkSourceLabel(name, appSlug) {
  const value = `${appSlug || ""} ${name}`.toLowerCase();
  if (value.includes("cloudflare")) return "Cloudflare Pages";
  if (value.includes("vercel")) return "Vercel";
  if (value.includes("github-actions") || value.includes("github actions")) return "GitHub Actions";
  return appSlug ? "External Check" : "Commit Status";
}
function summarizeGitHubCheckDetails(checkRuns, commitStatuses) {
  const details = checkRuns.map((run) => ({
    name: run.name || "Check Run",
    source: checkSourceLabel(run.name || "Check Run", run.app?.slug),
    state: ["failure", "cancelled", "timed_out", "action_required"].includes(run.conclusion || "") ? "failure" : run.status === "completed" ? "success" : "pending",
    conclusion: run.conclusion,
    url: run.html_url || run.details_url || null,
    summary: plainTextSummary(run.output?.summary || run.output?.title)
  }));
  details.push(...commitStatuses.map((status) => ({
    name: status.context || "Commit Status",
    source: checkSourceLabel(status.context || "Commit Status"),
    state: ["failure", "error"].includes(status.state) ? "failure" : status.state === "success" ? "success" : "pending",
    conclusion: status.state,
    url: status.target_url || null,
    summary: null
  })));
  return details;
}
function deploymentSummaryForTarget(summary, source, target) {
  if (!summary || !source.toLowerCase().includes("cloudflare")) return summary;
  const environment = target === "main" ? "Production" : target === "dev" ? "Preview" : null;
  return environment ? summary.replace(/\b(?:Preview|Production)\s+URL\s*:/i, `${environment} URL:`) : summary;
}
function canCreateStage(index, statuses) {
  return statuses.slice(0, index).every((status) => status.kind === "merged" && (!status.checks || status.checks.state === "success"));
}
function canCreateWorkflowStage(index, stages, statuses) {
  const waitFor = stages[index]?.waitFor;
  if (waitFor?.length) return waitFor.every((dependency) => statuses[dependency]?.kind === "merged" && (!statuses[dependency]?.checks || statuses[dependency]?.checks?.state === "success"));
  return stages[index]?.independent === true || canCreateStage(index, statuses);
}
function statusChanged(previous, next) {
  return previous.kind !== next.kind || previous.checks !== next.checks;
}
function needsNewPullRequest(aheadBy, latestPullState) {
  return aheadBy > 0 && latestPullState === "merged";
}
function canMergeOpenPull(input) {
  return (!input.checks || input.checks === "success") && (!input.actions || input.actions === "success") && input.approvalsMet && input.mergeable === true && input.mergeableState === "clean";
}
export {
  canCreateStage,
  canCreateWorkflowStage,
  canMergeOpenPull,
  checkSourceLabel,
  deploymentSummaryForTarget,
  getStageAction,
  githubCompareUrl,
  githubPullUrl,
  needsNewPullRequest,
  plainTextSummary,
  statusChanged,
  summarizeChecks,
  summarizeGitHubCheckDetails,
  summarizeGitHubChecks
};
