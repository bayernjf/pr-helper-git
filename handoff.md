# Handoff — pr-helper-git

A local Git GUI (GitKraken-like core) plus a lightweight GitHub PR control
tower (pr-helper-like core). The app itself runs entirely on loopback and
pushes nothing. This repository, however, **is** on GitHub as the public
`bayernjf/pr-helper-git` (renamed from `pr-helper-git2` on 2026-11-11); treat
every committed file as world-readable.


## pr-helper 迁移进度（实时段，随会话更新）

> 迁移方案、能力追踪矩阵（122 行）、决策记录 D-001…D-021 与验收标准在
> [`docs/pr-helper-migration.md`](docs/pr-helper-migration.md) — 本段只记**实时进度**。
> 每个迁移会话收尾必须更新本段（这是会话协议的一部分，见该文档 §0 规则 5-6）。

**当前阶段：Phase 0 ✅ → Phase 1 ✅（数据层）→ Phase 2 ✅（P2-1…P2-10 全部收口；P2-3/P2-6 真实外部副作用已验证）→ Phase 3 ✅（P3-1…P3-16 全部收口，含 P3-15 团队 UI；验收 ✅33/🔶0/🔀1）→ Phase 3.5 ✅（P3-10 ✅）→ Phase 4 ✅ → Phase 5 执行态（P5-2 动作 1 已于 2026-11-22 01:33 CST 实际发生，但无事前审批；owner 2026-11-23 选择承认现状并继续；动作 2–3 未批准；动作 4 已完成单 stage 与双 stage 本地实跑：PR #20、PR #23/#24、stage-advanced action `4754`；P5-1 判定证据仍未补齐）**

### 2026-11-25 Flows 首载空态

- **Flows 首载**：`FlowBoard` 在首屏投影读取完成前不再渲染 `.board-empty`；此前会同时出现 `Refreshing…` 与 `No flows yet — create one from a repository`，看起来像整个看板没有流程。新增 `src/components/FlowBoard.test.tsx`，用 pending fetch 锁定“加载中无空态、完成后才显示空态”。
- **验证**：`npm run lint`、`npm run typecheck:server`、`npm test`（1243 tests / 73 files）、`npm run build`、`npm run e2e`（162/162）、`npm run desktop`、`desktop:smoke` 通过；`build/PR Helper Git.app` 已重建为 0.3.20，`/Applications/PR Helper Git.app` 本次未替换。

### 2026-11-23 Dashboard 首屏、无 upstream 与 unstable 重试

- **Dashboard 首屏**：`lastFetchAll` 初值改为 `0`，注册表就绪后新增一次性静默 `fetchAll({silent:true})`，不再等 10 分钟后台轮询；手动 Fetch all 保留 toast，后台轮询继续只刷新缓存。此前首屏显示 `↑41` / `23 dirty`，真实为 72 个未推送提交 / 5 个脏文件；本次产品 UI 实测首屏立即进入 `Fetching…`，完成后汇总与 18 个仓库真实 `git status --porcelain` / `git rev-list --count @{u}..HEAD` 一致。
- **无 upstream**：新增 `hasUpstream()` / `repoIsClean()`，`clean` 必须有 upstream 且 WIP/ahead/behind/冲突为零。Dashboard 卡片与列表新增 `no upstream` 徽标，标题汇总新增 `N no upstream`；`observability/dev` 在实测中正确显示 `no upstream`，不再误报 clean。
- **unstable 自动合并**：`automationMergeOutcome` 把 `unstable` 视为可重试门禁；`automationGateWaitDelayMs` 对 `unstable` 走 30 秒快速复查，不再套用 5/10/20 分钟 approval 退避。重排不按尝试次数硬停，由 12 小时 stale 窗口兜底；实测 `loom` PR #225 因重复 CI 连续 `unstable` 时，早期 3 次上限曾误暂停动作，已移除。步骤抽屉新增 `failureReason` 与 `N attempts` 展示，样式用黄色原因行。
- **Flows 同路由去重**：`failureSections` 按 `workflowId:stageIndex:source` 合并同 stage 的 CI/部署失败与 blocked merge action，`atlas` 的同一路由不再在 NEEDS ATTENTION 里计两次；paused create-pr 因带 takeover 入口而保留。
- **无 upstream 一键推送**：工具栏 Push 在 `activeBrief.upstream === null` 时直接调用 `pushRepo(repo, true)`，服务端走 `git push -u origin <branch>`；Push 下拉菜单同时提供「Push and set upstream」。此前 `observability/dev` 只能在 Git 侧栏右键 `Push to origin`。
- **Git 工具栏按模块收口**：`Fetch / Pull / Push / Stash` 只在 Git 页渲染，Dashboard、Pull Requests、CI Health、Flows 的工具栏只保留居中的五页导航和右侧 More / Settings / Theme。Dashboard 卡片与列表行新增 Push 图标、右键 `Push <branch>` 菜单，无 upstream 时仍走 `push -u`；避免了仓库操作组在所有页面与导航 tabs 同排造成的整组视觉右偏。
- **Flows 原因回退**：`failureSections` 的 automation 条目按 `message → failureReason → automation reason unknown` 回退；`atlas` 的 `门禁尚未全绿（当前 failure）` 不再显示为原因未知。
- **验证**：`npm run lint`、`npm run typecheck:server`、`npm test`（1242 tests / 72 files）、`npm run build`、`npm run e2e`（162/162）通过；定向新增 repo-sort 2 例、Dashboard 首屏 2 例、unstable 行为/源码 3 例、StepDrawer 诊断 1 例、Flows 原因回退/同路由去重 2 例、Push 菜单 upstream 条件 1 例、设置弹层 portal 1 例、工具栏模块收口 1 例、Dashboard 推送快捷入口 1 例。浏览器实测 Flows/Dashboard 的 `.toolbar-actions` 为 0，Git 页为 1；Dashboard `atlas` 列表行与右键菜单均出现 `Push dev`。
- **桌面**：`npm run build`、`npm run desktop`、`desktop:smoke` 通过；`/Applications/PR Helper Git.app` 已替换为当前 Web 产物（仍为 0.3.20），旧包备份为 `PR Helper Git 0.3.20-local-pre-toolbar-scope.app` / `PR Helper Git 0.3.20-local-pre-row-push.app`。桌面窗口实测 Dashboard 工具栏只剩 More/Settings/Theme，Git 页仍显示 Fetch/Pull/Push/Stash；Dashboard 列表 `atlas` 行显示 `Push dev`，右键菜单同样提供 `Push dev`。

### 2026-11-23 P1 收口与 app-state 切片

- **危险操作影响范围/恢复路径**（`9b96f02`）：统一确认弹窗接受 `impact` / `recovery`，覆盖强制推送、清理未跟踪文件、硬重置、删除流程；明确远端 ref、未跟踪文件和工作区改动的恢复边界，不提供假装可 undo 的按钮。
- **Linked worktree 写操作**（`879df8d`）：新增 `routes-git-worktrees.mjs` 与 `WorktreeModal`；支持创建（新分支/已有分支、绝对路径且在所有已登记工作树之外）、移除（保护主/当前/锁定条目，脏树需二次确认）、锁定/解锁、prune 失效元数据。侧栏 Worktrees 分组常显管理入口。
- **app-state 仓库切片**（`181dafd`）：仓库数据拆为 registry / active repo / active brief / status / refs / history 六个 context，38 个生产消费者迁到精确 hooks；`selectedHash`、日志过滤和加载更多归入 history。切片 hook 不再订阅聚合 context，聚合 `useRepoData` 仅作测试注入与兼容回退。隔离测试扩到 6 例，验证 `selectCommit` / `setLogFilters` 只触发 history 探针。
- **Phase 5 状态收口**（`f255d35`）：如实记录 P5-2 动作 1 已在无事前审批下发生于 2026-11-22 01:33 CST；owner 2026-11-23 选择承认现状并继续，但明确动作 2–4 仍需逐项批准。P5-1 判定证据仍未补齐，不把事后确认写成事前审批。
- **动作 4 本地实跑**（`c454be5`）：单 stage PR #20 自动创建/合并，merge `3ed0c50`；双 stage PR #23/#24 自动创建/合并，`stage-advanced` action `4754` 成功，merge `bb59b9b` / `ac2ac7e`。双 stage 首轮暴露“自动合并后 advance 不调度”，修复为 merge action 直接入队 advance，并加回归测试。
- **桌面**：`npm run desktop`、`desktop:smoke`、`desktop:native-test` 通过；`/Applications/PR Helper Git.app` 更新为 0.3.20 / `714120c`，旧包 `f255d35` 备份为 `PR Helper Git 0.3.20-local-f255d35.app`。
- **验证**：`npm run lint`、`npm run typecheck:server`、`npm test`（1229 tests / 72 files）、`npm run build`、`npm run e2e`（162/162）通过；无头 Chrome 复核 Git 列表、提交选择和 worktree 管理模态。
- **产品 UI Push 复验**：测试仓提交 `db20323`；在产品 Git 页点击 Push 后远端 `dev` 更新，PR #25 自动创建并自动合并（merge `20bd916`）；5 分钟后 cron reconcile 自动接续 stage 1，PR #26 自动创建并合并（merge `eae1c5f`）。最终 `origin/main=20bd916`、`origin/release=eae1c5f`，每个 stage 仅 1 个 create-pr、1 个 merge-pr。
- **桌面**：`npm run desktop`、`desktop:smoke` 通过；`/Applications/PR Helper Git.app` 更新为 0.3.20 / `f255d35`，旧包备份为 `PR Helper Git 0.3.20-local-2569c12.app`。

### 2026-11-22 五模块 Apple 风格视觉体系（未发布）

- **范围**：Dashboard、Git、Pull Requests、CI Health、Flows 五个 Web 模块。Swift 薄壳未重写 UI，只同步窗口底色；业务逻辑、路由、测试基线不变。
- **设计层**：`design/tokens.json` 切换为 Apple 系统灰阶/系统色、SF Pro/SF Mono 字体栈、11/13/15/17/24 字号层级、5/7/12/16 圆角、30/26 控件高度；默认强调色改为系统蓝 `#0A84FF`（浅色 `#007AFF`），色板为 blue/rose/forest/amber/teal/crimson/indigo。`sync-tokens.mjs` 按 `$default-accent` 跳过默认选择器。
- **共享界面**：工具栏改为左侧分支/仓库、中部五页 segmented 导航、右侧 Fetch/Pull/Push/Stash 与 More/Settings/Theme；窄窗口同步动作降为 icon-only。按钮、输入框、下拉、菜单、弹窗统一 hairline + 系统材料。未选中提交时 `CommitDetail` 不再常驻空栏；PR 顶部改用独立 `.pr-toolbar`。
- **模块细节**：Dashboard 卡片去掉左侧 activity 色条、改为 14px 圆角白/深灰卡；Git 侧栏分组标题恢复完整显示、分支排序改为 hover 动作，提交行 36px；PR 三列改 14px 圆角列 + 10px 圆角卡，骨架加标题/元信息占位；CI 指标卡去掉左侧色条、改为状态圆点，表格头/行使用 hairline；Flows lane/step 改 14/10px 圆角、状态编号 colored badge，header 主操作改实心蓝。
- **桌面**：`desktop/main.swift` 深/浅窗口背景改为 `#121214` / `#f2f2f7`，与 `bg0` 对齐；无功能改动。
- **验证**：`npm run lint`、`npm run typecheck:server`、`npm test`（1223 tests / 72 files）、`npm run build`、`npm run e2e`（162/162）、`desktop:native-test`、`BUNDLE_NODE=1 npm run desktop`、`desktop:smoke` 通过。Five-module screenshots checked at 1440×960 and 1000×700 in both themes via headless Chrome. `/Applications/PR Helper Git.app` replaced with the new bundle; old app backed up as `PR Helper Git 0.3.20-local-6c865a5.app`.

### 2026-11-22 本地 push reconcile 预算修正（0.3.20）

- **根因**：0.3.19 产品界面 Push 后，`manual` reconcile run 253 复用普通手动刷新的 8 秒预算；GitHub compare/fetch 未在 8 秒内完成，run 被记 `degraded`，`SYNC HEALTH` 短暂显示 `last reconcile: degraded · 0 stages`。实际 action 4737 已入队，PR #77 正常创建并合并，功能未失败。
- **修复**：新增 `LOCAL_PUSH_RECONCILE_BUDGET_MS = 40s`，仅当 `filter.eventName === 'local-push'` 时使用；普通手动刷新仍走 8s。`reconcileRealtime` 把 `eventName` 传给 `realtimeReconcileBudgetMs`；30s reconcile 租约每 10s 续租，40s 预算落在 45s 外层上限内。新增 2 个测试覆盖 local-push 预算、手动短预算不变、租约续租与 45s 外层上限、eventName 传递。
- **实测校准**：0.3.20 首次产品 UI push（run 272）在 20s 预算下仍被 `pullForStage` 拖到 20.053s，phase 为 `pending.pull=1`，未排到 create-pr；据此把预算从 20s 提到 40s，而不是把 20s 当作已修复。0.3.19 的 run 253 则是 `pending.queue=1`，8s 时 action 已入队。
- **真实 push 验证**：20s 预算的首次 push（run 272）仍被 `pullForStage` 拖到 20.053s，`pending.pull=1`，未排到 create-pr；据此把预算提到 40s。第二次产品 UI push（`83a95b5`）触发 run 273，10.685s `success`，`compare=1.86s / pull=2.67s / queue=5.16s`，action 4739 `create-pr` 成功创建 PR #78，action 4740 `merge-pr` 入队。补文档证据的第三次 push（`e4a22b0`）触发 run 274，13.064s `success`，`pull=10.59s / checks=1.45s`，action 4741 `merge-pr` 绑定新 head。PR #78 的 test/desktop 各 2 个 run 全部通过，`merge-pr` 于 `13:09:11Z` 成功，PR #78 于 `13:09:10Z` 合并，merge commit `5a98a72`，远端 `main` 同步更新。
- **PR 页面 Loading 核实**：产品 UI 的 Pull Requests 页面点击后约 20 秒恢复为 `Refresh`，正常列出 77 条已合并 PR；确认是 GitHub 列表请求慢，不是前端死锁或接口错误，本轮未改页面代码。
- **验证**：`npm run lint`、`npm run typecheck:server`、`npm test`（1223 tests / 72 files）、`npm run build`、`npm run e2e`（162/162）通过。
- **桌面产物**：`BUNDLE_NODE=1 npm run desktop:dist` 产出 0.3.20 zip 40,049,309 B、dmg 46,687,180 B、`SHA256SUMS` 194 B；`desktop:native-test`、`BUNDLE_NODE=1 desktop:smoke`、zip 完整性、dmg 校验和 `shasum -a 256 -c` 均通过，bundle 版本 0.3.20。

### 2026-11-22 自动合并门禁与时效修复（0.3.19）

- **head guard**：merge action 必须匹配调度时的 `payload.headSha`；缺失即拒绝。PR head 推进后取消旧 action/run，stage 写 `head-changed` 并清空 `gate_sha`，不会用旧 green checks 合并新提交。
- **live gate**：合并前实时读取目标 head 的 check-runs、commit status、reviews、classic protection 和 rules；checks/status/reviews 读取失败就保持 `queued + waiting-gates`，不把不可读当绿灯。check-run/status 按 context 取最新 attempt，Approval 按用户最新 review 且限制当前 head。private repo 的 protection/rules 403 视为不可读但不阻断，最终由 GitHub merge API 强制。
- **即时投影与轮询**：`create-pr` 成功当秒写 `pull_number/pull_state/head_sha` 并排 merge action；`merge-pr` 成功当秒写 `merged`。pending checks 的 merge action 不吃 5 分钟 transient cooldown，按 2 分钟 drain 轮询。cron 批量 8→16，当前 15 个活跃流程一轮覆盖。
- **本地 push 即时触发**：`POST /api/push` 成功后解析 GitHub remote，立即对该仓库 `reconcileRealtime(..., 'manual')`；手工 CLI push 仍由 cron 兜底。首次接线时 `trigger='push'` 被 `reconciliation_leases` CHECK 拒绝，已改为合法 `manual`。
- **真实测试仓验证**：`bayernjf/git-e2e-test` PR #17（action 4731 create / 4733 merge）自动建 PR，两个同名 check 去重后 1/1 通过并自动合并；PR #18 验证 head guard：action 4735 计划 `c00812a`，PR 推进 `4fc21de` 后取消并写 `head-changed`，新 action 4736 在 checks 1/1 后自动合并。测试仓新增最小 CI workflow（`.github/workflows/ci.yml`）。
- **门禁与产物**：`npm run lint`、`typecheck:server`、`npm test`（1221 tests / 72 files）、`npm run build`、`npm run e2e`（162/162）、`npm run desktop`、`desktop:smoke` 通过；`build/PR Helper Git.app` 与 `/Applications/PR Helper Git.app` 均为 0.3.19（0.3.18 安装包移至 `000mycodes-backups`）。
- **产品界面发布闭环**：远端 `dev` 到 `0df0b47` 后，action 4737 在 4.2 秒内自动创建 PR #77；checks 2/2 通过后 action 4738 于 `11:38:12Z` 自动合并，远端 `main` 到 `51d799f`。`v0.3.19` tag 由产品 UI 的 `Push tag to origin` 推送（tag object `000674d6b05abaf73f317a4df526211be331de4b`，deref `0df0b47`）；GitHub Release `v0.3.19` 已发布为 Latest，资产为 zip 40,048,807 B、dmg 46,693,184 B、`SHA256SUMS` 194 B。`BUNDLE_NODE=1 npm run desktop:dist`、`desktop:native-test`、`BUNDLE_NODE=1 desktop:smoke`、zip/dmg 完整性与 `shasum -a 256 -c` 均通过；`/Applications/PR Helper Git.app` 0.3.19 启动验收后退出。

### 2026-11-22 Flows UI parity（第二批）
- 按旧版 `src/app/render/lane.ts`、`detail.ts`、`editor.ts`、`dialogs/steps.ts`、`create-pr.ts` 逐项对齐可见 UI：lane 顺序控件/运行摘要/折叠图标、内联 board preflight、详情与抽屉 Actions gate、抽屉 `drawer-status` 卡片、Flows 内 Create PR 对话框、source 分支删除提示。
- 验证：`npm run lint`、`npm run typecheck:server`、`npm test`（1209/72）、`npm run build`、`npm run e2e`（162/162）通过；在 4790 dev 实例以真实 projection 验收看板、详情、抽屉与 `Actions 1/1 Actions passed`。

| 任务 | 状态 |
|---|---|
| P0-1…P0-5（冻结/基线/导出/快照/推送） | ✅ 全部完成（2026-11-14，见台账 §12）|
| P1-1 OrbStack Postgres | ✅ pr-helper-pg 常驻（127.0.0.1:54329，unless-stopped）|
| P1-2 47 迁移原样执行 | ✅ 26 表 schema 一致（030 → server 调度例外）；`npm run check:migrations` 校验脚本随迁（11-14，26=26 ✓）|
| P1-3 Supabase 数据导入 | ✅ 58806 行（eb5000e）；workflows=14 实测确认 |
| P1-4 store 层移植 | ✅ bundle 3014 行自含 ESM（29169ff）+ store 测试网随迁全绿（418 不变量 + workflow-rows 25 + github-api 11 + ai-credentials 5，11-14）；api 路由层测试随 Phase 3 服务面接线随迁 |
| P1-5 领域内核 | ✅ 核心 4 模块 + Phase 3 语义模块（board/detail/failures/audit/prerequisites）全部落地，143 域测试 + 31 UI 语义测试；长尾 navigation/save-queue 由 React hooks + API client 直接承载，不重复造状态机 |
| P1-6 check-migrations 随迁 | ✅ 重定界为新实现（快照无源文件）— scripts/migration/check-migrations.mjs |
| P2-2/4 drain + 对账引擎 | ✅ 418 store 不变量覆盖 drain 决策/退避/幂等/取消；租约/轮转/分级预算测试通过；本地 PG `reconciliation_runs` 产生 `inbox_refresh` 遥测行（14 total/12 reconciled/0 failed/≈6s） |
| P2-6 AI 接管 | ✅ 2026-11-15 真实闭环：action 4372 缺 AI 配置自然 paused → 补临时凭据 → takeover 建 PR #9；另走 4789 UI 点击路径（take over 表单）建 PR #11，审计 `via=user-takeover`，Refresh 后卡片显示 PR #11；PR/分支/流程/凭据已清理 |
| P2-7 Actions 重跑 + Codex | ✅ 校验链随 bundle，路由 400/合法测试 + 次数上限域测试 + Codex context 测试；实际 rerun dispatch 未执行 |
| P2-5 触发器三通道 | ✅ webhook 端到端实测 + 9 个契约单测（11-15：fail-closed/坏签名/缺头/坏 JSON/shadow/合法投影+reconcile/重复去重）；fs.watch=既有 reconcileWatching、定时对账=调度器 |
| P2-10 影子模式 | ✅ 只读观测（引擎无 dry-run 缝；shadow 永不执行）+ JSONL 影子日志落盘；逐日比对材料见 `docs/phase5-runbook.md` |
| P2-1 PAT/App 凭据实网验收 | ✅ D-006-v3 PAT 路径实网（11-15）：App 私钥在 Vercel 侧被 Sensitive 掩码、App installation 不可用；`GITHUB_TOKEN` 走同账号同 REST 路径，实测 bayjf Actions 4 / Environment 5、pr-helper-git 空 Environment；凭据文件引号解析修复后服务端 PAT 生效 |
| P2-3 门禁+合并执行接线 | ✅ 2026-11-15 真实链路：PR #8 自动建/合并（action 4370/4371，`main` `f94ace0`）；PR #10 验证 advance-stage（action 4375 succeeded，审计 `stage-advanced`）；真实 advance 暴露并修复 020 审计 CHECK 缺 `stage-advanced`，新增本地迁移 `049_audit_stage_advanced.sql`；测试分支/流程/凭据已清理 |
| P2-8 团队四角色 | ✅ 引擎四角色/共享/账号删除 + `/api/flows/teams` 路由（3 测试）+ 角色矩阵（3 测试）+ `TeamsModal` UI；4791 实测创建团队→Owner、成员列表与四角色下拉；真实 HTTP 共享 200 且 join 表落库 |
| P2-9 launchd LaunchAgent | ✅ install/uninstall + 崩溃自愈实测（kill -9 → 10s 重启）；11-15 常驻运行于 4789（shadow 模式） |
| Phase 3 控制塔 UI React 重建 | ✅ **已收口**（11-15）：看板/详情/抽屉/编辑器/失败中心/手机/归档/静音/运行历史/PR 引用/审计 CSV/同步健康度/流程预检/部署实网/团队四角色全部落地；P3-9 验收 ✅33/🔶0/🔀1/⬜0（#1 为认证形态替代）；P3-2 手动 Refresh live 对账、P3-3/P3-5 实网部署卡与失败中心走查、P3-15 团队 UI 均完成 |
| Phase 3.5 功能缺口回补 | ✅ **关闭**（11-15）：P3-10 ✅（PAT/凭据修复后 Actions 4/Environment 5、4 条真实部署 run、回滚确认 UX；实际 dispatch 按用户裁决不执行）、P3-11 ✅、P3-12 ✅、P3-13 ✅、P3-14 ✅、P3-16 ✅；P3-15 ✅（11-15 团队 UI 收口，原暂缓裁决已被后续实现覆盖）；P3-7 四项前置禁用 ✅；P3-9 的 #19/#34 已通过 |
| Phase 4 通知/AGENTS 修订/脚本 | ✅ P4-1/P4-3/P4-4 完成（11-14，990/47）；P4-2 按 D-014 用户裁决修订：pr-helper 仓保持 PUBLIC+非归档、仅停止迭代（已还原）；AGENTS 已补 D-002-v2 部署门禁边界 |
| GitHub Device Flow + A2A（D-020/D-021） | ✅ **2026-11-15 落地**：Device Flow 身份连接（identity-only，token 0600 落 config、永不回传）+ Agent Card/JSON-RPC 真接线（fail-closed bearer；execute enqueue 引擎动作；production-rollback 永远升级）；门禁 1089/59 + E2E 162/162 + build 绿。**A2A 实网 ✅**；Device Flow 实网待账号启用 2FA / 刷新 GitHub 会话后重试 |
| Phase 5 影子并行→切换→下线 | 🔶 **执行态，审批未闭环**：11-14 16:24 启动影子期；launchd 4789 在 2026-11-22 01:33 CST 实际切为 `automation=1/shadow=0`，但审批表仍为空；owner 2026-11-23 选择承认现状并继续；动作 2–3 仍需 D-016 逐项审批；动作 4 已完成单 stage + 双 stage 本地实跑（PR #20、PR #23/#24、advance `4754`）；P5-1 判定证据未补齐；见 `docs/phase5-p5-2-approval.md` |

Phase 2 接线状态（2026-11-14）：`server/automation.mjs` 桥接调度器（drain 120s / reconcile 300s / retention 每日），
启动 opt-in `PR_HELPER_GIT_AUTOMATION=1`（e2e/临时 server 零接触）；webhook `POST /api/github-webhook` 位于 token
鉴权之前（HMAC 即鉴权，无 secret 503 fail-closed）；测试基线 959/44。

Phase 3 第一片（2026-11-14）：`server/flows.mjs`（身份桥采纳 pr_helper_users 单行 +
`/api/flows/{inbox,workflows,audit}`，App 凭据缺失单路读降级空集+readWarnings）+
`src/lib/automation/flows-board.ts`（六筛选/计数/步骤色调/运行摘要语义，13 单测）+
`src/components/FlowBoard.tsx`（Toolbar「Flows」视图，只读看板）。下一步：P3-3 步骤抽屉 →
P3-4 编辑器 → P3-5 失败中心。

**迁移会话更新（2026-11-17 → 11-19）：影子期运行中（11-14 启动，4 天累计 3400+ 轮观测；D-018 同步基础设施：`npm run sync:shadow` 每日云端→本地镜像，连接走 prh-sql 只读通道；11-19 中期同步完成——生产新增第 15 个流程 `agent-ops` dev→main 已进本地镜像，影子观测与云端一致）；**11-19 追加：19 对话框对照审计——真缺失 2 个全部落地（Codex 修复对话框 + 生成规则管理对话框【本地迁移 049 name 列 + rules CRUD 路由实测】）；看板细节批（步骤卡开抽屉/lane 收起/位置直跳）+ 排版/焦点环/空态/键盘可达性打磨**）；业务验收 34 项全部有结论（✅33 + 🔀1；#1 为 Device Flow 替代实现）（AI 凭据路由+规则库接线补齐 M-E5 尾巴，编辑器可配 AI 凭据与规则选择；旧加密凭据清除需重配 AI key）；D-014 仓库保持 PUBLIC、D-015 推进开关持久化（本地迁移 048）、D-016 切换/下线逐项审批铁律、D-017 飞书暂缓；UI v3/v4（v4=Catppuccin 清新护眼可爱主题+动效系统+排版/焦点环/空态打磨）；测试仓铁律+全量登记（`test-repos.md` 双表）。桌面单实例守卫+标题栏主题跟随已实测。测试 996/48、E2E 145/145（0.3.4 时点）→ 最新源码树 1099/61、E2E 162/162。**

**2026-11-19 控制塔第二批 UI 补齐（已推送，随 0.3.12 发布）**：对照冻结源 9 项全落地——
进度条语义+nextAction（639d02d）、fan-in 分组（7b7f637）、gateDisclosure（b6d1179）、
merge 方法菜单（706ec0b）、resolve 消隐（5100b29，修正冻结源 derive.ts 参数倒置）、
分支选择器（03aa15f）、toast undo（16a0168）、板级 preflight 聚合（67b3899，路由层
fan-out 不改冻结 store）、open-PR 抽屉面测试网（806ea80，8 测试+变异对照）。
门禁 **1160 tests / 66 files** + E2E 162/162 + build。浏览器只读走查（隔离 18776、
无调度器、零写操作）：板级 preflight 15 flows/17 failed/8 warnings/56 passed、
NEXT ACTION 与进度语义、分支选择器无 PAT 降级均实测；merge 菜单/gate chips/fan-in/
resolve 因真实数据全 merged、无 PAT、无多上游而不可触发，由组件/域测试覆盖并登记
数据缺口。dev 10 提交已推送（dev `ad4a79c`），随 `0.3.12` 发布。
逐项口径见 `docs/migration-acceptance.md` 同日补充段。

**2026-11-19 Live-PAT 实网走查 + 服务端 PAT 修复**：在已登记测试仓
`bayernjf/git-e2e-test` 建真实 PR [#14](https://github.com/bayernjf/git-e2e-test/pull/14)
（临时 fixture，走查后已关闭、临时分支已删除），补 `.github/workflows/live-pat-check.yml`，
真实 Actions `smoke` run `44493987714` 成功。桌面端 0.3.13 用真实服务端 PAT 走查：
PR 列表 Open 1 / Merged 6 / Closed 7、#14 抽屉 2 commits / 2 files / `+13 -0` /
`CHECKS smoke success`、文件 diff、New PR Base/Compare 分支列表全部真实加载。
走查发现 `FlowEditor` / `StepDrawer` 的 `useBranches` / `useCheckDetails` 只认浏览器
PAT，服务端 PAT 模式下会提前返回，分支列表和 checks 明细降级；已修为接收
`hasServerPat` 并保持空 PAT 时走服务端代理，新增 3 个 hook 测试。隔离 18777
（真实服务端 PAT、无调度器、零写）实测 source/target 列出 `dev`/`main`，StepDrawer
checks 展开 8 条真实 GitHub Actions 明细。门禁 **1163 tests / 67 files** + E2E
162/162 + build。PR 列表卡片在 GitHub REST 已 `mergeable=true / clean` 时仍显示
`computing`，属列表端点 mergeability 延迟计算，抽屉单 PR 读取正常，本次未改。

**2026-11-18 会话快照**：[`docs/session-handoff-2026-11-18.md`](docs/session-handoff-2026-11-18.md)
已按仓库实际状态校正。0.3.9 之后补发 0.3.10（PR #23，发布提交 `067ae83`，
tag `v0.3.10`）；0.3.11 新增 CI 健康看板（发布提交 `3bb8030`，tag `v0.3.11`，
PR #25 合并 `b17a380`）；`main = b17a380`、`dev = 3bb8030`，
GitHub latest = **`v0.3.11`**。
测试：1099 tests / 61 files + E2E 162/162，build 通过。备份目录最新
`source-20261118-1311.bundle` 含 `main`、`dev`、`v0.3.11`。

最近更新：2026-11-19（发布 0.3.15：PR 列表 open PR 合并状态通过 GraphQL 批量回填；修复切换仓库后顶部加载条不复位）。此前 2026-11-19（发布 0.3.14：服务端 PAT 模式下 FlowEditor 分支选择器与 StepDrawer 检查明细修复；真实 PR #14 live-PAT 走查完成）。此前 2026-11-19（发布 0.3.13：CI Health 窄窗指标标签换行修复）。此前 2026-11-19（发布 0.3.12：控制塔第二批 UI 对齐冻结源——进度/NEXT ACTION、fan-in、门禁披露、merge 菜单、resolve 消隐、分支选择器、toast undo、板级 preflight）。此前 2026-11-18（发布 0.3.11：只读 PR CI 健康看板（通过率/失败原因/CI 阻塞/合并后 CI，账号仓库 + 7/30/90 天窗口 + 10 分钟缓存）。此前 0.3.10：更新器下载速度/剩余时间与失败一键重试；admin 权限错误统一转为可操作提示，仓库管理弹窗对 member 直接提示并禁用提交。此前 0.3.9：权限边界收紧（仓库/控制塔写入需 admin）、webhook 请求体 256KB 上限、Dashboard 30 秒刷新与 PR 探测修复、并发保存/审计原子性、grep-all 预算、损坏 config 失败关闭，以及一批 UI 可访问性/懒加载修复。此前 0.3.8：`Check for Updates…` 菜单项随状态变为 `Checking…` / 文本进度条 / `Update ready` / `Update failed`，并作为恢复进度窗口入口；此前 0.3.7 为可最小化独立进度窗口；此前 0.3.6：桌面更新器增加下载进度、SHA-256 校验状态和 `Install & Restart` 确认；0.3.5 为 UI 体验版。生产巡检：14 个受管仓库 0 open PR、13 个 CI 全绿，唯一异常为 `agent-world` 自托管 runner 离线，详见下方 2026-11-16 段。此前 2026-11-16：发布 0.3.4，修复工具栏仓库下拉框选项被裁剪。此前 2026-11-15：GitHub Device Flow 身份连接 + A2A/Agent Card 真接线落地，见下方 D-020/D-021 段；实网 Device Flow 待用户启用 App 设置后走查。此前 PR 写操作终验：在 `bayernjf/git-e2e-test` 走产品真实路径——`/api/github` 代理 + `/api/merge-pull` 路由——建 PR #12 后**真实执行 Close/Reopen/Merge(squash) 全成功**，PR 合并 `main` 前进、本地 reset 回 `da284ca`、临时分支清理。**关键边界**：Approve/Request-changes 对自己 PR 被 GitHub 硬性拒绝（422 "Cannot approve/request changes on your own pull request"），这是 GitHub 平台约束、非产品缺陷；COMMENT review 对自己 PR 走通（200/COMMENTED）。单账号下 approve/request-changes 无法真实验证，需第二账号或接受"产品已正确透传 GitHub 422 错误"作为验收口径。测试 1099/61、E2E 162/162、build 通过。

**2026-11-16 文档校正**：Phase 4 已全部完成，P3-15 团队 UI 已收口，Phase 5 仅余 P5-1 影子期日历等待与 P5-2/P5-3 的 D-016 逐项审批；该轮无代码变更。

### PR 列表 mergeability（2026-11-19，未发布）

`GET /repos/{owner}/{repo}/pulls` 对 open PR 也只返回 `mergeable=null`，所以
PR 列表卡片一直显示「计算中」，而单 PR 详情已是 `mergeable=true / clean`。
新增 `POST /api/pull-mergeability`：按本地已登记仓库解析 GitHub origin，
用 GraphQL 一次读取仓库全部 open PR 的 `mergeable` / `mergeStateStatus`，
转成 REST 字段后由 `PrBoard` 合并进列表；查询失败保持原列表（fail-soft）。
GraphQL 的 `mergeable` 是 `MERGEABLE / CONFLICTING / UNKNOWN` 枚举，代码里
显式映射为 `true / false / null`，不能直接当布尔用。

验证：1169 tests / 68 files；E2E 162/162；build 通过；隔离 18777 用真实
`octocat/Hello-World` 验证接口返回 `mergeable=true / mergeable_state=clean`。
另在 `bayernjf/git-e2e-test` 开临时 PR #15 做列表视觉验收，卡片显示
`mergeable`（不再 `computing`）；验收后 PR 已关闭、临时分支已删除。
未发版，待用户指令。

### 顶部加载条复位（2026-11-19）

`repoLoading` 驱动的 2px 不定进度条在切仓库后一直跑。根因是
`selectRepo` / `setLogScope` / `setLogPath` / `setLogFilters` / `loadMore`
在调用 `loadRepoData` 前捕获 `loadSeqRef.current`，而后者入口处会先
`++loadSeqRef.current`，于是 `finally` 的 `seq === loadSeqRef.current`
永远不成立。改为捕获即将占用的序号（`current + 1`），并用 18777
浏览器实测：切换仓库完成后 `.loading-bar` 数量为 0。

## Release 0.3.18 (2026-11-21)

范围：2026-11-21 设计审计（主题/UI/UX 两路并行扫描）全部可修复项 + 当日两个
独立 bug 修复。四个提交：`a8c15c7`（主题：--on-accent 对比度体系、语义色
strong 变体、GitHub 时代第二调色板并入 Catppuccin token、提交图主题化、accent
预设单源化为 tokens.json → accents.css/accents.ts 双产物、z-index/圆角 token
标尺、死 token 清理）、`db77e10`（a11y：两个新模态补 Esc、焦点陷阱覆盖
drawer/命令面板、btn-small 修正、RefSidebar/文件树行键盘可达、11 处
aria-label）、`4663e95`（诚实状态：PR 列表骨架屏、Dashboard reposLoaded 门闸、
review 徽章 UNKNOWN 化、inline-error、FailureCenter 去双报、stash 不重置，
新增 honest-states 测试）、`433ace1`（i18n：剩余裸文案 t()/tp() + 中文词条）。
当日早些时候独立修复：侧栏排序下拉遮挡分组标题（b7500b9）、行内"更多"按钮
UA 灰底（ed454b5）。

验证：1177 tests / 70 files；E2E 162/162；lint / typecheck:server / build
全绿；对比度实测 primary 按钮 dark 8.12 / light-violet 5.41 / light-rose
6.38（rose 修复前为 2.64）；dark/light/forest 三主题 CDP 截图走查；本批无
desktop/ 或构建脚本改动，桌面端无需重建（沿用 0.3.17 壳）。

### macOS 系统设置风格设置页（2026-11-21，未发布）

`SettingsModal` 从单列长表单改为两栏设置窗口：52px 标题栏、218px 左侧分类
栏（General / GitHub / Application / Advanced）、右侧大标题
与 inset grouped 卡片。Repository tools 已移至工具栏 More 菜单，不再作为
设置分类；Advanced 仅 admin 可见。语言、浏览器 PAT、GitHub App、服务端 PAT、
服务端数据、AI、A2A、快捷键与原有角色门禁全部保留。外观改为三张固定明暗预览的
主题缩略图 + 带选中环的强调色色板；分类面板全部挂载，非当前页用 `hidden`
隐藏，保持既有 `h3.settings-section` 测试契约。

验证：1180 tests / 70 files；E2E 162/162；lint / typecheck:server / build
全绿；Vite 预览走查管理员/成员、深/浅色、中/英、应用与高级页，1280px
视口无溢出（900px 最小宽度为 CSS 计算，未做像素截图）。桌面门禁
`desktop:native-test` / `BUNDLE_NODE=1 npm run desktop` / `desktop:smoke`
全绿；新包 0.3.18 已安装到 `/Applications/PR Helper Git.app`，旧包备份为
`PR Helper Git-0.3.18-before-settings.app`，安装版实测 General/GitHub 两页
布局与对比度正常。提交 `006d65a`（设置页）、`526e9ea`（侧栏收起 12px 沟槽）。

### 桌面端稳定端口与 localStorage（2026-11-22，未发布）

现象：在桌面端切到 `pr-helper-git` 后重启又回到 `Hello-World`。

根因：桌面壳每次都传 `--port=0`，WKWebView 的 localStorage 按
`scheme + host + port` 隔离；端口一变就是新的空存储。当前
`~/Library/WebKit/local.pr-helper-git/WebsiteData/Default` 下已积累
55 份独立 `localstorage.sqlite3`，多个库仍各自保存着不同的
`pr-helper-git:active-repo`，直接证明每次启动换了 origin。

修复：新增 `desktop/ServerPort.swift`，把服务端口写入 `UserDefaults`
（`desktopServerPort`），下次启动先探测该端口，仍可用才复用；被占用时
回退 `--port=0`，并在 ready 握手后记住新端口。原生测试覆盖空存储、
空闲端口复用、占用端口回退；README 与 CHANGELOG 的“临时端口”表述同步更正。

验证：`desktop:native-test` 全绿；`BUNDLE_NODE=1 npm run desktop` +
`desktop:smoke` 全绿；安装后实际在 55018 端口切到 `pr-helper-git`，
退出再启动，端口仍为 55018，活动仓库仍为 `pr-helper-git`。
提交 `23d1652`。

### 设计 token 间距/控件标尺（2026-11-22，未发布）

用户反馈设置页 Advanced 里输入框文字贴边框，追问是否有设计 token。核对：
token 源 `design/tokens.json` 已覆盖颜色、字号、圆角、阴影，但没有间距和
控件尺寸标尺；设置页输入框为 `padding: 5px 9px`，紧凑按钮 10–12px，卡片行
14px，三套节奏并存。

修复：`tokens.json` 新增 `spacing`（2/4/6/…/40px）与 `control`
（30px 输入框、28px 紧凑按钮、12px 横向内边距、5px 输入框纵向、4px 按钮
纵向）；`sync-tokens.mjs` 生成 `--space-*` 与 `--control-*`。设置页的
`.settings-input`、`.settings-modal .dropdown-trigger`、`.settings-secondary`、
`.settings-save-btn`、卡片行、设置面板内距改走 token，控件横向文字内边距
统一 12px；`settings-nav-item` 等 3/5/7/9px 的零散值归一到偶数标尺。

验证：1183 tests / 70 files（新增 spacing/control token 断言）；E2E
162/162；lint / typecheck:server / build 全绿；`BUNDLE_NODE=1 npm run desktop`
+ `desktop:smoke` 全绿；安装版 Advanced 页 / A2A 高倍裁剪实测 Agent card
输入框文字距左边框约 14px（12px padding + 1px 边框 + 字形留白），与 Copy
按钮内距一致。0.3.18 已安装，旧包备份
`PR Helper Git-0.3.18-before-tokens.app`。

### 仓库工具迁出设置页（2026-11-22，未发布）

用户指出 Repository tools 不应作为设置分类，因为工具栏 More 菜单已经有
Manage remotes、git config、reflog、audit、compare、git grep、提交搜索、
跨仓库搜索 8 个入口。已删除设置侧栏的 Repository tools 分类、整页重复入口、
`settings-nav-repos` 样式与两条 i18n 词条；`SettingsModal` 不再接收 `activeRepo`，
设置分类收敛为 General / GitHub / Application / Advanced。More 菜单本身未改。

验证：SettingsModal 测试改为断言设置页不出现 Repository tools / Manage remotes /
Compare two references；Toolbar 测试断言右侧 More 入口存在。完整门禁
1183 tests / 70 files、E2E 162/162、lint / typecheck:server / build 全绿；
`BUNDLE_NODE=1 npm run desktop` + `desktop:smoke` 全绿。安装版实测设置侧栏
只剩 General / GitHub / Application / Advanced，More 菜单仍列出 8 个仓库工具
入口；旧包备份 `PR Helper Git-0.3.18-before-repotools.app`。

## Release 0.3.17 (2026-11-20)

范围：修复 0.3.16 桌面端顶部双击缩放的覆盖范围。0.3.16 把
`NSClickGestureRecognizer` 挂在 webView 上，只覆盖 web 内容顶部 28px；
原生标题栏那一条点击不触发。现在改为应用级 `NSEvent` 左键监听，同时覆盖
原生标题栏和 web 内容顶部 28px，工具栏按钮单击不受影响。

验证：1173 tests / 69 files；E2E 162/162；lint / typecheck:server / build
全绿；desktop:native-test / desktop:smoke 通过；真实桌面双击原生标题栏和
内容区顶部，窗口均 1280×852 → 1411×923，再双击恢复。

安装副本复验（2026-11-20）：`/Applications/PR Helper Git.app` 为 0.3.17；
双击原生标题栏和 Web 内容顶部 28px，窗口均 1280×852 → 1411×923 →
1280×852（无阴影窗口截图 2560×1704 / 2822×1846 px，2× Retina）。

## Release 0.3.16 (2026-11-20)

范围：把 0.3.15 之后已合并进 `main` 的改动带入桌面端：app-state context
拆分（Preferences / RepoData / Actions / Busy，43 个消费者迁移，新增隔离
测试）、桌面顶部双击缩放、分支排序触发器遮挡分组标题修复；同时把 `dev`
快进到 PR #44 的 merge commit `50f938f`。

验证：1173 tests / 69 files；E2E 162/162；lint / typecheck:server / build
全绿；desktop:native-test / desktop:smoke 通过；桌面端构建版本为 0.3.16。

## Release 0.3.15 (2026-11-19)

范围：修复 PR 列表 open PR 的合并状态（GraphQL 仓库级批量回填，替代 REST
列表缺失的 `mergeable`），以及切换仓库/过滤器后顶部加载条不复位的状态
序号 bug。

验证：1169 tests / 68 files；E2E 162/162；build 通过；真实 Hello-World
接口返回 `mergeable:true / mergeable_state:clean`；`git-e2e-test` 临时
PR #15 列表卡片显示 `mergeable`（PR 已关闭、分支已删除）；切换仓库后
`.loading-bar` 数量为 0。

## app-state context split (2026-11-19)

范围：把单例 `AppDataProvider` / `useApp()`（411 行、43 个生产消费点）拆成
四个领域 context（Preferences / RepoData / Actions / Busy）+ 既有
`ToastProvider`，按 `docs/app-state-split-plan.md` 的执行清单分 7 步落地
（S1a/S1b/S1c + Phase 2/3/4），每步独立提交。目的：让切主题 / 改 PAT /
busy 翻转 / 日志过滤不再触发无关消费者重渲染。

要点：

- `PreferencesProvider`（view/theme/accent/pat/hasServerPat）、
  `RepoDataProvider`（repos/status/commits/refs/remote/日志窗口、SSE、
  `loadSeqRef`/`activeRepoRef` 代际守卫、初始仓库恢复）、`ActionsProvider`
  （`runAction` + `busy` 分 context；`runAction` 用 `refreshRef` 稳定引用，
  顺带修掉旧闭包读旧 `refresh` 的隐患）、`useAppToast`。
- 43 个 `useApp()` 消费者全部迁到领域 hooks；移除 `useApp`/`AppContext`/
  `AppData` 兼容层。
- 关键不变量 `loadSeqRef.current + 1` 原样保留（漏 `+1` 顶部加载条会卡住）。
- 测试注入改为直接导出各领域 Context（`PreferencesContext`/`RepoDataContext`/
  `ActionsContext`/`BusyContext`），替代计划里的 `test-helpers.tsx`。
- 新增 `src/app-state/context-isolation.test.tsx`（4 个渲染计数探针证明隔离边界）。

验证：1173 tests / 69 files；E2E 162/162；lint / typecheck:server / build 全绿。
PR #40 合并 `586b12e`。可选后续（未做）：`selectedHash` / `SelectionContext`
拆分，若 Phase 3 后渲染性能仍不达标再评估。

## Release 0.3.14 (2026-11-19)

范围：修复服务端 PAT 模式下 `FlowEditor` 分支选择器与 `StepDrawer`
检查明细的降级。两个 hook 之前只认浏览器 PAT，空 PAT 时提前返回；
现在接收 `hasServerPat`，空浏览器 PAT 仍走服务端代理（服务端注入
admin PAT）。新增 3 个 hook 测试。

验证：1163 tests / 67 files；E2E 162/162；build 通过；隔离 18777
真实服务端 PAT 实测 source/target 列出 `dev`/`main`，StepDrawer checks
展开 8 条真实 GitHub Actions 明细；真实 PR #14 走查覆盖 PR 列表、
open-PR 抽屉、checks、文件 diff 与 New PR 分支列表。临时 PR #14 已关闭，
临时分支已删除。

发布：提交 `7ca6251`，tag `v0.3.14`（tag 对象 `4c628c2`），PR #36 合并
`1194218`；Release
`https://github.com/bayernjf/pr-helper-git/releases/tag/v0.3.14`。
桌面产物：`PR Helper Git-0.3.14-macos.zip`（SHA-256
`9903b90d…`）与 `.dmg`（`fde2e41f…`），`SHA256SUMS` 已随 Release 上传。
本机 `/Applications/PR Helper Git.app` 已安装 0.3.14，0.3.13 备份于
`/Users/jiangfeng/000mycodes-backups/pr-helper-git/PR Helper Git-0.3.13.app`；
安装后重启验证：应用窗口正常加载、Flows 15 个流程可见、FlowEditor
source/target 分支 toggle 出现并列出真实 `dev`。

### 测试仓清理（2026-11-19）

按用户指示复核 `TEST-REPOS.md` 的 GitHub 测试仓：保留
`bayernjf/git-e2e-test`（#1，主 E2E 仓，本地 `main` 干净、0 open PR）；
删除 #3 `pr-helper-e2e-sandbox`、#4 `pr-helper-e2e-sandbox-private`、
#6 `e2e-test`、#7 `receipt-test`（均为 pr-helper 时代 / 用途未确认，
本地无 clone，删除时分别有 2/0/0/9 个 open PR，随仓库一并消失）。
#2 `pr-helper-git-sync-test` 与 #8 `aw-pr-dogfood` 按用户指示留待后续处理；
#5 `e2e-test-real` 未在本次清单内，保持原样。登记表已移除四行并记录删除日期。

## Release 0.3.13 (2026-11-19)

范围：修复 CI Health 指标卡标签在窄窗口下被省略。`src/styles.css` 的
`.ci-stat-label` 改为按卡片宽度换行（`line-height: 1.3` /
`overflow-wrap: anywhere`），不再使用 `nowrap + ellipsis`；数值、提示、
颜色语义不变。

验证：1160 tests / 66 files；E2E 162/162；build 通过；786px 窄卡片
DOM 核对所有标签 `scrollWidth == clientWidth`，`Post-merge CI failures`
正常两行，无省略号。

更新器验收（2026-11-19）：用 0.3.12 独立 bundle-id 副本实测
`Check for Updates…` → 提示 `v0.3.13 is available` → 下载窗从 0% 走到
21%，显示 `4.5 MB of 46.2 MB · 454 KB/s · 1m 32s left`；最小化后
`is_minimized=true`，下载继续，恢复窗口仍为 21%；取消后下载窗关闭。

发布：提交 `e274d58`，tag `v0.3.13`（tag 对象 `31a0615`），PR #33
合并 `89ea36b`；Release
`https://github.com/bayernjf/pr-helper-git/releases/tag/v0.3.13`。
本机 `/Applications/PR Helper Git.app` 已安装 0.3.13，0.3.12 备份于
`/Users/jiangfeng/000mycodes-backups/pr-helper-git/PR Helper Git-0.3.12.app`；
发布时备份 `source-20261119-1626.bundle` 含 `main=dbf6ed0`、
`dev=a0bea00`、`v0.3.13`。

## Release 0.3.12 (2026-11-19)

范围：控制塔第二批 UI 与看板语义补齐（9 项 + 测试网），并修正冻结源
resolve 缺陷。

客户端/控制塔：
- 进度条按服务端阶段决策标注，新增 NEXT ACTION 面板；看板支持 fan-in
  汇入分组；部署门禁移除/同步改为带 undo 的 toast。
- 步骤抽屉 checks chip 实时展开逐检查明细；open 阶段显示 approvals 与
  mergeability 门禁 chip；merge 按钮改为分裂菜单（merge commit 可用，
  squash/rebase 保留 GitHub 页面边界）。
- 看板本地 resolve 消隐（15 分钟 TTL，投影追平/更新事件/服务端不再
  pending 时失效），只过滤看板视图。
- 流程编辑器 source/target 改为可过滤分支 combobox，无 PAT/读取失败
  降级自由文本；wildcard source 仍可手输。
- 看板新增「Preflight all flows」，一次只读检查全部未归档流程，按流程
  汇总 failed/warnings/passed，单个流程失败不中断整批。

服务端：板级 preflight 在 `server/flows.mjs` 路由层顺序 fan-out，
`{all:true}` 返回 `{results,errors}`；不改冻结 `workflows-store.mjs`，
单流程路径的 400 契约不变。

修复：移植 `resolved-automation` 时修正冻结源 wildcard 参数倒置缺陷
（原实现 wildcard 永不匹配）；resolve 标记按
`workflowId|stageIndex|source` 隔离，避免错误消隐。

验证：1160 tests / 66 files；E2E 162/162；build 通过；CI Linux test +
macOS desktop 双绿。第二批开发期隔离走查（无 PAT 降级环境，15 flows /
17 failed / 8 warnings / 56 passed）；open-PR fixture 覆盖 merge 菜单、
gate chips、fan-in 与 resolve 接线。

发布：提交 `c823224`，tag `v0.3.12`，PR #31 合并 `4b35658`；备份
`source-20261119-1507.bundle` 含 `main`、`dev`、`v0.3.12`。

0.3.12 实机走查（2026-11-19，隔离 18776、只读、无调度器）：CI Health
30 天窗口扫描 47 仓 / 516 PR / 99.0% 通过；Flows 列出 15 条（含
`agent-ops`）；板级预检 15 flows / 0 failed / 0 warnings / 90 passed；
NEXT ACTION「Flow status synced」、进度「All done · 1 steps」、步骤抽屉
PR #218 `checks 8/8` 正常；无写操作。

## Release 0.3.11 (2026-11-18)

范围：新增只读的 PR CI 健康看板。

服务端：`server/ci-health.mjs` 通过 GitHub REST `/user/repos` 获取 PAT 账号
拥有的非 fork/非归档仓库，再对每个候选仓库跑 GraphQL `statusCheckRollup`，
按 PR 级最终检查状态聚合；开放 PR 始终纳入，已关闭/已合并 PR 仅在创建时间
落在 7/30/90 天窗口内纳入；默认分支 HEAD 的合并后 CI 单独统计。失败检查按
名称/标题/描述归类到 infra/timeout/auth/deploy/deps/lint/tests/build/unknown；
同一检查名的多个 attempt 按最高严重度去重。内存缓存 10 分钟，`refresh=1`
强制刷新；不读取 pr-helper 生产库，不写 GitHub。

客户端：新增 `CiHealthPage` 与 `CI Health` 顶级视图；指标卡、仓库明细、
失败原因分布、失败 PR 列表、仓库多选与 localStorage 持久化；命令面板可切换。

验证：1099 tests / 61 files；E2E 162/162；build 通过；真实 loopback
`GET /api/ci-health?days=30` 返回 200，二次请求命中缓存。视觉点验受本机锁屏/
浏览器会话限制未执行，页面已过类型检查与生产构建。

## Release 0.3.10 (2026-11-18)

范围：更新器慢速/失败闭环 + admin/member 权限提示。

桌面：下载进度窗口显示传输速率和预计剩余时间；失败状态增加 `Retry`，
菜单项从 `Update failed — Show Details` 改为 `Update failed — Retry`，点击直接
沿用当前 release 重下，不必关闭窗口再走 Check for Updates。重试会清理旧临时
目录并重置进度/按钮状态。

客户端：`admin access required` 统一映射为可操作提示（说明需要 admin、owner
在 Team 提升角色或改用 owner 账号）；仓库管理弹窗打开时读取 `/api/me`，member
直接看到提示且提交按钮禁用，其余 admin-gated 写入口通过统一错误提示兜底。

验证：1093 tests / 60 files；E2E 162/162；build 通过；desktop native-test +
Swift 壳编译通过。

## Release 0.3.9 (2026-11-18)

范围：把 0.3.8 之后两条深评审修复（`7eb66ad`、`a31b208`）正式发版。

安全/服务端：仓库注册、移除、克隆、初始化以及 control-tower 的
automation / saves / credentials 写路由改为 admin 必需，member token 在看板
保持只读；GitHub installations 枚举同样 admin-gated；webhook 接收端改用
`readRawBody` 的 256KB 上限；`/api/save` 临时文件唯一化；grep-all 增加 30 秒
墙钟预算；损坏 `config.json` 失败关闭并保留 `.corrupt-*`；audit append+rotate
串行化并 await；顶层 500 不再回显 `err.message`，listen 回调保护
`reconcileWatching`。

客户端：Dashboard 30 秒定时器改为稳定依赖，PR 数量/owner 探测按仓库集合内容
触发；快速切换仓库按 load generation 清理 loading；StepDrawer Escape/焦点、
Dropdown `aria-activedescendant`、Dashboard 按钮语义、PrBoard 评论摘要懒加载
（去掉 N+1）、事件时间戳 locale、force-push/toast 翻译、移除 v4 前 `.lv-*` 色块。

门禁：1092 tests / 60 files、E2E 162/162、build 通过；desktop native-test +
`BUNDLE_NODE=1 npm run desktop` + smoke + dist。桌面产物未签名，首次打开需
右键 → 打开绕过 Gatekeeper。

## Release 0.3.8 (2026-11-17)

范围：把更新状态直接放进 App 菜单。`Check for Updates…` 不再是静态项：检查时
显示 `Checking for Updates…`；下载时显示文本进度条和百分比（`Downloading
0.3.8 [████░░░░] 42%`）；下载完成显示 `Update ready — v0.3.8`；失败显示
`Update failed — Show Details`。该菜单项同时是恢复进度窗口的入口，因此移除了
单独的 `Show Update Progress` 菜单项。底层仍是 0.3.7 的独立可最小化窗口。

门禁：desktop native-test、`npm run desktop`、`desktop:smoke`；完整发布门禁与
ZIP/DMG/SHA256SUMS 见 GitHub Release。桌面产物未签名，首次打开需右键 → 打开
绕过 Gatekeeper。

## Release 0.3.7 (2026-11-17)

范围：修复 0.3.6 更新进度面板的可用性问题。此前进度面板是挂载在主窗口上的
`NSAlert` sheet，无法最小化，下载期间会阻塞主窗口；用户要求最小化后继续使用
主窗口，并能恢复进度面板继续看下载状态。`UpdateManager` 现在改用独立
`NSWindow`（`titled + closable + miniaturizable`），下载期间主窗口保持可用；
最小化后可从 Dock 或菜单 `Show Update Progress` 恢复。下载完成、校验状态、
`Install & Restart` / `Later` 和失败状态都在同一窗口内联显示；下载中关闭窗口
会取消网络任务并清理临时目录。

门禁：desktop native-test、`npm run desktop`、`desktop:smoke`；发布资产
ZIP/DMG/SHA256SUMS 见 GitHub Release。桌面产物未签名，首次打开需右键 →
打开绕过 Gatekeeper。

## Release 0.3.6 (2026-11-17)

范围：桌面端更新体验补洞。`UpdateManager` 现在用 `URLSessionDownloadDelegate`
上报 DMG 下载进度，更新面板显示百分比与已下载/总大小；下载完成后继续显示
SHA-256 校验状态；校验通过后弹出 `Install & Restart`，由用户确认后再退出、
替换 `/Applications/PR Helper Git.app` 并重开。取消下载会清理临时目录，失败
仍弹 `Update failed`。为什么发 0.3.6：0.3.5 的更新器没有可见进度，用户点击
`Download` 后只能等待静默替换，无法判断是否卡住。

门禁：desktop native-test、`npm run desktop`、`desktop:smoke`；`0.3.6` 的
ZIP/DMG/SHA256SUMS 见 GitHub Release。桌面产物未签名，首次打开需右键 →
打开绕过 Gatekeeper。

## Release 0.3.5 (2026-11-17)

范围：`v0.3.4` 之后的 UI 体验版，无后端行为变更。三笔功能性提交：
① `e39269e` v3 调色板抬升 + 统一动效系统；② `e8e052b` v4 Catppuccin
清新护眼可爱主题（暗色 Mocha、浅色 Latte、Rose accent）；③ `65396bb`
排版与交互打磨（全局键盘焦点环、行高/字号层级、PrBoard 交互与空态文案）。
本版用于把 11-17 凌晨的 UI 变更正式发到桌面端；不是文档更新。

门禁：lint / typecheck:server / **1092 tests / 60 files** / build /
**E2E 162/162**；desktop native-test、`BUNDLE_NODE=1 desktop:dist`、
`desktop:smoke`、SHA256SUMS / ZIP / DMG 复核通过。桌面产物未签名（无
`APPLE_SIGNING_IDENTITY`），首次打开需右键 → 打开绕过 Gatekeeper。

## Release 0.3.4 (2026-11-16)

范围：修复 0.3.3 桌面端实测发现的仓库选择器缺陷——下拉菜单渲染在 40px 高、
`overflow: hidden` 的 `.repo-select` 包装层与横向滚动的工具栏内，导致选项几乎全部
被裁剪。`Dropdown` 现在通过 `createPortal` 把菜单挂到 `body`，固定定位锚定触发
按钮；下方空间不足时向上翻转，窗口 resize / scroll 时重新定位；外部点击与 blur
判定同时检查触发器和菜单。`.repo-select` 样式改为作用于触发按钮，去掉双层边框。

新增回归测试 `src/components/Dropdown.test.tsx`（2 条：portal 在裁剪容器外、点击
选项回传并关闭）。门禁：lint / typecheck:server / **1092 tests / 60 files** /
build / **E2E 162/162**；desktop native-test、`BUNDLE_NODE=1 desktop:dist`、
`desktop:smoke`、SHA256SUMS 复核。浏览器实测：工具栏下拉 5 个选项完整可见、
选择后触发器与仓库视图同步切换。

## Release 0.3.3 (2026-11-16)

范围：Dashboard 新增 **Cards / List** 视图切换（选择持久化到
`pr-helper-git:dashboard-view`），列表按 Repository / Owner / Branch / Status /
Last commit 展示，窄窗口自动隐藏 Owner 与 Last commit 列；卡片与列表共用同一套
状态徽章——铅笔 + 未提交文件总数（tooltip 拆分 staged / modified / untracked）、
↑ 本地未推送提交数、↓ 远端未拉取提交数、冲突数、开启 PR 数与 clean 状态。
`RepoBrief` 数据结构未变，纯客户端改动。

门禁：lint / typecheck:server / **1090 tests / 59 files** / build / **E2E 162/162**；
desktop native-test、`BUNDLE_NODE=1 desktop:dist`、`desktop:smoke`、SHA256SUMS 复核。
浏览器实测（隔离实例 + 3 个 fixture 仓库）：wip 显示铅笔 3、sync 显示 ↑1 ↓1、
clean 显示 clean，List 视图 3 行正常。

## GitHub Device Flow + A2A（2026-11-15，D-020/D-021）

用户把两项“有意不迁移”能力重新拉入范围：GitHub App OAuth 登录、A2A / Agent Card。

- **D-020 Device Flow**：现有 App 的 `GITHUB_APP_CLIENT_SECRET` / `PRIVATE_KEY` / `AUTH_SESSION_SECRET` 均为 Vercel `[SENSITIVE]` 占位，且 Device Flow 未启用，因此不用授权码回调；`github.com` 直连超时，新增 `server/github-http.mjs`（`HTTPS_PROXY` 优先、macOS 回退 `scutil --proxy` 的 CONNECT 隧道），仅服务两个 OAuth 端点。`server/github-oauth.mjs` 提供 start/poll/status/installations/logout；user token 存 `config.github.oauth`（0600），只做身份与安装/仓库发现，写操作仍走 PAT/引擎。`/api/pat` 改为合并 `config.github`，避免覆盖 oauth。
- **D-021 A2A 真接线**：`server/a2a.mjs` 提供公开 Agent Card（`/api/a2a/agent-card` + `/.well-known/agent-card.json`/`agent.json`）与 fail-closed JSON-RPC（`PR_HELPER_GIT_A2A_TOKEN`，legacy `ZEUS_A2A_TOKEN`，或 Settings 生成、仅存 SHA-256 哈希的 token，env 优先）。plan 默认；execute 经 `enqueueWorkflowAutomationAction` 入队 create-pr/merge-pr、直调 `rerunFailedActions`、只读部署投影；merge 需 `confirm=true`，production-rollback 永远 `input-required` 升级。任务内存 30 分钟 TTL；execute 写本地审计 `a2a.execute`。
- **UI**：SettingsModal 新增「GitHub account」（设备码/复制/浏览器打开/轮询/断开/安装列表/有效期与过期重连）与「A2A / Agent Card」（configured/source/hint、生成/重新生成/撤销 token、明文只显示一次、卡片 URL、技能列表）；文案中英双语补齐（i18n 字典门禁）。
- **验证**：`npm test` 1089/59、`npm run e2e` 162/162（新增 7 条）、lint/typecheck:server/build 通过；Device Flow 的 `device_flow_disabled` 作为明确错误透传。
- **实网验证（2026-11-16）**：**A2A 通过**——Settings/API 生成 token（config 仅存 SHA-256 哈希，明文不落库），无 token POST 返回 401；带 token 的 `create-pr` plan 返回 `completed`；`deployment-health` execute 返回 1 workflow / 2 deployments / 8 runs；审计记录 `a2a.token.generate` 与两条 `a2a.execute`。**Device Flow 受阻**——GitHub App 已启用 Device Flow，本地也成功拿到设备码，但 GitHub 授权确认页的 `Authorize` 按钮为 `disabled`，页面顶部是 2FA 强制提示（账号未启用 2FA / 会话状态陈旧）；未绕过安全按钮。需用户在 GitHub 启用 2FA 或重新登录刷新会话后重试。
- **实网待办（需用户）**：① GitHub 启用 2FA 或重新登录后，Settings → GitHub account → Connect 完成一次授权；② 已完成，token 明文在 `~/.pr-helper-git/a2a-token.txt`（0600，建议复制后删除）。
- 图拖拽按用户裁决暂不做，保留后续再议。

## 生产巡检（2026-11-16，14 个受管仓库）

数据源：本地引擎库 `pr_helper_workflows.repository` 去重，得到 14 个受管仓库：
agent-dev / agent-world / atlas / bayjf / commerce-os / growth-agent / growth-os /
job-agent / loom / model-hub / ops-console / pr-helper / pr-helper-git / zeus。

- **开放 PR：14 个仓库全部为 0**。`pr-helper-git` 的自动化 PR #12（docs）已于
  11-15 16:08Z 合并为 `c0712ab`，本地 `main`/`dev` 已同步，合并后的 main push
  CI（run 43733749957）test + desktop 均 success。
- **CI：13 个仓库默认分支最新 commit 的 check-runs 全绿**，最近 5 次 workflow
  runs 无失败；`atlas` 在 11-12 的 dev 上各有一次 failure/cancelled，已被后续
  success 覆盖。
- **唯一异常 `bayernjf/agent-world`**：自托管生产 runner `agent-world-prod` 离线。
  `Production runner watchdog` 于 11-15 17:36Z / 22:36Z 两次失败；
  `Deploy production` 于 11-15 15:29–15:48Z 连续 4 次失败，日志均为
  `production runner: agent-world-prod -> offline` / `0 online production runner(s)`。
  仓库自身 CI 与 CodeQL 仍为 success。处置：重新上线该 runner，或触发
  `Deploy production` 时传 `target=hosted` 走 hosted build-only 兜底。

## Release 0.3.2 (2026-11-15)

范围：两项新能力随正式发行——① GitHub App Device Flow 身份连接（identity-only，
token 0600 落 config，永不回传）；② A2A / Agent Card + JSON-RPC 真接线（fail-closed
bearer；execute enqueue 引擎动作；production-rollback 永远升级）。同时包含 Settings
的 A2A token 生成/撤销（只存 SHA-256 哈希，明文一次）、GitHub 连接有效期/过期提示、
`github.com` OAuth 端点代理客户端，以及 `/api/pat` 与 `github.oauth` 互不覆盖的修复。

门禁：lint / typecheck:server / **1089 tests / 59 files** / build / **E2E 162/162**；
desktop native-test、`BUNDLE_NODE=1 desktop:dist`、`desktop:smoke`、SHA256SUMS 复核。
实网 Device Flow 需用户在 GitHub App 设置启用后走查；A2A 可在 Settings 生成 token 后
用 curl 走 plan/execute 各一次并核对 `a2a.execute` 审计（验收 #1 暂保持 🔀，实网通过
后再转 ✅）。

## Release 0.3.1 (2026-11-15)

范围：两个桌面修复随正式发行出去——① 生产 npm 依赖闭包入 bundle（修
`/Applications` 安装后启动即崩）；② 更新检查 403 直连回退 + 资产/校验和
space→dot 归一化（修应用内更新在系统代理环境下必失败）。含冒烟真实启动断言
与 UpdateFetchTest（stub + 变异证明 + 可选 live）。v0.3.0 的 dmg/zip 为坏
bundle，0.3.1 产物为修复后首批可分发 artifact（BUNDLE_NODE=1，内含官方 Node 22）。
发布前 dev 与 origin/main 因 PR #7/#8/#9 的 merge commit 偏离，已用普通 merge
集成（不重写已 push 的 dev 历史）。门禁：1040/55、E2E 155/0、native-test
（含 update-fetch stub）通过；`BUNDLE_NODE=1 desktop:dist` 产出 0.3.1 dmg/zip
（内含官方 Node 22.23.5，未签名），`BUNDLE_NODE=1 desktop:smoke` 通过，
SHA256SUMS 经 `shasum -a 256 -c` 独立复核 OK。

发布执行：dev 四提交（`477b78d`/`010e4d6`/`25df6cd`/`01774b1`）推送后由
pr-helper 自动化开 PR #10；标题/描述重写覆盖全部 hash 与实测数字后 CI
（test×2、desktop×2）全绿，**由自动化合并**（merge commit `1eb3db7`，非
本地执行）。annotated tag `v0.3.1` 打在 release commit `01774b1`。GitHub
Release v0.3.1 已发布，仅含 0.3.1 三资产（dmg/zip/SHA256SUMS；GitHub 侧
资产名为 dot-sanitized，大小与本地一致，上传前 `shasum -c` 复核）。本地
`/Applications` 已替换为 0.3.1 并验证：server 跑 bundle 内置 Node
22.23.5，loopback 入口 200、无 token 401（鉴权正常）。备份
`source-20261115-2155.bundle` heads：main=dev=`1eb3db7`、含 `v0.3.1`。

教训（备份带旧 main）：备份脚本打的是**本地 refs**，自动化在远端合并
不会移动本地 `main`——首次备份 bundle 里 main 仍是 `60e256f`。发布后备份
前先 `git fetch origin main:main`（AGENTS.md 第 8 步已更新），再核验
bundle heads。旧 0.3.0 app 暂存 `/tmp/pr-helper-git-0.3.0-old.app` 可回滚。

## Desktop bundle dependency fix (2026-11-15)

用户报「app 启动报错」。根因：迁移引入 `postgres`/`web-push` 运行时依赖后，
`scripts/desktop-build.mjs` 仍只复制 `server/` + `dist/`，装到 `/Applications`
的 bundle 以 `ERR_MODULE_NOT_FOUND: postgres` 秒退，shell 弹 "Local server
stopped"。**自迁移起所有桌面构建均带此缺陷**；dev/launchd 正常是因为跑在仓库
树内。修复：构建用 `npm ls --omit=dev --all --parseable` 计算生产闭包并拷入
`Resources/app/node_modules`（21 包，bundle 1.5MB → 14MB）。

教训（冒烟假绿两层）：旧 `desktop:smoke` 只做 `node --check`（不解析导入）；
加上真实启动后仍假绿——在 `build/` 内启动时 Node 沿目录向上命中**仓库的**
`node_modules`。现冒烟先把 app 拷到仓库外临时目录、用隔离 `PR_HELPER_HOME`
真实启动并断言 READY，且已对坏 bundle 证明其会红。注意：GitHub v0.3.0 的
dmg/zip 是坏 bundle，已随 v0.3.1 重新发布（release notes 顶部要求覆盖安装）。
门禁：1040/55、E2E 155/0、
desktop native-test/smoke 通过。

同日续：应用内更新检查报 403。根因两层：① URLSession 走系统代理
（127.0.0.1:7900），共享出口 IP 的 GitHub 未认证配额（60/h/IP）被耗尽→403，
直连 IP 配额充足→200；② 即使过了 403，GitHub 上传资产名把空格 sanitise 成点
（`PR.Helper.Git-0.3.0-macos.dmg`），与带空格本地名精确匹配必落空，SHA256SUMS
条目 likewise。修复：403 时用 `connectionProxyDictionary = [:]` 的会话直连重试
一次；资产/校验和匹配按 space→dot 归一化（`githubSanitized`）；错误弹窗附
GitHub 原文。下载链路仍走系统代理（直连 github.com/releases/download 被墙，
HTTP 000；代理 200）。证明：新增 `desktop/UpdateFetchTest.swift`（POSIX socket
stub 以 absolute-form/origin-form 区分代理与直连；NWListener 在本机 macOS 27
返回 EINVAL 不可用），对删除回退分支的变异体证明会红；`PR_HELPER_UPDATE_LIVE=1`
用生产会话对真实 GitHub 走通 403→直连→资产解析。

## D-002-v2 功能缺口复审（2026-11-14）

用户纠正：“pr-helper-git 产品自身不上生产、不部署到 Cloudflare/Vercel”不等于“不管理
其他仓库的部署”。D-002 把两者混为一谈，导致核心部署门禁/健康检查/确认式回滚被裁。
复审同时发现：换仓库 #7/#8 是非云依赖的误裁；归档/静音、流程预检、PR 引用复制、
flows 审计 UI+CSV、同步健康度、团队 UI、运行历史仍未完成。以上不是“云基建替代”，
不能计入迁移完成。

已落文档：`docs/pr-helper-migration.md`（D-002-v2、范围、矩阵、Phase 3.5、DoD、风险 R8）、
`docs/migration-acceptance.md`（#1 改替代、#7/#8 与 #21/#22/#23/#30/#31 转 ⬜、统计修正）、
`docs/phase5-runbook.md`（切换前置）、`AGENTS.md`（部署门禁不再列为禁区）。代码未改；
下一步从 P3-10 开始。

## P3-12 / P3-14 / P3-16 回补（2026-11-14）

- P3-12：`FlowBoard` lane 增加归档/恢复（确认弹窗，归档后进入 Archived 筛选，可恢复）与静音/取消静音（仅影响通知徽标/suppression，不阻断自动化）；`FlowDetail` 新增「Recent runs」，按 workflowId 从 inbox 44 条 run 中取前 10（实测 zeus #192/#55）。写路径复用 `PUT /api/flows/workflows` → `upsertWorkflow`（archive transition + muted 列）。
- P3-14：新增 `FlowAuditModal`（`GET /api/flows/audit` 500 行、文本筛选、CSV 导出；`flowAuditCsv` 4 单测），FlowBoard「Sync health」接 `syncHealth`（last reconcile/stale stage/webhook 24h），新增 `PullReference` 统一 PR 引用 tooltip + 复制（看板/详情/抽屉/失败中心）。
- P3-16：FlowEditor 既有流程步骤默认折叠、新建默认展开、add step 后全部折叠；FlowBoard 详情返回目标 lane `.is-return-highlight` 1.6s 后清除。
- 验证：lint/typecheck:server 通过；`npm test` **1006/49**；`npm run build` 通过；真实 UI 走查归档计数 0→1→0、确认删除 15→14、静音徽标往返、审计 CSV 90,686 bytes、PR 引用悬停/复制、折叠 body 0→1→0、返回高亮 YES×12。

## P3-10 / P3-11 回补（2026-11-14）

- 后端：`server/workflows-store.mjs` 新增 `listDeploymentOptions`（GitHub App 凭据列目标仓库 active Actions workflows + Environments；凭据缺失返回 `actionsAvailable=false` 而非炸板）与 `retryDeploymentRun`（只允许 `workflow_stage_deployment_runs.state='failure'`，`POST /actions/runs/{id}/rerun` + stage event + `deployment-rerun` 审计）；`server/flows.mjs` 新增 `GET /api/flows/deployment-options`、`POST /api/flows/deployment-rollback`、`POST /api/flows/deployment-retry`。
- 前端：`src/api/flows.ts` 部署类型/client；`FlowEditor` 部署列表/警告/添加/编辑/移除/撤销/sync/suggestion/datalist/高级字段，仓库字段可编辑 + 确认后 `createWorkflow` 转新建；`StepDrawer` 部署卡（provider/environment/run/health/failure summary/failed job/open site/logs）、失败 run retry、最近 8 次 run、成功 run 确认式 rollback；`FlowBoard` 新 id 追加并选中。
- 验证：`npm run lint`、`npm run typecheck:server`、`npm test` 1002/48、`npm run build` 通过；路由测试覆盖 options 400、rollback/retry 参数 400 与成功透传。真实回滚/重跑与 Environment 列表仍待 P2-1 GitHub App 凭据 + 真实部署 run；`workflow_stage_deployment_runs` 当前为 0。

## Credentials D-006-v3 (2026-11-14)

vercel env pull proved the App private key is Sensitive-locked (12 keys
unpullable), so the engine gained a GITHUB_TOKEN PAT fallback at the
installationRequest seam. Local credentials live in
`~/.pr-helper-git/credentials.env` (0600; loaded at server boot; never in
git). The cloud pr-helper was untouched — read-only pull only. This unblocks
P2-1 and the Phase 5 shadow period.

## Local migration protocol + auto-advance fix (2026-11-14, D-015)

The faithful schema replay carried over a legacy pr-helper gap: the
auto-advance stage flag had no storage column (confirmed live — the cloud
toggle drops on refresh). Local fix: migration 048 in
`scripts/migration/local-migrations/` (first use of the local-increment
protocol — snapshot stays frozen, column-level additions don't affect the
table-set check) plus store read/write round-trip (3 tests). The cloud
pr-helper is NOT patched: frozen, retiring, and the shadow comparison is
driven by create/merge which persist fine.

## AI credential + rules wiring (2026-11-14, M-E5 tail)

The two business gaps found under the owner's acceptance frame (code
migration done, acceptance = no functional loss) are closed:
`/api/flows/ai-credentials` (GET/POST/DELETE/test-saved) drives the
migrated credential functions; `/api/flows/rules` lists the migrated
generation rules; the FlowEditor gained an AI credential card and pins a
library rule when enabling auto-create. The stale encrypted credential row
(old key unpullable) was cleared — the owner re-enters the AI key once.
A disposition summary section (6.0) records migrated vs not-migrated with
decision references.

## Feishu channel deferred (2026-11-14, D-017)

Feishu failure notifications are not enabled for now (owner verdict) and do
not block the migration — macOS local notifications satisfy DoD #5's main
body; the channel code stays ready (set PR_HELPER_GIT_FEISHU_WEBHOOK to
enable anytime).

## Switch/retire approval rule (2026-11-14, D-016)

Every P5-2 switch and P5-3 sunset action requires the owner's explicit
approval before execution (item-by-item: restate → approve → execute →
report). Shadow-period consistency alone is not an execution authorization.
Recorded in docs/phase5-runbook.md and the migration ledger.

## Test-repo iron rule (2026-11-14)

Owner directive: no new test repositories (GitHub or local) without explicit
approval; product-feature testing reuses repos from `TEST-REPOS.md`, which
is the single source of truth. Recorded in AGENTS.md Non-negotiables and the
registry header.

## Desktop single-instance guard (2026-11-14)

Second launches (double-click, launcher, direct binary) now activate the
running app and exit before spawning a second loopback server
(`NSRunningApplication` check in `desktop/main.swift`, verified live).
The rebuilt bundle carries the migrated web UI (Flows etc.); the user
should restart the currently open desktop app once to pick it up.

## Rename completion (2026-11-12)

The product repository is now `bayernjf/pr-helper-git` (PUBLIC, default branch
`main`); the old repository of the same name is `bayernjf/pr-helper-git-archive`
(PRIVATE, archived). The local checkout is `/Users/jiangfeng/000mycodes/pr-helper-git`
and pushes to `git@github.com:bayernjf/pr-helper-git.git`.

Runtime identifiers were renamed with one-shot migrations:
- data dir `~/.pr-helper-git2` -> `~/.pr-helper-git` (rename on first boot when
  the new dir is absent); current real dir is 0700, files 0600;
- localStorage namespace `pr-helper-git:*`, including pinned, draft, diff font,
  prefs, dashboard, active repo, browser PAT, commit history and clone parent;
- auth cookie `git2_token` -> `pr_helper_git_token`, with legacy cookie/header
  fallback; env vars `GIT2_*` remain readable as fallbacks;
- Tauri bundle id and download filename follow the new name.

Verification: lint, `typecheck:server`, 336 unit tests / 34 files, production
build, and E2E 144/144. CI is green through release commit `72e206a` (run `43253045248`, test + desktop).

The desktop shell was **frozen** at the time of this rename; it was unfrozen
later on the same day (see “Desktop unfrozen” below). The old Qoder session copy
under the `pr-helper-git2` project key was archived to
`000mycodes-backups/qoder-project-pr-helper-git2-20261112.tar.gz` and removed;
the new session key has the equivalent 2,836-record transcript.

Backups: `pr-helper-backup.sh` now targets the renamed checkout/data dir,
redacts secret fields, and pins `main`/`dev`/tags explicitly so the bundle HEAD
does not depend on the currently checked-out branch. The latest
`000mycodes-backups/pr-helper-git/source-*.bundle` is verified as a complete
history; check `git bundle list-heads` for the exact main ref.

## Release 0.3.0 (2026-11-15)

`package.json` / `package-lock.json` at **0.3.0**; `CHANGELOG.md` carries the
`[0.3.0]` section; `v0.3.0` is an annotated tag on the release commit.

Scope: pr-helper 自动化控制塔迁移主体收口（Phase 0–3.5 全部关闭）。把被归档
pr-helper 的全部业务功能迁入本地：Flows 顶层视图（Lane board / 详情 / 抽屉 /
编辑器 / 失败中心 / 归档静音 / 审计 CSV / 同步健康度 / 只读预检 / 团队四角色）、
本地自动化引擎（OrbStack Postgres + 幂等队列 + drain + 对账 + 触发器三通道 +
AI 接管 + 部署门禁 + 影子模式）、launchd 常驻、失败通知（macOS + 可选飞书）。

Gates: lint, server typecheck, **1040 unit/route tests / 55 files**, build,
E2E **155/155**。真实外部副作用已验证：P2-3 自动建 PR/合并 + advance-stage、
P2-6 AI 失败接管、PR Close/Reopen/Merge（Approve/Request-changes 因 GitHub
平台"不能 review 自己 PR"约束转验收口径：产品正确透传 422 错误 + COMMENT 走通）。

详见迁移台账 `docs/pr-helper-migration.md` 与验收映射
`docs/migration-acceptance.md`（34 项全部有结论：✅33 + 🔀1；除认证形态替代 #1 外无开放式失败项）。

## Release 0.2.6 (2026-11-12)

> **发布状态（2026-11-12 更新）**：draft 已 publish 为正式版（draft=false,
> prerelease=false, `releases/latest` = v0.2.6 — 应用内 Check for Updates
> 的"有更新"分支自此可实测）；dev 与 main 均在 0.2.6 + jsdom pin
> （266c039，测试计数在 Node 20/26 漂移下稳定为 337/34）。


`package.json` / `package-lock.json` are at **0.2.6**; `CHANGELOG.md` has the
`[0.2.6]` section. `v0.2.6` is an annotated tag on this release commit.

Scope: optional bundling of the official Node `22.23.5` macOS runtime
(`BUNDLE_NODE=1`), a lightweight **Check for Updates…** app-menu action backed
by GitHub `releases/latest`, separate signing of the nested Node with JIT
entitlements, a bundled-Node smoke check, and macOS CI exercising the bundled
distribution path.

Gates: lint, server typecheck, 337 unit tests / 34 files, build, E2E 144/144;
`desktop:native-test`, `BUNDLE_NODE=1 desktop:dist`, `BUNDLE_NODE=1
desktop:smoke` and `SHA256SUMS` verification. The app bundle reports
`CFBundleShortVersionString = 0.2.6`, contains Node `22.23.5` arm64, and is
about 114 MB. Launching it produced a server child process running from
`Contents/Resources/runtime/node`, not the system Node.

GUI: clicking **Check for Updates…** opened a native alert reading
`No releases found`, because no GitHub Release was published yet. The
“newer version” branch stays unverified until the first release exists.

Artifacts under `build/release`: `PR Helper Git-0.2.6-macos.zip` (36 MB),
`PR Helper Git-0.2.6-macos.dmg` (41 MB) and `SHA256SUMS`; all unsigned. No
Developer ID certificate or notary profile was available, so the nested-Node
signing path and notarization were not exercised.

## Release 0.2.5 (2026-11-12)

`package.json` / `package-lock.json` are at **0.2.5**; `CHANGELOG.md` has the
`[0.2.5]` section. `v0.2.5` is an annotated tag on this release commit.

Scope: desktop shell unfreeze (Swift `WKWebView`, no Electron/Tauri), native
folder picker feeding the existing Add repository modal, `WKDownload`
handling into `~/Downloads` with collision suffixes and Finder reveal, the
`desktop:dist` zip/dmg/`SHA256SUMS` pipeline with signing/notarization hooks,
the macOS 11.3 deployment target fix, desktop artifacts moved under `build/`,
macOS CI and headless download/bundle tests, and the distribution/handoff
documentation. Gates: lint, server typecheck, 337 unit tests / 34 files,
build, E2E 144/144; `desktop:native-test`, `desktop:dist`, `desktop:smoke`
and `SHA256SUMS` verification. GUI click-through verified the folder picker
prefill, first export, `-2` collision suffix and Finder reveal.

The local `build/release` artifacts are unsigned; no Developer ID
certificate or notary profile was available, so signing/notarization was not
exercised.

## Release 0.2.4 (2026-11-12)

`package.json` / `package-lock.json` are at **0.2.4**; `CHANGELOG.md` has the
`[0.2.4]` section. `v0.2.4` is an annotated tag on this release commit.

Scope: server path/credential/allowlist hardening, explicit `stage-all`
action, POST-only write routes, the `src/api.ts` per-domain split, further
UI subcomponent extraction, review-found frontend fixes and remaining i18n
coverage. Gates: lint, server typecheck, 336 unit tests / 34 files, build,
E2E 144/144; CI covers both `main` and `dev`.

## Documentation entry points (2026-11-12)

Added `AGENTS.md` (agent contract: branches, local-push policy, frozen
desktop, runtime identifiers, gates, release checklist, backup rules),
`CONTRIBUTING.md` (human/agent workflow) and `docs/README.md` (document map).
README now points to all three and corrects stale claims: the API client is
`src/api/` rather than `src/api.ts`, the repository has a GitHub remote and
CI runs on `main`/`dev`, and the documented environment variables use the
`PR_HELPER_GIT_*` names with legacy `GIT2_*` aliases.

Known caveat at the time: the shell matched only the legacy `GIT2_READY`
prefix while the server emitted `PR_HELPER_GIT_READY`. That mismatch was fixed
in the following desktop-unfreeze pass; the shell now accepts both prefixes.

## Desktop unfrozen (2026-11-12)

The desktop shell is maintained again. Scope for the first pass: keep the
Swift `WKWebView` shell (no Electron/Tauri), keep product behaviour in the
React client and Node server, and make the current app build against the
current release.

- The shell now sets `PR_HELPER_GIT_DESKTOP=1` and the legacy
  `GIT2_DESKTOP=1`, and accepts both `PR_HELPER_GIT_READY` and legacy
  `GIT2_READY` readiness lines.
- Added standard macOS menus (app, File, Edit, View, Window), a 900×600
  minimum window size, and external-link handling: non-localhost URLs open in
  the default browser instead of replacing the app view.
- Added **File > Open Repository…**: `NSOpenPanel` selects a folder and sends
  the path through the existing `git2:add-repo` event, so the web modal keeps
  owning registration rather than a second native flow.
- Added `WKDownloadDelegate`: web downloads (team config export and similar)
  land in `~/Downloads`, get a numeric suffix on name collisions, and reveal
  in Finder when finished. Minimum system is macOS 11.3 for this API.
- `scripts/desktop-build.mjs` now reads `CFBundleShortVersionString` from
  `package.json` (0.2.4 at this point) instead of the stale `0.1.0` literal.
- Added a server-render test for the desktop folder-picker prefill; unit
  baseline moved from 336 to **337 tests / 34 files**. Full gate: lint, server
  typecheck, 337 unit tests, build, E2E 144/144; desktop build and startup
  smoke also pass.
- Added `npm run desktop:dist`: zip + dmg + `SHA256SUMS` under
  `build/release/`. It signs with hardened runtime when
  `APPLE_SIGNING_IDENTITY` is set and notarizes/staples both artifacts when
  `APPLE_NOTARY_PROFILE` is set. `DESKTOP_BUNDLE_ID` switches the bundle id
  for distribution.
- Added `docs/desktop-distribution.md` for certificate setup, `notarytool`
  keychain profiles, verification and manual publishing.
- Extracted download destination naming into `desktop/DownloadDestination.swift`
  and added a headless Swift test for collisions, extensionless names,
  path-traversal input and the empty-name fallback.
- Added `desktop:smoke`, which verifies Info.plist version/bundle id, minimum
  system, icon, bundled client/server and the Mach-O executable without
  launching the GUI.
- CI now has a macOS job: native download test, unsigned `desktop:dist`,
  bundle smoke, and `SHA256SUMS` verification.
- Fixed the deployment target stamp: Swift compiled against the current SDK
  was producing `minos 27.2` while Info.plist promised 11.3. The build now
  passes `-target` and `MACOSX_DEPLOYMENT_TARGET=11.3`; `desktop:smoke` fails
  if the binary minos and `LSMinimumSystemVersion` disagree.
- `npm run desktop` builds `build/PR Helper Git.app`; the bundle starts the
  bundled server and was smoke-tested on this machine.
- GUI click-through on 2026-11-12: **File > Open Repository…** opened
  `NSOpenPanel`, selected `/Users/jiangfeng/000mycodes/pr-helper-git`, and
  prefilled that exact path in the existing Add repository modal. **Team >
  Export team config** wrote `~/Downloads/pr-helper-git-team.json`; a second
  export wrote `pr-helper-git-team-2.json` and Finder selected the new file.
  The exported JSON contained the repository registry and members only, with
  no tokens or GitHub PATs.

Still open for desktop: a real signed/notarized release needs a Developer ID
and Apple notary account.

Desktop artifacts live under `build/` (not `dist/`), so `npm run build` (Vite)
no longer wipes `PR Helper Git.app` or `release/`.

## Post-0.2.2 hardening (2026-11-11)

Security pass after the code review: admin-only server PAT/AI settings, no
server-PAT inheritance for members, sensitive-path guards on stage/commit/
move/remove/clean/stash/AI, 0700/0600 data permissions, serialized config
writes with corruption backup, cloned-URL audit sanitization, watcher
reconciliation after registry changes, and a dev-mode non-loopback bind guard.
Light-theme legacy tokens now alias the shared design tokens. `routes-git.mjs`
is now a 100-line dispatcher (repo guard + AI routes) over `routes-git-helpers`,
`routes-git-meta`, `routes-git-read` and `routes-git-write`; the write module
itself fans out to worktree / refs / history / files / network / stash. Unit suite is
336 tests / 34 files; E2E is 144 checks and is now part of CI. Server
`checkJs` is gated by `npm run typecheck:server` (`tsconfig.server.json`).

## Release 0.2.2 (2026-11-11)

`package.json` / `package-lock.json` are at **0.2.2**; `CHANGELOG.md` has the
`[0.2.2]` section and a fresh `[Unreleased]`. The repository is tagged locally
as `v0.2.2`. No remote was configured at release time, so the tag was local-only then;
it is now published — all three tags verified on the public
`bayernjf/pr-helper-git` remote on 2026-11-11.

Scope: server-side PAT storage; destructive-scenario E2E coverage (115 -> 136);
this repository is now the sole primary implementation, with `pr-helper-git`
archived.

## Release 0.2.1 (2026-11-10)

`package.json` / `package-lock.json` are at **0.2.1**; `CHANGELOG.md` has the
`[0.2.1]` section and a fresh `[Unreleased]`. The repository is tagged locally
as `v0.2.1`. No remote was configured at release time, so the tag was local-only then;
it is now published — all three tags verified on the public
`bayernjf/pr-helper-git` remote on 2026-11-11.

## Release 0.2.0 (2026-11-10)

`package.json` / `package-lock.json` are at **0.2.0**; `CHANGELOG.md` has the
`[0.2.0]` section and a fresh `[Unreleased]`. The repository is tagged locally
as `v0.2.0`. No remote was configured at release time, so the tag was local-only then;
it is now published — all three tags verified on the public
`bayernjf/pr-helper-git` remote on 2026-11-11.

## Interaction contract (2026-11-10)

`ToastProvider` and `ConfirmProvider` are the shared contract for both clients:
toasts last 3.6 s and carry a kind icon (`toast-info` / `toast-success` /
`toast-error`); confirmations use `aria-labelledby` / `aria-describedby`, accept
`{ danger, confirmLabel }`, and use `btn-danger` only for destructive actions.
Never call `window.confirm` — `DashboardPage` now uses `useConfirm()` too.

**Current target: web-first, desktop maintained.** Desktop was unfrozen on
2026-11-12. The shell stays thin: features target the browser UI, while Swift
owns only windowing, process lifetime and macOS integration. `desktop/main.swift`
and `npm run desktop` are active again; see “Desktop unfrozen” at the top.

## Scope

- GitKraken-like: repo registry, commit graph, refs (branches/tags/stash),
  stage/unstage, commit, amend, checkout, branch create/rename/delete, merge,
  reset (soft/mixed/hard), fetch/pull/push, clone and init (three-mode add
  dialog), tag create/delete (lightweight + annotated), remote branch
  push/delete, stash, unified + split diff viewer, folder-tree working panel,
  commit graph search, paginated history (load more), right-click context
  menu, keyboard shortcuts, resizable work panel, responsive layout,
  error boundary, loading states, SSE live refresh, safe revert (new commit,
  merge commits rejected, conflicts preserved with continue/abort instead of an
  automatic abort), add-to-.gitignore,
  push tag, history scope (all vs current branch), Cmd+K command palette,
  blob file viewer (working tree or any ref, binary detection, size cap),
  git blame (per-line author/commit, porcelain parser), git clean (dry-run
  preview then force-remove untracked, ignored files untouched), remote
  add/remove with name and URL validation, per-file history (follow a path
  across commits and jump to any revision), branch ahead/behind badges,
  stash patch viewer, copy commit hash, Escape to close every dialog,
  reference log (reflog) viewer, fetch with prune, stash with message and
  include-untracked, remote set-url editing, annotated tag details,
  two-reference comparison (ahead/behind commits and renamed-aware file
  diff with stats), branch set-upstream, remote rename, sidebar ref filter,
  ignore-whitespace diff toggle, merge strategies (default/no-ff/ff-only/
  squash) with a dedicated picker, smart remote-branch checkout that creates a
  tracking local branch (no detached HEAD), configurable diff context lines
  (--unified), empty commits (--allow-empty), and branch creation without
  switching (no-checkout), untracked-file diffs via `--no-index`, rebase
  state detection with continue/abort, and server-side author/message/date
  history filters, in-app audit log viewer (JSONL reader with success/failure
  markers, raw details, server-side text/outcome filters over the whole
  retained file and no-match empty state),
  in-app text-file editing with validated atomic saves
  (sensitive/NUL/1 MB guards), mtime-based stale-save rejection (409 with
  the draft preserved), audit log rotation (1.5 MB trigger, 1 MB / 10,000
  entry retention budget, atomic rewrite), and a 413 response for oversized
  request bodies with explicit keep-alive timeouts, per-hunk staging
  (server-side diff splice + `git apply --cached`, `MM` partial status,
  unstage via reverse apply), per-hunk discard (reverse apply to the
  working tree, index untouched), and editor keyboard shortcuts (Cmd/Ctrl+S
  save, Tab/Shift+Tab indent), a light theme with a persisted toggle
  (GitHub-style light token set, FOUC-free first paint), PR board filtering
  (number/title/author/branch/label/draft across every column), in-app new
  file creation (nested paths auto-create parent directories, then opens in
  the editor), and repository git config management (local/effective values
  for a whitelisted set of keys with per-type validation and unset-to-inherit),
  draggable sidebar and detail column widths (pointer and keyboard resizing,
  min/max clamps, persisted widths, ARIA separator role), and
  prefers-reduced-motion support (animations and transitions collapse to a
  near-instant state change).
- Desktop (macOS, zero third-party runtime) — **maintained since 2026-11-12**:
  a `swiftc`-compiled `WKWebView` shell (`desktop/main.swift`) bundled by
  `scripts/desktop-build.mjs` via `npm run desktop` into
  `build/PR Helper Git.app` (~1.5 MB). It locates the system Node.js at
  well-known paths, spawns the server on an ephemeral port with both desktop
  env names, accepts either readiness prefix, loads the one-time token URL,
  opens external links in the default browser, provides standard macOS menus,
  and terminates the server on window close. The bundle ships a generated
  `AppIcon.icns` (rendered by `desktop/make-icon.swift`, then scaled and
  packaged with the system sips/iconutil tools) referenced through
  `CFBundleIconFile`; the window remembers its frame across launches via
  `setFrameAutosaveName`, and `CFBundleShortVersionString` now follows
  `package.json`.
- pr-helper-like: PR board (open/merged/closed), per-user review state,
  create PR (incl. draft), draft → ready, PR detail with commits/files/checks,
  requested reviewers (view and request), issue comments (view, compose,
  inline edit and delete with confirmation, Cmd/Ctrl+Enter to post), review
  submission (comment/approve/request changes), merge PR
  (merge/squash/rebase), close/reopen, line-level review comments
  (inline composer on diff lines, RIGHT/LEFT side, outdated-comment group,
  threaded replies and edit/delete), and an editable PR description.
  PAT can be stored server-side (`/api/pat`, `hasServerPat`; the value never
  round-trips to clients) and injected into the GitHub proxy; a request-scoped
  `x-github-pat` header remains supported as a fallback.
- Hardening: nosniff on every response, strict CSP and no-referrer on the
  HTML entry, no-store for HTML, immutable long caching for hashed assets.
- Explicitly out of scope (historical — interactive rebase, cherry-pick,
  AI generation and the three-way merge editor listed here have all been
  implemented since): submodules, worktrees, GPG signing, GitHub App,
  webhooks, a database, web push and deploy gates.

## TODO

- [x] Project scaffold, configs, git init
- [x] Server: security, git runner, config store
- [x] Server: git read/write routes
- [x] Server: GitHub proxy
- [x] Server: branch rename, tag create/delete, amend, remote branch routes
- [x] Server: file watcher + SSE live refresh
- [x] Client: app shell, design system and typed API client
- [x] Client: inline SVG icon set and portal context menu
- [x] Client: commit graph, lane layout and live refresh
- [x] Client: ref sidebar with collapsible groups and full actions
- [x] Client: work panel with folder tree, split diff and amend
- [x] Client: PR board with review state, draft and detail view
- [x] Client: GraphQL draft-ready and merge endpoints
- [x] Test repository created, pushed, E2E verified and registered
- [x] Unit tests, build verification, README, atomic commits
- [x] Robustness: error boundary and loading states
- [x] Server: clone, init and reset routes with input validation
- [x] Client: three-mode Open/Clone/Init add dialog
- [x] Client: commit graph search, load more and reset menu
- [x] UX: shortcuts, resizable work panel, PR labels, responsive layout
- [x] Server: revert route (merge guard; conflicts preserved with continue/abort), ignore, push tag, log scope
- [x] Client: revert menu and history scope toggle
- [x] Client: gitignore action and push tag menu
- [x] Client: PR requested reviewers view and request
- [x] UX: Cmd+K command palette with fuzzy filter and keyboard nav
- [x] Third iteration: tests, build, E2E, docs, atomic commits
- [x] Server: file content route (ref-aware, binary detection, size cap)
- [x] Server: blame porcelain parser with unit tests
- [x] Server: clean route (dry-run + force, ignored files protected)
- [x] Server: remote add/remove routes with name/URL validation
- [x] Client: FileViewer with content/blame toggle, wired to work panel and commit detail
- [x] Client: clean button and remote management modal
- [x] Client: PR issue comments list and composer
- [x] Fourth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: file-history and stash-show routes
- [x] Server: branch ahead/behind via upstream:track
- [x] Client: FileViewer history tab with revision jump
- [x] Client: ahead/behind badges, stash patch viewer, copy hash, Escape hook
- [x] Fifth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: reflog route and parser, tag-show route and parser
- [x] Server: fetch prune, stash include-untracked, remote set-url routes
- [x] Client: reflog modal and entry, stash options modal, remote URL editing
- [x] Client: annotated tag details, fetch prune/reflog commands
- [x] Sixth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: compare route (two refs, ahead/behind commits + numstat files)
- [x] Server: branch set-upstream, remote rename, diff ignore-whitespace
- [x] Client: CompareModal with commits/files tabs and toolbar entry
- [x] Client: set-upstream picker, remote rename, sidebar filter, whitespace toggle
- [x] Seventh iteration: tests, build, E2E, docs, atomic commits
- [x] Server: merge strategies (no-ff/ff-only/squash), checkout remote tracking
- [x] Server: diff context lines (--unified), empty commit, branch no-checkout
- [x] Client: MergeModal with strategy picker, API helpers for new params
- [x] Client: diff context selector, empty-commit toggle, no-checkout checkbox
- [x] Eighth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: force push (force/force-with-lease), pull rebase, merge abort
- [x] Server: remote tag deletion, forced tag creation
- [x] Client: force-push confirm, pull rebase, merge abort entry, tag actions and API helpers
- [x] Ninth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: revert merge with mainline (-m), grep, mv, rm, log pathspec
- [x] Client: grep modal, file rename/delete, path filter, revert merge, API helpers
- [x] Tenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: untracked diff (no-index), rebase state, rebase continue/abort, log filters
- [x] Server: GitHub reviews allowlist; client: review composer, LogFilterModal, rebase banner
- [x] Route-level HTTP tests (real server, temp repo, isolated PR_HELPER_HOME)
- [x] Eleventh iteration: tests, build, E2E, docs, atomic commits
- [x] Server: readAudit store helper, GET /api/audit; client AuditModal + entry points
- [x] Server: POST /api/save with validation and atomic rename; client edit mode
- [x] Server: PATCH/DELETE comment allowlist; client inline comment edit/delete
- [x] Server: nosniff/CSP/referrer-policy and differentiated cache policy
- [x] Component render tests (renderToString, mock app context)
- [x] Twelfth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: audit rotation constants and rotateAudit with byte/entry budget
- [x] Server: mtime on /api/file, expectedMtime 409 guard on /api/save
- [x] Server: 413 body-cap response with Connection: close, keep-alive tuning
- [x] Client: FileViewer 409 handling, AuditModal text/outcome filters
- [x] Route tests for audit rotation and save/mtime/413 behavior
- [x] Thirteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: q/outcome query params on /api/audit, filtering over full file
- [x] Client: AuditModal drives server filters with debounced text input
- [x] Route tests for server-side audit filtering
- [x] Follow-up: tests, build, E2E, docs, atomic commits
- [x] Server: splitFilePatch/buildHunkPatch helpers, POST /api/stage-hunk
- [x] Client: DiffView hunk stage/unstage actions wired through runAction
- [x] Server: GET/POST pulls/:n/comments GitHub allowlist entries
- [x] Client: PrFileReview with line anchors, inline composer, outdated group
- [x] Client: FileViewer Cmd/Ctrl+S and Tab/Shift+Tab keyboard handling
- [x] Fourteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: POST /api/discard-hunk, PATCH/DELETE pulls/comments/:cid allowlist
- [x] Client: DiffView discard hunk, PrFileReview reply/edit/delete
- [x] Client: PR description section with inline edit
- [x] Fifteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: watcher filters lock/temp-object noise, exports isNoise
- [x] Client: CommitDetail effect keyed on hash, modal survives background refresh
- [x] Sixteenth iteration: watcher tests, full acceptance, docs, atomic commits
- [x] UI fixes: graph-row overflow, ref-badge horizontal scroll, no-wrap group heads and toolbar, repo-select text color
- [x] Client: commit graph keyboard navigation and listbox/option a11y with roving tabIndex
- [x] Client: global modal focus trap hook with focus return on close
- [x] Client: persistent per-repo UI preferences via localStorage (view, groups, panel height)
- [x] Server: /api/grep-all across every registered repository; client GlobalGrepModal
- [x] Server: /api/revert-batch (merge guard, oldest-first, abort on conflict); client multi-select batch bar
- [x] Client: pin local branches and sort by name or recent tip commit
- [x] Server: /api/commit-template (local/global, absolute home path); client message prefill
- [x] CI: GitHub Actions workflow running lint, test and build; resilient test timeouts
- [x] Client: aria-labels on icon-only controls, keyboard-shortcut help modal (? key)
- [x] Tooling: .nvmrc + engines pin, CI npm audit advisory, react-vendor chunk split
- [x] Server: cleanCommitMessage strips # comments on commit and amend (git strip mode)
- [x] Eighteenth iteration: full 115-test acceptance, build, docs, atomic commits
- [x] Project-level code review: grep option-injection, per-repo panel height
  restoration, graph space-key default, unused shortcut binding, malformed URI
  status (full 117-test acceptance, five atomic commits)
- [x] Capability-gap audit: extracted all API routes and probed for real
  missing features (theme/filter/new-file/config), not name-only matches
- [x] Light theme with persisted toggle; define the missing --bg-elevated
  token (fix) discovered while theming
- [x] PR board filter search across all three columns
- [x] In-app new file creation with auto-created parent directories
- [x] Repository git config management (whitelist, validation, unset)
- [x] Twentieth iteration: full 121-test acceptance, build, docs, atomic commits
- [x] Native macOS desktop shell: GIT2_READY readiness line, Swift WKWebView
  process supervision, desktop-build bundler, shutdown hardening, E2E verified
- [x] UI/UX P0 pass: resizable sidebar/detail columns with persistence and
  ARIA separators, app icon and window frame memory, prefers-reduced-motion
- [x] Hover fix: lift the commit graph SVG above row hover/selected backgrounds
  so lanes and nodes stay visible (pointer-events and text unaffected)
- [x] Path integrity: core.quotePath=false for literal UTF-8 paths, porcelain
  type-2 rename parsing from the first path field, numstat rename resolution
- [x] Server hardening: bounded file reads, grep -z NUL-triple parsing, 120s
  fetch/pull/push timeout, proxied upstream errors, GraphQL timeouts, symlink
  repo roots, expanded sensitive patterns, CSP/cookie/asset-path fixes
- [x] Web async-race guards: stacked Escape handling, sequence tokens on repo
  loads/file lists/patch previews, one-time draft seeding, split-view header
  dedupe, paginated PR board and detail beyond the 30-item window
- [x] Desktop Node discovery across Homebrew/MacPorts/volta/asdf/nvm with a
  server-crash alert; GitHub remote recognition for SSH ports and trailing slash
- [x] Follow-up race guards on audit/compare/grep/PR-detail modals and shortcuts
- [x] Code-quality pass: pure state updaters (no side effects in updaters),
  redundant diff-effect dependency removed, untracked delete wording corrected,
  repo removal without a target rejected with 400, a single EventSource reading
  latest params from a ref, and an SVG favicon
- [x] Multi-repository panel (RepositoriesModal): one filterable list of every
  registered repository showing location, working-tree change counts,
  ahead/behind and the current branch, with an active marker; a row opens that
  repository and checkboxes enable a batch fetch across the selection
- [x] Conflicted multi-step operations keep their state: `detectRepoState()`
  reads `REVERT_HEAD`, revert stops on conflicts with 409 + conflict list,
  `/api/revert/continue` (GIT_EDITOR=true) and `/api/revert/abort` are
  separate actions, and the UI banner offers both
- [x] Minimal conflict resolution: `POST /api/conflict/resolve` accepts
  `ours` / `theirs` / `mark` per unmerged file (refuses non-conflicted paths),
  stages with `git add -A` so deletions count, and returns the remaining
  conflicts; ResolveConflictsModal is reachable from every merge/rebase/revert
  banner
- [x] Split-view pairing and word-level diff: `pairDiffRows()` zips deletions
  with additions inside a hunk, `wordSegmentsByRow()` highlights changed words
  in the unified view, and multi-line changed blocks no longer scatter
- [x] Grep results jump to the file at the hit line and highlight the literal
  search term; regex mode falls back to plain text when no literal match exists
- [x] Commit graph windowing: `windowRange()` mounts only the visible rows
  (8-row overscan), the SVG keeps its full height, `revealRow()` scrolls first
  and focuses on the next frame
- [x] Multi-repository batch pull: `POST /api/repos/pull` pulls registered
  repositories with `--ff-only` sequentially, reports per-repository outcome
  inline, and refuses an empty or unregistered selection
- [x] Ref parsing hardened: `git()` forces `LC_ALL=C` so `%(upstream:track)`
  stays parseable regardless of the machine locale, and `[gone]` upstreams
  surface as a red `gone` badge instead of looking in sync
- [x] Grep filters: `Ignore case` maps to `git grep -i` and a file glob
  (`:(glob)` pathspec) narrows results in both the per-repository and the
  cross-repository modal; invalid globs are rejected with 400
- [x] PR head checkout: `POST /api/pr/checkout` fetches `pull/<n>/head` into
  FETCH_HEAD and creates a local `pr-<n>` branch without switching; existing
  branches are refused with 409
- [x] Web-only decision: desktop development paused, checks limited to
  `npm test`, `npm run lint`, `npm run build`
- [x] M1 team-ready local instance: the startup token is the owner (admin);
  `server/actor.mjs` carries the request identity through AsyncLocalStorage so
  every audit entry records `user` and `role`; `server/identity.mjs` issues
  per-member tokens (SHA-256 at rest, plaintext shown once), lists and revokes
  them; the Team panel shows the signed-in identity, member management and
  one-time tokens; `GET/POST /api/team/config` exports and imports the
  repository registry plus member names without any secret; `DELETE` request
  bodies are now parsed so revocation works

## Delivery notes

- Current state (2026-11-08): 181 Vitest tests across 13 files are green,
  `npm run lint` and `npm run build` pass, and the working tree is clean after
  `d359a2c` (team identities) and `cfb40a0` (documentation).
  Everything below is local: `git remote -v` is empty, so the commits have
  never been pushed anywhere. This project is intentionally local-only for
  now; do not add a remote or push unless the user explicitly asks. Desktop
  packaging is frozen per the web-only decision; `dist/PR Helper Git.app`
  predates the latest web features.
  **(Superseded 2026-11-11: a remote now exists — the public
  `bayernjf/pr-helper-git`. The "no remote" statement above is a 2026-11-08
  snapshot, not current state. The "do not push unless asked" rule stands.)**
- Initial delivery: 16 atomic conventional commits on `main`; no git remote is
  configured and no push of this project was performed.
- Enhancement phase adds the features above; commits remain atomic conventional
  English commits authored by the configured user, with no co-author trailers.
- The initial suite held 47 Vitest tests (graph layout, formatting, security,
  git parsers, file tree, diff lines, review summaries, clone/folder
  validation, command palette fuzzy filter, blame porcelain parsing, reflog
  and tag-object parsing); later iterations added route-level HTTP tests,
  bringing the total to 181 across 13 files after the M1 team-identity work.
  The GitHub Actions workflow exists but does not run in practice because this
  repository has no remote; the local `npm test` / `npm run lint` /
  `npm run build` loop is the source of truth.
- Fourth iteration E2E in the browser: FileViewer shows working-tree and
  committed files with line numbers, binary detection and a 1 MB cap; the
  blame tab renders per-line author/short-sha/content (200 lines); clean
  previews two untracked items in a confirm dialog then removes the file and
  directory, restoring a clean tree; the remote modal lists origin and an
  add/remove cycle ends with only origin configured; the PR comments block
  shows the empty state, composer and Cmd/Ctrl+Enter hint, enabling the
  post button only with text (no comment was actually posted). Security
  checks confirm sensitive-file masking, path-traversal rejection, invalid
  ref rejection and non-network remote URL rejection.
- Fourth iteration findings: a real `git blame --porcelain` header carries an
  optional fourth field (number of groups), so the parser regex must allow it;
  the read-only `/api/remotes` route was originally placed after the
  `if (method !== 'POST') return null` boundary and could never serve GET
  requests, so it was moved into the read section.
- Fifth iteration E2E in the browser: the sidebar shows a green ↑200 badge on
  main; the FileViewer history tab lists 200 commits for bulk.txt and clicking
  an entry reloads the blob at that revision (header and contents update);
  Escape closes the file viewer and the stash dialog; a temporary stash renders
  its patch with colored hunk/add lines and is dropped afterwards; the copy
  hash button shows the "Commit hash copied" toast. Input validation rejects
  path traversal and bad/overflow stash indices. No external side effects.
- Fifth iteration finding: a lazy-load effect that listed its own loading flag
  in the dependency array could cancel itself (setLoading re-runs the effect,
  which then returns early), leaving an eternal "Loading" state. The effect
  now keys only on the mode and inputs and manages cancellation locally.
- Sixth iteration E2E in the browser: the reference log modal renders 232
  entries in a four-column grid (index, short hash, action, description) and
  closes on Escape; the stash options modal accepts a message and an
  include-untracked toggle, and a real stash with the toggle captured both a
  modified tracked file and a new untracked file, leaving a clean tree (the
  probe stash was dropped afterwards); the annotated tag detail modal shows
  tagger, email, date, target object and the "First tagged release" message;
  the remote modal edits origin's URL inline, the change was verified with
  `git remote get-url` and then restored to the original SSH URL; the
  command palette "Fetch and prune" command ran with `prune: true` in the
  audit log. No external side effects.
- Sixth iteration finding: the reflog parser regex must match the literal
  `@{` separator (`(.+?)@\{(\d+)\}`); an earlier non-greedy pattern that
  omitted the `@` captured the `@` into the ref name.
- Seventh iteration E2E in the browser: the Compare modal auto-runs with
  base=main/head=feature/login and reports 2 head-only commits, 206
  base-only commits and 6 changed files, matching `git rev-list --count`
  and `git diff --numstat` exactly; the Commits and Files tabs both render
  with colored status letters and add/delete counts. The sidebar "Set
  upstream" picker sets feature/quick's tracking branch (verified via
  `git rev-parse --abbrev-ref ...@{upstream}`) and was unset afterwards;
  the remote modal renames origin inline (URL preserved) and was restored;
  the ref filter narrows local/remote/tag/stash groups in real time; the
  ignore-whitespace toggle collapses an inline-only whitespace diff to
  "No diff available". No external side effects, tree left clean.
- Seventh iteration finding: when `-w` makes a diff empty, DiffView returns
  the empty hint and unmounted its own toolbar, leaving no way to switch the
  toggle back. The whitespace toggle was lifted to a persistent WorkPanel
  control above DiffView so it stays actionable regardless of diff content.
- Git behavior note: `-w` ignores inline whitespace changes but not the
  addition/removal of whole blank lines (that needs `--ignore-blank-lines`);
  E2E uses an inline-space change to verify the toggle.
- Eighth iteration E2E in the browser: the Merge modal opens from a local
  branch's "Merge into current" menu and shows four strategy cards with
  titles and hints; choosing `--no-ff` on a branch with one independent
  commit produced a real two-parent merge commit on main (audit recorded
  strategy=no-ff), then the tree was reset and the branch removed. Clicking
  the remote `origin/feature/login` checked out the existing local
  `feature/login` branch rather than a detached HEAD (verified with
  `git branch --show-current` and a detached count of 0). The diff context
  selector changed the hunk header from `@@ -47,7` (default 3) to
  `@@ -50 +50` (0) and `@@ -40,21` (10); the Allow-empty toggle enabled a
  "Commit (empty)" button that created a commit with no file changes (reset
  afterwards); the New branch modal's "without switching" checkbox created
  a branch while staying on main (branch deleted afterwards). All probes
  were cleaned and the tree returned to main/343f1a9/clean.
- Eighth iteration finding: parsing the optional diff context query with
  `Number(query.get('context'))` misfired when the parameter was absent,
  because `Number(null) === 0`, so every default diff silently became
  `--unified=0`. The route now parses context only when the parameter is
  actually present (`query.get('context') !== null`) and falls back to the
  default for missing or invalid values.
- Third iteration E2E in the browser: command palette opens on Cmd+K, fuzzy
  filter narrows results, arrow/enter/escape work and a command switches views;
  history scope returns 213 (all) vs 209 (current) commits; revert rejects a
  merge with 400, reverts HEAD cleanly into a new commit, and left a conflicting
  revert untouched (this iteration asserted the then-current auto-abort; the
  route later switched to 409 + continue/abort); gitignore adds once (duplicate is a
  no-op) and ignores the file; push tag rejects bad names and a missing remote
  without any external push. All temporary changes were reset/removed.
- Tooling finding: `scripts/dev.mjs` spawns the API server without `--watch`,
  so server-side edits require a dev restart; the client is hot-reloaded by
  Vite. The RefSidebar menu opens from the row's "more" button, not context
  menu; the commit graph menu does open on right-click.
- Second iteration E2E in the browser: error boundary panel, loading bar,
  init and clone (auto-registered), soft/hard reset semantics, search filter
  with result count, load-more paging (200 → 213, matching `git log --all`),
  view-switch and search shortcuts, Cmd+Enter commit, panel drag resize and
  minimum clamp. All destructive checks were reset back to the baseline
  afterwards.
- E2E was run against a real private repository through the browser: graph
  forks/merge nodes, SSE auto refresh, stage/commit/push, draft creation,
  in-app ready conversion and all three merge methods.
- Environment finding: in this environment the REST `pulls/:n/merge` and
  PATCH `draft:false` calls fail (404 / silently ignored); the server therefore
  performs both via GitHub GraphQL (`mergePullRequest`,
  `markPullRequestReadyForReview`).
- Test repository registry lives in `bayjf/docs/TEST_REPOS.md`; local
  `test-repos.md` is a pointer. Nothing there is deleted without an explicit
  request.
- Ninth iteration scope: force push (`--force` / `--force-with-lease`), pull
  rebase, merge abort, remote tag deletion and forced tag creation. Two
  pseudo-gaps were ruled out by reading the code: stash pop already exists
  (`/api/stash/apply` with `drop:true`, plus a menu item) and local branch
  push/set-upstream actions are already complete.
- Ninth iteration backend: `/api/push` accepts a whitelisted `force` mode
  (force / force-with-lease), both requiring `confirm:true` (else 400);
  unknown values are ignored and fall back to a normal push. `/api/pull`
  takes a `rebase` boolean (`pull --rebase` vs default `pull --no-edit`).
  New `/api/merge/abort` runs `git merge --abort`. `/api/tag/create`
  inserts `-f` for both annotated and lightweight tags. New
  `/api/tag/delete-remote` runs `push <remote> --delete <name>` with
  confirmation and remote-name validation. All audit entries record the
  new force/rebase fields.
- Ninth iteration E2E in the browser: Pull/Push render as split button
  groups with a caret; the Pull menu lists merge/rebase and the Push menu
  lists normal/lease/force. The two force items open distinct confirm
  dialogs (lease notes the safety check; force warns it can discard
  commits and recommends lease) and were cancelled, so no remote was
  rewritten. A conflicting merge auto-surfaced a red "Merge in progress"
  banner via SSE; clicking "Abort merge" restored the clean tree and the
  banner disappeared. The tag menu shows "Delete remote tag" with a
  confirm dialog (cancelled); the Create-tag modal has a "Force overwrite
  (-f)" checkbox. No console errors. The real success paths of force
  push and remote tag deletion were not triggered; their command forms
  were verified earlier with `--dry-run` and stale-lease rejection.
- Tag recovery note: verifying force-create temporarily repointed local
  `v0.1.0` from its original annotated object (c0e7dc2, peeled f2910c1)
  to the main HEAD; it was fully restored with
  `git fetch origin refs/tags/v0.1.0:refs/tags/v0.1.0 --force` and now
  matches the remote. All temporary branches (tmp-conflict, tmp-abort,
  tmp-pull-rebase, etc.) were deleted; the test repo returned to
  main/343f1a9/clean, ahead 200 / behind 2.
- Tenth iteration scope: revert a merge commit (`-m` mainline), repository
  content search (`git grep`), file rename/move (`git mv`), file delete
  (`git rm`/unlink) and commit-graph path filtering (`git log -- path`).
  All five were confirmed as real gaps by reading the code: the revert
  route hard-rejected merge commits, no grep route existed, file rows had
  only stage/unstage/view/ignore/discard actions, and the log route had no
  pathspec. None is on the excluded high-level feature list.
- Tenth iteration backend: `/api/revert` reads the parent count via
  `rev-list --parents -n 1`; for a merge it requires an integer
  `mainline` in 1..parentCount (missing/out-of-range -> 400) and inserts
  `-m <mainline>`, while ordinary commits keep the old behaviour. `/api/log`
  accepts an optional validated `path` and appends `-- <path>`. New GET
  `/api/grep` runs `grep -I -n --untracked <pattern> [-- path]`, parsing
  each line on the first two colons only (exit 1 = empty result). New
  POST `/api/mv` runs `git mv <from> <to>`. New POST `/api/rm` first
  checks `git ls-files`: tracked files use `git rm [-f]`, fully untracked
  files are unlinked after `resolveInside` (responses carry a `method`
  field). All write paths are audited.
- Tenth iteration defects found and fixed during E2E: (1) the porcelain
  v2 rename parser swapped the names — the real row is
  `R100 <new-path>\t<old-path>`, so the current path is the first token
  and `renamedFrom` the second; a unit test now covers it. (2) The SSE
  effect's dependency array omitted `logPath`, so a file-change refresh
  used the stale empty path and overwrote filtered results; `logPath` is
  now a dependency. (3) `git rm` cannot remove a fully untracked file
  even with `-f` ("pathspec did not match"), hence the git/unlink split
  above.
- Tenth iteration E2E in the browser: GrepModal returned grouped matches
  with line numbers and a clean empty state; the path filter narrowed the
  graph to one commit for `src/index.js` and 200 for `bulk.txt`, and
  cleared back to 200; the Rename modal performed a staged `git mv`
  (shown as `RM old -> new`); the Delete confirm removed both an untracked
  file (unlink) and a tracked file (staged `D`); right-clicking the merge
  opened RevertMergeModal with Parent 1/2 and produced
  `Revert "merge ui feature"`. No console errors. All temporary commits,
  branches and probes were removed; the test repo returned to
  main/343f1a9/clean.
- Eleventh iteration scope: untracked-file diff preview, rebase recovery
  (continue/abort plus state detection), server-side history filters,
  pull-request review submission and route-level HTTP tests. All five were
  confirmed as real gaps by reading the code: plain `git diff` returns
  nothing for untracked files, no rebase routes existed (the pull --rebase
  path could leave an unrecoverable rebase), the graph search only covered
  the loaded page, the GitHub allowlist had no POST reviews entry, and the
  48 existing tests covered no HTTP routes.
- Eleventh iteration backend: the git runner now supports per-call env and
  preserves stdout on non-zero exits. `/api/diff` detects untracked files
  via porcelain and runs `git diff --no-index -- /dev/null <file>` (exit 1
  is a valid diff), returning an `untracked` flag. `/api/status` adds a
  `state` object from `detectRepoState` (MERGE_HEAD, rebase-merge,
  rebase-apply). New `/api/rebase/continue` (GIT_EDITOR=true) and
  `/api/rebase/abort`. `/api/log` accepts validated `author`, `message`,
  `since`, `until` (ISO calendar dates only; bad values -> 400).
  `routes-github.mjs` allowlists POST `pulls/:n/reviews`. `store.mjs`
  honors a `PR_HELPER_HOME` override for test isolation.
- Eleventh iteration defects found and fixed during E2E: (1) the provider
  stored only the inner porcelain object and discarded the sibling
  `state` field, so no component could read rebase/merge state;
  loadRepoData now attaches `state` onto the stored status. (2) GitHub
  returns 404 on `requested-reviewers` when nobody is requested, and the
  Promise.all detail load rejected on the first failure, blanking every
  section; the modal now uses Promise.allSettled with per-endpoint
  fallbacks.
- Eleventh iteration E2E in the browser: an untracked file rendered its
  full no-index diff; the LogFilterModal with message "bulk commit 200"
  narrowed the graph to 1 of 1 and cleared back to 200; a real conflicted
  rebase showed the amber banner with Continue/Abort and Abort restored
  a clean main; a temporary PR (#4) was created, a COMMENT review was
  submitted (verified via API and rendered in the Reviews section), then
  the PR was closed, the remote branch deleted and the test repo reset to
  343f1a9. No console errors.
- Eleventh iteration verification: 77 Vitest tests passed across 9 files
  (including 29 route tests); `tsc --noEmit` was clean; `vite build`
  transformed 68 modules (JS 341.49 KB, CSS 39.06 KB).
- Twelfth iteration scope: audit log reading, in-app file editing/saving,
  PR comment edit/delete, security response headers and component render
  tests. All five were confirmed as real gaps by reading the code: the
  audit trail was write-only, FileViewer was read-only, comments could be
  posted but not changed, static responses carried no security or cache
  headers, and no component-level render test existed.
- Twelfth iteration backend: `store.mjs` adds `readAudit(limit)` which
  parses the JSONL (bad lines skipped, ENOENT -> empty) newest-first.
  New read-only `GET /api/audit` (limit 1..1000). New `POST /api/save`
  rejects sensitive paths, non-string content, NUL bytes and sizes over
  1 MB, then writes a sibling temp file and renames atomically; every
  save is audited. `routes-github.mjs` adds DELETE to the method set and
  allowlists PATCH/DELETE on `issues/comments/:cid`.
- Twelfth iteration defect found and fixed during E2E: GitHub locates a
  single issue comment at `/repos/:o/:r/issues/comments/:cid` (no issue
  number); the nested `issues/:n/comments/:cid` form returns 404 upstream.
  The allowlist and client paths were corrected to the flat form, and the
  audit trail records both the initial 404 probes and the final 200/204.
- Twelfth iteration E2E in the browser: the audit modal listed 200 of
  6855 entries with markers and raw details; an untracked scratch file
  was edited and saved (verified on disk and in the audit); a temporary
  PR (#5) was created, its first comment was edited inline and its
  second deleted through the confirm dialog, then the PR was closed, the
  remote branch deleted and the test repo reset to 343f1a9. Header
  checks over a production instance confirmed nosniff on every response,
  CSP/no-store on HTML and immutable caching on hashed assets.
- Current verification: 85 Vitest tests pass across 10 files (including 8
  new component render tests); `tsc --noEmit` is clean; `vite build`
  transforms 69 modules (JS 347.71 KB / gzip 101.15 KB, CSS 41.45 KB /
  gzip 7.59 KB). Dev server stopped; ports 5173, 4789 and 4791 are free;
  localStorage holds only `git2-active-repo`; the product work tree is
  otherwise clean.
- Post-iteration repository maintenance (user-confirmed): the
  git2-e2e-test divergence (ahead 200 bulk commits / behind 2 real
  commits from merged PR #3) was resolved with a non-destructive
  `--no-ff` merge of origin/main (no conflicts: bulk work only touched
  bulk.txt, the remote feature added src/settings.js) and pushed, so
  local main and origin/main now converge with no ahead/behind. Stale
  branches were cleaned up: feature/settings (merge commit), feature/quick
  (local-only, fully contained), and feature/login + feature/ui (squash
  merged via PRs #1/#2; final file contents proven identical to main)
  were deleted both locally and on the remote. The repo now has only
  main. Hello-World remains a clean octocat clone; git2-init-check
  remains an empty repo with no remote; this product repo deliberately
  stays without a remote.
- Thirteenth iteration scope: audit log retention/rotation, stale-save
  prevention via mtime, route-level tests for /api/audit and /api/save,
  and AuditModal filtering. All four were confirmed as real gaps by
  reading the code: the JSONL audit trail grew unbounded, concurrent
  saves could silently overwrite each other, neither route had dedicated
  tests, and the audit modal could not be narrowed.
- Thirteenth backend: `store.mjs` exports AUDIT_ROTATE_BYTES (1.5 MB),
  AUDIT_TARGET_BYTES (1 MB) and AUDIT_KEEP_ENTRIES (10,000); appendAudit
  stats after each write and calls rotateAudit when the trigger is crossed.
  rotateAudit parses valid lines, walks newest-first under both the byte
  budget and the entry cap, and atomically replaces the file via a temp
  rename; the result is always under the trigger so ordinary appends never
  re-rotate. `/api/file` returns `mtimeMs` for working-tree blobs (null
  for ref/masked views); `/api/save` accepts an optional finite
  `expectedMtime` and returns 409 when the current stat differs or the
  file vanished, with a successful save returning the new `mtimeMs`.
- Thirteenth defects found and fixed during testing: (1) oversized request
  bodies were destroyed inside readJsonBody, so clients saw a bare
  ECONNRESET; the parser now signals tooLarge and the server flushes a
  413 JSON response with `Connection: close` before destroying the socket,
  which also prevents the pooled keep-alive socket from being reused.
  (2) Default server keep-alive timing could race pooled clients; the
  server now sets keepAliveTimeout 60s and headersTimeout 65s.
- Thirteenth testing incident: an early version of the rotation test
  derived the audit path from the test process's configPaths(), but the
  vitest process had no PR_HELPER_HOME set, so it resolved to the real
  `~/.pr-helper-git2/audit.log`; the test's truncating writeFile replaced
  the existing 8,299-line audit history with synthetic seed lines, and no
  backup or local snapshot existed, so the prior audit history could not be
  recovered. The test now builds the audit path explicitly from the
  isolated server home directory, and the real audit log starts empty.
  No source code, credentials or repository data were affected; the loss
  is limited to the diagnostic audit trail.
- Thirteenth E2E in the browser: against a 30-entry seeded audit trail,
  the text filter narrowed the list to 6 stage entries, the failures
  selector to 4 entries all marked "!", the success selector to 26
  entries all marked "✓", and a combined no-match query rendered the
  empty state; the seed data was removed afterwards.
- Current verification: 93 Vitest tests pass across 10 files (37 route
  tests, including 8 new); `tsc --noEmit` is clean; `vite build`
  transforms 69 modules (JS 348.67 KB / gzip 101.47 KB, CSS 41.91 KB /
  gzip 7.63 KB). Dev server stopped; ports 5173 and 4789 are free; the
  real audit log is empty and accrues anew under the retention policy.
- Follow-up scope (server-side audit filtering): the client-side filter
  only covered the loaded 200-entry window, so older retained entries
  could never be matched. `/api/audit` now accepts `q` (trimmed,
  case-insensitive substring over the same action/summary fields the
  modal displays, capped at 100 chars) and `outcome` (`all`/`ok`/`fail`,
  invalid value -> 400); `readAudit` applies the filters over every
  retained entry before taking the limit window, so `total` reports the
  full match count across the file. The modal now requests up to 1,000
  rows, debounces text typing by 300 ms, and distinguishes "no records"
  from "no matches" based on whether filters are active.
- Follow-up E2E in the browser: against a 250-entry seeded file, the
  unfiltered modal rendered all 250 rows; `q=save` returned 25 matches
  with the request carrying `q=save`; `outcome=fail` returned 23 failures
  spread across the whole file (including entries beyond the old 200-row
  window), proving whole-file coverage; a combined no-match query showed
  the empty state. Seed data removed afterwards.
- Updated verification: 94 Vitest tests pass across 10 files (38 route
  tests); `tsc --noEmit` is clean; `vite build` transforms 69 modules
  (JS 348.65 KB / gzip 101.56 KB, CSS 41.91 KB / gzip 7.63 KB). Dev
  server stopped and ports free; the real audit log remains empty.
- Fourteenth scope: a fresh capability-gap audit (66 endpoints extracted
  from source, 20 keyword probes) confirmed three real gaps — missing
  editor keyboard shortcuts, no line-level review comments, and
  whole-file-only staging — while bisect/fsck/LFS/milestones/reactions
  and similar niche items were explicitly rejected.
- Fourteenth implementation: `splitFilePatch`/`buildHunkPatch` pure
  helpers in git.mjs split a single-file unified diff into its header
  and hunks; the new POST /api/stage-hunk regenerates the authoritative
  diff server side, splices the requested hunk and applies it to the
  index via `git apply --cached` (unstage uses `-R`), with index-range
  validation and audit entries. DiffView renders Stage/Unstage hunk
  buttons in the unified view and runs them through runAction so the
  data refresh keeps the diff pane in sync.
- Fourteenth review comments: the GitHub allowlist gains GET/POST
  pulls/:n/comments; the new PrFileReview component expands a PR file
  into its unified diff, anchors an inline composer to any line and
  posts the modern commit_id/path/line/side payload (RIGHT for
  adds/context, LEFT for deletions), grouping comments per line and
  collecting orphaned comments as outdated.
- Fourteenth E2E: browser verified two-hunk stage (index held only the
  second change, `MM` porcelain status), unstage back to a clean
  split, Tab/Shift+Tab indentation and Cmd+S save (editor closes,
  toast confirms). The inline-comment proxy was verified against the
  real API through a temporary PR: 201 for both RIGHT and LEFT
  comments, GET returned them; the PR, comments and branches were
  then deleted and scratch repos removed.
- Fourteenth verification: 99 Vitest tests pass across 10 files (39
  route tests, 5 new); `tsc --noEmit` is clean; `vite build`
  transforms 70 modules (JS 354.07 KB / gzip 103.11 KB, CSS 44.27 KB
  / gzip 8.00 KB). Dev server stopped and ports free; no scratch
  repositories remain registered.
- Fifteenth scope: a fresh audit of 67 endpoints found four real flow
  gaps — the PR body was never rendered, review comments could not be
  replied to or edited/deleted, and only whole-file discard existed;
  niche items (stash branch, check-run logs, suggested changes, syntax
  highlighting) were explicitly rejected.
- Fifteenth implementation: POST /api/discard-hunk reuses the diff
  splice and reverse-applies the chosen hunk to the working tree
  without touching the index; the GitHub allowlist adds PATCH/DELETE
  on the flat pulls/comments/:cid path. The review cards gain Reply
  (in_reply_to only), Edit (PATCH) and Delete (confirm dialog), and
  the modal gains a Description section with inline editing via
  PATCH pulls/:n.
- Fifteenth E2E: browser verified Discard hunk on a two-hunk change
  (first hunk restored, second remains, index stays clean). Through
  the local proxy against a temporary PR: top-level comment 201,
  threaded reply 201 with in_reply_to set, comment PATCH 200,
  description PATCH 200, comment DELETE 204 and a GET confirming
  zero comments remained. The PR, branches and scratch repos were
  removed afterwards.
- Fifteenth verification: 100 Vitest tests pass across 10 files (40
  route tests, one new); `tsc --noEmit` is clean; `vite build`
  transforms 70 modules (JS 353.98 KB / gzip 103.09 KB, CSS 44.27 KB
  / gzip 8.00 KB). Dev server stopped and ports free; no scratch
  repositories remain registered.
- Sixteenth scope: while preparing the product demo, the commit patch modal
  was observed opening and closing within ~200ms. Root cause: the recursive
  file watcher watches .git too, so transient index.lock create/delete pairs
  (from background git activity) broadcast repo-changed frames; the SSE
  handler reloaded the repo, recreating commit objects, and CommitDetail's
  effect, keyed on the commit object identity, reset the patch state.
- Sixteenth fix: watcher.mjs now exports isNoise and ignores .lock files,
  in-flight tmp_obj_* objects and node_modules/dist events while keeping
  meaningful HEAD/refs/index changes. CommitDetail keys its load effect on
  the selected hash and active repo instead of the commit object, so a
  background refresh that keeps the same commit no longer closes the modal.
- Sixteenth E2E: browser verified the patch modal now stays open and the
  SSE stream emits only the hello frame with no spurious repo-changed.
- Sixteenth verification: 106 Vitest tests pass across 11 files (new
  watcher.test.mjs with 6 isNoise cases); tsc clean; vite build transforms
  70 modules (JS 358.58 KB / gzip 103.96 KB, CSS 44.60 KB / gzip 8.06 KB).
  Note: overlapping vitest runs produced index.lock contention and flaky
  403 failures; ensure prior test runs have exited before rerunning.
- Seventeenth scope: a wide-viewport screenshot of the Hello-World graph
  showed several layout defects — commit rows pushed the trailing date off
  the right edge (hard-clipped), dense ref badges on the merge row crowded
  out the subject, and at narrow widths the sidebar group headers wrapped
  ("LOCAL/BRANCHES") while the top toolbar wrapped its "Pull Requests" label
  and overlapped the Git button.
- Seventeenth fix (styles.css only): .graph-row clips overflow and .graph-body
  gets width:100%/min-width:0 so the subject shrinks and ellipsizes while
  author/hash/date stay fixed and fully visible; .ref-badges becomes a
  self-scrolling strip (flex 0 1, hidden scrollbar) so badges never cover the
  subject; the top toolbar scrolls horizontally with nowrap labels instead of
  wrapping; the graph filter toolbar wraps cleanly; .ref-group-head is
  nowrap so section headers stay on one line.
- Seventeenth verification: browser measured zero row overflow at 1860, 1000
  and 786px (all dates visible), and at 600px the badge strip scrolls and the
  subject keeps a minimum width rather than being clipped mid-label. 106 Vitest
  tests pass across 11 files; tsc clean; vite build transforms 70 modules
  (JS 358.58 KB / gzip 103.96 KB, CSS 45.18 KB / gzip 8.16 KB).
- Nineteenth scope: a project-level, file-by-file code review (not a gap
  audit) covering correctness, security, robustness, React usage, resource/
  race handling and test blind spots. The server's core security model held
  up: fixed-argv execFile with no shell, timing-safe token comparison,
  realpath-guarded path containment, a fixed GitHub proxy target with
  method/path allowlist, and SSE ping/close cleanup. Five real issues were
  fixed in atomic commits.
- Nineteenth fixes: (1) grep patterns were passed as bare positional args,
  so a dash-prefixed pattern (e.g. '--foo') was misread as a git option in
  both /api/grep and /api/grep-all; now declared via `-e`. (2) WorkPanel
  panelHeight was lazily initialized from the per-repo preference only on
  mount and never re-read on a repository switch, so the first repo's height
  leaked into every later repo; an activeRepo effect now restores it.
  (3) CommitGraph Space/Enter activation returned before preventDefault, so
  Space scrolled the page. (4) use-shortcuts destructured an unused `view`
  and kept it in the effect deps, needlessly recreating the listener.
  (5) A malformed static URI made decodeURIComponent throw and surfaced as
  500; it is now a local 400. Two new route tests cover the dash pattern and
  malformed URI; the panel-height effect was verified in the browser
  (220 -> 520 -> 220 across switches) since SSR tests never run effects.
- Nineteenth design note (left unchanged): the commit message draft is
  component state shared across repositories, so a non-empty draft carries
  over on a repo switch and also suppresses template prefill. Clearing it
  would be a behavior change that could discard a deliberate in-progress
  draft, so the current behavior is retained; the textarea stays visible
  before every commit, letting the user catch a mismatched message.
- Twentieth scope: a capability-gap audit (extract every route, keyword-probe
  for real gaps, then read the implementation) identified four features worth
  adding under the zero-dependency product boundary: light theme, PR board
  filtering, in-app new file creation, and git config management. All were
  delivered as atomic commits; a separate fix defined the never-declared
  --bg-elevated token that eleven existing rules referenced.
- Twentieth backend: GET/POST /api/config reads local and effective values
  for a whitelisted set of keys and writes repository-local config only.
  Arbitrary keys are rejected (core.sshCommand/alias/include/... can execute
  or escape), enum/email/branch values are validated, and an empty value
  unsets the local override (git exit 5 for an already-missing key is a
  successful no-op). /api/save now mkdir-recursively before writing so a
  nested new-file path works; the directory is already inside the validated
  path and mkdir is a no-op for existing-file edits.
- Twentieth verification: 121 Vitest tests pass across 11 files (four new
  config route tests); tsc clean; vite build output (react-vendor 223.09 KB /
  gzip 69.19 KB, app 153.54 KB / gzip 39.27 KB, CSS 51.98 KB / gzip 9.30 KB,
  76 modules). A fresh browser tab reports zero console errors/warnings; the
  throwaway test repo was restored to its empty state and the work tree is
  clean with no remote configured.
- Desktop decision: the product is already a local loopback server plus a web
  UI, so a desktop version only needs a native window, double-click launch and
  process supervision. Electron (~150 MB runtime) and Tauri (Rust toolchain)
  were rejected to preserve the zero-runtime-dependency design; the chosen
  shell uses system WKWebView and swiftc and reuses the installed Node.js,
  yielding a bundle under 1 MB.
- Desktop backend: in GIT2_DESKTOP mode the server prints a machine-readable
  GIT2_READY line with the ephemeral port and token. Shutdown now calls
  server.closeAllConnections() (keep-alive/SSE sockets) and a new
  stopAllWatching() closes every watcher, with a forced-exit safety net; the
  old signal handlers waited for long-lived clients and could stall.
- Desktop shell: the Swift AppDelegate resolves Node at well-known paths
  (GUI PATH omits Homebrew), spawns the bundled server, parses GIT2_READY on a
  serial queue, loads the token URL in a persistent WKWebView, and on
  termination waits up to 3 seconds before SIGKILL. E2E via open/quit confirms
  the shell and node start, establish five connections, and both exit with no
  lingering process; 121 tests and tsc stay green.
- UI/UX P0 pass scope: three confirmed gaps from the design review — fixed
  column widths, no app icon/window memory, and no reduced-motion support.
  Column resizing uses a reusable `useResizable` hook (`src/hooks/use-resizable.ts`)
  driving edge-mounted `.col-resize` separators; both pointer and keyboard
  (arrows, Shift for a larger step) paths clamp to a range and persist
  `sidebarWidth`/`detailWidth`, while no inline width is applied until the user
  first resizes so the responsive media queries keep working. The icon is
  rendered at build time from `desktop/make-icon.swift` and packaged to
  `AppIcon.icns` with system sips/iconutil (no checked-in binary, no new
  dependency); the Swift shell calls `setFrameAutosaveName` and keeps `center()`
  only for first-run placement.
- UI/UX P0 verification: browser checked both separators' ARIA attributes,
  keyboard resize and direction (sidebar ArrowRight widens, detail ArrowLeft
  widens), reload restoration, min/max clamps and a synthetic pointer sequence;
  a second desktop launch restored the saved frame (position 67,51 rather than
  centered) and open/quit still leaves no lingering shell or node process. All
  121 Vitest tests pass across 11 files, tsc is clean, vite build succeeds, and
  the rebuilt bundle is ~1.2 MB with the icon in Contents/Resources.
- Post-P0 hardening phase (eleven atomic commits) opened with a reported hover
  defect: the graph SVG and absolutely positioned rows shared an auto z-index,
  so an opaque row hover/selected background painted over the left lanes and
  nodes; the SVG now sits above the rows while remaining pointer-events-none.
  A sequence of correctness fixes followed: literal UTF-8 paths and reliable
  rename parsing (quotePath, porcelain type-2, numstat resolution), bounded file
  reads and grep -z parsing, longer network timeouts, symlink-aware repo roots,
  expanded sensitive-file masking, stacked Escape and sequence-token race guards
  across the modals, paginated PR collections, desktop Node discovery across
  version managers, and SSH-port/trailing-slash remote recognition.
- A fresh file-by-file bug audit then read every server module, all 35 client
  components and the pure helper libraries. Eight candidates were verified
  against the real source and ranked by severity. The single P1 (a slow
  repository load overwriting a newly selected repo) and the no-newline diff
  parsing had already been closed by the sequence-token work; the remaining
  real items were fixed in four atomic commits: side effects removed from
  setState updaters (a StrictMode double-invocation hazard), a redundant status
  dependency that re-fetched the diff on every background refresh, an untracked
  delete confirmation that wrongly claimed a staged deletion (the server unlinks
  untracked files directly), and repo removal now returns 400 instead of writing
  a repo:null audit entry. The EventSource was also reduced to one connection
  that reads the latest reload parameters from a ref, removing the event-loss
  window from reconnecting on every log-option change.
- The only theoretical item deliberately left unchanged is SSE write back
  pressure: there is a single loopback client sending tiny frames, and the
  existing try/catch removes a faulting client, so asynchronous drain logic
  would add complexity without practical benefit.
- Current verification: 140 Vitest tests pass across 12 files (the new 400
  rejection adds one route test); tsc is clean; vite build transforms 77 modules
  and now copies the checked-in SVG favicon (public/favicon.svg) into dist,
  eliminating the /favicon.ico 404. The dev server is stopped and ports 5173 and
  4789 are free; the product work tree is clean and still has no git remote.
- Multi-repository panel: a requested "Open repositories" view replaced the
  dropdown-only switching. The existing GET /api/repos already returned a full
  per-repository brief (branch, upstream, ahead/behind, staged/unstaged/
  untracked, last commit, error), so no server change was needed; the new
  RepositoriesModal renders those briefs in a filterable grid. A row opens the
  repository and closes the panel, while row checkboxes plus a select-all control
  drive a batch fetch that runs with Promise.allSettled so one failing remote
  cannot abort the rest, then refreshes and reports the fetched/failed counts.
  Browser testing covered filtering, the batch fetch (two /api/fetch 200s) and
  row switching; the server-side socket count confirms a single live SSE
  connection (the extra dev-only EventSource is the StrictMode mount/cleanup
  mount pair, whose first socket is closed by the effect cleanup).
- Updated verification: 144 Vitest tests pass across 12 files (four new
  RepositoriesModal render tests); tsc is clean; vite build transforms 78
  modules. The dev server is stopped and ports 5173 and 4789 are free; the work
  tree still has no git remote.

## 2026-11-08 cross-repo parity round

- Ported AI generation from pr-helper-git: `server/ai.mjs`, `/api/ai/config|test|commit-message|pr-description`,
  Settings AI section, "Generate with AI" in the commit form and the new-PR dialog.
  The key lives in `~/.pr-helper-git2/config.json` and is never returned (only `hasKey`).
- Added `/api/cherry-pick` (409 + conflicted paths, state preserved) and `/api/undo-commit`
  (soft reset), both in the commit-graph context menu.
- Fixed `parseGrepLines`: `git grep -n -z` records are `path\0line\0text\n`, so splitting on NUL
  in triples misaligned every match after the first. Now parsed record-by-record.
- Tests: 196 (15 files) (historical baseline). Remaining parity backlog at the time: `../pr-helper-git/PARITY.md` — now closed (0 functional gaps).

### 2026-11-08 repository panel round

- `src/lib/repo-sort.ts`: `activityLevel` / `relativeAge` / `sortRepos` /
  `summarizeRepos`, with 9 unit tests. Kept pure so the panel rules are testable
  without a DOM.
- RepositoriesModal: pin (localStorage `pr-helper-git2-pinned`), activity bar,
  aggregate header, "With changes" filter, manual refresh and a 30s auto refresh
  that only re-reads `git status` (never fetches or pulls).
- Tests: 205 (16 files).

### 2026-11-08 line-level staging

- `server/patch-lines.mjs`: `parseHunk` + `buildLineSelectionPatch(header,
  hunk, selected, action)`. The rebuild keeps context, converts unselected
  changes that the target side already holds into context (removals when
  staging, additions when unstaging) and drops the rest — a naive rebuild fails
  with "patch does not apply" whenever selected and unselected changes share a
  hunk.
- `POST /api/stage-lines` with `{ repo, file, hunk, lines[], action }`; validates
  indexes against the parsed hunk, caps the selection, audits both outcomes.
- DiffView: click a changed line to mark it, hunk header shows Stage/Unstage N
  lines + Clear; selection resets when the diff reloads.
- Tests: 215 (17 files), including two integration cases that stage/unstage a
  single line with real `git apply`.

### 2026-11-08 whole-history commit search

- `server/search-commits.mjs#buildCommitSearch(q, {limit})` is pure: it decides
  the mode from the `author:` / `path:` prefix, rejects empty/overlong/multi-line
  queries and returns the exact `git log --all --date-order --max-count=N -i`
  argv. `GET /api/search-commits` maps the result to `parseLog`.
- UI: `CommitSearchModal` (message / author / path, prefix buttons that write the
  prefix into the box, click a row to jump to the commit). Entries: toolbar
  button, command palette (`git2:search-commits`), Shift+Enter from the graph.
- Tests: 222 (18 files) — 6 pure/integration cases in `search-commits.test.mjs`
  (the integration one proves `--all` reaches an unmerged branch) plus 1 HTTP
  case in `routes.test.mjs`.

### 2026-11-08 interactive rebase

- `server/rebase-todo.mjs` keeps the planning logic pure: `validateRebasePlan`
  accepts only a full permutation of the range (a missing hash is reported as
  `plan omits <hash>`, never silently dropped), `applyTodoPlan` rewrites the
  todo file matched by one-way hash prefixes and preserves the comment block,
  `resolveRewordMessage` applies reword messages and refuses to touch a
  `# This is a combination of N commits` squash file.
- Two shims drive git: `rebase-sequence.mjs` (`GIT_SEQUENCE_EDITOR`, reads
  `GIT2_REBASE_PLAN`, exits 1 on a bad plan so git aborts) and `rebase-msg.mjs`
  (`GIT_EDITOR`, reads `GIT2_REWORD_STATE`, never exits non-zero). `GIT_DIR` is
  not exported to the editor, so the reword queue lives in our own state file.
- Routes: `GET /api/rebase/plan` (commits + dirty/merges/upstream/pushed) and
  `POST /api/rebase/interactive`; dirty tree, merge commits and an in-progress
  multi-step operation are 409, an invalid plan is 400, a conflict returns
  `200 { conflicted: true }` and leaves the rebase banner in charge.
- UI: `RebaseModal` with per-row action select, up/down reordering,
  reword inputs and the three guardrails; entry point is the commit context
  menu (a root commit means `--root`).
- Note for the next route added to `routes-git.mjs`: every GET handler must sit
  above `if (method !== 'POST') return null;` (~line 1249), otherwise it 404s.
- Tests: 237 (19 files) — 12 pure cases in `rebase-todo.test.mjs` plus 3 HTTP
  cases that really rewrite history, prove an omitted commit is rejected and a
  dirty tree is refused.

### 2026-11-08 CI gates + branch protection warnings

- `server/github-allowlist.mjs` now owns the PAT proxy allowlist (moved out of
  `routes-github.mjs` so it can be unit-tested without loading the HTTP layer).
  Two endpoints were added: `commits/:sha/status` (classic statuses, which a
  Jenkins-only repo reports instead of check runs) and
  `branches/:branch/protection` (404 = unprotected).
- `PrDetailModal` fetches both alongside the existing detail calls and merges
  statuses into the check list (`pending` has no conclusion, anything but
  `success` counts as failed). A failing gate adds a confirm dialog before the
  ordinary merge confirmation; the CI summary above the merge options shows the
  failing count, the unprotected-branch warning, or the required-check count.
- Tests: 240 (20 files) — `github-allowlist.test.mjs` 3 cases pin the new
  endpoints and prove `PUT`/`DELETE` protection and `/actions/runs` stay
  rejected, plus traversal paths.

### 2026-11-08 Bilingual UI (i18n)

- New `src/i18n.ts`: `ZH` dictionary keyed by the English source string (~300 entries), `t()`,
  `tp()` for `{placeholder}` text, count rules (`"12 commits"` → `"12 次提交"`), `getLocale/setLocale`
  persisted through `lib/prefs` (`locale`), plus `useLocale()` built on `useSyncExternalStore`.
- `App.tsx` calls `useLocale()` so switching re-renders the whole tree; the language selector lives
  at the top of `SettingsModal`.
- Component copy was converted mechanically: JSX text nodes / `title` / `placeholder` / `aria-label`
  / `alt` props and `toast('…')` / `setStatus('…')` literals now go through `t("…")`. Counted strings
  that are assembled at runtime (commits, repositories, matches, lines, selected) use `t(\`…\`)`
  backed by the count rules.
- `src/i18n.test.ts` (5 tests): en/zh switching, unknown-key fallback, count rules, `tp`, and a
  source scan asserting every `t("…")` key used in `src/**` exists in `ZH`.
- Known limits: server/API error text and raw Git output stay English; user data (branch names,
  commit subjects, file paths) is never translated because only exact dictionary keys are substituted.

### 2026-11-08 HTTP E2E smoke suite

- New `e2e/run.sh` (+ `npm run e2e`): boots `server/main.mjs --port=18774` with
  `GIT2_DEV=1` (fixed `dev-token`) and `PR_HELPER_HOME` in a throwaway dir, then
  drives the real HTTP API with curl. 60 checks covering auth/traversal,
  repo registration, status/log/refs/file reads, stage → commit → undo,
  branch/tag/stash, grep, compare, rebase plan, cherry-pick, merge, GitHub
  proxy guards (missing PAT 401 / allowlist 403) and audit.
- Quirks encoded in the suite: GET routes take `?repo=`, writes take `body.repo`;
  `GET /api/file` expects `file=` (not `path=`); `POST /api/merge` expects
  `ref=`; `stash-list` returns `entries`; `rebase/plan` rejects `HEAD~2`
  (`~` is outside the ref charset) so the suite passes a resolved SHA.

### 2026-11-08 E2E deepened to 101 checks

- Added conflict and history-rewriting coverage: merge conflict → resolve
  (`ours`) → commit, merge conflict → abort, interactive rebase `drop`,
  rebase conflict → abort, single and batch reverts, hunk / line-precise
  staging (`stage-hunk`, `stage-lines`), push/pull against a bare remote and
  force-push confirmation guard.
- Harness fix: `contains()` used `echo … | grep -q`, and `grep -q` exiting on
  the first match sent SIGPIPE to the writer, which `set -o pipefail` reported
  as a failure — a flaky red. It now greps a here-string.
- Product fixes found by the suite: a conflicted merge now returns 409 with the
  conflict list (it used to be a generic 400), and `POST /api/commit` is
  allowed to finish a merge whose resolution left the index identical to HEAD
  (`ours`), instead of failing with "nothing staged to commit".

### 2026-11-08 Chinese walkthrough and translation sweep

Ran the bilingual build in a browser against a throwaway repository and read
every panel in Chinese. The dictionary covered rendered keys, but plenty of
copy was still a raw literal (toolbar actions, work-panel controls, graph
filters, modal labels, shortcut help, command palette, team/repo panels, PR
detail counters, relative timestamps). All of those are now routed through
`t()`/`tp()` and translated; `formatRelative` and `relativeAge` emit Chinese
units instead of `3m ago`.

Toasts raised by `runAction` and the error messages the API returns are now
translated too (`src/components/ui.tsx` renders through the dictionary and
`runAction` translates `err.message` before appending the raw git detail), so a
Chinese user sees Chinese outcomes and Chinese failure headlines.

Known gaps: audit action names and raw git/GitHub output (branch names, commit
subjects, git stderr detail) stay exactly as git reports them.

### 2026-11-09 Audit action labels, changelog

Audit entries used the server's action identifier verbatim (`repo-add`,
`stash-create`, …), so a Chinese audit panel showed English identifiers.
`auditAction()` in `src/i18n.ts` maps 50 of them to Chinese labels and passes
unknown ones through; the English UI keeps the raw identifier because that is
what the audit log and its filter use. Covered by one new `i18n.test.ts` case
(250 tests / 21 files).

Also added the first `CHANGELOG.md`, back-filled with the 0.1.0 feature set and
the unreleased fixes (merge conflict contract, translation sweep, toasts, audit
labels, no-wrap toggles).

### 2026-11-09 Commit graph keyboard parity

The graph already had `role=listbox`, `role=option`, `aria-selected` and
arrow/Home/End/Enter, but it still differed from the vanilla client: no
PageUp/PageDown, no Escape, and no `aria-activedescendant`. Those three are in
now, with row ids (`commit-row-<hash>`) so the active option can be named.

The decision math lives in `src/lib/graph-nav.ts` (`nextCommitIndex`,
`pageSizeForViewport`) so it can be unit-tested without mounting React; the
component keeps the DOM part (selection, focus, reveal, scrolling). Tested at
three levels: 6 unit cases for the math, 4 jsdom interaction cases that render
the real component and press keys against `selectCommit`, and 2 SSR cases that
assert the listbox/option/`aria-activedescendant` markup. `jsdom` is now a dev
dependency here too.

### 2026-11-09 Commit signature verification

`GET /api/signature?repo=..&sha=..` runs `git log -1 --format=%G?%x00%GS%x00%GK`
and returns `{sha, status, signer, key, verified}`. `%G?` letters are mapped to
copy in the detail panel (G verified, B bad, U unknown, N unsigned, E cannot
check, X/Y expired, R revoked). The letter comes from git alone — no key
material is needed — so repositories with no signing key still get a truthful
"Not signed" instead of an error. Two route tests pin the unsigned path and the
400 on a malformed sha.

### 2026-11-09 Submodule status panel

`GET /api/submodules?repo=..` runs `git submodule status --recursive` and returns
`{entries:[{state,sha,path,describe}]}` through `parseSubmoduleStatus`, which
keeps the one-character state prefix (space clean, `-` not initialized, `+`
checked-out commit differs, `U` conflict). The sidebar renders a read-only
"Submodules" group only when a repo actually has submodules, colour-coded by
state. Covered by a parser test with all four prefixes, a route test for the
empty repository, and one E2E check.

### 2026-11-09 Bisect wizard

The last parity candidate. `GET /api/bisect` reads git's own marker files
(`$(git rev-parse --git-path BISECT_LOG)` and `BISECT_START`) instead of keeping
state in memory, so a running bisect survives a server restart; it also reports
the current candidate commit and the good/bad counts parsed from the log.
`POST /api/bisect/start` runs `git bisect start`, then `bisect bad <sha>` /
`bisect good <sha>`; a failure mid-way best-effort resets so HEAD is not left
detached. `POST /api/bisect/mark` and `/reset` refuse when no session is active,
and reset verified to restore the original branch (`main`). Covered by three
route tests against a real fixture repo plus five E2E checks (start → active →
reset → cleared → branch restored).

### 2026-11-09 Read-only phone view (/m)

After measuring the desktop layout at 390 px (scrollWidth 619, graph squeezed
to 70 px, working panel 0 px wide) the phone case was handled with a separate
read-only view instead of a responsive rewrite.

- `src/components/MobileApp.tsx` — sticky repo picker / refresh / language
  toggle, branch + ahead/behind, staged/unstaged/untracked chips, 80-commit
  list, full-screen commit sheet (author, date, `%G?` signature, body, files
  with `+n/-n`, per-file diff). No mutating endpoints are called.
- `src/main.tsx` — `/m` or `?mobile=1` renders `MobileApp`, everything else
  keeps the desktop app.
- `server/main.mjs` — extensionless `GET` misses now fall back to
  `dist/index.html`, so `/m` works in the production server.
- `src/styles.css` — `.m-*` block with 44 px touch targets, sticky header,
  `env(safe-area-inset-*)`, `100dvh`.
- Tests: `src/components/mobile.test.tsx` (jsdom, stubbed fetch, list → commit
  → file diff). E2E: `/m` responds 200 and returns the app entry
  (109/109).

- Follow-up in the same round: the phone view lists working-tree changes
  (tap → `/api/diff` for that file), and the server accepts `GIT2_HOST` for
  non-loopback binding (default unchanged); `src/components/mobile.test.tsx`
  now covers both the commit flow and the working-tree diff.

Baseline at 0.2.1: 287 unit tests / 27 files, E2E 115/115.
Current working-tree baseline: 336 / 34, E2E 144/144 (0.2.2 release was 287 / 27).
2026-11-10 appearance + maintenance wave: SettingsModal gained dark/light/system modes
and four accent presets (violet/ocean/forest/amber), applied before first paint and
persisted in `git2-prefs`; the toolbar button now cycles three modes with a monitor icon.
The same Settings modal shows the data directory + file sizes and calls
`POST /api/maintenance/audit-rotate` / `POST /api/maintenance/prune-repos` after a
confirm dialog; `pruneRepos()` drops registry entries whose `.git` disappeared.
`GET /api/storage` backs the sizes. Tests: 3 new route tests; E2E +6 maintenance checks.
2026-11-10 parity wave: Dashboard full-page view (open-PR counts, external open, remove UI,
background fetch-all), graph CI dots, image diffs (/api/raw), commit history + 50/72 counter,
amend prefill, discard-all, draft persistence. The remaining conflict 3-way editor landed in
the same round (`ConflictEditorModal` + `src/lib/diff/conflict.ts`), so no functional gaps
remain in pr-helper-git's PARITY.md.
Note: the phone view supports `/m?repo=<path>&commit=<sha>` deep links (README §Phone view).

2026-11-10: PR real-network validation (list/detail/create/merge/close-reopen/comments/reviews/
labels/reviewers/line-comments/draft-ready/protection-read) is **blocked on a user-provided PAT** —
all PR capabilities remain validated at route/offline level only (PARITY.md known limitation).
Record the validation outcome here once it runs.

## Lessons inherited from pr-helper-git (pre-archive, 2026-11-11)

Engineering knowledge worth keeping now that the old `pr-helper-git` is archived as `pr-helper-git-archive`:

1. **bash nested quotes shred JSON**: payloads written as `-d "{\"a\":…}"` inside
   `$( )` lose content to brace expansion (server receives fragments → invalid
   JSON). Build payloads with `printf … |` at runtime (see both e2e scripts).
2. **`REBASE_HEAD` is NOT a live-rebase signal** — an aborted rebase leaves the
   file behind. Detect a live rebase via the `rebase-merge`/`rebase-apply`
   directories only. Same class of bug: a conflicted single-commit revert
   writes `REVERT_HEAD` (pr-helper-git exposes it as `status.reverting`).
3. **Check `engines` when installing test deps**: `jsdom@31` requires Node
   ≥22.22 while `jsdom@26` requires ≥18 — on a Node 20 machine 7 test files
   silently failed to load, making suite counts look right but run less. And
   on Node ≥26, Node's experimental `globalThis.localStorage` (undefined
   without `--localstorage-file`) SHADOWS jsdom's inside vitest — fixed by
   `src/test-setup.ts` (in-memory polyfill via `test.setupFiles`).
4. **Multi-instance config safety**: web + desktop run side by side. git2's
   store reads the file on every call + writes via tmp+rename (keep this
   style); pr-helper-git needed mtime invalidation to avoid one instance
   erasing the other's settings.
5. **Server-side PAT model** (adopted this round): the token may live in
   `~/.pr-helper-git2/config.json` and is injected into the GitHub proxy
   context server-side; the browser never sees it. pr-helper-git's original
   design — worth keeping as the default for shared machines.
6. **Desktop shell engineering** (archived in `docs/archive/pr-helper-git-desktop/`):
   `--port=0` + machine-readable port line handshake, tray open/quit, dock
   reopen, child server killed on exit, `find_node()` multi-path discovery,
   fatal-error osascript dialog.
7. **`core.quotepath=off` is not enough**: git still C-quotes `"` and control
   characters. pr-helper-git needed a dedicated `c-quote.mjs` decoder; check
   git2's path parsing before assuming raw paths are safe.
8. **Refresh fingerprints must include content, not counts**: file paths +
   ahead/behind + remote/tags/stashes. Counts-only produced ghost WIP rows and
   defeated auto-fetch; opening a repo must reset the cached fingerprint.
9. **Removing an import requires checking transitive callers**: dropping `fs`
   broke `isGitWorktree` (`fs.lstatSync`); a try/catch turned it into a silent
   `false`, so every repo operation failed with "invalid repo path".
10. **`parsePorcelainV2` has two field layouts**: git 2.51 separates ordinary
    fields with spaces but uses a tab before the rename path — handle both.

### 继承的产品约束与暂缓项（2026-11-11 已从 ZCode 项目记忆迁入）

以下约束于 2026-11-11 自 pr-helper-git 旧项目的 ZCode 记忆
（`~/.zcode/cli/memories/projects/pr-helper-git-29beae1193885890/`，6 条，当日已
删除）迁入，现为本仓库的正式约束。迁入时已逐项 grep 确认 README / handoff /
CHANGELOG / docs 对这些主题为 0 命中，无重复记录。

- **产品定位**：本地自用工具，**不上生产**（用户 2026-11-10 明确）。手机端只在
  **局域网**内访问，不做公网 / Tailscale / 反代组网。
- **由此不做的事**：TLS、公网反代、CSP 收紧等加固类工作与部署文档，除非用户要求；
  局域网内明文 HTTP + token 可接受。这条直接影响权限矩阵与移动端验收的取舍。
- **备份**：统一放 `/Users/jiangfeng/000mycodes-backups`，一键脚本
  `bash pr-helper-backup.sh`（先 commit，bundle 不含未提交内容）。Docker 仅换机 /
  NAS 场景需要，日常不用。
- **设计 token**：编辑 `design/tokens.json` 后跑 **`node scripts/sync-tokens.mjs`**
  （`TARGETS` 只写 git2）。⚠️ 旧记忆写的 `npm run tokens` 在本仓库**不存在**，
  package.json 无该 script，已按脚本头部注释校正。
- **用户决策偏好（跨项目）**：不要追求最简实现，以核心 / 基本功能做对为准，UI 要
  设计得好看（2026-11-05 原话：「后续遇到要决策的点，不要追求最简单的实现方式，
  以核心功能，基本功能为准，UI也要设计的好看点」）。
- **迭代节奏（跨项目）**：用户会在建议收敛后继续说「继续」；照做并找出真实改进，
  但确实枯竭时要诚实说明，不要镀金。
- **暂缓功能**：图拖拽（branch→commit 的 checkout/merge/rebase、commit→branch
  的 cherry-pick）**维持 park**。2026-11-11 复核：同等能力已由右键菜单覆盖
  （`CommitGraph.tsx` menuItems 含 cherry-pick / interactive rebase from here，
  `RefSidebar.tsx` menuItems 含 Checkout / Merge into current），拖拽只是换手势；
  且图行已有单击选中 / 右键菜单 / 批量勾选三套手势，加拖拽有劫持风险。
- **对比模式：原 park 记录已过期**（迁自旧项目，对 git2 不成立）。2026-11-11
  复核：branch vs branch **早已实现**（Toolbar「Compare two references」→
  `CompareModal.tsx` + `/api/compare`），且 `validateRefSpec` 本就接受 7–40 位
  hex，后端已支持任意 commit。真实缺口只有两个 UI 口子：选不到任意 commit、
  没有「工作区」选项。用户 2026-11-11 批准补完这两个口子，**当日已交付**：
  - 服务端：`:worktree` 伪引用（`COMPARE_WORKTREE`，`:` 在 git ref 名里非法故不会
    撞名）可作任意一侧；作 base 时 diff 反向（同一暂存新增从 `A` 变 `D`），两侧
    同时为工作区或 `:worktree-ish` 一律 400；工作区侧没有自己的提交，两个提交
    列表按 HEAD 算且为空；响应新增 `untracked`（`ls-files --others
    --exclude-standard`，不计入 diff）。
  - 客户端：新增 `RefPicker.tsx` 组合框，可搜引用 / 已加载提交的主题与 hint，
    也可直接敲 7–40 位 SHA 选未加载的提交（列表上限 80 行 + sticky 截断提示）；
    新增「工作区」选项、base/head 交换按钮、未跟踪文件计数与分组；任一侧为
    工作区时自动落到「文件」页（提交页按构造为空）。
  - 闸门（`fnm exec --using=22.23.1`）：lint 0、typecheck:server 0、
    **336 单测 / 34 文件**、build ok、**E2E 144/144**。浏览器实测：dev 42/42、
    **生产构建** 42/42（0 console error / 0 失败请求）、中文 15/15；
    1280×900 / 1280×620 / 1280×450 / 390×844 / 390×500 / 390×420 六种视口下
    弹层均无裁切、截断提示始终可见。
  - 目检（不是数字）抓出两个真缺陷并已修：① 560px 宽的弹层撑破 `.modal` 的
    滚动盒，聚焦输入框会把标题和 BASE 标签横向滚出视野 → 弹层改为锚定整个
    picker 行；② 矮视口下弹层被裁 0.5px、截断提示要滚动才看得到 → `.modal-compare`
    固定高度框架 + `clamp()` 弹层高度 + sticky 页脚。
  - **未扩大范围**：390 宽下页面级横向溢出是既有现象，把 HEAD 的样式表换回实时
    页面复测可复现（HEAD 748px vs 当前 693px），源头是 toolbar 的
    `.btn-group`/`.segmented`，`styles.css` 已注明其横向滚动是设计意图。
- **显示名：现阶段用 `PR Helper Git`（去掉「2」）**。用户 2026-11-11 决定
  （原话「pr-helper-git吧」「现阶段就用这个」）。`index.html:7` 的 `<title>`
  （浏览器标签 / 手机加到主屏时的名字，`/m` 手机视图共用同一个 shell）与
  `server/main.mjs:304-305` 的启动横幅均已改名。
  - **2026-11-12 扩展为运行时标识符改名**：`package.json` name、数据目录
    `~/.pr-helper-git`、localStorage `pr-helper-git:*` 命名空间、cookie
    `pr_helper_git_token`、环境变量 `PR_HELPER_GIT_*`、Tauri bundle id 均已切换，
    并带一次性迁移。
  - **兼容读取**：旧 cookie `git2_token` / 旧 header `x-git2-token` / 旧环境变量
    `GIT2_*` 仍可读；旧 localStorage 键在首次加载时复制到新键后删除；旧数据目录
    在新目录不存在时于首次启动 rename。设置页显示的是迁移后的真实路径。
  - **GitHub 仓库名同日一并改了**（用户明确要求）：归档仓
    `bayernjf/pr-helper-git` → **`bayernjf/pr-helper-git-archive`**，产品仓
    `bayernjf/pr-helper-git2` → **`bayernjf/pr-helper-git`**。归档仓是
    read-only，GitHub 拒绝直接改名（403），故按「解除归档 → 改名 → 立刻重新
    归档」三步执行，可见性全程 PRIVATE，收尾已复验回到 archived=true。
    复验：归档 main `18413da` + 5 tag 完好；产品 main `63e10c3` 未变；
    新旧两个 URL 的 `git ls-remote` 都可达（GitHub 保留旧名重定向）。
  - **本地 `origin` 已切到新 URL** `git@github.com:bayernjf/pr-helper-git.git`
    （2026-11-12 切换并复验 `ls-remote`）；旧 URL 的重定向仍由 GitHub 保留。
  - **产品仓是 PUBLIC**（`bayernjf/pr-helper-git`，2026-11-11 pushedAt 10:01Z）。
    本文档与 README 里「local-only / no remote / never pushed」的旧说法**与事实
    不符**，已就地更正；仓库是否转私有属用户决策，未擅自更改。
  - **冻结的 desktop 壳未改**：`desktop/main.swift:204,221` 与
    `scripts/desktop-build.mjs:12` 仍是旧显示名；desktop 已冻结、无法验证，
    故不在本次范围。注意 `main.swift:207` 的 `setFrameAutosaveName` 是
    **持久化键**不是显示名，改它会重置已保存的窗口位置。
  - 验证：隔离实例 + headless Chromium **8/8**（标签名、served HTML、
    390 宽 `/m`、设置页数据目录未变、0 console error / 0 失败请求）。
    并做反向变异证明检查能红：把 `dist/index.html` 标题改回 Git2 后 4 条转红，
    随后按 sha256 还原（`244ee7a9…`）并复测 8/8。

## pr-helper-git 本地清理（2026-11-11 全部执行，本地已归零）

背景：pr-helper-git 于 2026-11-10 推 GitHub（PRIVATE + ARCHIVED）并完成资产迁移。
原本地目录按 A6 约定保留一个发布周期（「到期后执行，不要提前」）；2026-11-11
用户逐项明确批准提前清理，反悔期由用户覆盖。

已删除（本地不再有任何 pr-helper-git 副本）：

- [x] 完整副本 `pr-helper-git-archive/`（4.3M）。删前核验：dirty=0、未推送 commit=0、
      `git ls-remote origin main` = `18413da` 与本地 HEAD 一致、
      `source-20261111-0021.bundle` 试克隆还原 144 commit / 5 tag
- [x] 空壳目录 `pr-helper-git/`（4.0K，仅 README-ARCHIVED.md）。删前以
      `lsof -a -d cwd -Fn` 精确匹配确认无进程锚定，`lsof +D` 无打开文件
- [x] 旧数据目录 `~/.pr-helper-git/`：`audit.log`（2071 条）、`repos.json`、
      `settings.json`（含 40 字符 `ghp_` classic PAT，login `bayernjf`）及空目录本身。
      前两者删前与备份副本 sha256 相同，且已核验不含凭据（68 处 40 位十六进制全部
      落在 `commit`/`good`/`bad`/`shas[]` 等 git 对象字段）
- [x] 旧实现的 4 个本地测试仓：`git-demo-playground`、`git-notes`、`git-sync-test`、
      `git-clone-ui-test`（删前均 dirty=0）
- [x] 冷备份目录 `000mycodes-backups/pr-helper-git/`（9.7M / 16 项：10 个 source
      bundle、2 个测试仓 bundle、旧数据 3 副本、RESTORE.md）

不可逆后果（用户在列明后果的选项下选择全删）：

- `git-demo-playground`（19 commit，HEAD `a691fdd`）与 `git-notes`（3 commit，
  HEAD `7de9549`）**无远端**，其唯一副本 testrepo bundle 已随备份目录删除，
  22 个 commit 永久丢失。`git-sync-test` / `git-clone-ui-test` 的远端
  `bayernjf/pr-helper-git-sync-test` 保留，可 re-clone
- 旧 `v0.6.1` annotated tag 对象 `9726fd6`（该 tag 后移至 `efd54b8`）仅存在于
  `source-20261110-2007.bundle`，已随之删除；其指向的 commit `951c7f4` 在 GitHub
  归档仓中仍在。删前已核验：9 个旧 source bundle 的 71 个 ref 中 70 个被最新 bundle 覆盖
- 旧审计 2071 条（2026-11-05→11-10）已无副本

唯一恢复源：GitHub 归档仓 **`bayernjf/pr-helper-git-archive`**（PRIVATE + ARCHIVED）。
2026-11-11 核验：main = `18413da`，5 个 tag 齐全（v0.3.0–v0.6.1，sha 与原最新 bundle 一致）。
⚠️ 该仓 2026-11-11 由 `bayernjf/pr-helper-git` 改名而来（用户要求，为把
`pr-helper-git` 这个名字让给产品仓）。**旧地址 `bayernjf/pr-helper-git` 现在指向
公开的产品仓，不再是归档仓**——任何旧书签 / 旧记录里的归档地址都要换成
`pr-helper-git-archive`。改名后已复验 main 与 5 个 tag 均完好。

凭据处置（2026-11-11 用户决定：**不吊销**，此项已关闭）：

- [x] 旧 `settings.json` 里那串 40 字符 `ghp_` classic PAT：**本地副本已删，
      GitHub 侧保留**。用户明确「这三个 token 是我要用的」。当天登录 GitHub
      核到账号下共 3 串 classic token，全部在用：`GitHub CLI`、
      `Visual Studio Code`、`job-agent GITHUB_TOKEN`。
      本机 `gh auth token` 同样是 40 字符 `ghp_`，与旧项目那串特征一致，
      且旧记忆记载其来源就是 `gh auth token`，因此**很可能是同一串**
      （判别实验未做完，不下确定结论）。吊销会打断 gh CLI，故不做。
      ⚠️ 后续会话不要再把这串当作「待吊销的泄漏凭据」去删除。
      git2 不依赖它：服务端 `config.json` 无 `github.token`，代码里也没有
      `gh`/环境变量回退；git 传输走 SSH（`git_protocol: ssh`），不受影响。

保留、不属于 pr-helper-git：`pr-helper`、`pr-helper-landing`（独立活项目）、
git2 现役测试仓（`git-e2e-test`、`git-init-check`、`Hello-World`；前两个于
2026-11-12 去掉「2」改名，GitHub 仓同步改名）、
git2 内继承资产（`docs/archive/pr-helper-git-desktop/`、`docs/parity-archive.md`）。
