// Team panel: who is signed in, the member list (admin only), one-time member
// tokens, and export/import of the team configuration (repository registry).
import { useEffect, useRef, useState } from 'react';
import {
  createTeamUser,
  getMe,
  getTeam,
  getTeamConfig,
  importTeamConfig,
  removeTeamUser,
  type Me,
  type TeamMember,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconCopy, IconTrash, IconUser, IconX } from './icons';
import { Dropdown } from './Dropdown';
import { t } from '../i18n';

export default function TeamModal({ onClose }: { onClose: () => void }) {
  const { refresh, toast } = useApp();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<TeamMember[]>([]);
  const [owner, setOwner] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEscape(onClose);

  async function load() {
    try {
      const who = await getMe();
      setMe(who);
      if (who.role === 'admin') {
        const team = await getTeam();
        setOwner(team.owner);
        setUsers(team.users);
      }
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  useEffect(() => { void load(); }, []);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await createTeamUser(name.trim(), role);
      setCreated({ name: res.user.name, token: res.token });
      setName('');
      setCopied(false);
      await load();
      toast(`Created ${res.user.name}`, 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: string) {
    if (busy) return;
    setBusy(true);
    try {
      await removeTeamUser(member);
      await load();
      toast(`Removed ${member}`, 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function copyToken() {
    if (!created) return;
    void navigator.clipboard?.writeText(created.token).then(() => setCopied(true)).catch(() => {});
  }

  async function exportConfig() {
    try {
      const config = await getTeamConfig();
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pr-helper-git2-team.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function importConfig(file: File) {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.repos)) throw new Error('file has no repos array');
      const res = await importTeamConfig({
        repos: parsed.repos,
        mode: replaceOnImport ? 'replace' : 'merge',
      });
      await refresh();
      toast(t(`Imported ${res.imported} repositories`), 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Team")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <div className="team-me">
            <IconUser width={15} height={15} />
            {me ? (
              <span>
                {t("Signed in as")} <b>{me.name}</b>
                <span className={`role-badge ${me.role}`}>{t(me.role)}</span>
                {me.instance && <span className="muted"> （{t("instance owner")}）</span>}
              </span>
            ) : (
              <span className="muted">{t("Loading…")}</span>
            )}
          </div>

          {me?.role === 'admin' ? (
            <>
              <div className="detail-section">
                <span className="detail-label">{t("Members")}</span>
                <div className="team-list">
                  {owner && (
                    <div className="team-row">
                      <span className="team-name">{owner.name}</span>
                      <span className="role-badge admin">admin</span>
                      <span className="muted team-note">{t("instance token")}</span>
                    </div>
                  )}
                  {users.map((u) => (
                    <div className="team-row" key={u.name}>
                      <span className="team-name">{u.name}</span>
                      <span className={`role-badge ${u.role}`}>{u.role}</span>
                      <span className="muted team-note">{u.createdAt ? u.createdAt.slice(0, 10) : ''}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        title={`Remove ${u.name}`}
                        aria-label={`Remove ${u.name}`}
                        disabled={busy}
                        onClick={() => removeMember(u.name)}
                      >
                        <IconTrash width={13} height={13} />
                      </button>
                    </div>
                  ))}
                  {users.length === 0 && <div className="list-empty">{t("No members yet.")}</div>}
                </div>
              </div>

              <form className="team-add" onSubmit={addMember}>
                <input
                  placeholder="Member name (letters, digits, _ or -)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label={t("New member name")}
                />
                <Dropdown
                  value={role}
                  onChange={(v) => setRole(v as 'admin' | 'member')}
                  aria-label={t('New member role')}
                  options={[
                    { value: 'member', label: t('member') },
                    { value: 'admin', label: t('admin') },
                  ]}
                />
                <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                  {t("Create member")}
                </button>
              </form>

              {created && (
                <div className="team-token">
                  <div className="hint">
                    {t("Token for")} <b>{created.name}</b>{t(" — shown once. They sign in by opening")}
                    <code>/?token=&lt;token&gt;</code>{t(" on this server.")}
                  </div>
                  <div className="team-token-row">
                    <input readOnly value={created.token} aria-label={t("New member token")} />
                    <button type="button" className="btn" onClick={copyToken}>
                      <IconCopy width={13} height={13} />
                      {copied ? t('Copied') : t('Copy')}
                    </button>
                  </div>
                </div>
              )}

              <div className="detail-section">
                <span className="detail-label">{t("Team configuration")}</span>
                <div className="hint">
                  {t("Repository registry plus member names. Tokens and GitHub PATs are never exported.")}
                </div>
                <div className="team-config-actions">
                  <button type="button" className="btn" onClick={exportConfig}>
                    {t("Export team config")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    {t("Import…")}
                  </button>
                  <label className="hint team-replace">
                    <input
                      type="checkbox"
                      checked={replaceOnImport}
                      onChange={(e) => setReplaceOnImport(e.target.checked)}
                    />
                    {t("Replace the current repository list")}
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="team-file"
                    aria-label={t("Import team configuration")}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importConfig(file);
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="hint">
              {t("Member accounts can use Git and pull requests. Ask the owner for team administration and configuration import.")}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
    </div>
  );
}
