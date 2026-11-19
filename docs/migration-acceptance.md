# 迁移验收映射清单（P3-9）

原版 pr-helper 的 Playwright e2e（`docs/archive/pr-helper-source/e2e/pr-helper.spec.ts`，
34 条断言）逐条映射到 pr-helper-git 的承接方式。判定口径：

- **✅ 语义测试**：已由随迁单测/路由测试覆盖断言语义
- **🔶 走查**：UI 已落地，按本清单走查确认（部分语义已测）
- **🔀 替代实现**：原能力由本地形态等价替代（如 token bootstrap 取代 GitHub App OAuth）
- **🚫 不迁移**：对应能力在台账 §6 已判 🚫/🔀，断言随之失效
- **⬜ 待**：能力已确认为必迁，但当前未完成/未迁移

| # | 原版断言 | 判定 | 承接 |
|---|---|---|---|
| 1 | GitHub App 授权返回后载入工作台并显示仓库管理入口 | 🔀 | **D-020 已实现 Device Flow 连接**（Settings → GitHub account：设备码 + 浏览器授权 + 应用内轮询；显示账号/头像/App 安装），本地 token 仍是认证边界。**实网（11-16）**：Device Flow 已在 App 设置启用、本地成功取码，但 GitHub 授权确认页的 Authorize 按钮因账号 2FA 强制提示而禁用，未绕过；待用户启用 2FA / 刷新会话后完成走查，再评估转 ✅ |
| 2 | 账户菜单可查询最近操作审计记录 | ✅ | UI 实测（11-14）：FlowBoard「Audit log」→ 500 行 (上限 500) 表格 + 文本筛选 + 导出 CSV（`pr-helper-flows-audit-2026-11-14.csv`，90,686 bytes，表头/转义校验通过）；`GET /api/flows/audit` 路由测试 ✓ |
| 3 | 新建流程保存到本地 PG 并在刷新后恢复 | ✅ | `createWorkflow` 纯函数测试（随迁 143）+ PUT 路由测试；本地持久化 = 本地 PG，刷新即投影 |
| 4 | 编辑流程可重新排序步骤并保存新顺序 | ✅ | 11-15 UI 实测：新建流程加第二步后，展开第二步点「上移步骤」，`feature → main` 变为第 1 步、`dev → main` 变第 2 步，展开状态随 stageId 保留；顺序经既有 `PUT /api/flows/workflows` + `workflowToRows(stage_index)` 持久化（`reorderStages` 纯函数测试覆盖依赖索引重写）。pointer 拖拽未做，显式上/下移为等价入口 ；**流程级排序实测（11-19）**：看板 lane #N 位置徽章 + 位置直跳输入——CDP 实测 zeus 输入 3 → 顺序真实交换，moveWorkflowToPosition → PUT → Supabase 全链路生效 |
| 5 | 编辑时步骤表单默认折叠、添加后重新折叠 | ✅ | UI 实测（11-14）：编辑 zeus → 0 个 `.editor-stage-body`、折叠头显示 expand；展开后 1 个 body；点「add step」后 2 个折叠头、0 个 body |
| 6 | 新建时步骤表单保持展开 | ✅ | UI 实测（11-14）：新建流程默认展开第一步（source/target/auto-create/auto-merge/auto-advance 可见） |
| 7 | 编辑流程换仓库需确认 | ✅ | UI 实测（11-14）：编辑 zeus → 仓库字段可输入 `bayernjf/atlas` → 出现「Change repository and create a new flow」→ 原生确认框；取消则不改 |
| 8 | 确认换仓库转为新建流程 | ✅ | UI 实测（11-14）：确认后标题变「New flow」、仓库变 atlas、原 zeus 详情保留；`createMode` 保存走新建、FlowBoard `onSaved` 追加新流程 |
| 9 | 步骤就地改回等待前一步并保留 stageId | ✅ | `reorderStages`/`ensureStageIds` 语义测试 |
| 10 | 失败步骤抽屉显示重跑入口并调用受保护的重跑接口 | ✅ | StepDrawer rerun 按钮 + `POST /api/flows/rerun-actions` 路由测试（400 校验前置） |
| 11 | 抽屉创建 PR 仅在确认后提交准确负载 | ✅ | enqueue 路由测试（kind 归一化/幂等键透传）；抽屉按钮 + toast |
| 12 | 抽屉合并 PR 使用当前 head SHA | ✅ | 同上（引擎以投影 headSha 幂等执行）；实网验收归 P2-1 |
| 13 | 抽屉创建 PR 后待办立即消失 | ✅ | 操作成功 `onMutated` → 重读投影（测试覆盖路由，交互走查） |
| 14 | 抽屉合并 PR 后待办立即消失 | ✅ | 同上 |
| 15 | 失败中心可接管 AI 失败暂停的自动创建动作 | ✅ | StepDrawer take over 表单 + takeover 路由测试；失败中心项「步骤详情」直达 |
| 16 | 详情页开启合并后自动推进且不影响其它策略 | ✅ | `setStageAutoAdvance` 纯函数测试 + P3-7 确认交互 |
| 17 | 详情页单步开启自动合并不影响自动创建策略 | ✅ | `setStageAutoMerge` 纯函数测试 |
| 18 | 勾选自动合并先确认，取消则不保存 | ✅ | `immediateAutomationEffect` 语义测试（143）+ editor window.confirm |
| 19 | 前置缺失时开关禁用 | ✅ | 11-15 UI 实测（隔离服务 4791）：新建流程时显示「automation toggles are disabled」，auto-create / auto-merge / auto-advance 三个开关及阈值全部 `disabled`；缺项逐条列出（AI 凭据、自动生成、自动确认、规则）。原版四项前置 `autoCreatePrerequisites()` 语义已移植，`editor-prerequisites` 3 个纯函数测试 |
| 20 | 删除流程需确认后本地删除 | ✅ | UI 实测（11-14）：详情页「Delete flow」→ 确认弹窗（Delete Delete smoke 1114?）→ 删除后 lane 15→14、名称消失；DELETE 路由 200 |
| 21 | 部署回滚二次确认 + 不可变运行标识 | ✅ | 11-15 范围裁决：StepDrawer 确认框展示 provider/environment/target/runId/rollback workflow 并二次确认，runId 不可改写；`requestDeploymentRollback` + `POST /api/flows/deployment-rollback` 路由测试 ✓；真实成功部署 run 已入投影（bayjf 2、pr-helper 2），回滚按钮条件已满足。实际 dispatch 会触发被管理仓库 rollback workflow，按用户裁决作为范围例外**不执行**，不据此宣称真实回滚已发生 |
| 22 | 部署门禁收起表单 + 配置警告 | ✅ | FlowEditor 部署区（11-14 UI 实测）：收起时列表 + 警告；表单支持 workflow/target/provider/environment + 高级字段；`deploymentConfigurationWarnings` 渲染 no-deployments/actions-unavailable 等；真实仓库 Actions/Environment 列表随 `GET /api/flows/deployment-options`（路由测试 + 400 校验） |
| 23 | 移除部署门禁可撤销 | ✅ | UI 实测（11-14）：移除 Vercel·dev 后出现「Removed Vercel · dev」+ undo；撤销后四张默认门禁恢复 |
| 24 | 详情返回时目标泳道高亮后褪去 | ✅ | UI 实测（11-14）：进入 zeus/临时流程详情后返回，目标 lane 立即带 `.is-return-highlight`，1.6s 动画后自动清除 |
| 25 | 固定步骤打开抽屉并重触发 Actions | ✅ | StepDrawer + rerun 路由（同 #10） |
| 26 | 进度条按服务端阶段决策标注每一步 | ✅ | `flows-detail.ts flowProgress` 测试（tones → nodes） |
| 27 | 进度条只统计连续完成前缀 | ✅ | 同上（明确断言后续已合并不算本轮） |
| 28 | 全部完成后进度条无当前步 | ✅ | `workflowProgress` firstUnfinished === -1 → currentIndex null |
| 29 | 深色主题下 PR 编号链接色 | ✅ | 全站 token 化（--accent），无浏览器默认色 |
| 30 | GitHub Environment 字段列出可选值 | ✅ | 11-15 实网：`GET /api/flows/deployment-options?repository=bayernjf/bayjf` 返回 `actionsAvailable=true`、`environmentsAvailable=true`，Actions 4 个、Environment 5 个（`Production`、`preview-cloudflare-pages`、`preview-vercel-api`、`production-cloudflare-pages`、`production-vercel-api`）；FlowEditor 的 datalist 已接该字段 |
| 31 | 无 Environment 时提示留空 | ✅ | 11-15 实网：同一接口对 `bayernjf/pr-helper-git` 返回 `environmentsAvailable=true`、`environments=[]`；FlowEditor 的「未加载 / 有可选 / 仓库无 Environment 留空」三分支已实现，空列表走最后一支 |
| 32 | PR 引用悬停显示地址、点击复制 | ✅ | UI 实测（11-14）：悬停 `#194` 显示完整 `https://github.com/bayernjf/zeus/pull/194` + Open PR；点击后 toast「PR link copied」；看板/详情/抽屉/失败中心统一 `PullReference` |
| 33 | 手机竖屏无横向溢出，Lane 与抽屉可用 | ✅ | Chrome headless 390×844 仿真验收（14 lanes 无溢出）+ 700px 断点 |
| 34 | 手机竖屏失败中心与创建弹窗不溢出 | ✅ | 11-15 Chrome CDP 390×844 实测：`/m` Flows 失败中心宽 366、`document.documentElement.scrollWidth=390`；「New flow」创建页同样 `scrollWidth=390`，无横向溢出 |

**统计**：✅ 33 · 🔶 0 · 🔀 1 · ⬜ 0（合计 34）。11-15 实网对账后 #30/#31 转 ✅；#21 按用户裁决转 ✅（确认 UX/路由验收，实际 dispatch 为范围例外）；#19 四项前置禁用与 #34 手机竖屏走查同日通过；#1 为认证形态替代（🔀，非功能误砍）。**“34/34 已映射”不等于“34/34 已通过”**，但除 #1 的有意替代外已无开放式失败项。

走查方式：`npm run dev` → Flows 视图（桌面）或 /m（手机），逐条对照本表。

## 验收实测记录（2026-11-19 补充）

看板细节批（automation/stale 徽章、配置警告行、lane 运行历史+时间线 details）落地，
数据走 D-018 镜像（15 流程含新增 agent-ops）。原版对照审计（本地 checkout 仍在
000mycodes/pr-helper）确认 19 对话框语义全有对应——真缺失 2 个已落地（Codex 修复
对话框 4c60ef4 + 生成规则管理对话框 a41e05d，规则名迁移 049）。

### 第二批功能补齐（2026-11-19，随 0.3.12 发布）

对照冻结源 `docs/archive/pr-helper-source/` 的第二批 9 项全部落地（进度条语义与
nextAction 面板同提交），8 个功能提交 + 1 个测试提交：

| 项 | 提交 | 验证口径 |
|---|---|---|
| 进度条语义增强 + nextAction 面板 | 639d02d | 浏览器实测（隔离 18776，真实镜像数据）：NEXT ACTION「Flow status synced」、`All done · 1 steps, waiting for new commits`、`checks 8/8`、`merged · post-merge checks passed` |
| fan-in 分组 | 7b7f637 | 域测试覆盖；真实 15 流程无多上游 target，浏览器无触发数据（登记为数据缺口，非功能缺口） |
| gateDisclosure 门禁披露 | b6d1179 | 无 PAT 降级为纯 chip 浏览器实测；live 展开/分组/Cloudflare 摘要 retarget 由 806ea80 组件测试覆盖（open-PR fixture + mock proxy） |
| merge 方法菜单 | 706ec0b | 真实 15 stage 全 merged 无 open PR，浏览器不可触发；菜单选项/squash-rebase 禁用边界/Escape 层级/外点关闭由 806ea80 覆盖 |
| resolve 消隐 | 5100b29 | 17 个语义单测（TTL/新事件复现/prune/投影不变）；rerun/merge 成功回调接线由 806ea80 覆盖（含失败不消隐的反例）；浏览器不做写操作故未实测消隐 |
| 分支选择器 | 03aa15f | 无 PAT 降级自由文本浏览器实测（combobox 无 toggle/listbox）；过滤语义 3 单测；live 分支列表需 PAT，登记为待实网走查 |
| toast undo | 16a0168 | 4 个 jsdom 测试（undo 回调+消隐、7s/3.6s 窗口、focus 暂停/blur 续期、close 不触发）；浏览器无部署门禁草稿操作故未实测 |
| 板级 preflight 聚合 | 67b3899 | 浏览器实测：15 flow(s) checked、17 failed/8 warnings/56 passed、按流程 details 分组、无 App 凭据 fail-soft（App access FAILED + branches SKIPPED 为隔离环境预期降级）；路由 fan-out 1 测试 + 聚合 4 单测 |
| open-PR 抽屉面组件测试网 | 806ea80 | 8 测试；变异对照（移除 resolve 回调）恰红 2 个接线测试后恢复，哈希校验一致 |

门禁：lint、typecheck:server、**1163 tests / 67 files**、build、E2E **162/162**。
浏览器验证只读：隔离 `PR_HELPER_HOME` + 无 `PR_HELPER_GIT_AUTOMATION`（调度器 opt-in
不启动），未点任何写操作与看板 Refresh；验证后仅 kill 自启 PID 并清理临时目录。

### Live-PAT 实网走查（2026-11-19）

在已登记测试仓 `bayernjf/git-e2e-test` 建真实 PR
[#14](https://github.com/bayernjf/git-e2e-test/pull/14)（临时 fixture，走查后
已关闭、临时分支已删除；临时分支 `live-pat-walkthrough-20261119-1708` 与
`.github/workflows/live-pat-check.yml` 仍在）。PR 真实状态：2 commits / 2 files
（`live-pat-walkthrough.md` +3、workflow +10），head `54e3bb1`，GitHub Actions
`live-pat-check / smoke` run `44493987714` 结论 **SUCCESS**。

桌面端 0.3.13 用真实服务端 PAT 走查：
- PR 列表真实加载 Open 1 / Merged 6 / Closed 7；#14 抽屉显示 commits、files、`+13 -0`、
  `CHECKS smoke success`、merge 方法三项；文件 Review 展开真实 diff（`@@ -0,0 +1,3 @@`）。
- `New pull request` 的 Base/Compare 下拉真实列出 `live-pat-walkthrough-20261119-1708`
  与 `main`，未创建第二个 PR。
- 发现并修复服务端 PAT 缺口：`FlowEditor` / `StepDrawer` 的 `useBranches` /
  `useCheckDetails` 之前只认浏览器 PAT，服务端 PAT 模式会提前返回；修复后隔离
  18777（真实服务端 PAT、无调度器、零写）实测 source/target 列出 `dev`/`main`，
  StepDrawer checks 展开为 8 条真实 GitHub Actions 明细。
- PR 列表卡片在 GitHub REST 已是 `mergeable=true / merge_state=clean` 时仍显示
  `computing`；这是列表端点 `mergeable_state` 延迟计算，抽屉单 PR 读取正常，未改。
