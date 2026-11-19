// Board-level preflight aggregation (the old overview preflightPanel totals):
// sum the per-flow finding counts into one badge and keep a per-flow row so
// the board modal can name which lane is blocking. Structural types keep this
// module free of API imports, like the other automation semantics modules.

type FindingLike = { status: 'pass' | 'warn' | 'fail' | 'skip' };

type ResultLike = {
  workflowId: string;
  repository: string;
  ok: boolean;
  findings: readonly FindingLike[];
};

export type PreflightCounts = { fail: number; warn: number; pass: number };

export function preflightCounts(findings: readonly FindingLike[]): PreflightCounts {
  return {
    fail: findings.filter((finding) => finding.status === 'fail').length,
    warn: findings.filter((finding) => finding.status === 'warn').length,
    pass: findings.filter((finding) => finding.status === 'pass').length,
  };
}

export type BoardPreflightSummary = {
  totals: PreflightCounts;
  /** Every checked flow is ok and no flow failed to check. */
  ok: boolean;
  flows: Array<{ workflowId: string; repository: string; ok: boolean; counts: PreflightCounts }>;
};

export function aggregateBoardPreflight(
  results: readonly ResultLike[],
  errors: readonly { workflowId: string }[],
): BoardPreflightSummary {
  const flows = results.map((result) => ({
    workflowId: result.workflowId,
    repository: result.repository,
    ok: result.ok,
    counts: preflightCounts(result.findings),
  }));
  const totals = flows.reduce(
    (sum, flow) => ({
      fail: sum.fail + flow.counts.fail,
      warn: sum.warn + flow.counts.warn,
      pass: sum.pass + flow.counts.pass,
    }),
    { fail: 0, warn: 0, pass: 0 },
  );
  return { totals, ok: errors.length === 0 && results.every((result) => result.ok), flows };
}