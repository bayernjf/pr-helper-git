import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  fetchRepo,
  pullRepo,
  pushRepo,
} from '../api';
import { useApp } from '../app-state';
import { matchesCommand } from '../lib/fuzzy';
import {
  IconBranch,
  IconClock,
  IconCommand,
  IconDownload,
  IconFolder,
  IconGear,
  IconPullRequest,
  IconRefresh,
  IconStash,
  IconUpload,
} from './icons';

interface Command {
  id: string;
  label: string;
  hint?: string;
  search: string;
  icon?: React.ReactNode;
  run: () => unknown | Promise<unknown>;
}

export default function CommandPalette() {
  const {
    repos,
    activeRepo,
    setView,
    selectRepo,
    setLogScope,
    refresh,
    runAction,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global toggle: Cmd/Ctrl+K opens or closes the palette, regardless of focus.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'view-git',
        label: 'Switch to Git view',
        search: 'git view commits graph branches',
        icon: <IconBranch width={15} height={15} />,
        run: () => setView('git'),
      },
      {
        id: 'view-pr',
        label: 'Switch to Pull Requests',
        search: 'pull requests pr board github',
        icon: <IconPullRequest width={15} height={15} />,
        run: () => setView('pr'),
      },
    ];

    repos.forEach((r) => {
      list.push({
        id: `repo-${r.path}`,
        label: `Open repository: ${r.name}`,
        hint: r.path,
        search: `open repository switch ${r.name} ${r.path}`,
        icon: <IconFolder width={15} height={15} />,
        run: () => selectRepo(r.path),
      });
    });

    if (activeRepo) {
      list.push(
        {
          id: 'refresh',
          label: 'Refresh repository',
          search: 'refresh reload status',
          icon: <IconRefresh width={15} height={15} />,
          run: () => refresh(),
        },
        {
          id: 'fetch',
          label: 'Fetch all remotes',
          search: 'fetch remote update',
          icon: <IconDownload width={15} height={15} />,
          run: () => runAction(fetchRepo(activeRepo, false), 'Fetched'),
        },
        {
          id: 'fetch-prune',
          label: 'Fetch and prune',
          search: 'fetch prune remove deleted remote refs',
          icon: <IconRefresh width={15} height={15} />,
          run: () => runAction(fetchRepo(activeRepo, true), 'Fetched and pruned'),
        },
        {
          id: 'pull',
          label: 'Pull',
          search: 'pull download upstream',
          icon: <IconDownload width={15} height={15} />,
          run: () => runAction(pullRepo(activeRepo), 'Pulled'),
        },
        {
          id: 'push',
          label: 'Push',
          search: 'push upload origin',
          icon: <IconUpload width={15} height={15} />,
          run: () => runAction(pushRepo(activeRepo), 'Pushed'),
        },
        {
          id: 'stash',
          label: 'Stash changes (with options)',
          search: 'stash save working changes',
          icon: <IconStash width={15} height={15} />,
          run: () => window.dispatchEvent(new CustomEvent('git2:stash')),
        },
        {
          id: 'reflog',
          label: 'View reference log',
          search: 'reflog head history undo',
          icon: <IconClock width={15} height={15} />,
          run: () => window.dispatchEvent(new CustomEvent('git2:reflog')),
        },
        {
          id: 'scope-all',
          label: 'History: all branches',
          search: 'history scope all branches graph',
          icon: <IconBranch width={15} height={15} />,
          run: () => setLogScope('all'),
        },
        {
          id: 'scope-current',
          label: 'History: current branch',
          search: 'history scope current branch graph',
          icon: <IconBranch width={15} height={15} />,
          run: () => setLogScope('current'),
        },
      );
    }

    list.push(
      {
        id: 'add-repo',
        label: 'Add, clone or initialise a repository',
        search: 'add clone init new repository register',
        icon: <IconFolder width={15} height={15} />,
        run: () => window.dispatchEvent(new CustomEvent('git2:add-repo')),
      },
      {
        id: 'settings',
        label: 'Open GitHub settings',
        search: 'settings github token preferences gear',
        icon: <IconGear width={15} height={15} />,
        run: () => window.dispatchEvent(new CustomEvent('git2:settings')),
      },
    );
    return list;
  }, [repos, activeRepo, setView, selectRepo, refresh, runAction, setLogScope]);

  const filtered = useMemo(
    () => commands.filter((c) => matchesCommand(`${c.label} ${c.search}`, query)),
    [commands, query],
  );

  // Reset selection and focus the field whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  // Keep the highlighted row in view while navigating with the keyboard.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const close = useCallback(() => setOpen(false), []);

  function execute(command: Command) {
    setOpen(false);
    void command.run();
  }

  function onListKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) execute(command);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="cmdk-backdrop" onClick={close}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input-wrap">
          <IconCommand width={16} height={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Type a command or search a repository…"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onListKeyDown}
          />
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmdk-empty">No commands match “{query}”.</div>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                data-index={index}
                className={`cmdk-item${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => execute(command)}
              >
                <span className="cmdk-icon">{command.icon}</span>
                <span className="cmdk-label">{command.label}</span>
                {command.hint && <span className="cmdk-hint">{command.hint}</span>}
              </button>
            ))
          )}
        </div>
        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
