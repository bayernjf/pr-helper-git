// The upstream step page rendered two gate disclosures: commit checks and
// GitHub Actions workflow runs. This component keeps the Actions half live
// (head_sha read through the PAT proxy) without adding a projection column.
import { usePreferences } from '../app-state/preferences-provider';
import { useActionRunDetails } from '../hooks/use-action-run-details';
import { t, tp } from '../i18n';
import GateDisclosure from './GateDisclosure';

export default function StageActionsGate({ repository, headSha, target, className = 'detail-gate' }: {
  repository: string;
  headSha: string | null;
  target: string;
  className?: string;
}) {
  const { pat, hasServerPat } = usePreferences();
  const details = useActionRunDetails(pat, hasServerPat, repository, headSha);
  if (!details?.length) return null;
  const failed = details.filter((detail) => detail.state === 'failure').length;
  const pending = details.filter((detail) => detail.state === 'pending').length;
  const passed = details.length - failed - pending;
  return (
    <GateDisclosure
      className={className}
      target={target}
      details={details}
      summary={tp('Actions {passed}/{total} {state}', {
        passed,
        total: details.length,
        state: failed
          ? t('Actions failed')
          : pending ? t('Actions running') : t('Actions passed'),
      })}
    />
  );
}
