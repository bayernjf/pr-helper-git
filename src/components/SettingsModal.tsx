import { useEffect, useState } from 'react';
import {
  getAiConfig, saveAiConfig, testAi, getStorage, rotateAudit, pruneRepos, type StorageInfo,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconX } from './icons';
import { Dropdown } from './Dropdown';
import { useConfirm } from './ui';
import { getLocale, setLocale, t, tp, type Locale } from '../i18n';
import { ACCENTS, type Accent, type ThemeMode } from '../lib/appearance';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { pat, setPat, toast, theme, accent, setTheme, setAccent } = useApp();
  const [value, setValue] = useState(pat);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [testing, setTesting] = useState(false);
  useEscape(onClose);

  // The key itself is never returned, so the field starts empty and a blank
  // value means "keep the stored key".
  useEffect(() => {
    getAiConfig()
      .then((cfg) => {
        setBaseUrl(cfg.baseUrl);
        setModel(cfg.model);
        setHasKey(cfg.hasKey);
        setConfigured(cfg.configured);
      })
      .catch(() => { /* settings are optional */ });
    getStorage().then(setStorage).catch(() => { /* maintenance is optional */ });
  }, []);

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
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
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
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSavingAi(false);
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const res = await testAi();
      toast(`AI responded: ${res.reply.slice(0, 60)}`, 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
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
    } catch (err: any) {
      toast(err.message, 'error');
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
    } catch (err: any) {
      toast(err.message, 'error');
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
              {t("Stored in this browser only and proxied via the loopback server; never written to disk. Create one at")}{' '}
              <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
                github.com/settings/tokens
              </a>
              .
            </div>
          </div>

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
            {t("Any OpenAI-compatible endpoint. The key is stored server-side in ~/.pr-helper-git2/config.json (never returned to this page) and is used to draft commit messages and pull-request descriptions.")}
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
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary">{t("Save")}</button>
        </div>
      </form>
    </div>
  );
}
