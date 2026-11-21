import { useEffect } from 'react';
import { useRepoData } from '../app-state/hooks';
import { syncChromeRects } from '../lib/desktop-bridge';
import { Dropdown } from './Dropdown';
import { t } from '../i18n';

export default function Titlebar() {
  const { repos, activeRepo, selectRepo } = useRepoData();

  // The desktop shell drags the window from the titlebar strip and reports
  // double-click zooms there. The dropdown trigger is the strip's only
  // interactive control, so its frame goes to the shell's mouse monitor to
  // keep clicks on it interactive. Plain browsers have no bridge and skip
  // the whole reporting loop.
  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>('.titlebar .dropdown-trigger');
    if (!trigger) return;
    const report = () => {
      const rect = trigger.getBoundingClientRect();
      syncChromeRects([[rect.left, rect.top, rect.width, rect.height]]);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(trigger);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      syncChromeRects([]);
    };
  }, []);

  return (
    <div className="titlebar">
      <span className="titlebar-title">PR Helper Git</span>
      <Dropdown
        className="repo-select"
        value={activeRepo || ''}
        onChange={(v) => {
          if (v === '__add__') {
            window.dispatchEvent(new CustomEvent('git2:add-repo'));
          } else {
            selectRepo(v);
          }
        }}
        options={[
          ...(repos.length === 0 ? [{ value: '', label: t('No repository') }] : []),
          ...repos.map((r) => ({ value: r.path, label: r.name })),
          { value: '__add__', label: t('+ Add repository…') },
        ]}
      />
    </div>
  );
}
