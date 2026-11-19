# app-state 上下文拆分方案

状态：✅ 已完成（2026-11-19）；S1a/S1b/S1c + Phase 2/3/4 全部落地，PR #40
已合并。剩余可选后续见 §7。
日期：2026-11-19
范围：`src/app-state.tsx`（411 行、`AppData` 37 个字段、43 个生产
`useApp()` 调用点；`rg 'useApp\('` 共 44 个匹配，含 `app-state.tsx` 里
`export function useApp():` 这 1 个声明）。

## 1. 为什么要拆

当前只有一个 `AppDataProvider`。它把仓库数据、日志窗口、主题、PAT、
视图、写操作状态和 toast 全部放进一个 `useMemo`，任何字段变化都会生成
新的 context value，所有 `useApp()` 消费者一起重渲染。

高频触发点很具体：

- `runAction` 每次写操作都会翻转 `busy`，Toolbar 之外的大量组件也跟着重渲染；
- 切换主题/强调色、修改 PAT、切换 `view` 会触发 Git 数据消费者重渲染；
- SSE 自动刷新、加载更多、日志过滤会触发只依赖 PAT 的 CI Health / Flows
  页面重渲染；
- 选择 commit 会触发 RefSidebar、Toolbar 等不依赖 `selectedHash` 的组件重渲染。

这不是“React 慢”，而是依赖边界没有画开。目标不是引入状态库，而是把
**变化频率和消费范围不同的状态**分开。

## 2. 目标与非目标

目标：

1. 领域隔离：仓库数据、偏好、写操作、busy、toast 各自成为独立上下文。
2. 行为不变：刷新代际、SSE、初始仓库恢复、PAT、主题、日志过滤语义不改。
3. 可渐进：先抽 provider 并保留 `useApp()` 兼容层，再逐个迁移消费者。
4. 可回滚：每个阶段独立提交，不涉及 API、数据库或持久化格式。
5. 可验证：用渲染计数测试证明“切主题不触发仓库消费者”“busy 翻转不触发
   `runAction` 消费者”。

非目标：

- 不引入 Redux / Zustand / `use-context-selector` / MobX；
- 不重写 UI，不改组件视觉与交互；
- 不改 server API、SSE 协议、localStorage key；
- 不顺手拆 `App.tsx` 的页面路由或 Toolbar 的子组件；
- 不把 `selectedHash` 在 v1 里强行拆出去（见 §7 的可选后续）。

## 3. 目标结构

### 3.1 四个领域上下文

| Context | 字段 | 主要消费者 | 变化时机 |
|---|---|---|---|
| `RepoDataContext` | `repos`、`activeRepo`、`currentRepo`、`activeBrief`、`status`、`commits`、`refs`、`remote`、`selectedHash`、`repoLoading`、`logLimit`、`logScope`、`logPath`、`logFilters`、`setLogScope`、`setLogPath`、`setLogFilters`、`selectRepo`、`selectCommit`、`refreshRepos`、`refresh`、`loadMore` | App、Toolbar、RefSidebar、CommitGraph、CommitDetail、WorkPanel、PrBoard、DashboardPage、RepositoriesModal、CommandPalette、use-shortcuts | 切仓、SSE、加载更多、日志过滤、选择 commit |
| `PreferencesContext` | `view`、`theme`、`accent`、`pat`、`hasServerPat`、`setView`、`setTheme`、`setAccent`、`toggleTheme`、`setPat`、`setServerPat`、`clearServerPat` | App、Toolbar、SettingsModal、CiHealthPage、FlowEditor、StepDrawer、PrBoard、PrFileReview、CreatePrModal、use-shortcuts | 切视图、主题、PAT |
| `ActionsContext` | `runAction` | Toolbar、RefSidebar、CommitGraph、WorkPanel、各写操作弹窗 | 仅在 `refresh` 变化时；目标为稳定引用 |
| `BusyContext` | `busy` | 仅 Toolbar | 写操作开始/结束 |

Toast 不再放进 app-state。现有 `ToastProvider` / `useToast()` 已经是独立
上下文，新增一个兼容 hook：

```ts
// src/app-state/toast.ts
export function useAppToast() {
  const api = useToast();
  return useCallback(
    (message: string, kind: ToastKind = 'info') => api.notify(message, kind),
    [api],
  );
}
```

这样现有 `toast('...', 'error')` 调用形式可以原样保留，但消费者只订阅
ToastContext，不再订阅整个 AppData。

### 3.2 Provider 组合

```tsx
<PreferencesProvider>
  <RepoDataProvider>
    <ActionsProvider>
      {children}
    </ActionsProvider>
  </RepoDataProvider>
</PreferencesProvider>
```

- `PreferencesProvider` 独立，负责主题、视图、PAT 和 appearance effect；
- `RepoDataProvider` 负责仓库列表、当前仓库数据、SSE、刷新代际和日志窗口；
- `ActionsProvider` 读取 `useRepoData().refresh`，提供 `runAction` 和 `busy`；
- `ActionsProvider` 同时提供 `ActionsContext` 与 `BusyContext`，让只调用
  `runAction` 的组件不因 `busy` 翻转而重渲染。

### 3.3 兼容层

第一阶段保留：

```ts
export const AppContext = createContext<AppData | null>(null);
export function useApp(): AppData { ... }
```

`AppDataProvider` 在四个领域 provider 内再挂一个 `LegacyAppBridge`，把四个
context 组装成原 `AppData`，继续提供 `AppContext`。这样 43 个消费者和 5 个
测试文件在第一阶段完全不动，先证明“搬家不改变行为”。

## 4. 文件布局

```text
src/app-state.tsx                 # 兼容 barrel + 最终 AppDataProvider
src/app-state/
  types.ts                        # View / Theme / 领域类型
  preferences-provider.tsx        # view/theme/accent/PAT
  repo-provider.tsx               # repos/status/commits/refs/remote/log/SSE
  actions-provider.tsx            # runAction + busy
  toast.ts                        # useAppToast
  hooks.ts                        # useRepoData/usePreferences/useRunAction/useBusy
  context-isolation.test.tsx      # 渲染隔离证明
```

`src/app-state.tsx` 继续导出 `AppDataProvider` 和 hooks，现有 import 路径
不变。实施中未引入 `test-helpers.tsx`：改为直接导出各领域 Context（与旧
`AppContext` 同款），测试文件直接注入对应 Context，改动更小。

## 5. 实施阶段

### Phase 0：建立基线（0.25 天）

- 记录当前 `npm test`、`npm run build`、`npm run e2e` 结果；
- 用 `React.Profiler` 或临时 render counter 记录三个场景的当前渲染次数：
  切主题、`busy` 翻转、SSE 刷新；
- 不提交临时探针，基线数字写进实施记录。

### Phase 1：抽 provider，保留兼容层（0.75 天，拆 3 个可停止 checkpoint）

一次性搬 `Preferences`、`RepoData`、`Actions/Busy` 四个 provider 的 diff 和
回归面都太大，拆成三步。每步独立提交、独立验收、可独立回滚；任何一步之后
都能停在“已拆分但未迁移消费者”的安全状态。

#### 不可改变语义（全 Phase 1 通用，每步验收都要覆盖）

- `loadSeqRef` / `activeRepoRef` 的代际丢弃逻辑原样保留；
- **`loadSeqRef.current + 1` 的 `+ 1` 必须保留**：`loadRepoData` 开头用
  `++loadSeqRef.current` 递增代际，触发加载的调用方（`selectRepo` /
  `loadMore` / `setLogScope` / `setLogPath` / `setLogFilters`）必须先
  `const seq = loadSeqRef.current + 1` 再调用 `loadRepoData`，最后在
  `.finally` 里 `if (seq === loadSeqRef.current) setRepoLoading(false)`。
  若漏掉 `+ 1`，最新一次加载的 `finally` 永远判不等，`setRepoLoading(false)`
  不会执行，顶部加载条会卡住；
- SSE 只建立一次，参数走 ref，不因日志参数变化重连；
- 初始加载：`refreshRepos()` → 读取 remembered repo → `selectRepo()`；
- `refresh()` 在仓库被移除时清空 status/commits/refs/remote/selectedHash；
- `runAction` 失败后仍先 `refresh()` 再报错；
- 主题 effect、PAT 本地/服务端行为原样保留。

#### S1a：抽 `PreferencesProvider` + `useAppToast`（保留 `AppContext`）

范围：

- 新建 `src/app-state/{types,preferences-provider,toast}.tsx`；
- 把 `view/theme/accent/pat/hasServerPat` 及其 setter（`setView/setTheme/
  setAccent/toggleTheme/setPat/setServerPat/clearServerPat`）、appearance
  effect 原样搬进 `PreferencesProvider`；
- 把 `toast`（`toastApi.notify` 的包装）抽成 `useAppToast()`；
- `AppDataProvider` 仍直接持有 repo / actions 相关 state，`useApp()` /
  `AppContext` 完全不变；此步不引入 `LegacyAppBridge`。

验收：

- 1169 tests / 68 files、E2E 162/162、build 全绿；
- 手工：切主题（dark/light/auto）、改 accent、浏览器 PAT / 服务端 PAT
  互斥切换、view 切换后刷新仍恢复。

提交边界：

```text
refactor(app-state): extract preferences provider and useAppToast
```

回滚：`git revert` 该提交即回到原单 provider 状态。

#### S1b：抽 `RepoDataProvider`

范围：

- 新建 `src/app-state/repo-provider.tsx`；
- 把 `repos/activeRepo/status/commits/refs/remote/selectedHash/repoLoading/
  logLimit/logScope/logPath/logFilters` 及其 setter、`selectRepo`、
  `selectCommit`、`refreshRepos`、`refresh`、`loadMore`、`loadRepoData`、
  `activeRepoRef`、`loadSeqRef`、SSE effect、初始仓库恢复 effect 原样搬进
  `RepoDataProvider`；
- 重点核对 `loadSeqRef.current + 1` 与“SSE 只建立一次”两条语义。

验收：

- 1169 tests / 68 files、E2E 162/162、build 全绿；
- 手工：切仓、加载更多、三种日志过滤、SSE 自动刷新、初始 remembered
  repo 恢复、顶部加载条正常收尾（不卡住）。

提交边界：

```text
refactor(app-state): extract repo data provider
```

回滚：`git revert` 该提交。

#### S1c：抽 `Actions/Busy`，加 `LegacyAppBridge`

范围：

- 新建 `src/app-state/{actions-provider,hooks}.tsx`；
- 把 `busy`、`runAction` 搬进 `ActionsProvider`（同时提供 `ActionsContext`
  与 `BusyContext`）；
- `AppDataProvider` 组合 Preferences → RepoData → Actions，并在内部挂
  `LegacyAppBridge` 把四个 context 组装成原 `AppData`，`useApp()` /
  `AppContext` 继续可用，43 个消费者零改动；
- `src/app-state.tsx` 收敛为 barrel + `AppDataProvider` + 兼容 bridge。

验收：

- 1169 tests / 68 files、E2E 162/162、build 全绿；
- 手工：merge/revert/cherry-pick、冲突解决等写操作，成功与失败路径的
  refresh / busy / toast 行为不变。

提交边界：

```text
refactor(app-state): extract actions/busy providers behind compatibility facade
```

回滚：`git revert` 该提交；S1c 之后任何时点都可停在“已拆分未迁移”状态。

### Phase 2：迁移低风险消费者（0.5 天）

先迁出只依赖 toast 或只依赖偏好的组件，收益直接且回归面小：

| 文件 | 现在依赖 | 迁移后 |
|---|---|---|
| `AuditModal.tsx` | toast | `useAppToast()` |
| `GlobalGrepModal.tsx` | toast | `useAppToast()` |
| `FileViewer.tsx` | toast | `useAppToast()` |
| `FlowEditor.tsx` | pat | `usePreferences()` |
| `StepDrawer.tsx` | pat | `usePreferences()` |
| `CiHealthPage.tsx` | pat、hasServerPat、toast | `usePreferences()` + `useAppToast()` |
| `PrFileReview.tsx` | pat、toast | `usePreferences()` + `useAppToast()` |
| `SettingsModal.tsx` | preferences + toast | `usePreferences()` + `useAppToast()` |

`AppData` 暂时保留 `toast` 字段给未迁移组件；新代码不再使用它。

验收：

- 上述 8 个组件的现有测试全绿；
- 手工验证 Settings 主题/PAT、CI Health、FlowEditor、StepDrawer、PR 评论；
- 全量 gate。

提交边界：

```text
refactor(ui): consume toast and preferences directly
```

### Phase 3：迁移核心 Git 与 PR 消费者（1 天）

按“一个组件只订阅自己需要的域”迁移，不追求一次性全改：

| 组件 | 迁移后 hooks |
|---|---|
| `App.tsx` | `useRepoData` + `usePreferences` |
| `Toolbar.tsx` | `useRepoData` + `usePreferences` + `useBusy` + `useRunAction` |
| `RefSidebar.tsx` | `useRepoData` + `useRunAction` + `useAppToast` |
| `CommitGraph.tsx` | `useRepoData` + `usePreferences` + `useRunAction` + `useAppToast` |
| `CommitDetail.tsx` | `useRepoData` + `useAppToast` |
| `WorkPanel.tsx` | `useRepoData` + `useRunAction` + `useAppToast` |
| `PrBoard.tsx` | `useRepoData` + `usePreferences` |
| `DashboardPage.tsx` | `useRepoData` + `usePreferences` + `useAppToast` |
| `RepositoriesModal.tsx` | `useRepoData` + `useAppToast` |
| `CommandPalette.tsx` | `useRepoData` + `usePreferences` + `useRunAction` + `useAppToast` |
| `use-shortcuts.ts` | `useRepoData` + `usePreferences` |

其余弹窗按同样规则逐个迁移：只读仓库的用 `useRepoData`，只写操作的用
`useRunAction`，只提示的用 `useAppToast`，只读 PAT/主题的用
`usePreferences`。

为让 `ActionsContext` 稳定：

```ts
const refreshRef = useRef(refresh);
refreshRef.current = refresh;

const runAction = useCallback(async (action, successMessage) => {
  setBusy(true);
  try {
    const result = await action;
    await refreshRef.current();
    ...
  } finally {
    setBusy(false);
  }
}, []);
```

`runAction` 不再因 `activeRepo` / 日志参数变化而换引用；`busy` 通过独立
`BusyContext` 暴露，只有 Toolbar 订阅。

验收：

- 核心 Git 视图手工走查：切仓、选择 commit、加载更多、范围/路径/过滤、
  SSE 自动刷新、merge/revert/cherry-pick、冲突面板；
- PR 视图：打开 PR 列表、详情、评论、merge；
- Dashboard：仓库列表、批量 fetch、移除仓库；
- 全量 gate。

提交边界：

```text
refactor(ui): split core git view consumers
refactor(ui): split pr and dashboard consumers
```

### Phase 4：移除兼容层并加隔离测试（0.5 天）

- 删除 `AppContext`、`useApp()`、`AppData` 聚合类型；
- `src/app-state.tsx` 只导出 `AppDataProvider` 和领域 hooks；
- 更新 5 个测试文件的注入方式：
  `components.test.tsx`、`CommitGraph.keyboard.test.tsx`、
  `SettingsModal.test.tsx`、`StepDrawer.test.tsx`、`CompareModal.test.tsx`；
- 新增 `src/app-state/context-isolation.test.tsx`；
- 更新 `AGENTS.md` 的验证基线与 `docs/README.md` 的文档索引。

隔离测试至少覆盖：

1. 切换主题 → 仓库数据探针渲染次数不变；
2. 修改日志过滤 → 偏好探针渲染次数不变；
3. `busy` 翻转 → 只调用 `runAction` 的探针渲染次数不变，`useBusy` 探针 +1；
4. 修改 PAT → 仓库数据探针渲染次数不变。

提交边界：

```text
refactor(app-state): remove the aggregate useApp facade
test(app-state): prove context isolation boundaries
```

## 6. 验收标准

功能等价：

- 切仓后旧请求不会覆盖新仓库数据；
- 初始 remembered repo 仍能恢复；
- SSE `repo-changed` 仍只刷新当前仓库；
- `loadMore` 仍受 `LOG_MAX` 限制；
- `setLogScope` / `setLogPath` / `setLogFilters` 仍保留其他过滤条件；
- `runAction` 成功/失败后的 refresh、busy、toast 行为不变；
- 主题 `dark/light/auto`、accent、view 持久化不变；
- 浏览器 PAT 与服务端 PAT 的互斥/切换不变。

质量门禁：

```bash
npm run lint
npm run typecheck:server
npm test
npm run build
npm run e2e
```

基线为 1169 tests / 68 files、E2E 162/162；新增隔离测试后同步更新
`AGENTS.md`。桌面壳不改，不需要 `desktop:native-test`；如果实施中碰到
`desktop/` 则按 AGENTS 的 desktop gate 补跑。

手工走查清单：

- Git：切仓、提交选择、加载更多、三种日志过滤、SSE 刷新；
- 写操作：merge、revert、cherry-pick、冲突解决；
- PR：列表、详情、评论、merge；
- Dashboard：批量 fetch、移除仓库；
- Flows / CI Health：只切主题、改 PAT，确认不触发 Git 数据请求；
- Settings：主题、accent、浏览器/服务端 PAT。

## 7. 风险与回滚

| 风险 | 处理 |
|---|---|
| `runAction` 闭包读到旧 `refresh` | `refreshRef` + 写操作刷新测试 |
| provider 顺序错导致 hook 为空 | 组合固定为 Preferences → RepoData → Actions；运行时错误立即暴露 |
| SSE 被重复建立 | 只允许 `RepoDataProvider` 创建 EventSource；grep 校验 |
| context value 仍频繁重建 | 每个 provider 单独 `useMemo`；回调 `useCallback`；隔离测试 |
| 测试注入不完整 | `test-helpers.tsx` 提供完整默认值，类型强制所有域字段 |
| 过度拆分 | v1 固定 4 个上下文；`selectedHash` 暂留 RepoData，见下 |

回滚：

- 每个 Phase 独立提交，出问题直接 revert 对应提交；
- 无 API/数据库/存储格式变化，回滚不需要迁移；
- Phase 1 保留兼容层，Phase 1 之后任何时点都可以停在“已拆分但未迁移消费者”的安全状态。

### 可选后续（不在本次范围）

`selectedHash` / `selectCommit` 是第二热点：选择 commit 会触发所有
RepoData 消费者。若 Phase 3 后性能仍不达标，再评估独立
`SelectionContext`。它需要处理“切仓时清空选择”的跨 provider 协调，
不建议和本次拆分一起做。

## 8. 工作量与执行建议

| 阶段 | 估时 | 可独立验收 |
|---|---|---|
| Phase 0 基线 | 0.25 天 | 是 |
| Phase 1 抽 provider | 0.75 天 | 是（S1a/S1b/S1c 各一步） |
| Phase 2 低风险消费者 | 0.5 天 | 是 |
| Phase 3 核心消费者 | 1 天 | 是 |
| Phase 4 移除兼容层 + 测试 | 0.5 天 | 是 |
| 合计 | 约 2.75–3.25 天 | 6–7 个提交 |

Phase 1 执行节奏：**S1a → 全 gate → 确认 → S1b → 全 gate → 确认 →
S1c → 全 gate**，每一步停下都能独立回滚，不会留下半迁移状态。

建议 Phase 1 完成后先做 Phase 2，拿一次真实渲染计数对比；确认收益后再做
Phase 3。这样即使中途暂停，也不会留下半迁移的核心视图。

## 9. 已确认与剩余约束

已确认（2026-11-19）：

1. “4 个领域 context + 保留 ToastProvider”的目标结构；
2. 分阶段迁移、Phase 1 保留 `useApp()` 兼容层；
3. `selectedHash` 留到后续，不纳入本次；
4. Phase 1 拆为 S1a/S1b/S1c，按“S1a → gate → 确认 → S1b”节奏推进。

剩余约束：

- 只在 `dev` 本地提交，推送/发版另等明确指令；
- 每步 gate 全绿并停下确认后，才进入下一步。
