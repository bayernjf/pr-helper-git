# 对齐台账归档（parity archive）

> 本文件自 2026-11-10 起**归档**：pr-helper-git 已推 GitHub 私有仓并 archive（只读），
> pr-helper-git2 成为唯一主实现。功能性差异 = 0；以下台账保留完整对齐历史
> 与「已知限制」。后续功能变更直接记录在 pr-helper-git2 的 handoff.md。

---
# 两仓库功能对齐台账（pr-helper-git ⇄ pr-helper-git2）

最后更新：2026-11-10（两轮深度对齐完成：旧台账 18 项 + 后续迭代 4 项 + 本日新增 20 项对齐；功能性差异 0 项，5 项缺口已在本日全部闭合，git 侧外观与数据维护增强已回流 git2）

## 已补齐（✅）

| 方向 | 功能 | 落点 | 验证 |
|---|---|---|---|
| git2 ← git | AI 生成 commit message / PR 描述 + AI 设置（服务端存 key、`hasKey` 只回布尔） | `server/ai.mjs`、`/api/ai/*`、SettingsModal、WorkPanel、CreatePrModal | `server/ai.test.mjs` 12 项 + tsc + build |
| git2 ← git | cherry-pick、撤销 HEAD 提交（soft reset 保留暂存） | `/api/cherry-pick`、`/api/undo-commit`、提交图右键菜单 | 全量 196 测试 |
| git ← git2 | 仓库内容搜索 `git grep`（分组、行号、忽略大小写、glob、未跟踪文件、500 上限、点击预览高亮） | `server/grep.mjs`、`GET /api/repo/grep`、`src/views/grep.ts`、顶栏入口 | `server/grep.test.mjs` 9 项（含真实 git 输出）+ 全量 114 单测 + 32/32 E2E + build |
| git ← git2 | Merge 策略选择（default / `--no-ff` / `--ff-only` / `--squash`） | `buildMergeArgs`、`/api/repo/merge`、`mergeStrategyDialog`、侧栏两处入口 | `git-args.test.mjs` 用例扩展 + E2E merge 通过 |
| git ← git2 | 审计日志可视化 + 自动轮转（超过 1.5 MB 时保留 newest，1 MB / 10000 行预算，临时文件原子替换） | `server/audit.mjs`、`GET /api/audit`、`src/views/audit.ts`、设置页数据卡片 | `server/audit.test.mjs` 6 项 + 4 条 E2E |
| git2 ← git | 多仓库总览增强（置顶、活跃度色条、全局 WIP 聚合、With changes 过滤、30s 状态自动刷新） | `src/lib/repo-sort.ts`、`RepositoriesModal.tsx` | `repo-sort.test.ts` 9 项 + tsc + build |
| git2 ← git | 行级暂存 / 取消暂存（勾选 +/- 行重算 @@ 头，未选改动按目标侧保留为上下文） | `server/patch-lines.mjs`、`POST /api/stage-lines`、`DiffView.tsx` | `patch-lines.test.mjs` 10 项（含真实 `git apply` 双向集成） |
| git2 ← git | 全历史提交搜索（`--all` + message/`author:`/`path:` 三种模式，三种入口） | `server/search-commits.mjs`、`GET /api/search-commits`、`CommitSearchModal.tsx` | `search-commits.test.mjs` 6 项（含未合并分支集成）+ 1 条 HTTP 用例 |
| git2 ← git | 中英双语 i18n（英文原文作 key 的词典 + 计数规则 + 设置内语言切换） | `src/i18n.ts`（`ZH` 约 300 条、`t`/`tp`/计数规则、`useLocale`）、`SettingsModal` 语言选择、40+ 组件文案包裹 | `src/i18n.test.ts` 5 项（含源码 key 覆盖率扫描）+ 245 测试 / 21 文件 + tsc + build |
| git2 ← git | CI 门禁与目标分支保护提醒（check runs + 经典 status、失败门禁确认、无保护提醒/必需检查数） | `server/github-allowlist.mjs` 放开 `commits/:sha/status` 与 `branches/:branch/protection`、`PrDetailModal` 合并展示与合并前确认 | `github-allowlist.test.mjs` 3 项（240 单测 / 20 文件）+ tsc + build（需 PAT 实网未跑） |
| git ← git2 | PR 行级 review 评论（点 diff 行发言、按文件汇总计数、可删除） | `renderPatch` 的 `onLine` 回调、`server/github.mjs` 3 个函数、`/api/github/pr/review-comment(s)` | `github.test.mjs` 9 项 + 151 单测 + tsc + build + E2E 82/82（未联网） |
| git ← git2 | PR 协作主体（评论增删改、评审提交、评审人/标签增删、可编辑标题描述、draft→ready） | `server/github.mjs` 新函数、`GET/POST /api/github/pr/*` 10 条路由、`src/views/dialogs.ts` PR 弹窗、`promptDialog` 多行支持 | `github.test.mjs` 7 项 + 149 单测 + tsc + build + E2E 82/82（PAT 路由未联网） |
| git ← git2 | 可访问性（提交图 listbox/option + aria-activedescendant、Home/End/PageUp/PageDown、弹窗 Tab 焦点陷阱、`?` 快捷键速查） | `src/views/graph.ts`、`src/ui.ts` 焦点陷阱、`src/views/shortcuts.ts`、`src/main.ts` 的 `?` 入口、中英 9 词条 | tsc + build + 162 单测（其中 11 项 DOM 级：listbox/option/aria-activedescendant、Tab 焦点陷阱、`?` 速查面板）+ E2E 83/83 |
| git ← git2 | 团队身份 + 审计归属（owner/member token 哈希、Team 面板、审计带 user/role） | `server/identity.mjs`、`server/actor.mjs`、`GET /api/team`、`POST /api/team/add|remove`、`audit.mjs` 归属、设置页团队卡片 | `identity.test.mjs` 6 + `audit.test.mjs` 8 + E2E 11 条（82/82）+ tsc + build |
| git ← git2 | 两引用对比（ahead/behind + merge base + rename 感知文件列表 + 单文件 `mode=compare` patch） | `server/compare.mjs`、`GET /api/repo/compare`、`GET /api/repo/diff` 的 `mode=compare`、`src/views/compare.ts`、顶栏入口 | `compare.test.mjs` 7 项 + E2E 10 条（71/71）+ tsc + build |
| git ← git2 | Remote 管理面板（列出 fetch/push URL、新增、重命名、改 URL（`--push` 只改 pushurl）、删除 + 审计） | `server/git-args.mjs` 的 `buildRemoteArgs`/`parseRemoteVerbose`、`GET /api/repo/remotes`、`POST /api/repo/remote`、`src/views/remotes.ts`、顶栏入口 | `git-args.test.mjs` 新增 3 项 + E2E 17 条（61/61）+ tsc + build |
| git ← git2 | 应用内文件编辑器（mtime 乐观锁 409 + 重新载入/强制覆盖、⌘S、Tab 缩进、可选保存后暂存） | `server/file-write.mjs`、`GET /api/repo/file`、`src/views/editor.ts` | `file-write.test.mjs` 8 项 + E2E 6 条（42/42） |
| git ← git2 | 只读手机视图 `/m`（仓库下拉、刷新、中英切换、分支与 ahead/behind、暂存计数、未提交改动、80 条提交、全屏提交详情与单文件 diff，无写操作、`?repo=` + `?commit=` 深链） | `src/views/mobile.ts`、`src/main.ts` 的 `wantsMobile()`、`/m` / `?mobile=1` 分流、`.m-*` 样式 | `src/views/mobile.test.ts` 4 项 + E2E 100/100 + build；390px 实测无横向溢出 |
| git ← git2 | 批量回退（勾选 ≥2 个提交，按时间从新到旧 `git revert --no-edit`；拒绝合并提交、上限 25） | 提交图复选框、WIP 面板批量条、`POST /api/repo/revert-batch`、审计 | E2E 6 项（含真实仓库回退并核对两个 Revert 提交与文件消失） |
| git ← git2 | 清理未跟踪文件（`git clean -nd` 预览 + 确认后 `git clean -fd`，不动已忽略文件） | 未跟踪分组按钮、确认弹窗、`POST /api/repo/clean`、审计 | E2E 5 项（dry-run 列出、缺 confirm 400、删除生效、ignored 文件保留） |
| git2 ← git | 手机提交深链（`?repo=<path>&commit=<sha>` 打开即切仓库并弹出该提交，关闭清参数；StrictMode 双执行下不会回落到旧仓库） | `src/components/MobileApp.tsx` 的 `syncUrl` / `pendingRepo` 初始化、`mobile.test.tsx` 深链用例 | 274 / 25 单测 + tsc + build + 109 / 109 E2E；浏览器带 repo 深链实测弹出目标提交 |
| git2 ← git | 交互式 rebase（整段计划：pick/reword/edit/squash/fixup/drop + 上下重排 + reword 消息；计划漏项直接报错、dirty 与含合并提交 409、已推送力推提醒、冲突交给 continue/abort 横幅） | `server/rebase-todo.mjs`、`server/rebase-{sequence,msg}.mjs`、`GET /api/rebase/plan`、`POST /api/rebase/interactive`、`RebaseModal.tsx`、提交图右键菜单 | `rebase-todo.test.mjs` 12 项 + 3 条真实改写历史的 HTTP 用例 + 全量 237 / 19 文件 + build |

顺带修复：git2 的 `git grep` 多匹配解析是错的（按 NUL 三元组切分会把下一条 path 吞进上一条 text），已改为逐条记录解析并加回归测试。git 侧新实现一开始也踩了同一个坑，靠「真实 git 输出」的集成测试才发现。

## 本轮新对齐（2026-11-10，基于双仓 118/121 项全域盘点）

| 方向 | 功能 | 落点 | 验证 |
|---|---|---|---|
| git2 ← git | **Dashboard 整页化**（第三视图：卡片网格、open-PR 数、冲突优先/置顶/名称/最近/变更数排序、右键菜单 open/Finder/终端/VSCode/移除、后台 fetch-all 10 分钟、30s 自动刷新） | `DashboardPage.tsx`、`POST /api/repos/open-external`、`repoBrief` 拆分 unmerged 计数 | 274/25 单测 + 109/109 E2E + build |
| git2 ← git | 提交信息草稿持久化（按仓库隔离、提交后清除） | `WorkPanel.tsx` localStorage | 274/25 单测 |
| git2 ← git | 提交信息历史（最近 10 条回填菜单） | `WorkPanel.tsx` localStorage | 同上 |
| git2 ← git | 50/72 首行字符计数 | `WorkPanel.tsx` `countLine` | 同上 |
| git2 ← git | amend 开启时预填 HEAD 提交信息 | `WorkPanel.tsx` | 同上 |
| git2 ← git | Discard All（未暂存还原 + 未跟踪删除，确认弹窗） | `WorkPanel.tsx` + `/api/discard`、`/api/rm` 并行 | 同上 |
| git2 ← git | 图内 CI 状态点（open PR head ≤10 个，check-runs+statuses 聚合 failure>pending>success，pending 脉冲动画） | `CommitGraph.tsx`、`src/lib/ci.ts` | 单测 + build；真实 CI 需 PAT |
| git2 ← git | 图片 diff（HEAD vs 工作区并排，8 扩展名） | `GET /api/raw`（buffer + 图片 MIME + realpath 防护）、`DiffView.tsx`、dispatcher raw 契约 | build + 109/109 E2E |
| git ← git2 | 跨仓库全局搜索（500 条预算、按仓库分组/失败隔离/截断；点击结果切仓开编辑器） | `POST /api/grep-all`、`src/views/globalGrep.ts`、顶栏地球按钮 | E2E 3 项（100→103） |
| git ← git2 | PR 关闭/重开（PATCH pulls/:n；详情弹窗按钮，关闭需确认，操作后详情刷新） | `server/github.mjs` `setPullRequestState`、`POST /api/github/pr/state`、`dialogs.ts` | 路由 + build（PAT 实网未跑） |
| git ← git2 | revert 主线选择（merge 提交检测 2+ 亲本 → 必填 `-m 1..N`；图上弹窗输入） | `buildRevertArgs`、`/api/repo/revert`、`graph.ts` `promptDialog` | build；冲突场景由横幅接管 |
| git ← git2 | revert 中断恢复（`REVERT_HEAD` 检测 → status.reverting → WIP 横幅 继续/中止） | `repos.mjs`、`/api/repo/revert` action=abort/continue、`commitPanel.ts` | build + 手动场景 |
| git ← git2 | diff 调参（`-w` 忽略空白 + `-U` 上下文行数 ±3/6/10/25，均持久化） | `/api/repo/diff` 参数、`diff.ts` 头部控件、compare 调用透传 | 170/23 单测 + 103/103 E2E |
| git ← git2 | PR 列表增强：文本过滤（编号/标题/作者，就地过滤）+ 评审汇总 pill（+N 批准 / -N 请求修改，≤10 open PR） | `app.ts` `prReviews`、`sidebar.ts` | build（PAT 实网未跑） |
| git ← git2 | 图内高级筛选（作者 / 提交信息 / 起止日期 / 路径，服务端 `GET /api/repo/log` 覆盖已加载页之外；`pathFilter` 避免与仓库路径参数互撞） | `src/views/logFilter.ts`、`src/views/repo.ts` 顶栏 chip、`server/index.mjs` | 单测 175 / 24 + E2E 121/121（4 条筛选断言）+ 4792 隔离实例浏览器实测 `author` 与 `pathFilter` 请求 |
| git ← git2 | 团队配置导入导出（JSON 只含 repos + 成员名，永不含 token/PAT；导入默认 merge、可 replace，仅接受真实 Git 工作树，≤200 条并审计） | `server/index.mjs` `GET/POST /api/team/config`、`server/repos.mjs` bulk 注册、`src/views/settings.ts` | E2E 6 条（导出无 token、merge 导入、空列表 400、非 admin 403） |
| git ← git2 | commit.template 预填 + 空提交开关（读 `commit.template` 并剥 `#` 注释；`--allow-empty` 与 amend 互斥） | `GET /api/repo/commit-template`、`buildCommitArgs(amend, allowEmpty)`、`commitPanel.ts` | 单测 argv 2 例 + E2E 4 条（模板返回/剥注释/空提交 200/提交可查） |
| git ← git2 | `PR_HELPER_HOST` 局域网绑定开关（默认仍 127.0.0.1；通配绑定打印本机 URL 并警告 token 等同仓库读写） | `server/net.mjs`、`server/index.mjs` 的 `server.listen(PORT, HOST)` | `net.test.mjs` 4 项 + 实测 `PR_HELPER_HOST=0.0.0.0` 监听与 200 响应 |
| git2 ← git | 冲突三路合并编辑器（`parseConflictMarkers` 支持默认/diff3 标记 → 逐冲突区 ours/theirs/both → 可编辑合并结果 → 保存（mtime 乐观锁）+ 暂存） | `src/lib/diff/conflict.ts`、`src/components/ConflictEditorModal.tsx`、`ResolveConflictsModal.tsx` 入口 | `conflict.test.ts` 7 项 + 全量 281 / 26 + tsc + build |
| git2 ← git | 设置页外观（dark/light/auto 三模式 + 四强调色 violet/ocean/forest/amber，首屏前应用并持久化，顶栏三态循环） | `src/lib/appearance.ts`、`src/design/accents.css`、`SettingsModal.tsx`、`Toolbar.tsx` | 284 / 26 单测 + 115/115 E2E + tsc + build；4795 隔离实例实测 light+ocean = `#1f6feb`、刷新保持 |
| git2 ← git | 设置页服务端数据维护（数据目录与文件大小、压缩审计日志、清理失效仓库注册记录） | `server/store.mjs` `pruneRepos()`、`GET /api/storage`、`POST /api/maintenance/*`、`SettingsModal.tsx` | 3 条路由单测 + E2E 6 条 + 实测 `audit-rotate` 写入隔离 `audit.log` |

## 仍未补齐（⏳）— 功能性缺口

无。2026-11-10 日内闭合的最后 5 项：git 的图内高级筛选、团队配置导入导出、commit.template 预填 + allow-empty、`PR_HELPER_HOST` 局域网绑定；git2 的冲突三路合并编辑器。

### 双向形态差异（功能等价，按约定不做）

- PR 列表：git2 为三列看板页，git 为侧栏列表（评审 pill/过滤/关闭重开已补齐，能力等价）
- stash / reflog / 子模块：git 整页面板，git2 侧栏分组 + Modal
- 冲突预览：git 有三列预览弹窗 + 手动合并编辑器，git2 是 ours/theirs/mark 弹窗 + 三路合并编辑器（入口不同，能力等价）
- WIP 文件展示：git 平铺 + 未跟踪目录展开，git2 目录树折叠

已知限制不变：PR 相关能力两侧都未用真实 PAT 实网验证。

## 建议顺序

1. ~~git ← git2：审计日志可视化 + 轮转~~ 已完成
2. ~~git2 ← git：多仓库总览增强~~ 已完成
3. ~~git2 ← git：行级暂存 / 全历史搜索~~ 已完成
4. ~~git ← git2：文件编辑器~~ 已完成
5. ~~git2 ← git：交互式 rebase~~ 已完成
6. PR 深度协作（git）与 i18n（git2）放最后，两者都是重构级改动，建议各开独立分支

## 后续迭代（非补齐项，按价值排序）

已完成：

- git2 提交图的键盘导航与 git 侧对齐（`PageUp` / `PageDown` / `Esc` / `aria-activedescendant` + 三层测试）。
- 两侧提交签名验证：git 侧并入 `GET /api/repo/commit`（`signature.status/signer`），git2 侧 `GET /api/signature`；详情面板显示 `%G?` 状态。
- git2 子模块状态面板：`GET /api/submodules` + 侧栏只读分组（已同步 / 未初始化 / 已修改 / 冲突）。
- git2 `git bisect` 向导：start / good / bad / reset，状态读 `.git/BISECT_LOG`、`.git/BISECT_START`，重启不丢；命令面板入口 + 3 项路由测试 + 5 项 E2E。
- git 侧 `git bisect` 向导已回填：`GET/POST /api/repo/bisect`（`action: start|good|bad|reset`）+ 命令面板「二分定位…」弹窗 + 6 项 E2E。两侧此项现已对齐。

候选：无（后续迭代全部落地）。

已知限制仍在：PR 相关能力两侧都未用真实 PAT 实网验证。
