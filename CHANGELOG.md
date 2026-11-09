# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。版本号在 `package.json` 与 `handoff.md` 之间保持同步。

## [Unreleased]

### 修复
- **merge 冲突契约**：`POST /api/merge` 命中冲突时改为返回 `409` 并带上 `conflicts` 与 `state`（之前走 `gitFail` 返回 400，前端拿不到冲突列表，与 revert / cherry-pick 的 409 约定不一致）；`POST /api/commit` 的「无暂存内容」守卫只在**非** `mergeInProgress` 时拒绝，取 `ours` 解决冲突后可以正常收尾提交。
- **中文文案覆盖**：i18n 之前只覆盖已经用了 `t()` 的 key，浏览器逐屏走查发现工具栏、工作面板、提交图筛选、快捷键说明、命令面板、团队/仓库/PR 弹窗与相对时间仍是裸英文；约 100 条文案改走 `t()` / `tp()`，`formatRelative` 与 `relativeAge` 输出「3 分钟前」这类中文单位。
- **toast 与错误标题本地化**：操作结果 toast 与 API 的 `err.message` 现在过词典（git 原始 stderr 细节保留原文）。
- **审计动作名本地化**：`repo-add` / `stash-create` / `rebase-interactive` 等 50 个服务端动作名在中文界面显示中文标签，英文界面保持原始标识符（与审计筛选、日志一致）。
- **子模块状态面板**：侧栏新增只读「子模块」分组，`git submodule status --recursive` 的四种前缀（已同步 / 未初始化 / 已修改 / 冲突）分色展示，附带短 SHA 与 describe。
- **提交签名验证**：新增 `GET /api/signature`（`git log -1 --format=%G?%x00%GS%x00%GK`），提交详情显示「已验证 / 签名无效 / 未签名 / 已过期 / 密钥吊销」等 `%G?` 状态；无签名密钥的仓库照常显示「未签名」。
- **提交图键盘导航对齐**：补 `PageUp` / `PageDown` / `Escape`（清空选中）与 `aria-activedescendant`，每行加 `commit-row-<hash>` 的 id；决策逻辑抽到 `src/lib/graph-nav.ts`，纯函数 + jsdom 交互 + SSR 标记三层测试覆盖。
- **窄窗口换行**：中文标签变长后「忽略空白」在窄 diff 面板竖排，`.ws-toggle` / `.context-picker` 加 `nowrap`。

### 测试
- 新增 HTTP 层 E2E（`e2e/run.sh`，端口 18774，`GIT2_DEV=1` 固定 `dev-token`、`PR_HELPER_HOME` 隔离、fixture 现场创建），覆盖 Security → 仓库注册 → 暂存/提交/撤销 → 分支/标签/储藏 → grep/对比/rebase 计划 → cherry-pick/merge → GitHub 代理守卫 → 审计 → 注销，共 **102 项**。
- `server/routes.test.mjs` 新增 merge 冲突契约 4 项（409 带冲突文件、取 `ours` 后提交产生 3-token 的 merge 提交、merge 之外的空提交仍 409）。
- 当前基线：**267 单测 / 24 文件**（`routes.test.mjs` 单独 89）、E2E 102/102。

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
