import { useEffect, useState } from 'react';
import { getAiConfig, saveAiConfig, testAi } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconX } from './icons';
import { getLocale, setLocale, t, type Locale } from '../i18n';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { pat, setPat, toast } = useApp();
  const [value, setValue] = useState(pat);
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
            <select
              id="ui-locale"
              value={getLocale()}
              onChange={(e) => {
                setLocale(e.target.value as Locale);
                toast(e.target.value === 'zh' ? '界面已切换为中文' : 'Interface set to English', 'info');
              }}
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
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
