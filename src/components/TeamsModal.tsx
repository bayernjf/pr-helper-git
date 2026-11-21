// Team panel (P2-8/P3-15): the migrated pr-helper four-role team model.
// Owner manages membership and shares personal flows; every member sees the
// team and its members. This is intentionally separate from TeamModal, which
// manages local instance tokens and repository configuration.
import { useEffect, useMemo, useState } from 'react';
import {
  addTeamMember,
  createTeam,
  fetchFlows,
  fetchTeamMembers,
  fetchTeams,
  removeTeamMember,
  shareWorkflowWithTeam,
  type TeamMemberRow,
  type TeamSummary,
} from '../api/flows';
import type { Workflow } from '../lib/automation/workflow';
import { teamRoleLabel, type TeamRole } from '../lib/automation/team-permissions';
import { errorMessage } from '../lib/errors';
import { useEscape } from '../hooks/use-escape';
import { useToast } from './ui';
import { t, tp } from '../i18n';
import { IconX } from './icons';

const ROLES: TeamRole[] = ['owner', 'editor', 'operator', 'viewer'];

export default function TeamsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [memberLogin, setMemberLogin] = useState('');
  const [memberRole, setMemberRole] = useState<TeamRole>('viewer');
  const [shareWorkflowId, setShareWorkflowId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEscape(onClose);

  const selected = teams.find((team) => team.id === selectedId) ?? null;
  const canManage = selected?.role === 'owner';
  const personalFlows = useMemo(() => workflows.filter((flow) => !flow.team), [workflows]);

  async function loadTeams(nextId = selectedId) {
    const payload = await fetchTeams();
    const next = payload.teams ?? [];
    setTeams(next);
    const target = next.some((team) => team.id === nextId) ? nextId : next[0]?.id ?? '';
    setSelectedId(target);
    if (target) {
      const result = await fetchTeamMembers(target);
      setMembers(result.members ?? []);
    } else {
      setMembers([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTeams(), fetchFlows()])
      .then(async ([teamPayload, flowPayload]) => {
        if (cancelled) return;
        const nextTeams = teamPayload.teams ?? [];
        setTeams(nextTeams);
        setWorkflows(flowPayload.workflows ?? []);
        const first = nextTeams[0]?.id ?? '';
        setSelectedId(first);
        if (first) {
          const result = await fetchTeamMembers(first);
          if (!cancelled) setMembers(result.members ?? []);
        }
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function switchTeam(teamId: string) {
    setSelectedId(teamId);
    setError('');
    if (!teamId) { setMembers([]); return; }
    try {
      const result = await fetchTeamMembers(teamId);
      setMembers(result.members ?? []);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function createNewTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setBusy('create');
    setError('');
    try {
      const result = await createTeam(name);
      setNewTeamName('');
      await loadTeams(result.team?.id ?? '');
      toast.notify(t('Team created'), 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function addMember() {
    const login = memberLogin.trim();
    if (!login || !selectedId) return;
    setBusy('member');
    setError('');
    try {
      await addTeamMember({ teamId: selectedId, githubLogin: login, role: memberRole });
      setMemberLogin('');
      const result = await fetchTeamMembers(selectedId);
      setMembers(result.members ?? []);
      toast.notify(t('Team member saved'), 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function removeMember(login: string) {
    if (!selectedId) return;
    setBusy(`remove-${login}`);
    setError('');
    try {
      await removeTeamMember({ teamId: selectedId, githubLogin: login });
      const result = await fetchTeamMembers(selectedId);
      setMembers(result.members ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function shareFlow() {
    if (!selectedId || !shareWorkflowId) return;
    setBusy('share');
    setError('');
    try {
      await shareWorkflowWithTeam({ teamId: selectedId, workflowId: shareWorkflowId });
      const flowPayload = await fetchFlows();
      setWorkflows(flowPayload.workflows ?? []);
      setShareWorkflowId('');
      toast.notify(t('Flow shared with team'), 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('Teams')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body teams-body">
          {loading ? <p className="compact-notice">{t('Loading…')}</p> : null}
          {error ? <p className="drawer-error" role="alert">{error}</p> : null}

          <section className="teams-create">
            <label className="editor-label">
              <span>{t('Create a team')}</span>
              <input
                value={newTeamName}
                maxLength={120}
                onChange={(event) => setNewTeamName(event.target.value)}
                placeholder={t('Team name')}
                aria-label={t('Team name')}
              />
            </label>
            <button type="button" className="drawer-btn" disabled={!newTeamName.trim() || busy === 'create'} onClick={() => void createNewTeam()}>
              {busy === 'create' ? t('Creating…') : t('Create team')}
            </button>
          </section>

          {!teams.length && !loading ? (
            <p className="compact-notice">{t('No teams yet')}</p>
          ) : null}

          {teams.length ? (
            <div className="teams-layout">
              <label className="editor-label teams-selector">
                <span>{t('Team')}</span>
                <select value={selectedId} onChange={(event) => void switchTeam(event.target.value)} aria-label={t('Team')}>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} · {teamRoleLabel(team.role)}
                    </option>
                  ))}
                </select>
              </label>

              <section className="teams-section" aria-label={t('Team members')}>
                <h3>{t('Team members')}</h3>
                {members.length ? (
                  <ul className="teams-member-list">
                    {members.map((member) => (
                      <li key={member.githubLogin} className="teams-member-row">
                        <span>@{member.githubLogin} <small>{teamRoleLabel(member.role)}</small></span>
                        {canManage ? (
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy === `remove-${member.githubLogin}`}
                            onClick={() => void removeMember(member.githubLogin)}
                          >
                            {busy === `remove-${member.githubLogin}` ? t('Removing…') : t('Remove')}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : <p className="compact-notice">{t('No members')}</p>}

                {canManage ? (
                  <div className="teams-member-form">
                    <label className="editor-label">
                      <span>{t('GitHub login')}</span>
                      <input
                        value={memberLogin}
                        onChange={(event) => setMemberLogin(event.target.value)}
                        placeholder="octocat"
                        autoComplete="off"
                        aria-label={t('GitHub login')}
                      />
                    </label>
                    <label className="editor-label">
                      <span>{t('Role')}</span>
                      <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as TeamRole)} aria-label={t('Role')}>
                        {ROLES.map((role) => <option key={role} value={role}>{teamRoleLabel(role)}</option>)}
                      </select>
                    </label>
                    <button type="button" className="drawer-btn" disabled={!memberLogin.trim() || busy === 'member'} onClick={() => void addMember()}>
                      {busy === 'member' ? t('Saving…') : t('Add member')}
                    </button>
                  </div>
                ) : <p className="muted">{t('Only team owners can manage members')}</p>}
              </section>

              <section className="teams-section" aria-label={t('Share a flow')}>
                <h3>{t('Share a flow')}</h3>
                {canManage && personalFlows.length ? (
                  <div className="teams-share-form">
                    <label className="editor-label">
                      <span>{t('Personal flow')}</span>
                      <select value={shareWorkflowId} onChange={(event) => setShareWorkflowId(event.target.value)} aria-label={t('Personal flow')}>
                        <option value="">{tp('Select a flow ({count})', { count: personalFlows.length })}</option>
                        {personalFlows.map((flow) => (
                          <option key={flow.id} value={flow.id}>{flow.name} · {flow.repository}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="drawer-btn" disabled={!shareWorkflowId || busy === 'share'} onClick={() => void shareFlow()}>
                      {busy === 'share' ? t('Sharing…') : t('Share flow')}
                    </button>
                  </div>
                ) : <p className="muted">{canManage ? t('No personal flows to share') : t('Only team owners can manage members')}</p>}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
