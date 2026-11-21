import { errorMessage, errorDetail } from '../lib/errors';
import { useEffect, useRef, useState } from 'react';
import {
  getAiConfig, getMe, saveAiConfig, testAi, getStorage, rotateAudit, pruneRepos,
  getGithubAuthStatus, getGithubInstallations, logoutGithub, pollGithubDeviceFlow, startGithubDeviceFlow,
  getA2aStatus, generateA2aToken, revokeA2aToken,
  type A2aStatus, type GithubAuthStatus, type GithubDeviceStart, type GithubInstallation, type StorageInfo,
} from '../api';
import { usePreferences } from '../app-state/preferences-provider';
import { useAppToast } from '../app-state/toast';
import { useEscape } from '../hooks/use-escape';
import {
  IconCheck, IconChevronRight, IconFolder, IconGear, IconGlobe, IconServer, IconSliders, IconUser,
} from './icons';
import { Dropdown } from './Dropdown';
import { useConfirm } from './ui';
import { getLocale, setLocale, t, tp, type Locale } from '../i18n';
import { ACCENTS, type Accent, type ThemeMode } from '../lib/appearance';
import { ACCENT_SWATCH } from '../design/accents';

type SettingsPane = 'general' | 'github' | 'repositories' | 'application' | 'advanced';

export default function SettingsModal({ onClose, activeRepo }: { onClose: () => void; activeRepo?: string | null }) {
  const { pat, setPat, hasServerPat, setServerPat, clearServerPat, theme, accent, setTheme, setAccent } = usePreferences();
  const toast = useAppToast();
  const [value, setValue] = useState(pat);
  const [serverPatValue, setServerPatValue] = useState('');
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [github, setGithub] = useState<GithubAuthStatus | null>(null);
  const [device, setDevice] = useState<GithubDeviceStart | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [installations, setInstallations] = useState<GithubInstallation[]>([]);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [a2a, setA2a] = useState<A2aStatus | null>(null);
  const [a2aToken, setA2aToken] = useState('');
  const [a2aBusy, setA2aBusy] = useState(false);
  const [pane, setPane] = useState<SettingsPane>('general');
  const modalRef = useRef<HTMLFormElement>(null);
  useEscape(onClose);

  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pane === 'repositories' && !activeRepo) setPane('general');
    if (pane === 'advanced' && !isAdmin) setPane('general');
  }, [activeRepo, isAdmin, pane]);

  // Relocated tool entries dispatch the same lightweight events the command
  // palette and other surfaces use; Toolbar owns the listeners and opens the
  // matching dialog, so the settings form hands off and closes itself.
  const openTool = (event: string) => {
    window.dispatchEvent(new CustomEvent(event));
    onClose();
  };

  // The key itself is never returned, so the field starts empty and a blank
  // value means "keep the stored key".
  useEffect(() => {
    getMe()
      .then((me) => {
        const admin = me.role === 'admin';
        setIsAdmin(admin);
        if (!admin) return;
        getAiConfig()
          .then((cfg) => {
            setBaseUrl(cfg.baseUrl);
            setModel(cfg.model);
            setHasKey(cfg.hasKey);
            setConfigured(cfg.configured);
          })
          .catch(() => { /* settings are optional */ });
        getStorage().then(setStorage).catch(() => { /* maintenance is optional */ });
        getGithubAuthStatus()
          .then((status) => {
            setGithub(status);
            if (status.connected) {
              getGithubInstallations()
                .then((payload) => {
                  setInstallations(payload.installations);
                  setInstallUrl(payload.installUrl);
                })
                .catch(() => { /* installations need App access; identity still works */ });
            }
          })
          .catch(() => { /* GitHub connection is optional */ });
        getA2aStatus().then(setA2a).catch(() => { /* A2A is optional */ });
      })
      .catch(() => { /* keep the conservative member view */ });
  }, []);

  // Device Flow polling: one poll per interval, stopping on any terminal state
  // or when the modal unmounts. slow_down increases the interval by 5s.
  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    let timer: number | undefined;
    let interval = Math.max(5, device.interval || 5);
    const poll = async () => {
      try {
        const result = await pollGithubDeviceFlow(device.flowId);
        if (cancelled) return;
        if (result.state === 'connected') {
          setDevice(null);
          setDeviceError('');
          toast(`GitHub connected${result.login ? ` as @${result.login}` : ''}`, 'success');
          const status = await getGithubAuthStatus();
          setGithub(status);
          getGithubInstallations()
            .then((payload) => {
              setInstallations(payload.installations);
              setInstallUrl(payload.installUrl);
            })
            .catch(() => { /* installations are optional */ });
          return;
        }
        if (result.state === 'denied' || result.state === 'expired' || result.state === 'error') {
          setDevice(null);
          setDeviceError(result.message || t('GitHub authorization did not complete. Try again.'));
          return;
        }
        if (result.state === 'slow_down') interval += 5;
        timer = window.setTimeout(poll, interval * 1000);
      } catch (err) {
        if (cancelled) return;
        setDevice(null);
        setDeviceError(errorMessage(err));
      }
    };
    timer = window.setTimeout(poll, interval * 1000);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [device]);

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(message, 'success');
    } catch {
      toast(t('Copy failed'), 'error');
    }
  }

  async function connectGithub() {
    setDeviceBusy(true);
    setDeviceError('');
    try {
      setDevice(await startGithubDeviceFlow());
    } catch (err) {
      setDeviceError(errorMessage(err));
    } finally {
      setDeviceBusy(false);
    }
  }

  async function disconnectGithub() {
    try {
      await logoutGithub();
      setGithub(await getGithubAuthStatus());
      setInstallations([]);
      setInstallUrl(null);
      toast(t('GitHub account disconnected'), 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function generateA2a() {
    setA2aBusy(true);
    try {
      const generated = await generateA2aToken();
      setA2aToken(generated.token);
      setA2a(await getA2aStatus());
      toast(t('A2A token generated'), 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setA2aBusy(false);
    }
  }

  async function revokeA2a() {
    setA2aBusy(true);
    try {
      await revokeA2aToken();
      setA2aToken('');
      setA2a(await getA2aStatus());
      toast(t('A2A token revoked'), 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setA2aBusy(false);
    }
  }

  async function saveAi(event: React.MouseEvent) {
    event.preventDefault();
    setSavingAi(true);
    try {
      const cfg = await saveAiConfig({
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setHasKey(cfg.hasKey);
      setConfigured(cfg.configured);
      setApiKey('');
      toast(cfg.configured ? 'AI settings saved' : 'AI settings saved (incomplete)', 'success');
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setSavingAi(false);
    }
  }

  async function clearKey() {
    setSavingAi(true);
    try {
      const cfg = await saveAiConfig({ clearKey: true });
      setHasKey(cfg.hasKey);
      setConfigured(cfg.configured);
      toast(t("API key removed"), 'info');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSavingAi(false);
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const res = await testAi();
      toast(`AI responded: ${res.reply.slice(0, 60)}`, 'success');
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setTesting(false);
    }
  }

  const confirm = useConfirm();

  async function compactAudit() {
    const ok = await confirm({
      title: t('Compact audit log?'),
      detail: t('Keeps only the newest ~1 MB / 10,000 entries. Older audit records are dropped and this cannot be undone.'),
      confirmLabel: t('Compact'),
      danger: true,
    });
    if (!ok) return;
    try {
      await rotateAudit();
      toast(t('Audit log compacted'), 'success');
      setStorage(await getStorage());
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function pruneStaleRepos() {
    const ok = await confirm({
      title: t('Prune stale repositories?'),
      detail: t('Removes registry entries whose paths no longer exist or are no longer Git worktrees. No files are deleted.'),
      confirmLabel: t('Prune'),
      danger: false,
    });
    if (!ok) return;
    try {
      const result = await pruneRepos();
      toast(tp('Removed {n} stale entries', { n: result.removed }), 'success');
      setStorage(await getStorage());
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    setPat(value.trim());
    onClose();
  }

  return (
    <div
      className="modal-backdrop settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <form
        ref={modalRef}
        tabIndex={-1}
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
      >
        <header className="settings-header">
          <div className="settings-header-title">
            <span className="settings-header-icon" aria-hidden="true"><IconGear /></span>
            <h2 id="settings-title">{t("Settings")}</h2>
          </div>
          <div className="settings-header-actions">
            <button type="button" className="settings-text-btn" onClick={onClose}>{t("Cancel")}</button>
            <button type="submit" className="btn btn-primary settings-save-btn">{t("Save")}</button>
          </div>
        </header>

        <div className="settings-body">
          <nav className="settings-sidebar" aria-label={t('Settings categories')}>
            <div className="settings-nav-group">
              <button
                type="button"
                className={`settings-nav-item settings-nav-general${pane === 'general' ? ' active' : ''}`}
                aria-current={pane === 'general' ? 'page' : undefined}
                onClick={() => setPane('general')}
              >
                <span className="settings-nav-icon" aria-hidden="true"><IconSliders /></span>
                <span className="settings-nav-label">{t("General")}</span>
              </button>
              <button
                type="button"
                className={`settings-nav-item settings-nav-github${pane === 'github' ? ' active' : ''}`}
                aria-current={pane === 'github' ? 'page' : undefined}
                onClick={() => setPane('github')}
              >
                <span className="settings-nav-icon" aria-hidden="true"><IconGlobe /></span>
                <span className="settings-nav-label">{t("GitHub")}</span>
              </button>
              {activeRepo && (
                <button
                  type="button"
                  className={`settings-nav-item settings-nav-repos${pane === 'repositories' ? ' active' : ''}`}
                  aria-current={pane === 'repositories' ? 'page' : undefined}
                  onClick={() => setPane('repositories')}
                >
                  <span className="settings-nav-icon" aria-hidden="true"><IconFolder /></span>
                  <span className="settings-nav-label">{t("Repository tools")}</span>
                </button>
              )}
              <button
                type="button"
                className={`settings-nav-item settings-nav-app${pane === 'application' ? ' active' : ''}`}
                aria-current={pane === 'application' ? 'page' : undefined}
                onClick={() => setPane('application')}
              >
                <span className="settings-nav-icon" aria-hidden="true"><IconUser /></span>
                <span className="settings-nav-label">{t("Application")}</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className={`settings-nav-item settings-nav-advanced${pane === 'advanced' ? ' active' : ''}`}
                  aria-current={pane === 'advanced' ? 'page' : undefined}
                  onClick={() => setPane('advanced')}
                >
                  <span className="settings-nav-icon" aria-hidden="true"><IconServer /></span>
                  <span className="settings-nav-label">{t("Advanced")}</span>
                </button>
              )}
            </div>
          </nav>

          <main className="settings-content">
            <section
              className="settings-pane"
              hidden={pane !== 'general'}
              aria-labelledby="settings-general-title"
            >
              <h3 id="settings-general-title" className="settings-section settings-pane-title">{t("General")}</h3>
              <p className="settings-pane-description">{t('Language and appearance.')}</p>

              <h3 className="settings-section">{t("Language")}</h3>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <span className="settings-row-label">Language / 语言</span>
                    <span className="settings-row-detail">{t('Choose the interface language.')}</span>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      className="settings-dropdown"
                      id="ui-locale"
                      value={getLocale()}
                      onChange={(v) => {
                        setLocale(v as Locale);
                        toast(v === 'zh' ? '界面已切换为中文' : 'Interface set to English', 'info');
                      }}
                      options={[
                        { value: 'en', label: 'English' },
                        { value: 'zh', label: '中文' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <h3 className="settings-section">{t("Appearance")}</h3>
              <div className="settings-card">
                <div className="settings-row stacked">
                  <div className="settings-row-copy">
                    <span className="settings-row-label">{t("Theme mode")}</span>
                  </div>
                  <div className="settings-theme-options" role="group" aria-label={t("Theme mode")}>
                    {([
                      ['dark', t('Dark')],
                      ['light', t('Light')],
                      ['auto', t('Follow system')],
                    ] as [ThemeMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`settings-theme-card${theme === mode ? ' selected' : ''}`}
                        aria-pressed={theme === mode}
                        onClick={() => setTheme(mode)}
                      >
                        <span className={`settings-theme-thumb ${mode}`} aria-hidden="true">
                          <span className="settings-theme-thumb-sidebar" />
                          <span className="settings-theme-thumb-content"><i /><i /><i /></span>
                        </span>
                        <span className="settings-theme-name">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row stacked">
                  <div className="settings-row-copy">
                    <span className="settings-row-label">{t("Accent")}</span>
                    <span className="settings-row-detail">{t('Accent color for controls, selections and links.')}</span>
                  </div>
                  <div className="settings-accent-grid" role="group" aria-label={t("Accent")}>
                    {ACCENTS.map((name) => {
                      const label = t(name[0].toUpperCase() + name.slice(1));
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`settings-accent${accent === name ? ' selected' : ''}`}
                          aria-pressed={accent === name}
                          aria-label={label}
                          title={label}
                          onClick={() => setAccent(name as Accent)}
                        >
                          <span
                            className="settings-accent-dot"
                            style={{
                              background: theme === 'light' ? ACCENT_SWATCH[name].light : ACCENT_SWATCH[name].dark,
                              color: name === 'amber' ? '#1a1c2c' : '#ffffff',
                            }}
                          >
                            {accent === name && <IconCheck width={12} height={12} />}
                          </span>
                          <span className="settings-accent-name">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section
              className="settings-pane"
              hidden={pane !== 'github'}
              aria-labelledby="settings-github-title"
            >
              <h3 id="settings-github-title" className="settings-section settings-pane-title">{t("GitHub")}</h3>
              <p className="settings-pane-description">{t('Accounts, tokens, and GitHub App access.')}</p>

              <h3 className="settings-section">{t("Personal access token")}</h3>
              <div className="settings-card">
                <div className="settings-row stacked">
                  <label className="sr-only" htmlFor="settings-pat">{t("Personal access token")}</label>
                  <input
                    id="settings-pat"
                    className="settings-input"
                    type="password"
                    placeholder="github_pat_…"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  <div className="settings-hint">
                    {t("Stored in this browser's localStorage and proxied via the loopback server; it is not written into the server data directory. Create one at")}{' '}
                    <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
                      github.com/settings/tokens
                    </a>
                    .
                  </div>
                </div>
              </div>

              {!isAdmin && (
                <p className="settings-owner-note">
                  {t('Server-side PAT and AI settings are managed by the owner. Your browser PAT above still works for GitHub calls.')}
                </p>
              )}

              {isAdmin && (
                <>
                  <h3 className="settings-section">{t("GitHub account")}</h3>
                  <div className="settings-card">
                    {!github ? (
                      <div className="settings-row">
                        <span className="settings-row-detail">{t('Loading…')}</span>
                      </div>
                    ) : device ? (
                      <div className="settings-row stacked">
                        <div className="settings-row-copy">
                          <span className="settings-row-label">{t('Open the verification page and enter this code:')}</span>
                        </div>
                        <div className="settings-device-code-row">
                          <code className="settings-device-code">{device.userCode}</code>
                          <button
                            type="button"
                            className="btn settings-secondary"
                            onClick={() => copyText(device.userCode, t('Device code copied'))}
                          >
                            {t('Copy code')}
                          </button>
                          <a className="btn settings-secondary" href={device.verificationUri} target="_blank" rel="noreferrer">
                            {t('Open GitHub')}
                          </a>
                          <button type="button" className="btn settings-secondary" onClick={() => setDevice(null)}>
                            {t('Cancel')}
                          </button>
                        </div>
                        <div className="settings-hint">{t('Waiting for authorization…')}</div>
                      </div>
                    ) : github.connected ? (
                      <>
                        <div className="settings-row">
                          <div className="settings-account">
                            {github.avatarUrl && (
                              <img src={github.avatarUrl} alt="" width={32} height={32} className="settings-avatar" />
                            )}
                            <div className="settings-row-copy">
                              <span className="settings-row-label">@{github.login}</span>
                              {github.expiresAt && !github.expired && (
                                <span className="settings-row-detail">
                                  {t('Access expires')}: {new Date(github.expiresAt).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <button type="button" className="btn settings-secondary" onClick={disconnectGithub}>
                            {t('Disconnect')}
                          </button>
                        </div>
                        {github.expired && (
                          <div className="settings-row">
                            <span className="settings-row-detail settings-danger-text">
                              {t('GitHub authorization expired — reconnect to refresh access.')}
                            </span>
                            <button type="button" className="btn settings-secondary" onClick={connectGithub}>
                              {t('Reconnect')}
                            </button>
                          </div>
                        )}
                        <div className="settings-row stacked">
                          <span className="settings-row-label">{t('GitHub App installations')}</span>
                          {installations.length ? (
                            <div className="settings-installations">
                              {installations.map((item) => (
                                <div key={item.id} className="settings-installation">
                                  <span>{item.account || `#${item.id}`}</span>
                                  <span className="settings-row-detail">
                                    {item.repositorySelection || t('selected repositories')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="settings-row-detail">
                              {t('No App installation found. Install the App to grant repository access.')}
                            </span>
                          )}
                          {installUrl && (
                            <a className="settings-link" href={installUrl} target="_blank" rel="noreferrer">
                              {t('Install the GitHub App')}
                            </a>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <span className="settings-row-label">{t('GitHub App')}</span>
                          <span className="settings-row-detail">
                            {t('Optional GitHub App Device Flow connection. It proves your GitHub identity and lists App installations; GitHub writes still use the PAT and automation credentials.')}
                          </span>
                          {!github.configured && (
                            <span className="settings-row-detail">
                              {t('Set GITHUB_APP_CLIENT_ID in ~/.pr-helper-git/credentials.env, then restart the server.')}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn settings-secondary"
                          disabled={!github.configured || deviceBusy}
                          onClick={connectGithub}
                        >
                          {deviceBusy ? t('Starting…') : t('Connect GitHub')}
                        </button>
                      </div>
                    )}
                  </div>
                  {deviceError && <p className="settings-error">{deviceError}</p>}

                  <h3 className="settings-section">{t("Server-side PAT")}</h3>
                  <div className="settings-card">
                    <div className="settings-row stacked">
                      <div className="settings-hint">
                        {t("Alternative to the browser storage above: the token is kept in ~/.pr-helper-git/config.json (0700 dir / 0600 files), never returned to this page, and injected into GitHub calls server-side when the browser sends none. Preferred when this machine is shared.")}
                      </div>
                      <div className="settings-inline">
                        <input
                          className="settings-input"
                          type="password"
                          aria-label={t('Server-side PAT')}
                          placeholder={hasServerPat ? t('A server-side PAT is stored') : 'github_pat_…'}
                          value={serverPatValue}
                          onChange={(e) => setServerPatValue(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn settings-secondary"
                          disabled={!serverPatValue.trim()}
                          onClick={async () => {
                            try {
                              await setServerPat(serverPatValue.trim());
                              setServerPatValue('');
                              toast(t('PAT stored server-side'), 'success');
                            } catch (err) {
                              toast(errorMessage(err) || 'store failed', 'error');
                            }
                          }}
                        >
                          {t('Store on server')}
                        </button>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span className="settings-row-detail">
                        {hasServerPat ? t('Status: stored') : t('Status: not stored')}
                      </span>
                      <button
                        type="button"
                        className="btn settings-secondary settings-danger-text"
                        disabled={!hasServerPat}
                        onClick={async () => {
                          if (!(await confirm(t('Remove the server-side PAT? Clients will need a browser PAT or a new server-side entry.')))) return;
                          try {
                            await clearServerPat();
                            toast(t('Server-side PAT removed'), 'success');
                          } catch (err) {
                            toast(errorMessage(err) || 'remove failed', 'error');
                          }
                        }}
                      >
                        {t('Remove')}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>

            {activeRepo && (
              <section
                className="settings-pane"
                hidden={pane !== 'repositories'}
                aria-labelledby="settings-repositories-title"
              >
                <h3 id="settings-repositories-title" className="settings-section settings-pane-title">
                  {t("Repository tools")}
                </h3>
                <p className="settings-pane-description">{t('Repository utilities for the active repository.')}</p>
                <div className="settings-card">
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:remotes')}>
                    <span>{t('Manage remotes')}</span><IconChevronRight />
                  </button>
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:config')}>
                    <span>{t('Repository settings (git config)')}</span><IconChevronRight />
                  </button>
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:reflog')}>
                    <span>{t('View reference log (reflog)')}</span><IconChevronRight />
                  </button>
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:audit')}>
                    <span>{t('View audit log')}</span><IconChevronRight />
                  </button>
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:compare')}>
                    <span>{t('Compare two references')}</span><IconChevronRight />
                  </button>
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:grep')}>
                    <span>{t('Search repository contents (git grep)')}</span><IconChevronRight />
                  </button>
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:search-commits')}>
                    <span>{t('Search commits in all branches')}</span><IconChevronRight />
                  </button>
                  <button type="button" className="settings-link-row" onClick={() => openTool('git2:global-grep')}>
                    <span>{t('Search across all repositories')}</span><IconChevronRight />
                  </button>
                </div>
              </section>
            )}

            <section
              className="settings-pane"
              hidden={pane !== 'application'}
              aria-labelledby="settings-application-title"
            >
              <h3 id="settings-application-title" className="settings-section settings-pane-title">{t("Application")}</h3>
              <p className="settings-pane-description">{t('Application behavior and help.')}</p>
              <div className="settings-card">
                <button type="button" className="settings-link-row" onClick={() => openTool('git2:team')}>
                  <span>{t('Team members and configuration')}</span><IconChevronRight />
                </button>
                <button type="button" className="settings-link-row" onClick={() => openTool('git2:shortcuts')}>
                  <span>{t('Keyboard shortcuts (press ?)')}</span><IconChevronRight />
                </button>
              </div>
            </section>

            {isAdmin && (
              <section
                className="settings-pane"
                hidden={pane !== 'advanced'}
                aria-labelledby="settings-advanced-title"
              >
                <h3 id="settings-advanced-title" className="settings-section settings-pane-title">{t("Advanced")}</h3>
                <p className="settings-pane-description">{t('Server, AI, and automation settings.')}</p>

                <h3 className="settings-section">{t("Server data")}</h3>
                <div className="settings-card">
                  <div className="settings-row stacked">
                    {storage ? (
                      <>
                        <span className="settings-row-label">{t('Data directory')}</span>
                        <div className="settings-path">{storage.dataDir}</div>
                        <div className="settings-file-list">
                          {storage.files.map((file) => (
                            <span key={file.name} className="settings-file-item">
                              {file.name} · {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <span className="settings-row-detail">{t('Loading data directory…')}</span>
                    )}
                  </div>
                  <div className="settings-action-row">
                    <button type="button" className="btn settings-secondary" onClick={compactAudit}>
                      {t('Compact audit log')}
                    </button>
                    <button type="button" className="btn settings-secondary" onClick={pruneStaleRepos}>
                      {t('Prune stale repositories')}
                    </button>
                  </div>
                </div>

                <h3 className="settings-section">{t("AI generation")}</h3>
                <p className="settings-hint">
                  {t("Any OpenAI-compatible endpoint. The key is stored server-side in ~/.pr-helper-git/config.json (never returned to this page) and is used to draft commit messages and pull-request descriptions.")}
                </p>
                <div className="settings-card">
                  <div className="settings-row stacked">
                    <label className="settings-row-label" htmlFor="ai-base">{t("Base URL")}</label>
                    <input
                      id="ai-base"
                      className="settings-input"
                      placeholder="https://api.openai.com/v1"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </div>
                  <div className="settings-row stacked">
                    <label className="settings-row-label" htmlFor="ai-model">{t("Model")}</label>
                    <input
                      id="ai-model"
                      className="settings-input"
                      placeholder="gpt-4o-mini"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  </div>
                  <div className="settings-row stacked">
                    <label className="settings-row-label" htmlFor="ai-key">{t("API key")}</label>
                    <input
                      id="ai-key"
                      className="settings-input"
                      type="password"
                      placeholder={hasKey ? t('•••••• stored (leave blank to keep)') : 'sk-…'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>
                  <div className="settings-action-row">
                    <button type="button" className="btn btn-primary" disabled={savingAi} onClick={saveAi}>
                      {savingAi ? t('Saving…') : t('Save AI settings')}
                    </button>
                    <button type="button" className="btn settings-secondary" disabled={!configured || testing} onClick={runTest}>
                      {testing ? t('Testing…') : t('Test')}
                    </button>
                    {hasKey && (
                      <button type="button" className="btn settings-secondary" disabled={savingAi} onClick={clearKey}>
                        {t("Remove key")}
                      </button>
                    )}
                    <span className="settings-status-text">
                      {configured ? t('Configured') : t('Not configured yet')}
                    </span>
                  </div>
                </div>

                <h3 className="settings-section">{t("A2A / Agent Card")}</h3>
                <p className="settings-hint">
                  {a2a?.configured
                    ? t('A2A is enabled for bearer-token clients. Plan mode is the default; execute mode enqueues real automation actions.')
                    : t('A2A is disabled until you generate a token or set PR_HELPER_GIT_A2A_TOKEN in ~/.pr-helper-git/credentials.env.')}
                </p>
                {a2a && (
                  <div className="settings-card">
                    <div className="settings-row">
                      <span className="settings-row-label">{t('Agent card')}</span>
                      <div className="settings-row-control settings-agent-card-control">
                        <input className="settings-input" readOnly value={a2a.cardUrl} aria-label={t('Agent card')} />
                        <button type="button" className="btn settings-secondary" onClick={() => copyText(a2a.cardUrl, t('Agent card URL copied'))}>
                          {t('Copy')}
                        </button>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span className="settings-row-detail">{t('Skills')}: {a2a.skills.join(', ')}</span>
                    </div>
                    <div className="settings-row">
                      <span className="settings-row-detail">
                        {a2a.configured
                          ? (a2a.source === 'env' ? t('Configured via credentials.env') : t('Configured in config.json'))
                          : t('No A2A token configured yet.')}
                        {a2a.hint ? ` · ${t('Token hint')}: …${a2a.hint}` : ''}
                      </span>
                      <div className="settings-row-control">
                        <button type="button" className="btn settings-secondary" disabled={a2aBusy} onClick={generateA2a}>
                          {a2a.configured ? t('Regenerate token') : t('Generate token')}
                        </button>
                        {a2a.configured && a2a.source === 'config' && (
                          <button type="button" className="btn settings-secondary" disabled={a2aBusy} onClick={revokeA2a}>
                            {t('Revoke token')}
                          </button>
                        )}
                      </div>
                    </div>
                    {a2aToken && (
                      <div className="settings-row stacked">
                        <span className="settings-row-label">{t('Copy it now — the token is not shown again.')}</span>
                        <div className="settings-inline">
                          <input className="settings-input" readOnly value={a2aToken} aria-label={t('A2A token')} />
                          <button type="button" className="btn settings-secondary" onClick={() => copyText(a2aToken, t('A2A token copied'))}>
                            {t('Copy')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </main>
        </div>
      </form>
    </div>
  );
}
