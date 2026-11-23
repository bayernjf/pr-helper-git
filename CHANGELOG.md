# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。版本号在 `package.json` 与 `handoff.md` 之间保持同步。

## [Unreleased] - 2026-11-22

### 变更
- **app-state 仓库切片**：仓库数据 context 进一步拆为 registry、active repo、active brief、status、refs、history 六个切片，并提供精确 hooks；38 个生产消费者从聚合 `useRepoData` 迁移到对应切片。提交选择、日志过滤与加载更多只更新 history 订阅者，不再连带触发侧栏、工具栏和详情面板重渲染；聚合 context 仅保留给测试注入与兼容回退。
- **Linked worktree 管理**：Git 侧栏 Worktrees 分组新增「管理」入口，可创建关联工作树（新分支或已有分支）、锁定/解锁、移除与清理失效元数据。创建要求绝对路径且位于所有已登记工作树之外；移除前展示影响范围与恢复路径，脏工作树需二次确认强制移除；主工作树、当前工作树和已锁定工作树受保护；目录已丢失的条目只能走 prune，不删除任何文件。
- **Git 三面板独立收起**：工具栏新增左侧边栏、底部工作区、右侧提交详情三个布局开关；底部与右侧状态分别持久化为 `workPanelCollapsed` / `detailCollapsed`，刷新和重启后保持。收起后提交图自动回收空间，选中提交、暂存、diff 与提交表单逻辑不变；左侧继续沿用 `⌘B` 与 `sidebarCollapsed`。
- **危险操作影响范围与恢复路径**：确认弹窗新增 `Impact` / `Recovery path` 两段，先说明动作会改变什么，再给出可行的恢复方式。覆盖强制推送、清理未跟踪文件、硬重置和删除流程；明确远端 ref 移动、未跟踪文件/工作区改动不可由 Git 恢复，以及 reflog、其他克隆、文件系统备份、数据库备份等恢复边界。
- **五模块 Apple 风格视觉体系**：Dashboard、Git、Pull Requests、CI Health、Flows 统一改用 Apple 系统灰阶、SF 字体栈、hairline 分隔、系统蓝强调色与更克制的阴影。工具栏重排为左侧仓库/分支、中部五页 segmented 导航、右侧同步动作；默认强调色从 violet 切换为系统蓝，色板收敛为 blue / rose / forest / amber / teal / crimson / indigo。
- **Git 与 PR 布局修正**：未选中提交时详情栏不再常驻占宽，提交图独占整行；PR 页顶部独立为 `.pr-toolbar`，避免与全局工具栏样式串扰；仓库卡、PR 卡、CI 指标卡、Flow lane 与步骤卡改用统一表面层级。
- **桌面窗口底色同步**：Swift 薄壳的深色/浅色窗口背景分别改为新 token `#121214` / `#f2f2f7`，与 Web 内容边缘保持一致。

### 修复
- **自动合并后 stage-advance 未调度**：`runAutomationMergeAction` 先把 stage 写成 `pull_state=merged`，下一次 reconcile 因 `ahead_by=0`、状态终态而按 settled 提前返回，导致 `auto_advance` 永远不入队。现在 merge action 在写完 merged 与审计后直接调用 `scheduleServerAdvance`，advance 调度失败只记日志、不回写合并失败；新增回归测试。双 stage 实测 PR #23 合并后 `advance-stage` action `4754` 自动入队并成功，随后 PR #24 自动创建/合并。

### 验证
- `npm run lint`、`npm run typecheck:server`、`npm test`（1229 tests / 72 files）、`npm run build`、`npm run e2e`（162/162）通过。
- 桌面：`desktop:native-test`、`npm run desktop`、`desktop:smoke` 通过；包内版本 0.3.20，本地 commit 标记 `714120c`；`/Applications/PR Helper Git.app` 已替换，旧包备份为 `PR Helper Git 0.3.20-local-f255d35.app`。
- 无头 Chrome 逐页检查五个模块的 dark/light 与 1440×960 / 1000×700 两种窗口；Git 页额外验证展开、仅收底部、仅收右侧、两者全收四种组合，并确认刷新后状态保持。

## [0.3.20] - 2026-11-22

### 修复
- **本地 push 触发的 reconcile 预算**：新增 `LOCAL_PUSH_RECONCILE_BUDGET_MS = 40s`，仅对 `eventName=local-push` 生效；交互式手动刷新仍保持 8s。`reconcileRealtime` 把 eventName 传入预算选择器；30s reconcile 租约每 10s 续租，40s 预算落在 45s 外层上限内。0.3.19 的 8s 预算曾把真实 push 记为 `degraded`；0.3.20 实测 20s 仍被 `pullForStage` 拖过预算，40s 后真实 push run 273 在 10.685s 内成功并自动创建 PR #78，PR #78 checks 2/2 后自动合并为 `5a98a72`。
- **PR 页面 Loading 核实**：Pull Requests 页面约 20 秒后正常加载 77 条已合并 PR；确认是 GitHub 列表请求慢，不是前端死锁或接口错误，未改代码。

### 文档
- **补全 0.3.19 发布记录**：handoff 增加产品界面 Push、PR #77、merge commit `51d799f`、远端 tag 和 GitHub Release 证据。

### 验证
- `npm run lint`、`npm run typecheck:server`、`npm test`（1223 tests / 72 files）、`npm run build`、`npm run e2e`（162/162）通过。
- 桌面：`desktop:native-test`、bundled Node 22.23.5、`desktop:smoke`、zip 完整性、dmg 校验与 `SHA256SUMS` 全部通过。

## [0.3.19] - 2026-11-22

### 变更
- **本地 push 即时校准自动流程**：`POST /api/push` 成功后按 remote 解析 `owner/name`，对该仓库立即触发定向 reconcile，不再等 5 分钟 cron；cron 批量从 8 提升到 16，当前 15 个活跃流程一轮可覆盖。手工 `git push` 仍由 cron 兜底。
- **主题强调色扩展**：在原有 Violet / Rose / Ocean / Forest / Amber 基础上新增 Teal / Crimson / Indigo，设置面板共 8 个色板；新增配色沿用现有 Catppuccin 风格语义色，并让色板勾选图标按当前深浅主题使用对应的 `on-accent` 对比色。
- **Flows 旧版 UI 细节对齐（第二批）**：看板 lane 头部改为旧版顺序控件 + 标题/运行摘要 + 折叠图标结构；`Preflight all flows` 从弹窗改为看板内联面板；流程详情与步骤抽屉补上独立的 Actions 门禁（通过 `head_sha` 读取 `/actions/runs`，抽屉缺 `head_sha` 时回读 PR 详情）；步骤抽屉把状态、PR、checks、Actions、更新时间合并为 `drawer-status` 卡片；Flows 内的 Create PR 打开固定 source/target 的创建对话框，复用本地草稿、AI 生成（当前仓库已打开时）、重复 PR 检查和 GitHub 直连创建；source 分支被删除时显示历史 PR 状态提示。
- **Flows 看板与流程详情页重排**：看板默认收起泳道，标题、运行状态和操作拆成两层，新增“全部展开/全部收起”；阶段卡改为可横向填充的管道卡，带状态色、PR 引用和更新时间；Run history 与 Timeline 并成一行并补齐样式；步骤抽屉同步放大并改为分区卡片。流程详情页改为两栏：左栏进度条 + 阶段时间线，右栏下一步动作、最近运行和流程信息；阶段事件改为独立卡片。
- **Flows 看板与详情页补齐旧版能力**：看板 lane 新增 Edit/View、拖拽手柄与自定义顺序排序、共享流程/团队徽标、`N warnings` + 首条可读文案；Run history 展示 source→target、状态、版本、PR 引用与完成时间，Timeline 展示消息、路由、PR 与时间。详情页新增 Refresh status、阶段内联 Open PR/Create PR/Merge PR/Rerun Actions/Codex repair/step details、checks 门禁逐条展开、可折叠 Stage events，以及可直接落库的逐阶段 Automation 开关（auto-create/auto-merge/auto-advance，前置不满足时禁用并提示）。
- **Git 侧边栏新增 Worktrees 分组**：通过 `git worktree list --porcelain` 只读列出主工作树之外的 linked worktree，显示分支或 detached 任务目录、当前标记、锁定/可清理状态；路径作为 tooltip，点击复制。并行 AI 编码任务在 `.agent-ops/tasks/<id>/work` 下时按 `<id 前 8 位>/work` 区分，避免一排重复的 `work`。
- **非 Git 模块隐藏侧边栏开关**：侧边栏只在 Git 视图存在，Dashboard / Flows / CI Health / Pull Requests 不再显示左上角的展开/收起按钮；`⌘B` 也只在 Git 视图生效。
- **仓库删除入口补充作用范围说明**：卡片、列表垃圾桶和右键 `Remove from list` 的 tooltip 明确说明只从列表移除此仓库，不删除本地克隆或 GitHub 远端；确认弹窗同步该文案。
- **自动创建 PR 文案改为全英文并加硬校验**：AI prompt 改为全英文，生成的标题和正文强制 English；创建前校验 Conventional Commits、必需段落、段落顺序、Related Issues 的 `Closes #` 形式，并禁止 `【PR Title】` 块和标题在正文中重复；首次不合规自动纠错重试一次，仍失败则暂停转人工，不创建 PR。
- **设置页改为 macOS 系统设置式两栏布局**：左侧按通用 / GitHub / 应用 / 高级分类，右侧以大标题 + 分组内嵌卡片承载表单；语言、主题、强调色改为设置项行，主题增加深色/浅色/跟随系统的缩略预览，强调色改为带选中态的色板，帮助入口改为可点击的设置行。成员仍只看到浏览器 PAT，owner 专属的 GitHub 账号、服务端 PAT、服务端数据、AI 与 A2A 保持原权限门禁。
- **仓库工具从设置页移到工具栏 More**：删除设置侧栏的 Repository tools 分类及其整页重复入口（Manage remotes、git config、reflog、audit、compare、git grep、提交搜索、跨仓库搜索）；这 8 个入口继续由工具栏 More 菜单承载，设置页只保留应用级配置，不再出现与 More 重复的分类。
- **设计 token 补齐间距与控件标尺**：`design/tokens.json` 新增 `spacing`（2–40px）与 `control`（30/28px 高度、12px 横向内边距、5/4px 纵向内边距），并由 `sync-tokens.mjs` 生成 `--space-*` / `--control-*`；设置页的输入框、下拉、紧凑按钮、卡片行与面板内距改为消费 token，控件横向文字内边距统一为 12px。

### 修复
- **自动合并门禁改为实时 head 门禁**：merge action 只允许作用于调度时的 `head_sha`；PR 又推新提交时取消旧动作并写 `head-changed`，不会拿旧 green 合并新 head。合并前实时读取该 head 的 check-runs、commit status、reviews、branch protection/rules；读取失败不当作绿灯。check-run 与 status 按 context 取最新一次，避免旧失败重跑挡住新成功；Approval 按用户最新 review 且限定当前 head 统计。private repo 的 protection/rules 403 视为不可读但不阻断，最终仍由 GitHub merge API 强制保护。
- **自动动作状态即时投影**：`create-pr` 成功当秒写入 `pull_number/pull_state/head_sha` 并排 merge action；`merge-pr` 成功当秒写入 `merged`，不再等下一轮 reconcile 刷新 UI。pending checks 的 merge action 不再吃 5 分钟 transient cooldown，按 2 分钟 drain 轮询。
- **看板阶段卡打不开步骤抽屉**：`StepDrawer` 原来只在流程详情分支渲染，看板上点击阶段卡只设置状态、不挂载抽屉；现在看板也渲染抽屉，阶段卡改为可键盘操作的卡片容器，PR 引用点击不再触发卡片打开。
- **Flows 看板配置警告、同步健康与运行历史不显示**：`BoardState` 构建时漏传 `syncHealth`、`configurationWarnings`、`runs`、`timeline`，导致 stale 标记和配置警告恒为空、看板拿不到运行记录；补齐后 warning 只在泳道展开时渲染，避免所有收起泳道同时挂黄条。
- **Flows 运行状态直接显示数据值**：看板与详情页的 Recent runs 之前显示 `completed`/`active` 等内部值；现在统一映射为 `Completed`/`Running`/`Failed`，并保留版本号与完成时间。
- **桌面端重启回到 Hello-World**：桌面壳每次以 `--port=0` 启动，WKWebView 的 localStorage 按端口隔离，端口一变活动仓库、主题等浏览器侧偏好全部读不到。现在把服务端口记入 `UserDefaults`，下次启动优先复用；端口被占用时才回退随机端口，并在就绪后记住新端口。
- **收起侧栏后内容贴左边**：侧栏折叠为负边距后，中间栏从窗口左缘开始，提交图轨道只剩组件内部 14px 内距。现在收起态给中间栏增加 12px 内容沟槽，并移除侧栏残留的右边线；展开态仍保持 0 边距。
- **设置页输入框文字贴边**：输入框横向内边距为 9px，按钮为 10–12px，卡片行 14px，三套节奏并存，长 URL 在 Agent card 等控件里视觉上贴住边框。现在统一走 `--control-padding-x: 12px` 与 `--radius-control`，同排 Copy 按钮和输入框文字内距一致。

### 验证
- Flows 看板在 1011px 视口实测：默认 0 条展开，“Expand all” 展开 15 条，“Collapse all” 收回 0 条；详情页两栏布局正常，阶段卡与侧栏无横向溢出；看板与详情页的步骤抽屉均可打开并用 Esc 关闭。
- Flows 旧版能力实测：展开首条 lane 时只有该条显示 `1 warning`，Run history 展开为 `dev → main`、`Completed · v16`、`#192`；详情页 `checks 8/8` 可展开、Stage events 可折叠，三个 Automation 开关中 auto-create/auto-merge 为开启、auto-advance 为关闭且均可操作。
- Git 侧边栏实测：`agent-ops` 的 `WORKTREES` 分组显示 11 个 linked worktree（主工作树不重复出现在该组），detached 任务显示为 `b9749884/work` 等易区分标签，完整路径进入 tooltip；Dashboard 与 Flows 视图左上角侧边栏按钮为 0 个，Git 视图恢复显示。
- 1221 tests / 72 files；E2E 162/162；lint / typecheck:server / build 全绿；1011px 与 900px 视口实测收起态 center 从 x=12 开始、轨道 x=26，展开态 margin 0。
- 测试仓 `bayernjf/git-e2e-test` 真实验证：PR #17（action 4731/4733）自动建 PR、2 个同名 check 去重为 1/1 通过、自动合并成功，stage 投影与 action 成功同一秒写入；PR #18 验证 head guard：action 4735 计划 `c00812a`，PR 推进到 `4fc21de` 后动作被取消并写 `head-changed`，随后新 action 4736 在 1/1 checks 通过后自动合并。
- 真实 `agnes-3.0-flash` 以当前 9 个提交连续生成 3 次，标题/正文均通过新校验，无 `【PR Title】` 块、无 CJK。
- 设置页在 1280px 预览中走查深色/浅色、管理员/成员、英文/中文与应用、高级页；900px 最小桌面宽度下两栏宽度按 CSS 计算无横向溢出。安装版侧栏只保留 General / GitHub / Application / Advanced，Repository tools 分类不再出现；工具栏 More 菜单实测仍列出 8 个仓库工具入口。安装版 Advanced/A2A 高倍裁剪实测 Agent card 输入框文字距左边框约 14px（12px padding + 1px 边框 + 字形留白），与 Copy 按钮文字内距一致。
- 仓库删除 tooltip 在 1011px 视口实测：卡片垃圾桶与右键 `Remove from list` 均弹出“仅从列表移除，不删除本地克隆或 GitHub 远端”。
- `desktop:native-test` 增加服务端口记忆测试（空存储→0、空闲端口复用、占用端口回退）；真实桌面切换仓库后退出重启，检查活动仓库与设置页保持不变。

## [0.3.18] - 2026-11-21

### 修复
- **侧栏排序下拉遮挡分组标题**：0.3.x Dropdown 组件化后全局 `.dropdown-trigger` 大样式压过原生 select 时代的 `.branch-sort` 规则，触发器溢出行高盖住 LOCAL BRANCHES。现在直接以紧凑样式（20px 高、透明底、meta 字号）接管该触发器，分组标题窄宽度下优雅省略且计数不被挤掉。
- **行内"更多"按钮浏览器默认灰底**：`.row-more` 从未重置 UA 按钮外观，悬停行时露出浅灰原生按钮。现与 `.icon-btn` 同基线（透明、无边框、24px 方形），并补 `focus-visible`。
- **主题对比度体系（审计批）**：新增 `--on-accent`（深色主题粉彩 accent 上深字 8.0–11.3，亮色主题深 accent 上白字 5.41，light forest/amber/rose 单独深字）替换全部实底 accent/红色面上的白字；新增 `--green/amber/orange/cyan-strong` 文字安全变体救回亮色下状态字母与徽章；`--text-faint` 亮色 2.60→4.20。
- **双调色板合并**：badge/diff/pill/sticky/overlay/toolbar 的 GitHub 时代硬编码色值全部并入 Catppuccin token 体系（两主题，0 残留）；提交图泳道/节点改走 `--graph-1..8`/`--graph-node`，亮色主题不再残留近黑节点；accent 预设搬进 `design/tokens.json`，生成器同时产出 `accents.css` 与 `accents.ts`（设置面板色板单源、主题感知）。
- **对话框规范与键盘可达**：CodexRepair/GenerationRules 两个模态补 Esc；焦点陷阱覆盖 StepDrawer 与命令面板（Tab 不再逃出浮层、关闭归还焦点）；`btn-sm`→存在的 `btn-small`；RefSidebar 行与文件树行可键盘操作（Enter/Space）；11 处图标按钮补 `aria-label`。
- **加载与失败状态诚实化**：PR 列表首载渲染骨架屏（reduced-motion 静态降级），不再伪装成空列；Dashboard 以 `reposLoaded` 门闸消灭 "No repositories yet" 闪现；开着 PR 卡片 review 摘要未知时显示 `review ?` 而非误导性 "No review"；错误横幅用真 `inline-error`（`role=alert`），失败中心不再同事件双报；stash 加载失败保留原列表。
- **i18n 收尾**：命令面板空态、rebase 合并提交警告、stash 标签、上游选择器标题、确认弹窗、树展开/折叠 aria 等裸文案全部过 `t()/tp()` 并补中文词条。
- **token 卫生**：21 处裸 z-index 收进 `--z-*` 标尺（值 1:1 保留）、16 处 `999px` 走 `--radius-pill`、被覆盖的生成版 `--shadow-lg` 复活、无引用的 `--sp-*` 间距 scale 移除。

### 验证
- 1177 tests / 70 files（新增 honest-states：reposLoaded 生命周期 + ReviewPill UNKNOWN/NONE/APPROVED）；E2E 162/162；lint / typecheck:server / build 全绿；对比度实测 dark 8.12 / light-violet 5.41 / light-rose 6.38，dark/light/forest 三主题截图走查；CI（test+desktop）双绿后合并 PR #49。

## [0.3.17] - 2026-11-20

### 修复
- **桌面端顶部双击缩放覆盖原生标题栏**：0.3.16 的 `NSClickGestureRecognizer` 只挂在 webView 上，点击原生标题栏那一条不触发。现在改为应用级 `NSEvent` 左键监听，同时覆盖原生标题栏和 web 内容顶部 28px；工具栏按钮的单击不受影响。

### 验证
- 1173 tests / 69 files；E2E 162/162；lint / typecheck:server / build 全绿；desktop:native-test / desktop:smoke 通过。
- 真实桌面验证：在原生标题栏和内容区顶部双击，窗口均从 1280×852 缩放到 1411×923，再次双击恢复；版本 0.3.17。

## [0.3.16] - 2026-11-20

### 变更
- **app-state 领域拆分**：把单例 `AppDataProvider` / `useApp()`（411 行、43 个生产消费点）拆成 Preferences / RepoData / Actions / Busy 四个领域 context，`runAction` 稳定化，保留 `loadSeqRef + 1` 不变量；切主题、改 PAT、busy 翻转、日志过滤不再触发无关消费者重渲染。新增 `src/app-state/context-isolation.test.tsx` 隔离测试。

### 修复
- **桌面端顶部双击缩放**：透明标题栏下网页内容覆盖标题条，系统自带的双击缩放不触发。现在在 webView 顶部 28px 区域内识别双击并调用 `window.performZoom`，工具栏按钮不受影响；窗口背景色同时对齐 v4 调色板。
- **分支排序触发器遮挡分组标题**：0.3.x Dropdown 组件化后全局 `.dropdown-trigger` 样式压过旧的 `.branch-sort`，触发器溢出分组行并盖住 `LOCAL BRANCHES`。现在直接约束 `.branch-sort` 触发器为 20px 高、透明底、88px 值宽，并让分组标题在空间不足时省略而不是硬裁切。

### 验证
- 1173 tests / 69 files；E2E 162/162；lint / typecheck:server / build 全绿；desktop:native-test / desktop:smoke 通过；桌面端构建版本为 0.3.16。

## [0.3.15] - 2026-11-19

### 修复
- **PR 列表合并状态**：GitHub REST 的 pulls 列表即使对 open PR 也返回 `mergeable=null`，导致所有卡片显示「计算中」。新增 `POST /api/pull-mergeability`，按仓库用 GraphQL 批量读取 open PR 的 `mergeable` / `mergeStateStatus`，映射成 REST 字段后合并进列表；查询失败时保持原列表，不阻塞加载。
- **顶部加载条卡住**：切换仓库、历史范围、路径或过滤器时，调用方在 `loadRepoData` 之前捕获的序号被后者递增，导致 `finally` 永远不匹配、`repoLoading` 不复位。现在捕获即将占用的序号，加载完成后蓝条正常消失。

### 验证
- 1169 tests / 68 files；E2E 162/162；build 通过；隔离 18777 用真实 Hello-World 仓库验证接口返回 `mergeable:true` / `mergeable_state:clean`（GraphQL 的 `MERGEABLE` 枚举映射为 true）；`git-e2e-test` 临时 PR #15 的列表卡片显示 `mergeable`；切换仓库完成后顶部加载条消失。

## [0.3.14] - 2026-11-19

### 修复
- **服务端 PAT 模式下的分支选择器与步骤检查明细**：`FlowEditor` 与 `StepDrawer` 之前只把浏览器 PAT 传给 `useBranches` / `useCheckDetails`，服务端 PAT 模式下两个 hook 会提前返回，分支列表退化为自由文本、checks chip 无法展开。现在 hook 接收 `hasServerPat`，空浏览器 PAT 时仍走服务端代理（由服务端注入 admin PAT）；新增 3 个 hook 测试，真实服务端 PAT + 真实 PR #14 走查通过。

### 验证
- 1163 tests / 67 files；E2E 162/162；build 通过；隔离 18777 真实服务端 PAT 实测：FlowEditor source/target 列出 `dev`/`main`，StepDrawer checks 展开为 8 条真实 GitHub Actions 明细。

## [0.3.13] - 2026-11-19

### 修复
- **CI Health 窄窗指标标签**：指标卡标签改为按卡片宽度换行，不再在窄窗口下被省略为 `CI-blocked open P…` / `Post-merge CI fail…`；数值、提示与颜色语义不变。

## [0.3.12] - 2026-11-19

### 新增
- **看板预检全部流程**：Flows 看板新增「Preflight all flows」，一次只读检查所有未归档流程，汇总 failed/warnings/passed 与受检流程数，按流程展开分类 findings；单个流程检查失败不中断整批（fail-soft 列出失败原因）。
- **下一步行动面板**：流程详情顶部 NEXT ACTION 面板按服务端阶段决策给出当前应做之事；进度条按决策标注每一步（含「全部完成 · 等待新提交」态），checks 计数与合并后语义（`merged · post-merge checks passed`）上桌。
- **fan-in 分组**：看板对多上游汇入同一 target 的步骤按汇入组展示。
- **门禁披露**：步骤抽屉 checks chip 在有 PAT 且实时读取成功时展开为按来源分组的逐检查明细（状态图标、部署摘要按阶段分支 retarget、跳转 run 链接）；无 PAT 或读取失败保持纯 chip。open 阶段另显示 approvals 与 mergeability 门禁 chip。
- **merge 方法菜单**：抽屉 merge 按钮变为分裂按钮，箭头展开方法菜单；merge commit 为可用选项并入队引擎动作，squash/rebase 禁用并提示需到 GitHub 页面操作（引擎合并路径只产生 merge commit 的既有边界）。
- **分支选择器**：流程编辑器 source/target 变为可过滤 combobox，列出仓库真实分支（PAT 代理读取）；无 PAT 或读取失败降级为自由文本输入，wildcard source 规则仍可手输。
- **toast undo**：移除部署门禁与同步门禁结果改为带 undo 的 toast（7s 窗口、悬停/聚焦暂停倒计时）；同步 toast 显示 kept/added/removed 计数，无变化时明确提示。

### 变更
- **resolve 消隐**：抽屉/失败中心重跑、入队、接管成功后该步骤在看板本地消隐，直到投影追平、出现更新事件或 15 分钟 TTL 到期；详情/抽屉/进度仍显示原始投影。修正冻结源 wildcard resolve 参数倒置导致永不匹配的缺陷。

### 验证
- 1160 tests / 66 files；E2E 162/162；build 通过。隔离只读浏览器走查：板级预检 15 flows（17 failed/8 warnings/56 passed）、NEXT ACTION/进度语义、分支选择器降级实测；merge 菜单与 gate chips 由 open-PR fixture 组件测试覆盖（真实受管步骤当前全 merged）。

## [0.3.11] - 2026-11-18

### 新增
- **CI 健康看板（只读）**：新增第五个顶级视图 `CI Health`，扫描当前 GitHub PAT 账号拥有的非 fork、非归档仓库，按 PR 级最终检查状态统计总数、通过、失败、待定、通过率、被 CI 阻塞的开放 PR，以及默认分支 HEAD 的合并后 CI 失败。
- **失败原因分布**：失败检查按名称/标题/描述归入基础设施、超时、权限、部署、依赖、Lint、测试、构建、未分类九类，并列出失败 PR、失败检查项和 GitHub 跳转链接。
- **范围与缓存**：支持 7 / 30 / 90 天窗口、仓库多选（localStorage 持久化）、`refresh=1` 强制刷新；服务端内存缓存 10 分钟，首次扫描约 30–60 秒。
- **数据边界**：只走 GitHub REST + GraphQL 只读接口，不读取 pr-helper 生产库、不依赖其 14 个流程配置，也不写入 GitHub。

### 验证
- 1099 tests / 61 files；E2E 162/162；build 通过；`GET /api/ci-health?days=30` 真实 loopback 请求通过，二次请求命中缓存。

## [0.3.10] - 2026-11-18

### 变更
- **更新下载进度**：桌面更新进度窗口在下载时显示传输速率与预计剩余时间（如 `12.4 MB of 47.7 MB · 1.2 MB/s · 32s left`），慢速网络不再只看到长时间不动的百分比。
- **更新失败可直接重试**：失败窗口增加 `Retry`，菜单项变为 `Update failed — Retry`；点击会沿用当前 release 重新下载，不必关闭窗口后再走一遍 Check for Updates / Download。
- **权限提示**：服务端 `admin access required` 统一转为可操作提示，说明需要 admin、请 owner 在“团队”中提升角色或改用 owner 账号；仓库管理弹窗对 member 直接显示提示并禁用提交。

### 验证
- 1093 tests / 60 files；E2E 162/162；build 通过；桌面 native-test + Swift 壳编译通过。

## [0.3.9] - 2026-11-18

### 修复
- **权限边界**：仓库注册/移除/克隆/初始化，以及控制塔的 automation / saves / credentials 写入路由改为 admin 必需；member token 在看板上保持只读。GitHub installations 枚举同样收紧到 admin。
- **Webhook 请求体上限**：token-exempt 的 webhook 接收端改用 `readRawBody`，统一 256KB 上限，避免无界请求体导致内存/中断泄漏。
- **Dashboard 刷新**：修复 30 秒自动刷新定时器因依赖引用变化而永远不会触发的问题；PR 数量/owner 探测改为按仓库集合内容而非数组引用触发，避免每 30 秒重复发起 N 次远端探测。
- **并发保存**：`/api/save` 临时文件增加 pid+时间戳+计数器唯一后缀，避免同一文件并发保存时互相覆盖半写文件。
- **grep-all 预算**：跨仓库 grep 增加 30 秒墙钟预算，避免 N 仓 × 单仓超时把请求拖到数分钟。
- **损坏 config 失败关闭**：`config.json` 解析失败时保留 `.corrupt-*` 备份，读返回空视图，所有写入抛错，直到恢复文件；不再静默用空注册表覆盖仓库/用户。
- **审计写入原子性**：audit append + rotate 走 `serializeWrite` 链并 await，避免半行/双 rotate。
- **错误信息**：顶层 500 不再把 `err.message` 回显给客户端；listen 回调保护 `reconcileWatching`，配置读取错误不会崩溃启动。
- **UI 细节**：快速切换仓库时按 load generation 清理 loading；StepDrawer 支持 Escape 关闭与焦点回归；Dropdown 增加 `aria-activedescendant`；Dashboard 卡片/行支持按钮语义与 Enter/Space；PrBoard 评论摘要按需懒加载，去掉每页 N+1 GitHub 调用；事件时间戳跟随 locale，force-push 确认与 dashboard toast 已翻译；移除 v4 前遗留的 `.lv-*` 色块。

### 验证
- 1092 tests / 60 files；E2E 162/162；build 通过。

## [0.3.8] - 2026-11-17

### 变更
- **`Check for Updates…` 菜单项随更新状态变化**：检查时显示 `Checking for Updates…`；下载时直接显示文本进度条和百分比（如 `Downloading 0.3.8 [████░░░░] 42%`）；下载完成显示 `Update ready — v0.3.8`；失败显示 `Update failed — Show Details`。
- 菜单项在更新过程中也是恢复进度窗口的入口，不再需要单独的 `Show Update Progress` 菜单项。

## [0.3.7] - 2026-11-17

### 修复
- **桌面更新进度窗口可最小化**：下载进度从阻塞式 sheet 改为独立窗口，主窗口保持可用；点黄色最小化按钮后可继续办公，从 Dock 或菜单 `Show Update Progress` 恢复进度窗口。
- **下载完成/失败状态留在同一窗口**：校验完成后窗口内直接显示 `Install & Restart` 与 `Later`；失败也内联展示并保留 `Close`，不再用阻塞弹窗打断操作。

## [0.3.6] - 2026-11-17

### 修复
- **桌面更新过程不可见**：更新下载现在显示百分比、已下载/总大小和 SHA-256 校验状态；下载校验完成后弹出 `Install & Restart` 确认，不再静默替换。

## [0.3.5] - 2026-11-17

### 变更
- **主题 v3：面板层次提升与统一动效**：暗色背景梯级整体抬升并拉开层次，面板不再与背景混成黑色；交互元素统一使用平滑的 hover 过渡和一致的时长/缓动曲线，尊重系统“减少动态效果”设置。
- **主题 v4：Catppuccin 清新护眼可爱主题**：暗色采用暖紫夜底 + 粉彩语义色 + mauve 主色，浅色采用 Latte 奶白系；accent 预设可爱化并新增 Rose 粉色。
- **排版与交互打磨**：统一正文/标题行高与字号层级，补齐全局键盘焦点环，调整 PrBoard 交互与空态文案，减少布局跳动和视觉噪声。

## [Unreleased]

### 新增
- **流程控制塔（Flows，pr-helper 迁移）**：跨仓库泳道看板（六筛选/聚合/搜索/排序/上下移动）、流程详情（进度条/分步状态/事件流）、步骤抽屉（创建 PR/合并/重跑/AI 接管/重新生成）、失败中心（检查失败/待审批/部署失败/受阻自动化聚合）、流程编辑器（新建/编辑/自动化开关+即时效果确认/恢复策略）
- **AI 自动化凭据管理**：编辑器内配置 AI 凭据（Base URL/模型/密钥，服务端加密存储），自动创建 PR 的消息由其起草；生成规则库接线（启用自动创建时可从库中选择规则）
- **失败通知**：可行动的自动化失败（动作进入 paused/failed）推送 macOS 本地通知；可选飞书 webhook（`PR_HELPER_GIT_FEISHU_WEBHOOK`）
- **推进开关持久化**：本地迁移 048 修复原版缺陷——「合并后自动推进」此前在原版从不持久化（刷新即丢），本地已可持久保存并生效

### 变更
- **主题 v4（清新护眼可爱）**：Catppuccin 基调全套重设计——暗色为暖紫夜底（Mocha 化）+粉彩语义色+mauve 主色；浅色为 Latte 奶白系；accent 预设可爱化并新增 **Rose 粉色**
- **动效系统**：统一时长刻度与缓动曲线，所有交互元素 hover 平滑过渡（不再瞬跳），移除位移类抖动；尊重系统"减少动态效果"设置

### 修复
- **桌面单实例守卫**：重复启动（双击/启动器/直接执行）现在激活已运行实例并退出，不再多开（此前直接执行二进制会绕过 LaunchServices 造成双开+双 server）
- **桌面标题栏主题跟随**：标题栏不再固定浅色——随应用内深浅主题实时同步（themeSync 桥接）
- **原版缺陷迁移修复**：自动推进开关的存储列缺失（本地迁移 048 补齐）

## [0.3.4] - 2026-11-16

### 修复
- **工具栏仓库下拉框选项被裁剪**：菜单此前渲染在 40px 高、`overflow: hidden` 的包装层和横向滚动的工具栏内，几乎全部选项不可见。现在所有 Dropdown 菜单通过 portal 渲染到 `body`，以固定定位锚定触发按钮；下方空间不足时自动向上翻转，窗口缩放或滚动时重新定位。仓库选择器样式也改为作用在触发按钮上，不再出现双层边框。

## [0.3.3] - 2026-11-16

### 新增
- **Dashboard 卡片 / 列表视图切换**：工具栏新增视图切换（选择持久化）。列表视图按仓库逐行显示 Repository / Owner / Branch / Status / Last commit，GitKraken 风格；右键菜单、置顶、移除与 30 秒状态刷新在两种视图下一致。
- **统一的仓库状态徽章**：铅笔图标 + 未提交文件总数（tooltip 拆分已暂存 / 已修改 / 未跟踪）、↑ 本地未推送提交数、↓ 远端未拉取提交数、冲突数与开启 PR 数；卡片与列表共用同一套状态渲染。

## [0.3.2] - 2026-11-15

### 新增
- **GitHub App Device Flow 登录（可选）**：Settings → GitHub account 显示 8 位设备码，打开 `github.com/login/device` 授权，应用内轮询直到完成；连接后显示账号/头像与 App 安装列表。只用于身份与仓库发现，本地 token 仍是唯一认证边界，GitHub 写操作继续走 PAT/引擎凭据；user token 存于 `config.json`（0600），永不回传浏览器。
- **A2A / Agent Card**：公开卡片 `GET /api/a2a/agent-card`（含 `/.well-known/agent-card.json` 与 `agent.json` 别名）+ JSON-RPC `POST`（tasks/send、sendSubscribe、get、cancel）。默认 plan 模式；execute 模式经本地引擎 enqueue 真实 create-pr/merge-pr、直接重跑 Actions、读取部署健康投影；生产回滚永远升级人工审批。鉴权 fail-closed（`PR_HELPER_GIT_A2A_TOKEN`，兼容 `ZEUS_A2A_TOKEN`，或 Settings 生成的 token；config.json 只存 SHA-256 哈希，明文只显示一次），任务存内存（30 分钟 TTL）。

### 修复
- **服务端 PAT 与 GitHub OAuth 连接互不覆盖**：`/api/pat` 的写入改为合并 `config.github`，删除只移除 token，避免抹掉 `github.oauth`。
- **github.com OAuth 端点代理支持**：Node fetch 不走系统代理，新增 CONNECT 代理客户端（`HTTPS_PROXY` 优先，macOS 回退 `scutil --proxy`），仅用于 Device Flow 两个端点。
- **GitHub 连接过期可见**：状态返回 `expired` 与 `expiresAt`，Settings 显示访问有效期，过期后提示重新连接。

## [0.3.1] - 2026-11-15

### 新增
- **桌面端应用内更新**：`Check for Updates…` 从「只跳转下载页」升级为完整更新流程——读取 `releases/latest`，下载 dmg + `SHA256SUMS`，校验 SHA-256，再交给一个 detached 辅助脚本替换运行中的 app 并重启。完整性锚定在发布时附带的校验和，无需 Developer ID 证书或公证。

### 修复
- **桌面 app 启动即崩**：迁移后 server 依赖 `postgres`/`web-push` npm 包，但桌面构建只复制 `server/` 与 `dist/`，装到 `/Applications` 后以 `ERR_MODULE_NOT_FOUND` 退出（弹窗 "Local server stopped"）。构建脚本现在把全部生产依赖闭包打进 bundle；冒烟测试改为把 bundle 拷出仓库树后真实启动 server 并断言 READY（此前在 `build/` 内启动会沿目录向上命中仓库的 `node_modules`，坏 bundle 也能假绿）。
- **应用内更新检查失败（HTTP 403 / 资产缺失）**：系统代理的共享出口 IP 耗尽 GitHub 未认证 API 配额导致 403——现在 403 自动绕过系统代理直连重试一次，错误弹窗附 GitHub 原文；GitHub 上传资产名把空格替换为点（`PR.Helper.Git-0.3.0-macos.dmg`），与带空格的本地名精确匹配必然落空——资产与 SHA256SUMS 匹配统一按该 sanitization 归一化。

## [0.3.0] - 2026-11-15

### 新增
- **pr-helper 自动化控制塔迁入**（迁移主体收口）：把被归档的 pr-helper 产品全部业务功能迁入本地，新增「Flows」顶层视图——Lane board（六筛选/搜索/聚合条/活动条/卡片）、流程详情（投影直出 + 30s TTL + 手动 Refresh live 对账）、步骤抽屉（创建 PR/合并/重跑/部署卡/时间线）、流程编辑器（步骤/路由/门禁/恢复策略 + 上移下移重排 + 换仓库确认）、失败中心（三段聚合 + AI 接管 + Codex 修复包）、归档/静音、运行历史、PR 引用复制、流程审计（CSV 导出）、同步健康度、只读流程预检（六类检查）、团队四角色管理。
- **本地自动化引擎**：本地 Postgres（OrbStack 单容器）+ 幂等动作队列（create-pr/merge-pr/advance-stage）+ drain 执行器 + 对账引擎（租约/公平轮转/分级预算）+ 触发器三通道（fs.watch / HMAC webhook 接收端 / 定时对账）+ AI 失败接管 + Actions 重跑 + 部署门禁跟踪与确认式回滚 + 影子模式（只读观测）。
- **团队四角色**：owner/editor/operator/viewer，创建团队、成员管理、个人流程共享，`TeamsModal` UI 与角色矩阵。
- **launchd 常驻**：`launchd/` install/uninstall 脚本，KeepAlive 崩溃自愈，开机自启。
- **失败通知**：macOS 本地通知（osascript）+ 可选飞书 webhook（`PR_HELPER_GIT_FEISHU_WEBHOOK`）。

### 修复
- fix(git): include the root commit in commit-file listings (`diff-tree
  --root`), so the first commit no longer reports zero changed files.
- fix(github): use the server PAT from either `config.json` or the
  `GITHUB_TOKEN` injected from `credentials.env`, so an existing local PAT
  powers the PR pages and GitHub proxy without re-entering it.
- fix(config): resolve `credentials.env` under the effective data directory
  (`PR_HELPER_HOME` aware), so isolated homes do not read real credentials.
- fix(flows): carry `headSha`/`mergedAt` into the detail first paint, so an
  open PR with failed checks no longer reads “waiting to create a PR”.
- fix(migration): persist the auto-advance stage flag locally（迁移 048）+ 扩审计 CHECK 白名单（迁移 049）。
- fix(server): make PAT fallback reachable for deployment checks。

### 测试
- 随迁 pr-helper 引擎测试网（418 store 不变量 + workflow-rows + github-api + ai-credentials）+ 143 域测试 + Phase 3 语义模块 + 9 webhook 契约测试 + 3 团队权限测试 + 3 凭据解析测试。
- E2E 扩展到 **155 通过**（补分支 checkout/rename/delete、stash pop）。
- 单元/路由测试 **1040 / 55 文件**。
- test: pin `jsdom` to exact 26.1.0。

## [0.2.6] - 2026-11-12

### 新增
- 桌面构建新增可选 Node 运行时捆绑：`BUNDLE_NODE=1 npm run desktop` 会下载官方 Node `22.23.5` macOS tarball，校验 `SHASUMS256.txt` 后缓存到 `build/node-cache`，只把 `bin/node` 和 `LICENSE` 放进 `Contents/Resources/runtime`；桌面壳优先启动 bundle 内 Node，找不到才回退系统 Node。
- 桌面应用菜单新增 **Check for Updates…**：读取 GitHub `releases/latest`，按 `CFBundleShortVersionString` 比较 `tag_name`；有新版本时提供 **Open Release Page**，无 release 或网络失败时给出明确提示。只做检查与跳转，不自动下载或替换 app。
- 新增 `desktop/node.entitlements`（JIT / unsigned executable memory）；`desktop-dist` 在签名构建中先单独签内置 Node，再签外层 app，避免 `--deep` 覆盖 Node 的运行时权限。
- `desktop:smoke` 增加内置 Node 检查：存在 `runtime/node` 时校验 `runtime/LICENSE`、`--version`（major ≥ 22）和 Mach-O 格式。

### 变更
- macOS CI 改为用 `BUNDLE_NODE=1` 构建和冒烟，覆盖真正准备分发的带 Node 产物。
- 桌面文档补充 Node 捆绑、缓存、体积、签名和更新检查的边界。

### 测试
- `desktop:native-test` 增加版本比较断言，输出 `download destination and update-check tests OK`。
- 普通 `npm run desktop` / `desktop:smoke` 通过；`BUNDLE_NODE=1` 构建产出 Node `22.23.5` arm64，app 约 114 MB，`desktop:smoke` 输出 `bundled Node OK: v22.23.5`。
- 真机启动带 Node 的 app 后，子进程命令行确认使用 `Contents/Resources/runtime/node`，而不是系统 Node。
- 真机点击 **Check for Updates…** 已弹出 `No releases found`（当前仓库没有 published release）；`releases/latest` 的“有更新”分支待发布首个 release 后复验。

## [0.2.5] - 2026-11-12

### 新增
- macOS 桌面端解冻：保留 Swift `WKWebView` 薄壳，不引入 Electron/Tauri；新增标准应用菜单（关于、文件、编辑、刷新、窗口）、900×600 最小窗口，外部链接交给默认浏览器打开。
- 桌面端 **File > Open Repository…** 使用原生目录选择器，选中路径预填现有“添加仓库”弹窗，不新增第二套注册流程。
- 桌面端接住 Web 下载（如团队配置导出），文件落到 `~/Downloads`，重名自动加后缀，完成后在 Finder 中定位。
- 新增 `npm run desktop:dist`：输出 zip、dmg 与 `SHA256SUMS`；设置 `APPLE_SIGNING_IDENTITY` 后用 hardened runtime 签名，设置 `APPLE_NOTARY_PROFILE` 后自动提交公证并 staple app/dmg。`DESKTOP_BUNDLE_ID` 可切换分发用 bundle id。
- 新增 [`docs/desktop-distribution.md`](docs/desktop-distribution.md)，记录证书、公证、校验和发布步骤。
- CI 新增 macOS job：跑纯 Swift 下载落盘测试、无签名 `desktop:dist`、bundle 冒烟和 `SHA256SUMS` 校验。
- 修复桌面二进制部署目标：`swiftc` 现在显式按 macOS 11.3 编译，避免在较新 SDK 上打出 `minos 27.2` 而让旧 Mac 无法启动；`desktop:smoke` 会校验 `minos` 与 `LSMinimumSystemVersion` 一致。

### 修复
- 桌面壳同时接受 `PR_HELPER_GIT_READY` 与旧 `GIT2_READY` 就绪前缀，并同时设置新旧 desktop 环境变量，修复改名后启动 20 秒超时的问题。
- 桌面构建的 `CFBundleShortVersionString` 改为读取 `package.json`，不再硬编码 `0.1.0`；最低系统版本调整为 macOS 11.3（下载代理所需）。

### 测试
- 新增 `AddRepoModal` 桌面选目录预填测试；lint、server typecheck、单测 **337 / 34 文件**、生产构建、E2E **144/144** 通过，`npm run desktop` 构建通过。
- macOS 真机验收：原生目录选择器成功预填项目路径；团队配置连续导出生成 `pr-helper-git-team.json` 与 `pr-helper-git-team-2.json`，Finder 自动定位到最新文件。

## [0.2.4] - 2026-11-12

### 安全
- GitHub allowlist 拒绝 percent-encoded dot segments（`%2e%2e`），避免解码后绕过 `..` 检查。
- 服务端路径与凭据处理加固：仓库路径、凭据输入和写操作统一校验；`/api/repos/remove` 与 `/api/repos/add` 一样归一化路径，尾随斜杠或相对段仍能匹配。
- `/api/stage-all` 要求显式 `action: "stage" | "unstage"`，不再对缺失 action 的请求默认执行全量暂存。

### 重构
- `src/api.ts`（770 行）拆成 `api/core`、`api/git-read`、`api/git-write`、`api/repos`、`api/github`、`api/team`、`api/ai` 与统一入口 `api/index`。
- 写路由统一要求 POST，删除重复 import 与死代码；`routes-git-*` 领域模块同步瘦身。
- `RefSidebar`、`PrDetailSections`、`CommitGraph` 继续抽出子组件，前端大文件保持可维护区间。

### 修复
- 修复代码评审发现的前端交互问题；上下文菜单、横幅、合并策略选择器补齐中英文案。
- E2E `stage-all` 改为发送显式 `action`，与服务端新契约一致。

### 测试
- lint、server typecheck、336 单测 / 34 文件、生产构建、E2E 144/144 全通过；CI 同时覆盖 `main` 与 `dev`。

## [0.2.3] - 2026-11-12

### 新增
- **对比可选任意提交**：对比弹窗的两侧改用新的 `RefPicker` 组合框，可搜索引用与已加载提交（主题 / hint 一起匹配），也可直接输入 7–40 位 SHA 选中尚未加载的提交；候选超过 80 条时截断并给出常驻提示，方向键 / Enter / Esc 可用（Esc 先关候选列表，再关弹窗）。
- **对比可选工作区**：新增「工作区」一侧（服务端 `:worktree` 伪引用），把未提交改动与任意引用对比；作基线时 diff 方向自动反转，未跟踪文件单独计数并列出（不计入 diff），任一侧为工作区时自动落到「文件」页。两侧同时为工作区会被拒绝。
- **对比弹窗交换基线 / 头部**：新增交换按钮；弹窗改为固定高度框架，结果在内部滚动，空对比与长提交列表之间切换不再改变弹窗尺寸。

### 变更
- **显示名去掉「2」**：浏览器标签与启动横幅改为 `PR Helper Git`（`/m` 手机视图共用同一 shell，一并生效）。
- **运行时标识符同步改名（2026-11-12）**：包名 `pr-helper-git2` → `pr-helper-git`；数据目录 `~/.pr-helper-git2` → `~/.pr-helper-git`（首次启动自动 rename）；localStorage 键（pinned / draft / diff-font / prefs / dashboard / active-repo / PAT / commit-history / clone-parent）统一改为 `pr-helper-git:*` 命名空间（首次加载自动迁移）；认证 cookie `git2_token` → `pr_helper_git_token`、header 增加 `x-pr-helper-git-token`，旧名仍兼容读取；环境变量 `GIT2_*` → `PR_HELPER_GIT_*`（旧名仍兼容）；User-Agent 与 Tauri bundle id 同步更新。
- **GitHub 仓库改名**：产品仓 `bayernjf/pr-helper-git2` → `bayernjf/pr-helper-git`；原同名归档仓先改名为 `bayernjf/pr-helper-git-archive`（PRIVATE + ARCHIVED 不变）。旧 URL 由 GitHub 重定向；本地 `origin` 已于 2026-11-12 切到新 URL。

### 安全
- **服务端设置只归 owner**：`POST/DELETE /api/pat`、`POST /api/ai/config`、`POST /api/ai/test` 增加 admin 闸门；成员不再隐式继承服务端 PAT，必须自带 `x-github-pat`。
- **AI 密钥不跟随新端点**：修改 `baseUrl` 而未同时提交新 key 时清空旧 key；base URL 必须是合法 http(s)、不允许内嵌凭据，非 localhost 的 `http://` 强制改用 https。
- **敏感文件写入闸门**：stage / stage-hunk / stage-lines / stage-all / commit / mv / rm / clean / stash(-u) / AI commit-message 统一拒绝 `.env`、私钥、证书等路径；`clean` 先 dry-run 收集 preview 再实删，并在发现敏感路径时 409。
- **数据目录权限**：`~/.pr-helper-git2` 收紧为 `0700`，`config.json` / `audit.log` 为 `0600`；配置写入改为串行化 + 唯一临时文件 + rename，解析失败时保留 `.corrupt-*` 备份而不是静默清空。
- **审计脱敏**：clone URL 写入审计前移除 username/password、query 和 fragment。
- **开发模式防误绑**：`GIT2_DEV=1` 且绑定非 loopback 地址时拒绝启动，除非显式设置 `GIT2_ALLOW_INSECURE_DEV_HOST=1`。

### 修复
- watcher 与仓库注册表保持一致：`prune-repos` / 团队配置导入后停止多余 watcher、补齐缺失 watcher。
- `/api/repos` 的逐仓 brief 改为最多 4 个并发，避免注册表很大时一次拉起数百个 git 进程。
- light theme 的 legacy surface token 改为真正 alias 到 `design/tokens.css`，不再被 `styles.css` 的硬编码暗色 `:root` 覆盖。
- 设置页对 member 隐藏 server PAT / AI / 服务端数据维护区，并说明浏览器 PAT 仍可用。
- README / 设置页文案：E2E 144、单测 336/34、数据目录 0700/0600、PAT localStorage 口径、敏感文件覆盖范围、`GIT2_HOST` 与默认 loopback 的关系。

### 重构
- `routes-git.mjs` 从 2743 行拆成 100 行调度器 + `routes-git-helpers.mjs`（共享校验/仓库摘要/敏感路径/rebase helper）、`routes-git-meta.mjs`（health/audit/storage/registry/PAT/users/team）、`routes-git-read.mjs`（只读仓库接口）、`routes-git-write.mjs`（写操作接口）；`repo` 守卫和 GitHub fallthrough 保持在调度器里，避免改变路由顺序。
- `readAudit` 从“整文件读入 + 全量 parse”改为 `readline` 流式扫描 + 只保留最新 `limit` 条窗口；`total` 仍统计全文件匹配数，内存不再随审计文件增长。
- `routes-git-write.mjs` 再拆成 124 行写调度器 + `worktree` / `refs` / `history` / `files` / `network` / `stash` 六个领域模块，单文件最大从 1318 行降到 496 行。

### 测试
- 测试依赖 vitest `3.2.7` → `5.1.0`，修掉 `@vitest/mocker` / `tinypool` 的 1 moderate + 2 critical 告警；336/34 与 E2E 144 复跑通过。
- `PrDetailModal` 拆出 `PrDetailSections`（标签/描述/提交/审查人/检查/评论/合并方式），932→661 行；`CommitGraph` 的 CI 状态轮询抽成 `useCiBySha` hook，688→642 行。
- 前端 54 处 `catch (err: any)` 改为 `unknown` + 统一 `errorMessage/errorDetail/errorStatus` 助手，`src/api.ts` 的响应体从 `any` 改为 `unknown` 并显式收窄；新增 4 条错误助手测试。
- 前端大组件抽出 `RefSidebarParts`（组头/行/重命名弹窗）与 `WorkPanelTree`（文件树行/分组），`RefSidebar` 819→716 行、`WorkPanel` 747→559 行。
- 新增 `tsconfig.server.json` 与 `npm run typecheck:server`：对 `server/**/*.mjs`（排除测试文件）启用 `checkJs`，CI 与 `npm run lint` 并列执行。
- 新增 admin 权限、成员 PAT 不继承、敏感文件 stage/commit/clean、数据目录权限、URL 脱敏、AI endpoint 变更清 key、watcher reconcile、主题 token alias 的测试；CI 增加 `npm run e2e`。
- 新增 `appearance` 偏好/alias 测试与 `SettingsModal` admin/member 分区测试（6 条），并起隔离实例目检 light theme 主界面、设置弹窗与 Git 工作区。
- 对比补完：新增 `CompareModal.test.tsx`（15 条，覆盖未加载 SHA、80 行截断、Esc 分层关闭、方向键、工作区选项与自动切页、交换、未跟踪计数）与 5 条服务端工作区/SHA 路由测试；E2E +8 项（SHA 对比、工作区两个方向、未跟踪计数、两侧工作区与 `:worktree-ish` 的 400）。单测 311/32 → **336/34**，E2E 136 → **144**。

## [0.2.2] - 2026-11-11

### 新增
- **服务端 PAT 存储**：新增 `POST /api/pat`、`DELETE /api/pat`、`GET /api/pat/status`，PAT 可保存在服务端 `config.json`，浏览器不再必须持有；GitHub 代理在请求未带 `x-github-pat` 时注入服务端 token，只回传 `hasServerPat`，不回传 token 原文。
- **PAT 设置入口**：设置页新增 GitHub PAT 状态、保存与清除；token 不写入仓库、不回显到浏览器，也不写进日志。

### 测试
- **E2E 扩到 136 项**：吸收 git 侧的 destructive-scenario 覆盖（hard reset、force-with-lease、rebase/merge 冲突、clean、commit.template、allow-empty 等），从 115 增至 136，全部通过。
- **jsdom localStorage polyfill**：修复 Node >= 22 下测试环境的 localStorage 缺失，单测保持 287 / 27 文件。

### 变更
- **git 归档 / 单一主实现**：`pr-helper-git` 归档为 GitHub PRIVATE+ARCHIVED，本地保留 `pr-helper-git-archive` 与最终 bundle；设计 token 源、PARITY 台账、Tauri 桌面壳配置迁入本仓库。（后续：本地副本 `pr-helper-git-archive` 与全部本地 bundle 已于 2026-11-11 经用户批准删除，唯一恢复源为 GitHub 归档仓，见 handoff 清理台账）
- **文档校准**：README / handoff 更新 PAT 存储口径、E2E 基线、three-way merge 状态与 PR 实网验收 blocked 说明。

### 补记（0.2.0 已上线，原 CHANGELOG 漏记）
- Dashboard 整页化（`Dashboard | Git | Pull Requests` 三视图、open-PR 数、冲突/置顶/排序、后台 fetch-all、30s 刷新）。
- 提交图 CI 状态点、图片 diff、提交信息历史 / 50/72 计数 / amend 预填 / Discard All / 草稿持久化。

## [0.2.1] - 2026-11-10

### 新增
- **统一交互契约**：toast 统一为「类别图标 + 文案 + 关闭按钮」，错误/成功/提示使用同一套边框与语义色，停留 3.6 秒，容器 `aria-live=polite`，错误项 `role=alert`；确认弹窗补齐 `aria-labelledby` / `aria-describedby`，支持 `danger` 与自定义 `confirmLabel`，destructive 用红色按钮、中性操作用主色。

### 修复
- **Dashboard 移除仓库**：不再调用原生 `window.confirm`，改用共享确认弹窗，和其他破坏性操作保持一致。
- **toast 样式失效**：组件输出 `toast-success` / `toast-error`，CSS 之前却匹配 `.toast.success` / `.toast.error`，导致边框和图标颜色不生效；已改为匹配 `toast-*` 类。

### 测试
- 新增 `ui.test.tsx` 3 条 jsdom 契约测试（toast 类别/图标/role、confirm danger/primary 与 ARIA），单测 **287 / 27 文件**。

## [0.2.0] - 2026-11-10

### 新增
- **外观设置**：设置页新增深色 / 浅色 / 跟随系统三种主题模式与四套强调色（靛紫 / 海蓝 / 森林绿 / 琥珀）；顶栏按钮按深色→浅色→跟随系统三态循环，auto 模式监听系统配色变化；外观在首屏前应用并持久化到 `git2-prefs`。
- **服务端数据维护**：设置页显示数据目录与 `config.json` / `audit.log` 大小；新增「压缩审计日志」与「清理失效仓库记录」两个确认后执行的按钮，对应 `GET /api/storage`、`POST /api/maintenance/audit-rotate`、`POST /api/maintenance/prune-repos`，操作写入审计；清理只移除磁盘上已不存在或已非 Git 工作树的注册路径，不删除文件。
- **PR 标签管理**：允许列表补齐 labels 四条规则（仓库标签列表、PR 标签读取/添加、按名删除，标签名支持空格与 URL 编码）；PR 详情弹窗新增彩色标签 chip、移除按钮与「添加标签」下拉，只列仓库中尚未挂上的标签，仅 open PR 可新增，失败走 toast。
- **只读手机视图 `/m`**：单列窄屏布局（仓库选择 / 刷新 / 中英切换、分支与 ahead/behind、暂存计数、未提交改动列表、80 条提交列表；点改动或提交都弹出全屏详情，含签名结论、正文、文件 `+n/-n` 与单文件 diff），无任何写操作。`/m` 与 `?mobile=1` 都可进入；支持 `?repo=<path>&commit=<sha>` 深链直达；服务端为无扩展名的 GET 深链回退 `index.html`。
- **`GIT2_HOST`**：服务默认仍绑 `127.0.0.1`，可用 `GIT2_HOST=0.0.0.0` 或具体内网/Tailscale 地址覆盖；非 loopback 时启动日志打印告警，并额外打印 `/m` 的访问地址。

### 修复
- **merge 冲突契约**：`POST /api/merge` 命中冲突时改为返回 `409` 并带上 `conflicts` 与 `state`（之前走 `gitFail` 返回 400，前端拿不到冲突列表，与 revert / cherry-pick 的 409 约定不一致）；`POST /api/commit` 的「无暂存内容」守卫只在**非** `mergeInProgress` 时拒绝，取 `ours` 解决冲突后可以正常收尾提交。
- **中文文案覆盖**：i18n 之前只覆盖已经用了 `t()` 的 key，浏览器逐屏走查发现工具栏、工作面板、提交图筛选、快捷键说明、命令面板、团队/仓库/PR 弹窗与相对时间仍是裸英文；约 100 条文案改走 `t()` / `tp()`，`formatRelative` 与 `relativeAge` 输出「3 分钟前」这类中文单位。
- **toast 与错误标题本地化**：操作结果 toast 与 API 的 `err.message` 现在过词典（git 原始 stderr 细节保留原文）。
- **审计动作名本地化**：`repo-add` / `stash-create` / `rebase-interactive` 等 50 个服务端动作名在中文界面显示中文标签，英文界面保持原始标识符（与审计筛选、日志一致）。
- **`git bisect` 向导**：命令面板入口，选 good/bad 提交后 start，逐次标记 good/bad，reset 回起始分支；状态从 `.git/BISECT_LOG`、`.git/BISECT_START` 读取，服务重启后仍在。
- **子模块状态面板**：侧栏新增只读「子模块」分组，`git submodule status --recursive` 的四种前缀（已同步 / 未初始化 / 已修改 / 冲突）分色展示，附带短 SHA 与 describe。
- **提交签名验证**：新增 `GET /api/signature`（`git log -1 --format=%G?%x00%GS%x00%GK`），提交详情显示「已验证 / 签名无效 / 未签名 / 已过期 / 密钥吊销」等 `%G?` 状态；无签名密钥的仓库照常显示「未签名」。
- **提交图键盘导航对齐**：补 `PageUp` / `PageDown` / `Escape`（清空选中）与 `aria-activedescendant`，每行加 `commit-row-<hash>` 的 id；决策逻辑抽到 `src/lib/graph-nav.ts`，纯函数 + jsdom 交互 + SSR 标记三层测试覆盖。
- **窄窗口换行**：中文标签变长后「忽略空白」在窄 diff 面板竖排，`.ws-toggle` / `.context-picker` 加 `nowrap`。

### 测试
- 新增 HTTP 层 E2E（`e2e/run.sh`，端口 18774，`GIT2_DEV=1` 固定 `dev-token`、`PR_HELPER_HOME` 隔离、fixture 现场创建），覆盖 Security → 仓库注册 → 暂存/提交/撤销 → 分支/标签/储藏 → grep/对比/rebase 计划 → cherry-pick/merge → GitHub 代理守卫 → 数据维护 → 审计 → 注销，共 **115 项**（含 `/m` 深链 2 项）。
- `server/routes.test.mjs` 新增 merge 冲突契约 4 项（409 带冲突文件、取 `ours` 后提交产生 3-token 的 merge 提交、merge 之外的空提交仍 409）。
- 当前基线：**284 单测 / 26 文件**（`routes.test.mjs` 单独 95，手机视图 DOM 测试 2 项）、E2E 115/115。

## [0.1.0] - 2026-11-08

首个可用版本：纯本地 Web 工作台（无 remote、无桌面壳），React 19 + Vite 前端 + Node HTTP 服务，直接操作本机仓库。

### 新增
- 多仓库注册与总览（置顶、活跃度色条、全局 WIP 聚合、With changes 过滤、30s 状态刷新、批量 fast-forward 拉取）。
- 提交图（窗口化渲染、泳道布局、词级 diff、搜索高亮、冲突解决面板）、提交详情与按行/按块暂存。
- 分支、标签、储藏、远程、reflog、引用对比、`git grep` 仓库内容搜索、全历史提交搜索（message / author / path）。
- 写入闭环：提交（含 amend / allow-empty）、cherry-pick、soft 撤销提交、revert、merge（含四策略）、交互式 rebase（pick/reword/edit/squash/fixup/drop + 重排）、冲突 continue/abort。
- PR 面板：列表与详情、创建 PR、评审人/标签/评论、draft→ready、CI 门禁与分支保护提醒（GitHub 代理走白名单 + PAT）。
- AI 生成提交信息与 PR 描述（服务端存 key，`hasKey` 只回布尔）、团队身份与审计归属、审计日志可视化。
- 中英双语界面（英文原文作 key 的词典、计数规则、设置内语言切换）。

### 已知限制
- PR 相关能力仅在参数校验与单测层验证，未用真实 PAT 实网跑过。
- 桌面端（`desktop/main.swift`）冻结，不做新功能适配。
