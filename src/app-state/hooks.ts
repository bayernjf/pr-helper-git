// Domain hook barrel: one import point for the split app-state contexts.
export { usePreferences } from './preferences-provider';
export {
  useActiveBrief,
  useActiveRepo,
  useRepoHistory,
  useRepoRefs,
  useRepoRegistry,
  useRepoStatus,
  useRepoData,
} from './repo-provider';
export { useRunAction, useBusy } from './actions-provider';
