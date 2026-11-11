# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。版本号在 `package.json` 与 `handoff.md` 之间保持同步。

## [Unreleased]

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
- README / 设置页文案：E2E 136、单测 307/31、数据目录 0700/0600、PAT localStorage 口径、敏感文件覆盖范围、`GIT2_HOST` 与默认 loopback 的关系。

### 重构
- `routes-git.mjs` 从 2743 行拆成 100 行调度器 + `routes-git-helpers.mjs`（共享校验/仓库摘要/敏感路径/rebase helper）、`routes-git-meta.mjs`（health/audit/storage/registry/PAT/users/team）、`routes-git-read.mjs`（只读仓库接口）、`routes-git-write.mjs`（写操作接口）；`repo` 守卫和 GitHub fallthrough 保持在调度器里，避免改变路由顺序。
- `readAudit` 从“整文件读入 + 全量 parse”改为 `readline` 流式扫描 + 只保留最新 `limit` 条窗口；`total` 仍统计全文件匹配数，内存不再随审计文件增长。
- `routes-git-write.mjs` 再拆成 124 行写调度器 + `worktree` / `refs` / `history` / `files` / `network` / `stash` 六个领域模块，单文件最大从 1318 行降到 496 行。

### 测试
- 新增 admin 权限、成员 PAT 不继承、敏感文件 stage/commit/clean、数据目录权限、URL 脱敏、AI endpoint 变更清 key、watcher reconcile、主题 token alias 的测试；CI 增加 `npm run e2e`。
- 新增 `appearance` 偏好/alias 测试与 `SettingsModal` admin/member 分区测试（6 条），并起隔离实例目检 light theme 主界面、设置弹窗与 Git 工作区。

## [0.2.2] - 2026-11-11

### 新增
- **服务端 PAT 存储**：新增 `POST /api/pat`、`DELETE /api/pat`、`GET /api/pat/status`，PAT 可保存在服务端 `config.json`，浏览器不再必须持有；GitHub 代理在请求未带 `x-github-pat` 时注入服务端 token，只回传 `hasServerPat`，不回传 token 原文。
- **PAT 设置入口**：设置页新增 GitHub PAT 状态、保存与清除；token 不写入仓库、不回显到浏览器，也不写进日志。

### 测试
- **E2E 扩到 136 项**：吸收 git 侧的 destructive-scenario 覆盖（hard reset、force-with-lease、rebase/merge 冲突、clean、commit.template、allow-empty 等），从 115 增至 136，全部通过。
- **jsdom localStorage polyfill**：修复 Node >= 22 下测试环境的 localStorage 缺失，单测保持 287 / 27 文件。

### 变更
- **git 归档 / 单一主实现**：`pr-helper-git` 归档为 GitHub PRIVATE+ARCHIVED，本地保留 `pr-helper-git-archive` 与最终 bundle；设计 token 源、PARITY 台账、Tauri 桌面壳配置迁入本仓库。
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
