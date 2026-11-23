import { useEffect } from 'react';
import { useActiveRepo, useRepoRegistry } from '../app-state/hooks';
import { syncChromeRects } from '../lib/desktop-bridge';
import { Dropdown } from './Dropdown';
import { IconList } from './icons';
import { t } from '../i18n';

export default function Titlebar() {
  const { repos } = useRepoRegistry();
  const { activeRepo, selectRepo } = useActiveRepo();

  // The desktop shell drags the window from the titlebar strip and reports
  // double-click zooms there. The dropdown trigger is the strip's only
  // interactive control, so its frame goes to the shell's mouse monitor to
  // keep clicks on it interactive. Plain browsers have no bridge and skip
  // the whole reporting loop.
  useEffect(() => {
    // Both interactive controls in the strip (repositories button + repo
    // dropdown) report their frames so the shell keeps their clicks
    // interactive while the rest of the strip drags/zooms.
    const report = () => {
      const els = [
        document.querySelector<HTMLElement>('.titlebar .titlebar-btn'),
        document.querySelector<HTMLElement>('.titlebar .dropdown-trigger'),
      ].filter((el): el is HTMLElement => !!el);
      const rects = els.map((el) => {
        const r = el.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height];
      });
      syncChromeRects(rects);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(document.querySelector<HTMLElement>('.titlebar')!);
    // The dropdown's width follows the repo name (fit-content) - observe the
    // control itself so the shell's interactive rect stays fresh on switch.
    const controls = [
      document.querySelector<HTMLElement>('.titlebar .titlebar-btn'),
      document.querySelector<HTMLElement>('.titlebar .dropdown-trigger'),
    ].filter((el): el is HTMLElement => !!el);
    controls.forEach((el) => observer.observe(el));
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      syncChromeRects([]);
    };
  }, []);

  return (
    <div className="titlebar">
      <button
        type="button"
        className="icon-btn titlebar-btn"
        aria-label={t('Open repositories panel')}
        title={t('Open repositories panel')}
        onClick={() => window.dispatchEvent(new CustomEvent('git2:repositories'))}
      >
        <IconList width={14} height={14} />
      </button>
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
