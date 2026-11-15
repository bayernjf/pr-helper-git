import { errorMessage, errorDetail } from '../lib/errors';
import { useEffect, useState } from 'react';
import {
  getAiConfig, getMe, saveAiConfig, testAi, getStorage, rotateAudit, pruneRepos,
  getGithubAuthStatus, getGithubInstallations, logoutGithub, pollGithubDeviceFlow, startGithubDeviceFlow,
  getA2aStatus, generateA2aToken, revokeA2aToken,
  type A2aStatus, type GithubAuthStatus, type GithubDeviceStart, type GithubInstallation, type StorageInfo,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconX } from './icons';
import { Dropdown } from './Dropdown';
import { useConfirm } from './ui';
import { getLocale, setLocale, t, tp, type Locale } from '../i18n';
import { ACCENTS, type Accent, type ThemeMode } from '../lib/appearance';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { pat, setPat, hasServerPat, setServerPat, clearServerPat, toast, theme, accent, setTheme, setAccent } = useApp();
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
  useEscape(onClose);

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
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-header">
          <h2>{t("Settings")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="ui-locale">Language / 语言</label>
            <Dropdown
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

          <div className="form-group">
            <label>{t("Personal access token")}</label>
            <input
              autoFocus
              type="password"
              placeholder="github_pat_…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="hint">
              {t("Stored in this browser's localStorage and proxied via the loopback server; it is not written into the server data directory. Create one at")}{' '}
              <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
                github.com/settings/tokens
              </a>
              .
            </div>
          </div>

          {!isAdmin && (
            <div className="hint" style={{ marginTop: 12 }}>
              {t('Server-side PAT and AI settings are managed by the owner. Your browser PAT above still works for GitHub calls.')}
            </div>
          )}

          {isAdmin && (
            <>
          <h3 className="settings-section">{t("GitHub account")}</h3>
          <div className="hint" style={{ marginBottom: 10 }}>
            {t('Optional GitHub App Device Flow connection. It proves your GitHub identity and lists App installations; GitHub writes still use the PAT and automation credentials.')}
          </div>
          {!github ? (
            <div className="hint">{t('Loading…')}</div>
          ) : device ? (
            <div className="form-group">
              <div className="hint">{t('Open the verification page and enter this code:')}</div>
              <div className="settings-row" style={{ alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 18, letterSpacing: 2 }}>{device.userCode}</code>
                <button type="button" className="btn" onClick={() => copyText(device.userCode, t('Device code copied'))}>
                  {t('Copy code')}
                </button>
                <a className="btn" href={device.verificationUri} target="_blank" rel="noreferrer">{t('Open GitHub')}</a>
                <button type="button" className="btn" onClick={() => setDevice(null)}>{t('Cancel')}</button>
              </div>
              <div className="hint">{t('Waiting for authorization…')}</div>
            </div>
          ) : github.connected ? (
            <>
              <div className="settings-row" style={{ alignItems: 'center', gap: 10 }}>
                {github.avatarUrl && (
                  <img src={github.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                )}
                <span>@{github.login}</span>
                <button type="button" className="btn" onClick={disconnectGithub}>{t('Disconnect')}</button>
              </div>
              {github.expired ? (
                <div className="hint" style={{ color: 'var(--danger, #d05c5c)' }}>
                  {t('GitHub authorization expired — reconnect to refresh access.')}{' '}
                  <button type="button" className="btn" onClick={connectGithub}>{t('Reconnect')}</button>
                </div>
              ) : github.expiresAt ? (
                <div className="hint">{t('Access expires')}: {new Date(github.expiresAt).toLocaleString()}</div>
              ) : null}
              <div className="form-group" style={{ marginTop: 10 }}>
                <label>{t('GitHub App installations')}</label>
                {installations.length ? (
                  <div className="hint">
                    {installations.map((item) => (
                      <div key={item.id}>
                        {item.account || `#${item.id}`} · {item.repositorySelection || t('selected repositories')}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="hint">{t('No App installation found. Install the App to grant repository access.')}</div>
                )}
                {installUrl && (
                  <a href={installUrl} target="_blank" rel="noreferrer">{t('Install the GitHub App')}</a>
                )}
              </div>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={!github.configured || deviceBusy} onClick={connectGithub}>
                {deviceBusy ? t('Starting…') : t('Connect GitHub')}
              </button>
              {!github.configured && (
                <div className="hint">
                  {t('Set GITHUB_APP_CLIENT_ID in ~/.pr-helper-git/credentials.env, then restart the server.')}
                </div>
              )}
            </>
          )}
          {deviceError && <div className="hint" style={{ color: 'var(--danger, #d05c5c)' }}>{deviceError}</div>}

          <h3 className="settings-section">{t("Server-side PAT")}</h3>
          <div className="form-group">
            <div className="hint">
              {t("Alternative to the browser storage above: the token is kept in ~/.pr-helper-git/config.json (0700 dir / 0600 files), never returned to this page, and injected into GitHub calls server-side when the browser sends none. Preferred when this machine is shared.")}
            </div>
            <div className="settings-row">
              <input
                type="password"
                placeholder={hasServerPat ? t('A server-side PAT is stored') : 'github_pat_…'}
                value={serverPatValue}
                onChange={(e) => setServerPatValue(e.target.value)}
              />
              <button
                type="button"
                className="btn"
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
              <button
                type="button"
                className="btn"
                disabled={!hasServerPat}
                onClick={async () => {
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
            <div className="hint">{hasServerPat ? t('Status: stored') : t('Status: not stored')}</div>
          </div>
            </>
          )}

          <h3 className="settings-section">{t("Appearance")}</h3>
          <div className="form-group">
            <label>{t("Theme mode")}</label>
            <div className="segmented">
              {([
                ['dark', t('Dark')],
                ['light', t('Light')],
                ['auto', t('Follow system')],
              ] as [ThemeMode, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={theme === mode ? 'active' : ''}
                  onClick={() => setTheme(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>{t("Accent")}</label>
            <div className="segmented">
              {ACCENTS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={accent === name ? 'active' : ''}
                  onClick={() => setAccent(name as Accent)}
                >
                  <span
                    className="accent-dot"
                    style={{
                      background: {
                        violet: '#8b6cef', ocean: '#4f8ff7', forest: '#45a06b', amber: '#d79a3c',
                      }[name],
                    }}
                  />
                  {t(name[0].toUpperCase() + name.slice(1))}
                </button>
              ))}
            </div>
          </div>

          {isAdmin && (
            <>
          <h3 className="settings-section">{t("Server data")}</h3>
          <div className="hint" style={{ marginBottom: 10 }}>
            {storage ? (
              <>
                <div style={{ wordBreak: 'break-all' }}>{storage.dataDir}</div>
                {storage.files.map((file) => (
                  <span key={file.name} style={{ marginRight: 12 }}>
                    {file.name} · {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                  </span>
                ))}
              </>
            ) : t('Loading data directory…')}
          </div>
          <div className="form-row" style={{ alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn" onClick={compactAudit}>
              {t('Compact audit log')}
            </button>
            <button type="button" className="btn" onClick={pruneStaleRepos}>
              {t('Prune stale repositories')}
            </button>
          </div>

          <h3 className="settings-section">{t("AI generation")}</h3>
          <div className="hint" style={{ marginBottom: 10 }}>
            {t("Any OpenAI-compatible endpoint. The key is stored server-side in ~/.pr-helper-git/config.json (never returned to this page) and is used to draft commit messages and pull-request descriptions.")}
          </div>
          <div className="form-group">
            <label htmlFor="ai-base">{t("Base URL")}</label>
            <input
              id="ai-base"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="ai-model">{t("Model")}</label>
              <input
                id="ai-model"
                placeholder="gpt-4o-mini"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="ai-key">{t("API key")}</label>
              <input
                id="ai-key"
                type="password"
                placeholder={hasKey ? t('•••••• stored (leave blank to keep)') : 'sk-…'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          </div>
          <div className="form-row" style={{ alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn" disabled={savingAi} onClick={saveAi}>
              {savingAi ? t('Saving…') : t('Save AI settings')}
            </button>
            <button type="button" className="btn" disabled={!configured || testing} onClick={runTest}>
              {testing ? t('Testing…') : t('Test')}
            </button>
            {hasKey && (
              <button type="button" className="btn" disabled={savingAi} onClick={clearKey}>
                {t("Remove key")}
              </button>
            )}
            <span className="field-note">
              {configured ? t('Configured') : t('Not configured yet')}
            </span>
          </div>

          <h3 className="settings-section">{t("A2A / Agent Card")}</h3>
          <div className="hint" style={{ marginBottom: 10 }}>
            {a2a?.configured
              ? t('A2A is enabled for bearer-token clients. Plan mode is the default; execute mode enqueues real automation actions.')
              : t('A2A is disabled until you generate a token or set PR_HELPER_GIT_A2A_TOKEN in ~/.pr-helper-git/credentials.env.')}
          </div>
          {a2a && (
            <div className="form-group">
              <label>{t('Agent card')}</label>
              <div className="settings-row">
                <input readOnly value={a2a.cardUrl} />
                <button type="button" className="btn" onClick={() => copyText(a2a.cardUrl, t('Agent card URL copied'))}>
                  {t('Copy')}
                </button>
              </div>
              <div className="hint">{t('Skills')}: {a2a.skills.join(', ')}</div>
              <div className="hint" style={{ marginTop: 8 }}>
                {a2a.configured
                  ? (a2a.source === 'env' ? t('Configured via credentials.env') : t('Configured in config.json'))
                  : t('No A2A token configured yet.')}
                {a2a.hint ? ` · ${t('Token hint')}: …${a2a.hint}` : ''}
              </div>
              <div className="settings-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn" disabled={a2aBusy} onClick={generateA2a}>
                  {a2a.configured ? t('Regenerate token') : t('Generate token')}
                </button>
                {a2a.configured && a2a.source === 'config' && (
                  <button type="button" className="btn" disabled={a2aBusy} onClick={revokeA2a}>
                    {t('Revoke token')}
                  </button>
                )}
              </div>
              {a2aToken && (
                <div className="hint" style={{ marginTop: 8 }}>
                  <div>{t('Copy it now — the token is not shown again.')}</div>
                  <div className="settings-row">
                    <input readOnly value={a2aToken} />
                    <button type="button" className="btn" onClick={() => copyText(a2aToken, t('A2A token copied'))}>
                      {t('Copy')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary">{t("Save")}</button>
        </div>
      </form>
    </div>
  );
}