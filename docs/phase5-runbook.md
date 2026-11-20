# Phase 5 运行手册 — 影子并行 → 切换 → 下线

> **⚠️ 执行审批铁律（2026-11-14，用户指令 D-016）：**
> **P5-2 切换与 P5-3 下线的每一个动作（本地转执行、摘除 GitHub App webhook 订阅、
> 停 Vercel cron、Supabase 冷备/下线），在执行前必须先向用户复述完整清单并获得
> 明确审批。** 影子期判定一致本身**不构成**执行授权；AI 不得以"runbook 写了"或
> "计划里有"为由代为执行。逐项：审批一项、执行一项、报告一项。

前置：Phase 0–4 + **Phase 3.5 功能缺口回补（D-002-v2）已关闭**（见台账 §5/§12）。**P3-10 部署
门禁、P3-11 换仓库未关闭前，P5-2 切换与 P5-3 下线一律冻结。P5-1 的"算"需要 GitHub 凭据**
（P2-1：一次性私有测试仓 + PAT，或 GitHub App 凭据迁入本地 env）——凭据未就位前
影子期无法开始。

## P5-1 影子期（1–2 周日历）

**目标**：本地引擎只算不执行，与云端 pr-helper 的决策逐日比对，连续一致后进入切换。

**启动影子模式**（本地 server，引擎只观测不执行）：

```bash
PR_HELPER_GIT_AUTOMATION=1 PR_HELPER_AUTOMATION_SHADOW=1 npm start
# 或常驻：编辑 launchd/install.sh 的 AUTOMATION 默认值加 PR_HELPER_AUTOMATION_SHADOW=1
```

**每天第一件事：同步云端数据**（影子期数据基础设施，D-018）：

```bash
npm run sync:shadow
```

本地引擎读的是本地 PG 镜像——云端 Supabase 的实时状态必须先同步进来，
影子观测才有可比材料。每天一次（或大事件后手动），输出逐表行数。

同步是**单事务全量重建**：云端 22 张核心表按页读取（500 行/页）后，本地
`TRUNCATE + 分批 INSERT` 在一个事务内完成，中途失败整体回滚；本地增量列
`workflow_stages.auto_advance`（D-015）在重建前快照、重建后回填，不会被同步抹掉。
Supabase pooler 对单条查询约 300 秒即断连（2026-11-15 实测），因此不能用一个
psql 会话一次导出全表；同步器逐表、500 行分页读取。每次云端读取成功后先写
`~/.pr-helper-git/shadow-latest.json`（0600，含镜像数据，不得外传），本地写入失败时
可用 `PR_HELPER_GIT_SHADOW_SNAPSHOT=$HOME/.pr-helper-git/shadow-latest.json npm run sync:shadow -- --snapshot`
直接重试，不必重读云端。云端行可能比本地多列（如 `workflow_stages.id`），写入时按
本地 `information_schema` 列集投影并打印被丢弃的列名。
4 张遥测表（`github_webhook_deliveries`、`reconciliation_runs`、
`pr_helper_notification_deliveries`、`data_retention_runs`）默认跳过，避免每日同步
跑数小时；需要一次性全量时用 `npm run sync:shadow -- --full`。

**云端连接不稳定时**（Supabase pooler 间歇性断连，2026-11-14 实测）：先用
`npm run sync:shadow -- --snapshot` 从备份快照做 bootstrap（默认
`~/000mycodes-backups/pr-helper-git/supabase-export-20261113.json`，可用
`PR_HELPER_GIT_SHADOW_SNAPSHOT` 覆盖），再用只读 runner 只拉
`id > 本地最大值` 的增量行补到当前。快照 bootstrap 会把 stages 恢复成快照时刻的
`auto_create/auto_merge`（11-13 为 0/14），因此 bootstrap 后必须补当前
`workflow_stages`/`workflow_stage_states`，否则影子引擎会以为自动化全关。
同步器在事务末尾对本表 `id` 序列做 `setval`，避免快照/增量显式 id 让下一次
审计写入撞主键（2026-11-14 的 PUT 500 就是这个原因）。

**当前本地镜像（2026-11-15 16:04）**：14 workflows / 14 stages / 3,359 events /
3,647 automation runs + actions / 449 deployment runs / 8,372 audit；`auto_advance`
本地为 0，等切换日显式开启。重启 4789 后影子日志
`queued 0 / running 0 / paused 2，trackedWorkflows=14`。

> **代码更新后必须重启 4789 影子服务**（`launchctl kickstart -k gui/$(id -u)/local.pr-helper-git.server`）。
> launchd 只在进程退出时重读代码；常驻进程会继续跑旧 bundle。D-015 验收就踩过：
> 服务 16:24 启动，修复提交 17:04，PUT 返回 200 但 DB 没写列。同步完成后重启一次再判定影子结果。

**每天看什么**（自动产出）：

1. 影子日志 `~/.pr-helper-git/automation-shadow.log`（JSONL，每轮 drain/reconcile
   观测一行：时间戳、队列 queued/running/paused、tracked workflows）——
   P2-10 的落盘产物，失败路径也落盘（见 flows.test.ts smoke）。
2. server 日志 `[automation:shadow]` 行。

**比对什么**：云端 pr-helper（Vercel，切换前保持运行）每天产生的
`workflow_automation_actions`（云端 Supabase 可查）与本地影子观测的
队列状态演进是否一致——同样的仓库事件应产生同样的动作序列。

**判定**：连续 5–7 天无不可解释差异 → 进入 P5-2。出现差异 → 台账 §12 记录缺口 →
修复 → 重跑影子计数。

**本地的会做什么**：影子模式从不调用 drain/reconcile 执行入口（引擎无 dry-run 缝，
shadow = 只读观测，见 server/automation.mjs 注释）——云端 pr-helper 保持唯一执行者。

## P5-2 切换日（1 天，需用户执行）

> 逐项审批、验证命令和回滚清单见
> [`phase5-p5-2-approval.md`](phase5-p5-2-approval.md)；本节的 D-016 铁律不变。

按序执行，每步可回滚：

1. **本地引擎转执行**：`PR_HELPER_GIT_AUTOMATION=1`（不带 shadow）重启
   `bash launchd/install.sh` 常驻。观察首日 drain 日志无异常。
2. **移除 GitHub App webhook 订阅**：GitHub → Settings → Applications →
   Installed GitHub Apps → pr-helper → Configure → 删除 Vercel 域名的订阅 URL；
   （本地接收端 `/api/github-webhook` 如需接管，需可达性方案 D-004 三选一 +
   `GITHUB_WEBHOOK_SECRET` env）。
3. **停 Vercel cron**：Vercel 项目 → vercel.json 移除 crons 字段 → redeploy。
4. **端到端一次真实流程**：push → 阈值 → 自动建 PR → 门禁 → 自动合并 → 推进
   （台账 P2-3 验收标准），全程本地执行。

**回滚**：重新启用 Vercel cron + 恢复 webhook 订阅 URL，本地转回 shadow——
5 分钟内可完成，数据无破坏（两边都写云端 Supabase 直到 P5-3）。

## P5-3 Supabase 下线（用户操作，切换稳定 1 周后）

1. 冷备导出（P0-3 脚本重跑一次，取最终增量）
2. Supabase 项目 → Pause 或 Delete（用户在 Supabase 后台操作）
3. 本地 Postgres 从此是唯一数据层；备份策略沿用 pr-helper-backup.sh

## 完成判定（DoD §10 全勾）

全部完成后在台账 §12 记录切换日期与首周观察结论，迁移正式关账。
