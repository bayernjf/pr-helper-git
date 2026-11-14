# pr-helper → pr-helper-git 迁移方案与执行台账

> **文档定位**：本文档是 pr-helper → pr-helper-git 全功能迁移的**唯一核心台账**——
> 迁移方案、能力追踪矩阵、验收标准、决策记录、变更记录全部在此。任何后续调整
> （范围、验收标准、状态流转）**必须追加到 §12 变更记录**，并同步更新对应条目的
> 状态列。完成度以 §10 能力追踪矩阵的处置列为准，不以任何口头或会话结论为准。
>
> **创建**：2026-11-13 · **最后更新**：2026-11-13（初版）· **迁移发起人**：用户
>
> 状态图例：⬜ 待迁移 · 🔵 进行中 · ✅ 已迁移+验收通过 · 🔀 替代实现 · ⏸ 缓办 · 🚫 不迁移（理由在备注）

---

## 0. 文档使用规则

1. 本文档按 **迁移阶段（§5）→ 能力追踪矩阵（§10）→ Supabase 迁移处置（§11）** 三层组织：
   追溯某个能力 → 查 §10 对应行；核对某条数据库结构 → 查 §11；核对某阶段做什么 → 查 §5。
2. **每一条能力的处置列是完成度的唯一判据**。`✅` 必须满足该行"验收标准"列的全部条目
   并注明验证证据（测试/命令/E2E 用例号），否则不得标 ✅。
3. 范围、验收标准、阶段划分的任何变更 → 追加 §12 变更记录（日期 + 原因 + 批准人 = 用户）。
4. 与 `AGENTS.md` 的关系：本迁移经用户明确指令**推翻并修订** AGENTS 中的部分禁区
   （§2 决策记录 D-003/D-004/D-005/D-008）。修订稿在 Phase 2 前提交用户留痕；
   未列入修订的禁区（云平台 SaaS 能力）仍然有效。
5. **源仓只读原则（D-011，2026-11-13）**：pr-helper 的本地目录与 GitHub 仓在迁移
   全程**只读**——不修改任何文件、不提交、不加标注。一切"冻结/迁移中"声明只记录
   在本台账（本文档即声明载体）。允许的操作仅限：读文件、`git fetch`/`git log`/
   `git show` 等只读核对。被迁出产品保持原样，归档与删除决策在 Phase 5 之后。
6. **多会话协作协议（上下文对齐的唯一机制 = 本文档随仓库版本化）**：
   - 每个迁移会话**开场**：① 读本文档 §0 使用规则与 §12 变更记录（最新状态）→
     ② 读 §10 追踪矩阵找第一个 ⬜/🔵 条目 → ③ `git -C . log --oneline -5` 核对
     基线 → ④ 认领任务并在状态列标 🔵。
   - 每个迁移会话**收尾**：① 更新状态列与验收证据 → ② 追加 §12 变更记录 →
     ③ 更新根目录 `handoff.md` 的「pr-helper 迁移进度（实时段）」（D-013：实时进度
     记录在 handoff，方案与验收在本文档——双文档分工）→ ④ Conventional Commit
     提交并 push dev → ⑤ 跑备份脚本。
   - 会话中断/换会话不丢上下文：本文件随仓库存在，状态列就是断点。

---

## 1. 迁移目标与总范围（D-001，2026-11-10）

**目标**：pr-helper（GitHub-first PR / Release Control Tower）的**全部业务功能**迁入
pr-helper-git（React 19 客户端 + Node loopback server + 本地 Postgres），业务功能与体验
对用户**无感**；pr-helper 随即停止迭代并归档。

**范围内（全部迁入）**：工作流定义与规则、自动化引擎（队列/幂等/门禁/自动合并/推进）、
Actions 重跑与失败中心、AI 生成与失败接管、Lane board 与流程详情/编辑器、收敛路线视图、
团队与角色、审计、保留清理、通知（macOS + 飞书）、webhook 接收、E2E。

**范围外（明确排除，D-002，2026-11-10）**：
- 部署域整体：Cloudflare/Vercel 部署门禁、健康检查、确认式回滚、部署 run 跟踪的
  **功能面**（相关 schema 表仍随迁移照建，无害）；
- 云平台基建本身：Supabase 云、GitHub App OAuth、webhook 公网接收（改本地接收 + 轮询
  兜底，见 D-004）、Web Push（缓办，D-005）。

**已知不可无感项**（D-008 前提下）：Mac 关机/未开机期间自动化暂停（launchd 常驻 +
开机自启缓解；恢复后 reconcile 追平）。此为 D-008 方案 B 的既定代价，用户知情。

---

## 2. 决策记录（按时间序，全部经用户确认）

| ID | 日期 | 决策 | 影响 |
|---|---|---|---|
| D-001 | 2026-11-10 | pr-helper 停止迭代，全功能迁入 pr-helper-git，体验无感 | 本文档成立 |
| D-002 | 2026-11-10 | 部署域排除（Cloudflare/Vercel 门禁、健康检查、回滚不迁） | F/C/B 域相关行 🚫 |
| D-003 | 2026-11-13 | 持久化 = **OrbStack 本地 Postgres 容器**（仅 localhost），47 个 Supabase 迁移**原样执行**；`postgres` npm 客户端为首个运行时依赖（打破"零依赖"，用户知情确认） | Phase 1 形态；AGENTS 修订 |
| D-004 | 2026-11-13 | **GitHub webhook 直接使用**（用户纠正"仅局域网"的过度推断）：本地 server 提供接收端点，可达性方案在 Phase 2 接线时选定（现有网络 / cloudflared tunnel / Tailscale）；不可达时轮询兜底 | 触发延迟回到 1–3s；Phase 2 增加接收端移植 |
| D-005 | 2026-11-13 | Web Push **缓办**（非砍掉）：替代为 macOS 本地通知 + 飞书 webhook；需要时再迁 | C19/F23 ⏸；Phase 4 |
| D-006 | 2026-11-13 | GitHub App → 个人 PAT 替代。**2026-11-13 修订（v2）**：实测 `vercel env pull` 拉到 GITHUB_APP_* 全套明文凭据 → **GitHub App 凭据随迁移迁入本地 server**（github-app.ts 直迁，App JWT → installation token 流保留，org 级权限与安装边界不损失）；PAT 降级为兜底。受影响矩阵行改为 🔁（M-D1/D2/D4/D5/D11） | D 域 App 相关行 🔁 |
| D-007 | 2026-11-13 | AI 凭据 → `~/.pr-helper-git/` 0600 config.json（safeStorage 不适用：桌面壳为 Swift 非 Electron） | E3 🔀 |
| D-008 | 2026-11-13 | 不在场自动化 → **launchd 常驻 headless server**（KeepAlive + 开机自启，复用 v0.2.6 捆绑 runtime/node）；GUI/浏览器为 server 客户端 | Phase 2；唯一无感例外 |
| D-009 | 2026-11-13 | pr-helper 仓库归档方式 = 推最终状态 → PRIVATE + ARCHIVED（不删除）；Supabase 下线或冷备待定 | Phase 5 |
| D-010 | 2026-11-13 | E2E 策略：引擎契约 = curl API e2e（对齐现有 121 条模式）；UI = 组件测试 + 手动走查；Playwright 引入推迟 | Phase 3 |

---

## 3. 源基线（pr-helper @ `c32c6c6f`，2026-11-13）

- 源仓库：`git@github.com:bayernjf/pr-helper.git`（本地 checkout `000mycodes/pr-helper`，
  与 origin/main 一致，HEAD = c32c6c6f）。
- 栈：Vite vanilla-TS 客户端（`index.html` + `wip.html` 双入口）+ Vercel Serverless（`api/`）
  + Supabase Postgres（47 迁移）+ GitHub App（installation token）。
- **权威能力目录**：pr-helper `docs/feature-catalog.md`（223 行，717 个 i18n 键前缀为功能地图，
  逐项带代码证据与状态图例）— Phase 0 随归档迁入本仓 `docs/archive/pr-helper-feature-catalog.md`。
- **基线疑点（Phase 0 第一项任务核对）**：pr-helper `docs/current-state.md` 与
  `docs/superpowers/plans/2026-11-12-split-main-ts-handoff.md` 记录 2026-11-13 已完成
  `src/main.ts` 拆分（2968 → 1794 行、拆入 `src/app/` 32 文件），但本地 main 分支实测
  `src/main.ts` 仍为 2968 行、`src/app/` 仅 9 文件 — **拆分提交可能在未合并分支**。
  Phase 0 需在 pr-helper 仓核对分支并确定迁移源基线（以拆分后形态优先）。
- 测试基线：44 文件 / 857 单测 + Playwright 34 E2E。

**源能力与模块全清单**见 §10 追踪矩阵的"源文件"列（A–H 八域 122 行 + 47 迁移），
此处不重复；盘点扫描覆盖 `src/`、`api/`（含 `_lib` 8031 行）、`supabase/`、`scripts/`、
`.github/workflows/`、`docs/`。

---

## 4. 目标基线（pr-helper-git @ dev `1adc994`，0.2.6 已发布）

已具备、无需重复迁移的能力（矩阵中标 ✅）：

- GitHub REST/GraphQL 封装 + 代理白名单（`server/github-allowlist.mjs`、routes-github）
- PR 看板（三列 + 评审汇总 + 文本过滤）、PR 详情八组数据并行加载、close/reopen
- 合并（merge/squash/rebase）、close/reopen、label/reviewer 增删、行级评论、draft→ready（GraphQL）
- CI 门禁 + 保护提醒 + 图内 CI 点（`src/lib/ci.ts`）
- AI 流式生成（commit/PR 描述）、AI 配置（服务端 key）
- Dashboard 整页（卡片/置顶/冲突优先/PR 数/后台 fetch-all/stale 芯片）
- WIP 三分区 + 文件树 + hunk/行级暂存 + conflict editor（三路）
- identity（owner/member token hash）、审计（轮转 + 可视化 + CSV）、E2E 121→144
- 设计 token 体系（`design/tokens.json` 单一源）、tooltip/toast/confirm 统一契约
- Node 26/20 双兼容测试基建（jsdom 26.1.0 pin + `src/test-setup.ts` polyfill）

---

## 5. 迁移阶段计划

### Phase 0 — 冻结、基线对齐与数据导出（0.5 天）

| # | 任务 | 源/依据 | 验收标准 | 状态 |
|---|---|---|---|---|
| P0-1 | ~~pr-helper 标注 frozen~~ **已取消（D-011 源仓只读）**：pr-helper 文件全程不动，frozen 声明以本文档 §1 为准 | 本文档 §1 | 台账含 D-011 声明 | ✅ |
| P0-2 | **核对 main.ts 拆分分支**（§3 基线疑点）：确定源基线分支（只读操作：`git branch -a` + `git log origin/<branch>`，不改 pr-helper 工作树） | git branch -a | 明确源基线 commit 并记入 §12 | ⬜ |
| P0-3 | Supabase 生产导出 | prh_readonly 只读角色 + session pooler（.env.production 无法取 DATABASE_URL — Sensitive 掩码；凭据在 ~/.config/pr-helper/db.env） | 导出集 `000mycodes-backups/pr-helper-git/supabase-export-20261113.json`：58806 行/26 表，14 流程与文档终态一致 | ✅（例外：reconciliation_runs 遥测表 5×60s 超时未导出，非业务数据，§12 已记） |
| P0-4 | 47 迁移文件 + feature-catalog.md + current-state.md 快照拷入本仓 `docs/archive/pr-helper-source/` | supabase/migrations | 文件数 = 47 | ⬜ |
| P0-5 | ~~pr-helper 推最终状态到 origin~~ **已满足**：origin/main = c32c6c6f（#406）= 本地 HEAD，最终状态已在 GitHub | — | ls-remote 核对记录 | ✅ |

### Phase 1 — OrbStack Postgres + 领域内核移植（2–3 天）

| # | 任务 | 源（pr-helper） | 目标（pr-helper-git） | 验收标准 | 状态 |
|---|---|---|---|---|---|
| P1-1 | OrbStack 拉 Postgres 容器（版本对齐 Supabase PG 主版本，仅 localhost，volume 持久化，restart 策略） | D-003 | — | `docker ps` 常驻；重启 Mac 后自动恢复 | ✅ pr-helper-pg 运行中（127.0.0.1:54329，unless-stopped）；下次 Mac 重启后补一次实测 |
| P1-2 | 原样执行 47 迁移（含 030 的函数创建；调度职责由 server 承担，见 §11 例外） | supabase/migrations | 本地 PG schema | `\dt` 表清单与 §11 矩阵一致；迁移基线校验脚本随迁 | 🔶 26 表 schema 与矩阵一致（030 pg_cron/pg_net → server 调度 + no-op stub，§11 例外）；校验脚本随迁未做（P1-6） |
| P1-3 | Supabase 数据导入（P0-3 dump → 本地 PG） | dump | 数据行数与导出一致 | 14 流程/17 stages 逐列对照 | ✅ 58806 行/25 表导入（eb5000e，reconciliation_runs 遥测表例外）；workflows=14 实测确认 |
| P1-4 | `postgres` npm 客户端接入 + store 层重写（`workflows-store.ts` 的 SQL/事务/锁直迁，Supabase SDK → SQL） | api/_lib/workflows-store.ts | `server/workflows-store.mjs` | store 单测随迁全绿 | ✅ bundle 3014 行自含 ESM（29169ff）；store 测试网随迁全绿（11-14）：418 不变量测试（源级断言指快照 TS，D-011 冻结源=被测对象）+ workflow-rows 25 + github-api 11 + ai-credentials 5；补导出 workflowFromRows/workflowToRows；剩余 api 路由层测试（workflows/inbox-refresh handler 级）随 Phase 3 服务面接线时随迁 |
| P1-5 | 领域纯逻辑直拷（domain/workflow/workflow-run/generation-rules/projected-stage/…） | src/lib/*.ts + tests | `src/lib/automation/*.ts` | 随迁单测全绿（预计 ~600±） | 🔶 核心 4 模块落地 `src/lib/automation/`（workflow/workflow-run/projected-stage/generation-rules + 测试 143 全绿，11-14）；长尾 UI 支撑模块（navigation/workflow-save-queue/action-queue-request-queue 等）随 Phase 3 需求移植 |
| P1-6 | 迁移纪律脚本随迁（check-migrations） | tools/check-migrations.sh | scripts/ | `npm run check:migrations` 通过 | ✅ 源前提不成立（快照无 tools/，11-14 查证）→ 重定界为新实现：`scripts/migration/check-migrations.mjs` 解析 47 迁移推导期望表集 vs 本地 PG 实测（26=26 ✓，核心表行数核对 ✓） |

### Phase 2 — 自动化引擎 + webhook 接收端 + launchd（4–5 天，中高风险）

| # | 任务 | 源（pr-helper） | 目标 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| P2-1 | PAT 替代 GitHub App：installation token 层删除，REST/GraphQL 走 PAT（对齐 D-006） | api/_lib/github-api.ts | pr-helper-git github-api 层 | 对 14 仓库的读/写/merge 调用全部 200 | ⬜ |
| P2-2 | 队列 + drain 执行器移植（幂等键、execute/reclaim/requeue/cancel/skip、瞬时失败重排 15min×3、12h stale 取消） | api/_lib/workflows-store.ts（drain 相关） | server/workflows-store.mjs | 队列单测随迁全绿；drain 决策与迁移前逐条一致 | ⬜ |
| P2-3 | 自动创建 PR（阈值 + 四项 AI 前置）+ 自动合并（门禁全绿 + sha 幂等 + behind 暂停）+ advance-stage | api/_lib/workflows-store.ts | server | 端到端：push → 阈值 → PR → 门禁 → 合并 → 推进 | ⬜ |
| P2-4 | 对账引擎移植（租约/公平轮转/分级预算 webhook 25s/inbox 6s/manual 8s/cron 40s、阶段校准、ETag 遥测） | api/_lib/workflows-store.ts | server | sweep 遥测行产生；预算语义一致 | ⬜ |
| P2-5 | 触发器三通道：fs.watch（本地 push 即时）+ webhook 接收端（D-004）+ 定时对账（D-008） | api/github/webhook.ts、api/_lib/github-webhook.ts、api/cron/* | server `POST /api/github-webhook`（HMAC 验签，raw body，401 fail-closed） | webhook 签名校验单测随迁；可达时 1–3s 触发实测 | 🔶 webhook 端到端实测 ✓（11-14：HMAC/去重/projection/实时对账 202 流程，本地 PG）；fs.watch=既有 reconcileWatching、定时对账=automation.mjs 调度器；签名单测随迁与实网触发实测待验 |
| P2-6 | AI 失败接管（regenerate/takeover/unpause）+ 消息解析（剥围栏/部分 JSON） | api/_lib/workflows-store.ts | server + 引擎 | 接管单测随迁；paused→unpause 端到端 | ⬜ |
| P2-7 | Actions 重跑（次数/冷却/提交校验）+ Codex 修复包 | api/_lib/workflows-store.ts、api/[action].ts | server | rerun 校验单测随迁 | ⬜ |
| P2-8 | 团队四角色 + 共享授权 + 账号删除（级联） | api/_lib/workflows-store.ts、api/account.ts | server + identity 扩展 | 角色矩阵单测随迁 | ⬜ |
| P2-9 | launchd LaunchAgent（常驻 + KeepAlive + 开机自启，复用捆绑 runtime/node） | D-008 | `launchd/` plist 随仓 | Mac 重启后 server 自动恢复；崩溃 10s 内重启 | ✅ `launchd/{install,uninstall}.sh` + README（11-14）：RunAtLoad 登录自启、KeepAlive 崩溃 10s 重启实测（kill -9 → 新 pid → 200）、自动化随启（PR_HELPER_GIT_AUTOMATION=1）、日志 ~/Library/Logs/pr-helper-git/；验证后已卸载，常驻启用待用户拍板（Phase 5 前） |
| P2-10 | 影子模式开关（引擎只决策不执行 + 决策日志落库） | 本方案 Phase 5 | server | 影子日志可逐日比对 | ⬜ |

### Phase 3 — 控制塔视图 React 重建（4–5 天，量大但机械）

| # | 任务 | 源（pr-helper） | 目标 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| P3-1 | 流程看板（Lane board 页面化：六筛选/搜索/聚合条/活动条/卡片） | src/main.ts overview/projectLane | `src/components/FlowBoard.tsx` | 筛选/排序/聚合与 pr-helper 行为一致 | 🔶 第一片完成（11-14）：服务面前置（P3-0：`server/flows.mjs` 身份桥单人采纳 + `/api/flows/{inbox,workflows,audit}` 三路由，App 依赖读优雅降级为空集+warning）+ 纯语义模块 `src/lib/automation/flows-board.ts`（六筛选计数/可见性/搜索/步骤色调/运行摘要，DI 重写自 overview()+derive.ts，13 单测）+ FlowBoard React 组件（只读版：筛选条/聚合/搜索/刷新/卡片/PR 链接）；剩：拖拽排序、编辑/归档/静音操作、展开区（时间线/运行历史）、新建流程入口 |
| P3-2 | 流程详情（投影直出 + live 校正 + 30s TTL） | src/main.ts detail、src/lib/projected-stage.ts | `src/components/FlowDetail.tsx` | 投影 TTL 语义一致 | 🔶 只读详情第一片完成（11-14）：`flows-detail.ts` 纯语义（stageTimeline 的状态判定/门禁文案/动态路由分支列表/进度条仅计连续前缀，8 单测）+ FlowDetail 页（看板点 lane 进入，返回交互，Chrome headless 截图验收）；降级：live 校正需 App 凭据（P2-1），刷新=重读投影；自动化控制项归 P3-4/P3-7 |
| P3-3 | 步骤抽屉（创建 PR/合并/重跑/部署卡/时间线） | src/main.ts 抽屉 | `src/components/StepDrawer.tsx` | 操作集与 pr-helper 一致 | 🔶 服务面操作路由完成（11-14）：`POST /api/flows/automation`（enqueue/execute/regenerate/takeover，参数归一化逐条对应原版）+ recovery-event + rerun-actions（6 路由测试）；StepDrawer UI 待接 |
| P3-4 | 流程编辑器（步骤/路由/门禁/恢复策略表单 + 拖拽排序） | src/main.ts editor | `src/components/FlowEditor.tsx` | 表单语义一致；互斥校验随迁 | ⬜ |
| P3-5 | 失败中心（四段聚合 + AI 接管 + Codex 修复包 + 恢复策略设置） | src/main.ts 失败中心 | `src/components/FailureCenter.tsx` | 四段聚合语义一致；接管端到端 | ⬜ |
| P3-6 | 时间线 + 只读进度条 | src/main.ts 时间线段 | `src/components/FlowTimeline.tsx` | 连续前缀计数语义一致 | ⬜ |
| P3-7 | 自动化开关 UI（四项前置 + 勾选即动作确认） | src/lib/workflow.ts immediateAutomationEffect | FlowEditor 内 | 确认交互与 pr-helper 一致 | ⬜ |
| P3-8 | /m 手机适配（700px 断点对齐） | src/style.css 700px 方案 | FlowBoard/FlowDetail 响应式 | 390×844 无横向溢出 | ✅ MobileApp 接入 Flows 完成（11-14）：header segmented「Repository/Flows」切换（偏好持久化 mobile.tab），Flows tab 复用 FlowBoard 组件全宽渲染；顺带修复 /m?token= 不种 cookie 的既有缺口（bootstrap 放宽到 /m，e2e 断言随行为更新 144→145）；Chrome headless 手机仿真 390×844 截图验收：14 lane 无横向溢出 |
| P3-9 | 34 条 Playwright e2e 断言语义逐条映射为组件测试/手动走查清单 | e2e/pr-helper.spec.ts | `docs/migration-acceptance.md` 附录 | 映射清单 34/34 完整 | ⬜ |

### Phase 4 — 通知、pr-helper 归档、AGENTS 修订（1–2 天）

| # | 任务 | 验收标准 | 状态 |
|---|---|---|---|
| P4-1 | 失败通知：macOS 本地通知（替代 Web Push，D-005）+ 飞书 webhook | 失败场景实测收到通知 | ⬜ |
| P4-2 | pr-helper GitHub 仓推最终状态 → PRIVATE + ARCHIVED；本地目录标注归档 | gh repo view：PRIVATE+ARCHIVED | ⬜ |
| P4-3 | AGENTS.md 修订落地（容器/依赖/webhook/PAT/通知五处，D-003~D-006） | AGENTS 修订稿与实际一致 | ⬜ |
| P4-4 | 移动状态监控脚本（gh-status-summary/page）随迁 scripts/（低优） | 脚本可执行 | ⬜ |

### Phase 5 — 影子并行 → 切换 → 下线（1 天工作 + 1–2 周日历）

| # | 任务 | 验收标准 | 状态 |
|---|---|---|---|
| P5-1 | 影子期 1–2 周：本地引擎只算不执行，与云端 pr-helper 逐日比对决策 | 连续一致（不一致即缺口修复重跑） | ⬜ |
| P5-2 | 切换：本地引擎转执行；移除 GitHub App webhook 订阅；停 Vercel cron | 真实流程端到端一次 | ⬜ |
| P5-3 | Supabase 下线或冷备（用户操作） | — | ⬜ |

---

## 6. 能力追踪矩阵（源基线 → 处置 → 目标 → 验收）

> 处置图例：🔁 迁移（Phase n）· ✅ 已存在（pr-helper-git 已有等价）· 🔀 替代实现 ·
> ⏸ 缓办 · 🚫 不迁移（理由）· 部分 = 拆分处置（各行单独标注）

### A. 工作流定义与规则（16 行 → 全部迁移，Phase 1/2）

| ID | 能力 | 源文件（pr-helper） | 处置 | 目标（pr-helper-git） | 验收 |
|---|---|---|---|---|---|
| M-A1 | Workflow 领域模型 + 纯函数操作集 | src/lib/workflow.ts (+test) | 🔁P1 | src/lib/automation/domain.ts | 随迁单测全绿 |
| M-A2 | 阶段路由三模式（sequential/independent/waitFor + 互斥） | 同上 | 🔁P1 | 同上 | 互斥校验单测 |
| M-A3 | 动态分支规则匹配（feature/* 通配） | src/lib/workflow.ts + api/_lib/workflows-store.ts | 🔁P1+P2 | client lib + server store | 通配命中单测 |
| M-A4 | 阶段自动化开关（autoCreate/Merge/Advance） | src/lib/workflow.ts | 🔁P1 | domain.ts | 开关语义单测 |
| M-A5 | 勾选即动作预判确认 | src/lib/workflow.ts immediateAutomationEffect | 🔁P3 | FlowEditor | 确认弹窗语义 |
| M-A6 | 部署门禁配置模型/派生 | src/lib/workflow.ts deploymentsForRepository 等 | 🔀部分 | 模型随 M-A1 迁移；**Vercel/Cloudflare 集成不迁（D-002）** | 模型单测 |
| M-A7 | 生成规则本地 CRUD/导入 | src/lib/generation-rules.ts (+test) | 🔁P1 | src/lib/automation/generation-rules.ts | 随迁单测 |
| M-A8 | 规则内容服务端存储（hash 去 payload） | api/_lib/workflows-store.ts | 🔁P2 | server/workflows-store.mjs | hash 往返单测 |
| M-A9 | stage 级规则快照 | api/_lib/workflow-rows.ts | 🔁P2 | 同上（036/040 schema） | 快照列映射单测 |
| M-A10 | Workflow↔行双向映射（往返恒等） | api/_lib/workflow-rows.ts (+test) | 🔁P2 | server（036–044 关系表） | 往返恒等单测 |
| M-A11 | StoredWorkflow 校验/排序/去水合 | api/_lib/workflows-store.ts | 🔁P2 | 同上 | 校验单测 |
| M-A12 | 流程 CRUD + version 乐观锁 + 归档转换 | api/_lib/workflows-store.ts | 🔁P2 | 同上 | 乐观锁单测 |
| M-A13 | 流程排序/位置持久化 | src/lib/workflow.ts reorder 系列 | 🔁P2 | server store | 拖拽排序 E2E |
| M-A14 | 收敛阶段决策模型（7 态单一判定源） | api/_lib/workflows-store.ts deriveStageDecision 等 | 🔁P2 | 同上（引擎核心） | 决策单测全绿 |
| M-A15 | 上游解锁判定（废弃路线排除） | api/_lib/workflows-store.ts | 🔁P2 | 同上 | 解锁判定单测 |
| M-A16 | stageId 稳定身份 | src/lib/workflow.ts + workflows-store.ts（018/019） | 🔁P1+P2 | domain + schema | 身份单测 + schema 对照 |
| M-A17 | 保存队列（串行 + 失败清 dirty） | src/lib/workflow-save-queue.ts (+test) | 🔁P3 | WorkPanel 流程保存路径 | 队列单测 |
| M-A18 | 在途保存合并/权威结果应用 | src/lib/workflow.ts | 🔁P3 | FlowEditor 保存路径 | 合并语义单测 |
| M-A19 | 版本快照 + 运行实例（015） | api/_lib/workflows-store.ts | 🔁P2 | server（015 表） | 快照/运行行写入验证 |

### B. 自动化引擎（16 行 → 全部迁移，Phase 2；展示判定 Phase 3）

| ID | 能力 | 源文件 | 处置 | 目标 | 验收 |
|---|---|---|---|---|---|
| M-B1 | 幂等动作队列（create-pr/merge-pr/advance-stage，幂等键钉 head sha） | api/_lib/workflows-store.ts | 🔁P2 | server + 025 表 | 幂等单测 |
| M-B2 | 队列 drain（唯一执行入口，execute/reclaim/requeue/cancel/skip） | 同上 + api/cron/drain.ts | 🔁P2 | server 定时器 | drain 决策逐条一致（影子比对） |
| M-B3 | 瞬时失败重排（15min 冷却 ×3、12h stale 取消） | 同上 | 🔁P2 | 同上 | 重试语义单测 |
| M-B4 | 自动创建 PR（aheadBy 阈值 1–20 + 四项 AI 前置） | 同上 | 🔁P2 | 同上 | 端到端用例 |
| M-B5 | 自动合并（门禁全绿 + sha 幂等 + behind 暂停） | 同上 | 🔁P2 | 同上 | 端到端用例 |
| M-B6 | 合并后自动推进（advance-stage） | 同上 | 🔁P2 | 同上 | 推进语义单测 |
| M-B7 | AI 失败接管（regenerate/takeover/unpause） | 同上 + src/main.ts takeover | 🔁P2+P3 | server + FailureCenter | 接管端到端 |
| M-B8 | AI 消息解析（剥围栏/部分 JSON 容错） | api/_lib/workflows-store.ts | 🔁P1 | server 纯逻辑 | 解析单测 |
| M-B9 | Actions 失败重跑（次数/冷却/当前提交校验） | api/_lib/workflows-store.ts + api/[action].ts | 🔁P2 | server | 校验单测 |
| M-B10 | 部署回滚（确认式 + workflow_dispatch） | api/[action].ts + src/main.ts 回滚弹窗 | 🚫 | —（D-002 部署域排除） | — |
| M-B11 | 失败恢复策略（3 次/300s + 失败中心展示） | api/_lib/workflows-store.ts DEFAULT_RECOVERY_POLICY + src/main.ts | 🔁P2+P3 | server + FailureCenter | 策略单测 |
| M-B12 | Codex 修复包（PR/失败 Job/错误摘要/diff 的 Markdown） | api/_lib/workflows-store.ts + src/main.ts | 🔁P2 | server + FailureCenter | 生成内容单测 |
| M-B13 | webhook 触发投影（PR 状态/内联校准/delivery 去重） | api/github/webhook.ts + api/_lib/workflows-store.ts + github-webhook.ts | 🔁P2 | server `POST /api/github-webhook` | 签名/去重/投影单测 |
| M-B14 | 勾选/保存触发实时校准 | api/workflows.ts PUT 后 reconcile + store | 🔁P2 | server（PUT 后 reconcile 语义） | 单测 |
| M-B15 | 前端动作队列请求串行化（180s 超时） | src/lib/action-queue-request-queue.ts (+test) | 🔁P3 | client lib 直拷 | 随迁单测 |
| M-B16 | 自动化展示判定（失败中心/计数/徽标/进度条共用） | src/lib/workflow-run.ts (+test) | 🔁P3 | client lib 直拷 | 随迁单测 |

### C. 持久化与对账（20 行 → store 层全部 🔁P2；部署跟踪 🚫；Push ⏸；云同步 🚫）

| ID | 能力 | 源文件 | 处置 | 目标 | 验收 |
|---|---|---|---|---|---|
| M-C1 | 数据访问层（postgres.js 全部 SQL/事务/锁集中） | api/_lib/workflows-store.ts（2882 行） | 🔁P2 | server/workflows-store.mjs（postgres 客户端，SQL 直迁） | store 单测全绿 |
| M-C2 | cron drain 触发（*/2） | api/cron/drain.ts | 🔀P2 | server 定时器（同间隔语义） | 定时触发日志 |
| M-C3 | cron reconcile 触发（*/5→*/30）+ 保留清理 | api/cron/reconcile.ts + store cleanupRetainedData | 🔀P2 | server 定时器（5min 对齐） | 清理 run 遥测 |
| M-C4 | 收敛健康检查（不健康 503） | api/cron/health.ts | 🔁P2 | server | 健康端点语义一致 |
| M-C5 | 对账引擎（租约/公平轮转/分级预算 25s/6s/8s/40s/deferred 让出） | api/_lib/workflows-store.ts | 🔁P2 | 同上 | 预算/租约单测 |
| M-C6 | 阶段校准（PR/checks/reviews/protection/mergeable 投影，sha 钉目标分支） | api/_lib/workflows-store.ts reconcile 系列 | 🔁P2 | 同上 | 校准单测 |
| M-C7 | 部署跟踪（Vercel/Cloudflare runs + 健康探测 + 失败摘要） | api/_lib/workflows-store.ts | 🚫 | —（D-002 部署域排除；010–013 表仍照建） | — |
| M-C8 | webhook delivery 去重落库 | api/_lib/workflows-store.ts recordWebhookDelivery | 🔁P2 | 同上（003 表） | 去重单测 |
| M-C9 | 阶段事件/时间线落库 | api/_lib/workflows-store.ts | 🔁P2 | 同上（008 表） | 事件写入验证 |
| M-C10 | 同步健康度（过时阶段/webhook 计数） | api/_lib/workflows-store.ts | 🔁P2 | 同上 | 健康度单测 |
| M-C11 | 对账遥测（GitHub 调用数/耗时/ETag 命中） | api/_lib/github-api.ts noteEtag + store | ⏸P2 | server（低优，先记录后可视化） | 遥测行存在 |
| M-C12 | 操作审计（9 类 action 全量留痕 + CSV 导出） | api/_lib/workflows-store.ts recordOperationAudit + src/app/ui/audit.ts | 🔁P2+P3 | Postgres 表（020 原样）+ git2 AuditModal 扩展 | 审计行/导出验证 |
| M-C13 | 数据保留清理（webhook 30/密文 30/对账 90/事件 180/部署 180/审计 365 天） | api/_lib/workflows-store.ts cleanupRetainedData | 🔁P2 | 同上（022 表） | 保留预算单测 |
| M-C14 | 加密云同步（PBKDF2 600k + revision 乐观并发） | api/encrypted-sync.ts + src/lib/encrypted-sync.ts (+tests) | 🚫 | —（本地存储即权威，无云同步需求，D-003） | — |
| M-C15 | 团队/成员/共享（四角色） | api/_lib/workflows-store.ts listTeams 等（023 表） | 🔁P2 | server（023 表 + git2 identity 合并） | 团队路由 e2e |
| M-C16 | 角色权限矩阵（owner/editor/operator/viewer） | src/lib/team-permissions.ts (+test) | 🔁P2 | git2 identity 扩展为四角色 | 权限矩阵单测 |
| M-C17 | 共享流程操作授权（mutation 前强制） | api/_lib/workflows-store.ts authorizeWorkflowOperation + api/github/[action].ts | 🔁P2 | server | 授权单测 |
| M-C18 | 账号删除（RESTRICT 外键级联，041a 索引） | api/_lib/workflows-store.ts deleteAccount + api/account.ts | 🔁P2 | server | 删除级联 e2e |
| M-C19 | Push 订阅存取（006 表） | api/_lib/workflows-store.ts + api/notifications/[action].ts | ⏸ | 表照建（47 迁移原样）；功能随 Web Push 缓办（D-005） | — |
| M-C20 | inbox 聚合读（11 路并联 + 去重，egress 优化） | api/[action].ts | 🔁P2 | server | 聚合读单测 |

### D. GitHub 集成（18 行 → PAT 替代 6 行 🚫/🔀；webhook/白名单迁移；其余已有或对齐）

| ID | 能力 | 源文件 | 处置 | 目标/备注 | 验收 |
|---|---|---|---|---|---|
| M-D1 | GitHub App 配置解析（7 环境变量） | api/_lib/github-app.ts | 🔁P2 | github-app.ts 直迁；凭据迁入本地 config（0600） | 配置解析单测 |
| M-D2 | App JWT（RS256）签发 | api/_lib/github-app.ts | 🔁P2 | 同上 | JWT 单测随迁 |
| M-D3 | 签名会话/OAuth state（HMAC cookie） | api/_lib/github-app.ts | 🔀P2 | git2 token cookie（HttpOnly SameSite）已等价 | e2e 现有 |
| M-D4 | OAuth 授权流（start/callback/install/logout） | api/auth/github/[action].ts | 🔁P2 | 同上（本机 server 承载，本机浏览器授权） | OAuth 流 e2e |
| M-D5 | installation token 缓存（500 上限/60s 刷新/并发去重） | api/_lib/github-api.ts | 🔁P2 | github-api 层直迁 | 缓存单测 |
| M-D6 | 统一 GitHub 请求封装（15s 超时/错误分类/version 头） | api/_lib/github-api.ts githubFetch | ✅ | pr-helper-git github-api 层已有等价封装 | 对齐确认（Phase 2 核对错误分类语义） |
| M-D7 | ETag 遥测（304 可行性观测） | api/_lib/github-api.ts | ⏸P2 | server（低优，先记录） | 遥测行 |
| M-D8 | Webhook 签名校验（HMAC 常数时间） | api/_lib/github-webhook.ts (+test) | 🔁P2 | server `POST /api/github-webhook`（M-B13 一部分） | 签名单测随迁 |
| M-D9 | Webhook 路由（raw body、401 fail-closed） | api/github/webhook.ts | 🔁P2 | 同上 | 验签失败 401 e2e |
| M-D10 | GitHub App 订阅事件集（Push/PR/review/check/status/workflow run） | docs（GitHub App 配置） | 🔀P2 | PAT 权限映射文档（PAT scope ↔ 事件覆盖） | 文档段落 |
| M-D11 | installation 归属/仓库归属校验 | api/_lib/installations.ts (+test) | 🔁P2 | 同上 | 归属校验单测 |
| M-D12 | 浏览器 GitHub 代理白名单（method/path、dot-segment 拒绝） | api/github/[action].ts request-policy | ✅ | pr-helper-git github-allowlist.mjs 已有等价（对齐确认） | 对齐核对 |
| M-D13 | 代理 mutation 审计（created/merged/rerun） | api/github/[action].ts | ✅ | git2 appendAudit 已有（对齐确认） | 对齐核对 |
| M-D14 | GitHub 会话状态查询（connected/login/avatar） | api/github/[action].ts sessionHandler | 🔀P2 | git2 identity/me 已等价 | 路由核对 |
| M-D15 | 客户端 GitHub fetch（20s 超时，无 token 走代理） | src/lib/github.ts (+test) | ✅ | git2 github-allowlist 客户端已等价 | 对齐核对 |
| M-D16 | 门禁原语（五类门禁汇总/mergeable/canMergeOpenPull） | src/lib/domain.ts (+test) | 🔁P1 | domain.ts 直拷 | 随迁单测 |
| M-D17 | 生产回滚 workflow_dispatch（仓库侧 yml） | .github/workflows/rollback-frontend-deployment.yml | 🚫 | D-002 | — |
| M-D18 | PR 引用组件（tooltip + 复制） | src/lib/pr-reference.ts | 🔁P3 | client lib 直拷 | 组件测试 |

### E. AI 能力（9 行 → 已有 5 + 迁移 3 + 替代 1）

| ID | 能力 | 源文件 | 处置 | 目标/备注 | 验收 |
|---|---|---|---|---|---|
| M-E1 | AI 连接测试 + PR 提示词（redirect:'error' 防带 key 302） | src/lib/ai.ts (+test) | ✅ | git2 ai.ts 已有等价（对齐确认） | 对齐核对 |
| M-E2 | SSE 流式生成 + 部分 JSON 解析（含 unicode 代理对边界） | src/lib/ai-stream.ts (+test) | 🔁P1 | git2 ai-stream 比对：缺 unicode 边界解析则补 | 解析单测 |
| M-E3 | AI Key 服务端加密（AES-256-GCM v1 + key hint/mask） | api/_lib/ai-credentials.ts (+test) | 🔀P2 | 0600 config.json 替代（D-007）；AES 加密列为可选增强，暂缓 | 存取 e2e |
| M-E4 | AI Base URL SSRF 防护（IPv4/IPv6/mapped/NAT64） | api/_lib/ai-credentials.ts validateAiBaseUrl | 🔁P2 | server | SSRF 单测随迁 |
| M-E5 | AI 凭据 API（保存/读取/删除/测试，key ≤4096） | api/workflows.ts resource=ai-credentials | 🔀P2 | git2 AI 配置路由已等价 + 024 表照建（服务端自动化用） | e2e |
| M-E6 | 自动化 AI 前置偏好（026 列） | api/_lib/workflows-store.ts | 🔁P2 | 同上 | 偏好单测 |
| M-E7 | 客户端 AI 配置（sessionStorage） | src/main.ts loadAiConfig | ✅ | git2 AI 配置 UI 已等价 | 对齐核对 |
| M-E8 | AI 生成弹窗（24h 草稿回填/规则单选/覆盖确认） | src/main.ts showCreateDialog 等 | ✅/🔁P3 | git2 CreatePrModal AI 已有；24h 草稿/规则单选语义比对补齐 | 组件测试 |
| M-E9 | AI 失败接管弹窗（paused 脱敏 + 确认恢复） | src/main.ts showTakeoverDialog | 🔁P3 | FailureCenter（M-B7） | 接管端到端 |

### F. 视图层（27 行 → React 重建 🔁P3 为主体；已有 7；不迁移 4；替代 1）

| ID | 能力 | 源文件 | 处置 | 目标/备注 | 验收 |
|---|---|---|---|---|---|
| M-F1 | 编排入口（渲染/对话框/轮询/刷新全状态机，2968 行） | src/main.ts | 🔁P3 | React 组件树（App/FlowBoard/FlowDetail/…） | 34 条 e2e 语义映射（P3-9） |
| M-F2 | DOM 工具（escape/app） | src/app/dom.ts | 🚫 | React 自带转义 | — |
| M-F3 | 全量类型投影（30+ 类型） | src/app/types.ts | 🔁P3 | src/types 迁移合并 | tsc |
| M-F4 | Lane 看板（六筛选/搜索/展开/聚合条） | src/main.ts overview/projectLane | 🔁P3 | DashboardPage 扩展或独立 FlowBoard | 筛选语义走查 |
| M-F5 | Lane 拖拽排序（手柄/位置输入/键盘兜底） | src/app/ui/lane-sorting.ts | 🔁P3 | FlowBoard | 排序 E2E |
| M-F6 | 失败处理中心（四段聚合） | src/main.ts failureCenterPanel | 🔁P3 | FailureCenter | 四段走查 |
| M-F7 | 流程详情（SWR 投影直出 + live 校正 + 30s TTL） | src/main.ts detail + projected-stage | 🔁P3 | FlowDetail | TTL 语义走查 |
| M-F8 | 步骤抽屉 | src/main.ts showProjectStepDrawer | 🔁P3 | StepDrawer | 操作集走查 |
| M-F9 | 只读进度条 | src/main.ts flowProgressBar + workflow-run.ts | 🔁P3 | FlowDetail | 进度走查 |
| M-F10 | 时间线（Lane + 抽屉 + 图标映射） | src/main.ts + app/ui/format.ts | 🔁P3 | FlowTimeline | 走查 |
| M-F11 | 流程编辑器（步骤/路由/部署/恢复策略表单） | src/main.ts editor 系列 | 🔁P3 | FlowEditor | 表单走查（部署表单除外） |
| M-F12 | 合并弹窗/菜单（merge commit 仅 head sha） | src/main.ts showMergeDialog + confirm.ts | ✅ | git2 合并弹窗已等价 | 对齐核对 |
| M-F13 | 确认对话框（自动化执行/换仓库） | src/app/ui/confirm.ts | ✅ | git2 ConfirmProvider 已等价（执行确认语义对齐 P3） | 对齐核对 |
| M-F14 | 操作审计对话框 + CSV 导出 | src/app/ui/audit.ts | 🔁P3 | git2 AuditModal 扩展 CSV | 导出验证 |
| M-F15 | 状态文案/门禁披露（details 分组） | src/app/ui/format.ts | 🔁P3 | FailureCenter/StepDrawer | 文案走查 |
| M-F16 | 主题切换（light/dark）+ token 守卫 | src/app/ui/theme.ts + style-theme-tokens.test.ts | ✅ | git2 主题已等价；**token 守卫测试模式可借鉴（可选）** | — |
| M-F17 | Toast（Popover API，undo 7s） | src/app/ui/toast.ts | ✅ | git2 ToastProvider 已等价 | — |
| M-F18 | 原生 tooltip | src/app/ui/tooltip.ts | ✅ | git2 design/tooltip.ts 已等价（共享文件） | — |
| M-F19 | PR 引用组件（tooltip + 复制） | src/lib/pr-reference.ts | 🔁P3 | client lib 直拷 | 组件测试 |
| M-F20 | 账户菜单/权限说明/断开/删号/隐私页 | src/main.ts + public/privacy.html | 🔀P3 | git2 identity/Settings 已等价；隐私页按需移植 | 走查 |
| M-F21 | 团队管理对话框 | src/main.ts showTeamsDialog | 🔁P3 | TeamModal 扩展（四角色） | 走查 |
| M-F22 | 云同步对话框（解锁/推拉/轮换） | src/main.ts showCloudSyncDialog 系列 | 🚫 | 本地存储即权威（D-003，无同步需求） | — |
| M-F23 | Web Push 前端（SW + 订阅） | src/main.ts + public/push-sw.js | ⏸ | D-005 缓办；macOS 通知替代 | — |
| M-F24 | 移动端 700px 统一断点 | src/style.css | 🔁P3 | FlowBoard/详情响应式 | 390×844 走查 |
| M-F25 | 飞书通知（workflow 失败 curl） | .github/workflows/reconcile-pr-helper.yml | 🔁P4 | server 通知通道 | 通知实测 |
| M-F26 | 移动状态监控脚本（gh-status-summary/page） | scripts/gh-status-*.sh | ⏸ | 低优，按需 | — |
| M-F27 | 定时对账兜底 workflow（*/10 + 健康上报） | .github/workflows/reconcile-pr-helper.yml | 🔀P2 | server 定时器替代 | 定时日志 |

### G. 本地 WIP 总览（7 行 → ✅ 全部已吸收）

| ID | 能力 | 源文件 | 处置 | 备注 |
|---|---|---|---|---|
| M-G1 | WIP 入口页（双入口） | wip.html + src/wip/main.ts | ✅ | pr-helper-git 主应用即其超集演化 |
| M-G2 | WIP 前端（列表/diff/写操作） | src/wip/main.ts + style.css | ✅ | 同上 |
| M-G3 | WIP 本地服务（token/diff/stage/commit/discard + SSE + 审计 + 遮罩） | scripts/wip-server.mjs (+test) | ✅ | pr-helper-git server 同能力更强 |
| M-G4 | 写动作 argv 固定构造 | scripts/wip-actions.mjs (+test) | ✅ | 同上 |
| M-G5 | 敏感路径判定 | src/lib/wip/mask.ts (+test) | ✅ | pr-helper-git mask.mjs 同源且更全 |
| M-G6 | numstat/porcelain/paths/sort 纯函数（4 测试） | src/lib/wip/*.ts | ✅ | 同上 |
| M-G7 | 主应用 vs WIP 差异说明 | — | ✅ | 文档级：本地客户端 = WIP 超集 + 主应用 |

### H. 横切（16 行 → 已有 6 + 迁移/核对 9 + 不迁移 1）

| ID | 能力 | 源文件 | 处置 | 目标/备注 | 验收 |
|---|---|---|---|---|---|
| M-H1 | i18n（en/zh 词典 + detectLocale） | src/lib/i18n.ts + translations | ✅ | git2 i18n 已等价（~600 条 ZH 词典） | — |
| M-H2 | 屏幕导航（overview/editor/detail/back） | src/lib/navigation.ts (+test) | ✅/🔁P3 | git2 view 切换已等价；语义比对 | 对齐核对 |
| M-H3 | 动作队列请求串行化 | src/lib/action-queue-request-queue.ts | 🔁P3 | client lib 直拷（= M-B15） | 随迁单测 |
| M-H4 | 加密同步客户端（PBKDF2/v2/轮换） | src/lib/encrypted-sync.ts (+test) | 🚫 | 本地即权威，无同步需求 | — |
| M-H5 | 请求来源校验（CSRF：APP_ORIGIN + 白名单） | api/_lib/http.ts assertRequestOrigin | 🔁P2 | server 核对补齐（cookie 模式 mutation 需 Origin 校验） | 校验单测 |
| M-H6 | 错误→HTTP 状态映射（403/429/409/401/503） | api/_lib/http.ts requestErrorStatus | ✅/🔁P2 | git2 错误映射比对补齐 | 单测 |
| M-H7 | 登录级限流（60 req/min） | api/_lib/rate-limit.ts (+test) | 🔁P2 | server（低优，滥用兜底） | 限流单测 |
| M-H8 | 会话入口（identity/session 双层） | api/_lib/session.ts | 🔀P2 | git2 identity 已等价 | 对齐核对 |
| M-H9 | 应用名常量 | src/lib/app-name.ts | ✅ | 改名后常量 = pr-helper-git | — |
| M-H10 | CSS token 守卫（var 可解析/无字面兜底） | src/style-theme-tokens.test.ts | 🔁P3 | git2 加同款守卫测试（token 体系配套） | 守卫测试 |
| M-H11 | 迁移基线校验脚本 | tools/check-migrations.sh + baseline.txt | 🔁P1 | scripts/ 随迁 | 脚本通过 |
| M-H12 | E2E 回归（34 用例 Playwright） | e2e/pr-helper.spec.ts | 🔁P3 | 语义映射清单（P3-9） | 映射 34/34 |
| M-H13 | 部署流水线（Vercel/Cloudflare/CI workflows） | .github/workflows/deploy-*.yml、ci.yml | 🚫 | pr-helper 仓自身 CI，随归档仓保留 | — |
| M-H14 | Supabase 迁移执行纪律 | supabase/README.md + tools | 🔁P1 | 本地 Postgres 同纪律（P1-2/6） | — |
| M-H15 | 团队权限语义（服务端强制） | 见 M-C16/C17 | 🔁P2 | server | 同上 |
| M-H16 | 主应用窄屏适配（统一 700px） | src/style.css | ✅/🔁P3 | git2 已有响应式；控制塔视图对齐 | 走查 |

---

## 7. Supabase 迁移处置矩阵（47 项 → 全部原样执行于本地 Postgres，例外 1）

| 编号 | 文件 | 作用 | 处置 |
|---|---|---|---|
| 001 | 001_users_and_workflows.sql | pr_helper_users + pr_helper_workflows | ✅ 原样 |
| 002 | 002_normalize_workflow_payloads.sql | payload 归一化 | ✅ 原样 |
| 003 | 003_github_webhook_deliveries.sql | webhook 投递去重表 | ✅ 原样 |
| 004 | 004_workflow_stage_states.sql | 阶段实时状态 | ✅ 原样 |
| 005 | 005_workflow_monitoring.sql | 监控列扩展 | ✅ 原样 |
| 006 | 006_push_notifications.sql | push 订阅/投递表 | ✅ 原样（功能 ⏸ 缓办） |
| 007 | 007_track_stage_ahead_by.sql | ahead_by 记录 | ✅ 原样 |
| 008 | 008_workflow_stage_events.sql | 阶段事件史 | ✅ 原样 |
| 009 | 009_dynamic_branch_routes.sql | 动态路由状态行 | ✅ 原样 |
| 010 | 010_track_stage_deployments.sql | 部署 run 跟踪 | ✅ 原样（功能 🚫） |
| 011 | 011_deployment_failure_details.sql | 失败摘要列 | ✅ 原样 |
| 012 | 012_deployment_health_checks.sql | 健康探测列 | ✅ 原样 |
| 013 | 013_deployment_run_history.sql | 部署 run 史 | ✅ 原样 |
| 014 | 014_reconciliation_runs.sql | 对账遥测表 | ✅ 原样 |
| 015 | 015_workflow_versions_and_runs.sql | 版本快照/运行实例 | ✅ 原样 |
| 016 | 016_encrypted_cloud_sync.sql | 加密同步表 | ✅ 原样（功能 🚫） |
| 017 | 017_reconciliation_scope_and_degraded_state.sql | 遥测收窄 + degraded | ✅ 原样 |
| 018 | 018_stage_identity_compatibility.sql | stage_id 回填 | ✅ 原样 |
| 019 | 019_stage_identity_primary_keys.sql | stage_id 主键化 | ✅ 原样 |
| 020 | 020_operation_audit_logs.sql | 操作审计表 | ✅ 原样 |
| 021 | 021_encrypted_sync_hardening.sql | 密文加固 + 历史 | ✅ 原样 |
| 022 | 022_data_retention.sql | 保留清理遥测 | ✅ 原样 |
| 023 | 023_team_permissions.sql | 团队/成员/共享三表 | ✅ 原样 |
| 024 | 024_ai_automation_credentials.sql | 加密 AI 凭据表 | ✅ 原样 |
| 025 | 025_workflow_automation_queue.sql | 自动化 run + 幂等动作队列 | ✅ 原样 |
| 026 | 026_ai_automation_preferences.sql | AI 前置偏好列 | ✅ 原样 |
| 027 | 027_reconciliation_concurrency_and_fairness.sql | skipped + 公平轮转 | ✅ 原样 |
| 028 | 028_reconciliation_leases_and_pending.sql | 对账租约 | ✅ 原样 |
| 029 | 029_reconciliation_github_call_cost.sql | GitHub 调用成本记录 | ✅ 原样 |
| **030** | 030_reconciliation_pg_cron_clock.sql | **pg_cron/pg_net/Vault（Supabase 扩展）** | ⚠️ **替代**：函数照建，调度由 server 定时器承担（本地无 Supabase 扩展语义；drain 2min/reconcile 5min 对齐） |
| 031 | 031_reconciliation_claimed_workflows.sql | sweep 认领记录 | ✅ 原样 |
| 032 | 032_reconciliation_phase_timings.sql | 阶段耗时 jsonb | ✅ 原样 |
| 033 | 033_relax_reconciliation_clock.sql | cron 放宽 */30 | ✅ 执行（调度归 server，语义对齐） |
| 034 | 034_workflow_repository_index.sql | repository 索引 | ✅ 原样 |
| 035 | 035_generation_rule_content.sql | 规则正文集中表 | ✅ 原样 |
| 036 | 036_workflow_relational_expand.sql | payload 展开关系列 | ✅ 原样 |
| 037 | 037_workflow_relational_backfill.sql | 关系回填 | ✅ 原样（导入数据后核对） |
| 038 | 038_workflow_relational_read_switch.sql | 读切关系列 | ✅ 原样 |
| 039 | 039_drop_workflow_payload_index.sql | 删失效索引 | ✅ 原样 |
| 040 | 040_generation_rule_contract.sql | 规则 contentHash | ✅ 原样 |
| 041a | 041_account_deletion_fk_indexes.sql | 删除级联索引 | ✅ 原样 |
| 041b | 041_stage_gate_sha.sql | 门禁 sha 列（红门禁停摆修复） | ✅ 原样 |
| 042 | 042_payload_nullable.sql | payload 可空 | ✅ 原样 |
| 043 | 043_version_not_null.sql | version NOT NULL | ✅ 原样 |
| 044 | 044_drop_workflow_payload.sql | DROP payload 列 | ✅ 原样 |
| 045 | 045_mute_column.sql | 流程静音列 | ✅ 原样 |
| 046 | 046_workflow_versions_snapshot_nullable.sql | snapshot 可空（23502 修复） | ✅ 原样 |

注：041 编号在源仓被两个已执行文件占用（源仓 `tools/migration-baseline.txt` 为准）；
新增迁移自 047 起。本地 PG 的 RLS 策略（如迁移内含）不生效属预期：server 以 owner
身份直连，鉴权由 server identity 层承担。

---

## 8. 自动化引擎语义对照表（云端行为 → 本地实现 → 测试锚点）

| 云端行为（生产已验证） | 迁移后实现 | 测试锚点 |
|---|---|---|
| push webhook 投递 → 投影 + 内联校准（1–3s） | 本地 `POST /api/github-webhook`（HMAC）→ 同一投影/校准逻辑 | github-webhook.test 随迁 |
| 无 webhook（投递失败/未配置）→ cron */2 drain | server 定时器 2min drain（同间隔语义） | drain 单测随迁 |
| cron */5 reconcile（对账 + 保留清理） | server 定时器 5min reconcile | reconcile.test 随迁 |
| aheadBy ≥ 阈值 → 入队 create-pr（四项 AI 前置） | 同逻辑移植（PAT REST compare/pulls） | store 单测 |
| 门禁全绿 + mergeable + clean → merge（sha 幂等） | 同逻辑移植（merge API） | store 单测 |
| behind → 暂停不 update branch | 同语义移植 | store 单测 |
| AI 失败 → paused（脱敏原因）→ 接管/重生成/Unpause | 同逻辑移植 + FailureCenter UI | 接管端到端 |
| Actions 失败 → 重跑校验（次数/冷却/当前提交） | 同逻辑移植（PAT Actions API） | rerun 单测 |
| 勾选自动化 → 预判动作 → 确认 → 保存 → 实时校准 | 同语义移植 | 确认交互 + 校准单测 |
| 阈值/路由/门禁配置变更 → reconcile_pending_since → 即时校准 | 同语义移植 | 校准单测 |
| 幂等命中（PR 已合并/动作已存在）→ 记幂等成功 | 同语义移植 | 幂等单测 |
| 失败恢复 3 次/300s → 停 paused 升级警告 | 同语义移植 | 恢复单测 |

---

## 9. 体验对照表（无感边界，2026-11-13 修正版）

| 能力 | 云端 pr-helper | 迁移后 pr-helper-git | 无感？ |
|---|---|---|---|
| 本地 push 触发 | webhook 1–3s | webhook 1–3s（直达本机接收端） | ✅ |
| 远端他人 push 触发 | webhook 1–3s | webhook 可达 1–3s；不可达自动落轮询 ≤5min | ✅（可达性配置好）|
| 自动化运行时段 | 24/7 不在场 | Mac 开机 + launchd 常驻 headless server | ⚠️ **关机时段暂停 — 唯一实质差距（D-008 既定代价）** |
| 多设备工作流状态 | Supabase 多端 | 单机 server（多浏览器共享 ✓） | ✅ 单人单机 |
| 仓库身份 | GitHub App 安装 | PAT（个人仓库） | ✅ |
| 失败通知 | Web Push / 飞书 | macOS 通知 + 飞书 | ✅（Web Push 缓办）|
| AI 凭据 | Supabase 加密 | 0600 config.json | ✅ 本机单人等价 |
| 部署门禁/回滚 | — | 🚫 排除（D-002） | —（范围外）|

---

## 10. 迁移 DoD（总验收标准）

迁移完成的定义（全部满足方可宣布"迁移完成"）：

1. **数据完整性**：14 流程 / 17 stages / 规则快照 / 版本历史 / 审计 在本地 Postgres 与
   导出集逐列一致（§5 P1-3 对照记录）。
2. **引擎行为一致性**：影子期（≥1 周）本地引擎与云端对同一流程集的决策一致率 100%
   （不一致项修复后重跑）。
3. **测试网**：随迁单测（~600±）+ git2 存量（287）+ E2E（≥136）全绿；34 条旧 Playwright
   e2e 断言语义映射清单 34/34 完整（P3-9）。
4. **功能走查**：§10 矩阵中全部 🔁 行标 ✅；🚫/⏸ 行有决策记录（D-xxx 或用户指令）。
5. **通知**：失败场景 macOS 通知 + 飞书实测各一次。
6. **常驻**：Mac 重启后 launchd 自动恢复 server 并完成一轮 sweep（日志证据）。
7. **归档**：pr-helper GitHub 仓 PRIVATE + ARCHIVED；本地目录标注归档；AGENTS 修订落地。
8. **文档**：本文档 §12 变更记录完整覆盖迁移期内的全部调整。

---

## 11. 风险登记

| # | 风险 | 缓解 | 状态 |
|---|---|---|---|
| R1 | 阶段 2 引擎移植：对账/队列是生产验证过的复杂逻辑，未覆盖分支可能长尾 | 857 单测网随迁 + 影子比对期 + 逐条语义对照表（§8） | 开放 |
| R2 | Node 20/26 漂移 × 依赖 engines | jsdom 精确 pin 26.1.0 + test-setup polyfill；`.nvmrc`/engines 声明推荐 Node ≥22 | 已缓解 |
| R3 | webhook 可达性（NAT） | 三选项（现有网络/隧道/Tailscale）；不可达自动落轮询兜底 | 待用户选定 |
| R4 | 关机时段自动化暂停 | D-008 既定代价（launchd 缓解）；恢复后 reconcile 追平 | 用户知情 |
| R5 | pr-helper 本地 checkout 与远端拆分状态不一致（2968 vs 32 文件） | Phase 0 P0-2 核对分支并定基线 | 开放 |
| R6 | 双引擎并行期互踩（重复建 PR） | 影子模式（只算不执行）+ 流程集分组 | 已设计 |
| R7 | Postgres 容器随 Mac 重启恢复可靠性 | OrbStack 容器 restart 策略 + 重启实测（P1-1 验收） | Phase 1 验证 |

---

## 12. 变更记录（追加式 — 所有后续调整在此登记）

| 日期 | 变更 | 原因 | 批准 |
|---|---|---|---|
| 2026-11-13 | 初版创建（§0–§12） | 用户指令：完整迁移方案落盘为核心台账 | 用户 |
| 2026-11-13 | **D-011**：pr-helper 全程只读（源仓文件不修改、不提交；仅允许读/fetch/log 核对）。P0-1 标注任务取消，P0-5 标注已满足 | 用户指令：被迁出产品不能动 | 用户 |
| 2026-11-13 | **D-012**：确立多会话协作协议（§0 规则 5-6）：台账状态列 = 断点，开场读台账领任务、收尾更新+提交+推送+备份 | 多会话上下文对齐需求 | 用户 |
| 2026-11-13 | **D-006-v2**：vercel env pull 实测 GITHUB_APP_* 明文可拉 → GitHub App 凭据迁入本地 server（推翻 v1 的 PAT 替代），安装级权限保留；DATABASE_URL 被 Sensitive 掩码 → 生产连接串需用户提供 | Phase 1 排障 | 用户 |
| 2026-11-14 | Phase 0 完成：P0-2（源基线=origin/dev@96bd94fe + main 独有修复 709940f3 登记）✅、P0-3（导出 58806 行/26 表，reconciliation_runs 遥测表超时未导出 — 例外记录）✅、P0-4（228 文件快照）✅ | Supabase session pooler 大表/断连不稳 → 超时+重连+跳过策略 | 用户 |
| 2026-11-14 | **D-013**：根目录 `handoff.md` 增设「pr-helper 迁移进度（实时段）」，每个迁移会话收尾实时更新；本文档保持方案/追溯/验收职责不变 | 用户要求进度实时可见 | 用户 |
| 2026-11-14 | Phase 2 接线修正四项（0330dd1 验证后）：① webhook 路由移出 token 鉴权区 — GitHub 投递无 session token，HMAC 签名即该端点鉴权，原位置所有真实投递 401；② 自动化调度器改为启动时显式 opt-in（`PR_HELPER_GIT_AUTOMATION=1`），撤除请求路径内启动 — launchd headless 无 UI 会话也 drain，e2e/临时 server 与真实自动化库零接触；③ shadow 模式重定义为**只读观测**（引擎无 dry-run 缝，shadow 永不调用 drain/reconcile 执行入口，仅报告队列深度+tracked 数）；④ `workflows-store.mjs` ssl `require`→尊重 URL `sslmode`/默认 `prefer`（本地 OrbStack 无 TLS）+ 9 处 checkJs 行为中立类型修补，`typecheck:server` 门禁恢复全绿 | Phase 2 端到端验证发现接线缺陷：webhook 401 死路、e2e 隔离泄漏、shadow 假执行、本地 PG SSL_NOT_SUPPORTED | 用户（继续授权推进） |
| 2026-11-14 | webhook 接收端端到端实测通过：无 token 可达 ✓、无 secret 503 fail-closed ✓、错误签名 401 ✓、有效签名 202 accepted ✓、重放 duplicate ✓、投递行落库 ✓、shadow 观测（tracked=14）✓、空队列真实 drain ✓；调度形态三态验证（opt-in+shadow / opt-in 实跑 / 默认零 automation）✓ | P2-5 验收标准部分达成；全门禁 lint ✓ / typecheck ✓ / vitest 337 ✓ / build ✓ / e2e 144 ✓ | 用户（继续授权推进） |
| 2026-11-14 | P1-6 重定界：快照内无 tools/check-migrations.sh（源前提不成立，查证记录）→ 新实现 `scripts/migration/check-migrations.mjs`（解析 47 迁移推导期望表集 vs 本地 PG 实测，`npm run check:migrations`，26=26 ✓）；P2-9 launchd 完成：`launchd/{install,uninstall}.sh` + README，KeepAlive 崩溃自愈实测 ✓，验证后卸载（常驻启用待用户拍板）；P1-5 核心 4 模块落地 `src/lib/automation/`（workflow/workflow-run/projected-stage/generation-rules + 随迁测试 143 全绿）→ 测试基线升至 480/38 | 继续推进迁移（无阻塞项优先：P1-6 → P2-9 → P1-5 核心） | 用户（继续授权推进） |
| 2026-11-14 | **P1-4 store 测试网随迁全绿**：`server/workflows-store.test.ts` 418 项（源级不变量断言指快照冻结 TS 源 — bundle 是其机械变换且注释被剥离，指快照才是被测对象；MIGRATIONS_DIR/STORE_SOURCE/`[action].ts`/`workflows.ts`/`main.ts` 七类相对路径重写到快照树）+ `workflow-rows` 25 + `github-api` 11 + `ai-credentials` 5；bundle 补导出 workflowFromRows/workflowToRows；vite.config.ts include 增 `server/**/*.test.ts`；测试基线 480/38 → **939/42**（全门禁绿） | P1-4 验收标准（store 单测随迁全绿）达成 | 用户（继续授权推进） |
| 2026-11-14 | **Phase 3 启动（P3-0 服务面 + P3-1 第一片）**：`server/flows.mjs` 身份桥（本地 token 身份 → 引擎 identity，采纳 pr_helper_users 单行；多人场景报错待 P2-8）+ 三读路由（inbox 11 函数扇出 / workflows 原始 payload / audit），App 凭据缺失时单路读降级空集+readWarnings（看板投影直出不阻断）；分发顺序调整（flows 在 git 路由前，后者对无 repo 的 /api 兜底 403）；React：`FlowBoard.tsx` 只读看板（Toolbar 新增 Flows 视图）+ `flows-board.ts` 纯语义模块（13 单测）+ `src/api/flows.ts`；i18n 增看板文案（英文句子键）；测试基线 939/42 → **959/44**（全门禁绿） | 用户指令"继续"（Phase 3 开工） | 用户（继续授权推进） |
| 2026-11-14 | **MobileApp 接入 Flows + P3-3 服务面写路由**：/m header 新增「Repository/Flows」segmented（mobile.tab 持久化），Flows tab 直接复用 FlowBoard；修复既有缺口 /m?token= 不种 cookie（bootstrap 放宽到 /m + redirect 回 /m，e2e 断言随行为更新，144→145）；`POST /api/flows/{automation,recovery-event,rerun-actions}` 落地（enqueue/execute/regenerate/takeover 参数归一化逐条对应 api/workflows.ts，recovery/rerun 校验 400 前置），6 新路由测试；测试基线 967/45 → **973/45**（全门禁绿） | 继续推进 Phase 3（手机看板价值立现；抽屉 UI 待路由已就绪） | 用户（继续授权推进） |
| 2026-11-14 | **P3-2 流程详情只读片**：`flows-detail.ts`（状态判定/gates/动态路由/进度条纯模块，8 单测）+ `FlowDetail.tsx`（Back/标题/路由/进度条/分步卡：状态+gates+自动化 chips+事件流）+ 看板 lane 可点击进入详情；事件时间本地化、eyebrow 去重同看板规则；测试基线 959/44 → **967/45**（全门禁绿） | 继续推进 Phase 3（P3-2 先于 P3-3：纯读无需凭据） | 用户（继续授权推进） |
| 2026-11-14 | **看板样式专项返工（用户反馈"样式没法看"）**：根因是首片 CSS 使用了不存在的设计变量（--sp-*/--surface/--fs-sm/--success 等，间距塌 0、色调全失效）→ 按真实 token 词汇表重写（--panel/--panel-2/--muted/--faint/--fs-meta/--fs-ui/--green/--red/--amber/--blue + -soft）；lane 头部重排（name==repo 时隐藏 eyebrow 去重、运行摘要改"色点+右对齐弱化文本"）；PR 引用去重（状态文案不带号，链接承担 #N；队列消息尾部 #N 剥离）；700px 断点（纵向步骤、连接符转向、搜索全宽、卡片 flex:none 修高度拉伸）——Chrome headless 截图双宽度验收；顺手补齐别名层潜在缺失变量（--text-muted/--success/--danger/--warning，修复仓库既有 3+13 处悬空引用） | 用户截图反馈 + 本产品验收标准（UI 打磨到位） | 用户 |
