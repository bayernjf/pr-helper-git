# pr-helper-git 会话交接（2026-11-18 快照）

> 性质：**时间点快照**，不是实时状态源。实时发布状态看 `package.json`、
> `CHANGELOG.md` 和 `handoff.md`；迁移状态看 `docs/pr-helper-migration.md`。
>
> 本快照已按仓库实际状态校正：`dev = a31b208`（代码基线，已推送、已备份；
> 其后另有本地 docs 校正提交），`main = 92d136e`，GitHub latest = `v0.3.8`。
> `dev` 另有 2 个尚未发布的功能修复。

## 1. 项目一句话

本地优先的 Git/GitHub PR 工作台（GitKraken 式核心 + pr-helper 迁入的发布控制塔）。
React 19 + Node 内置 http + OrbStack Postgres。单用户、loopback-only、桌面+浏览器双端。

**pr-helper 迁移：代码 100% 完成，34 项验收全部有结论（✅33 + 🔀1），Phase 5
影子期运行中（自 2026-11-14 16:24 起）。**

## 2. 当前版本状态（先看这里）

| 项 | 实际值 |
|---|---|
| `dev` | 代码基线 `a31b208`；其后有本地 docs 校正提交（未 push） |
| `main` | `92d136e`（`Merge pull request #20 from bayernjf/dev`） |
| GitHub latest | **`v0.3.8`**（2026-11-17 22:59 本地发布） |
| 已安装桌面 app | `/Applications/PR Helper Git.app` = `0.3.8` |
| `dev` 领先 `main` | 2 个功能性提交：`7eb66ad`、`a31b208`（**尚未发版**） |
| 下一次发布 | 建议 `0.3.9`，覆盖上述 2 个提交；按发布 checklist 走 |
| 备份 | `/Users/jiangfeng/000mycodes-backups/pr-helper-git/source-*.bundle`，以 `ls -t` 取最新；含 `main 92d136e`、`dev` 与 `v0.3.8` |

> 上一版交接写“产品发布版 v0.3.4 / 桌面 app 0.3.4”，已被 `0.3.5`–`0.3.8`
> 覆盖；以本表为准。

## 3. 关键路径速查

| 什么 | 哪里 |
|---|---|
| 迁移核心台账（方案/122 行矩阵/D-001…D-021/DoD） | `docs/pr-helper-migration.md` |
| 业务验收（34 条映射） | `docs/migration-acceptance.md` |
| 影子期/切换/下线手册（D-016 审批铁律在头部） | `docs/phase5-runbook.md` |
| 交付台账（发布史/迁移实时段/评审记录） | `handoff.md` |
| 测试仓登记（铁律 + GitHub 8 仓/本地 3 仓双表） | `test-repos.md`（仓库实际小写路径） |
| 引擎 bundle（pr-helper 冻结源变换，勿手改逻辑） | `server/workflows-store.mjs` |
| 控制塔路由（inbox/automation/saves/ai-credentials/rules） | `server/flows.mjs` |
| 影子模式桥（调度器/日志/通知钩子） | `server/automation.mjs` + `server/notifier.mjs` |
| 影子期云端→本地同步 | `scripts/migration/shadow-sync.mjs`（`npm run sync:shadow`） |
| 本地增量迁移（048 auto_advance 等） | `scripts/migration/local-migrations/` |
| launchd 常驻安装/卸载 | `launchd/install.sh` / `launchd/uninstall.sh` |
| 引擎凭据（0600，不入 git；GITHUB_TOKEN + AI 加密 key） | `~/.pr-helper-git/credentials.env` |
| Supabase 只读凭据（0600） | `~/.config/pr-helper/db.env` |
| 只读 SQL 工具（实测可靠，含手拆密码解析） | `~/.local/bin/prh-sql.mjs` |
| 影子日志（逐轮 JSONL） | `~/.pr-helper-git/automation-shadow.log` |
| 桌面壳（Swift 薄壳：单实例守卫 + 标题栏 themeSync） | `desktop/main.swift` |

## 4. 运行命令

```bash
npm start                      # 生产式单端口（打印 ?token= 引导 URL）
npm run dev                    # Vite :5173 + API :4789
npm run sync:shadow            # 影子期：云端→本地镜像（每日一次，D-018）
npm run check:migrations       # schema 纪律校验（26 表基线）
npm run desktop                # 重建 macOS .app（改 desktop/ 或 UI 后）
node ~/.local/bin/prh-sql.mjs "SELECT …"   # Supabase 生产只读查询
launchctl print gui/$(id -u)/local.pr-helper-git.server   # 查常驻状态
tail ~/.pr-helper-git/automation-shadow.log               # 影子观测
```

## 5. 影子期状态（2026-11-18 时点）

- 启动：2026-11-14 16:24；已运行约 4 天，仍处于 P5-1。
- launchd 常驻 `:4789`（automation=1，shadow=1，KeepAlive）——state=running。
- 影子日志：约 3673 行（11-18 01:00 时点；逐轮增长）；最近一轮
  `queued=0 / running=1 / paused=2`，`trackedWorkflows=14`。
- 最近一次 `shadow-latest.json`：`exportedAt=2026-11-17T19:41:42Z`
  （本地 11-18 03:41），22 张表，云端全量镜像可用。
- 云端（主驾）继续执行；本地只观测。P5-2/P5-3 未开始。

## 6. 当前测试基线

- 单元/路由测试：**1092 tests / 60 files**（2026-11-18 在 `a31b208` 上复跑）。
- E2E：**162 passed / 0 failed**（同次复跑）。
- `npm run build`：通过。
- 桌面端：`0.3.8` 已构建、smoke 通过；本条不替代下一次 `0.3.9` 的桌面门禁。

## 7. 铁律（违反=事故）

1. **D-011**：pr-helper 源仓/checkout 全程只读。
2. **D-014**：`bayernjf/pr-helper` 仓库保持 PUBLIC+非归档，仅停止迭代
   （曾误执行 private+archive，已还原——勿再动）。
3. **D-016**：P5-2 切换、P5-3 下线的**每个动作**执行前必须逐项获得用户明确
   审批（复述→审批→执行→报告）。影子期判定一致**不构成**执行授权。
4. **D-017**：飞书通知暂不启用、不算阻塞（代码保留，配 env 即可开）。
5. **测试仓铁律**：不新建测试仓（GitHub/本地）；只用 `test-repos.md` 登记表
   内的仓。新仓需用户明确批准并先进登记表。
6. **凭据纪律**：永不打印/提交 token/PAT/key/连接串值；凭据文件 0600 且
   在数据目录/仓库外。
7. **AGENTS.md Non-negotiables**：容器仅 OrbStack Postgres 单容器；webhook
   仅本地 HMAC 接收端；GitHub App 无 OAuth 仅服务端引擎调用（Device Flow
   仅身份发现）；A2A 默认 plan 模式 fail-closed；worktrees/submodule/GPG 禁止。

## 8. 剩余待办

| 优先级 | 事项 | 谁做 | 状态/前置 |
|---|---|---|---|
| P1 | 发 `0.3.9`：覆盖 `7eb66ad` + `a31b208` 两个功能性修复 | AI + 用户确认 | 建议尽快；按完整门禁 + dev→main PR + tag + 备份 |
| P1 | P5-1 影子期判定：约 11-21～11-28 进入判定窗口，连续 5–7 天一致 | 用户 + AI 比对 | 运行中，不提前切换 |
| P1 | P5-2 切换日：本地转执行 → 摘 webhook → 停 Vercel cron → 端到端真实流程 | 用户逐项审批（D-016） | 4 个动作，每个动作单独审批 |
| P1 | P5-3 Supabase 下线：冷备导出 → Pause/Delete | 用户审批 | 切换稳定 1 周后 |
| P2 | FlowEditor 重配 AI 凭据（旧加密件已清） | 用户 | 一次性 |
| P2 | Device Flow 2FA 实网走查（#1 验收项） | 用户 | 账号启用 2FA / 刷新会话后 |
| P3 | 清理 `~/.pr-helper-git/a2a-token.txt`（若确认不再使用） | 用户 | 可选 |
| P3 | `receipt-test` 用途确认 | 用户 | 可选 |
| P3 | `app-state` 巨型 context 拆分（406 行、37 个消费者） | 专项规划 | 高风险重构，不夹日常迭代 |
| 非迁移 | `agent-world` 自托管 runner 离线 | 用户/运维 | 生产巡检项，不阻塞迁移 |

## 9. 已知坑（踩过的，别再踩）

1. **jsdom 必须 pin 26.1.0**：宿主 Node 在 20.x↔26.x 漂移；jsdom 31 在
   Node 20 崩溃；Node ≥22 遮蔽 localStorage（`src/test-setup.ts` 兜底）。
   测试文件数突然少 ~6 = 先查这两个。
2. **Node 版本漂移**：fnm 可能给 20.x（vitest 报 `Map.groupBy` 等）——用
   `PATH=/opt/homebrew/opt/node/bin:$PATH` 前缀（homebrew Node 26）。
3. **git add 大小写**：case-insensitive APFS 上 index 里是小写
   `test-repos.md`——`git add TEST-REPOS.md` 不会 stage。始终用 index 实际路径。
4. **python 批量改文档**：assert 失败 = 整个脚本没写盘，但同一命令行里
   后续 git commit 仍会跑——文档更新要单独确认落盘。
5. **Supabase session pooler 不稳**：进程内长连接会 hang/CONNECTION_CLOSED
   （实测 89s 大查询断连）——云端读取走 `~/.local/bin/prh-sql.mjs` 子进程
   或分批短查询；shadow-sync 已内置逐表子进程模式。
6. **vercel env pull**：Sensitive 键拉下来是 `[SENSITIVE]` 占位——App 私钥
   等不可得（D-006-v3 因此改走 GITHUB_TOKEN PAT fallback）。
7. **不可逆/外部动作**：先复述清单拿明确批准（D-014 教训；D-016 铁律）。
8. **UI 自动化探针**：headless 模态内程序化点击/时序不稳定——验收以截图、
   git CLI 真相、e2e 结果为准。
9. **launchd 常驻 server**：改代码后需重启才拾取；切换日重启会自然带上新逻辑。
10. **桌面更新菜单**：`Check for Updates…` 现在是动态菜单项，下载时显示
    `Downloading <version> [bar] pct%`；更新中再点该项会恢复进度窗口。

## 10. 会话协议

开场：读 `docs/pr-helper-migration.md` §0 规则 + §12 最新行 → 领任务；需要
历史决策时读 `D-001…D-021`。

收尾：更新迁移台账状态列 + §12 变更记录 + `handoff.md` 实时段 → commit（dev）
→ 用户明确要求时才 push → `bash /Users/jiangfeng/000mycodes-backups/pr-helper-backup.sh`
→ 验证 bundle heads 含 `main`、`dev` 和最新 tag。

## 11. 提交与发布纪律

- 只在 `dev` 提交；集成走 `dev → main` PR；不要改写 `main` 历史。
- 普通开发默认只本地 commit；push 只在用户明确要求时执行。
- 功能性变更必须发版，不能只更新文档；发布走 AGENTS.md checklist +
  版本号四处同步（`package.json` / `package-lock.json` / `CHANGELOG.md` / `handoff.md`）。
- 发布后等 CI（Linux test + macOS desktop）再报完成；桌面产物核对
  `build/release/SHA256SUMS`。
- 未签名桌面产物首次打开需右键 → 打开以绕过 Gatekeeper。

## 12. 评审遗留（唯一架构项）

**`app-state` 巨型 context 拆分**：约 406 行单 context、37 个 `useApp()` 消费者——
任意状态变化（busy 翻转/SSE 推送）全树重渲染。建议按域拆为
RepoData / Preferences / Actions 三个 context。高风险重构，需专项规划 + 回归验证。
