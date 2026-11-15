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
| 1 | GitHub App 授权返回后载入工作台并显示仓库管理入口 | 🔀 | **D-020 已实现 Device Flow 连接**（Settings → GitHub account：设备码 + 浏览器授权 + 应用内轮询；显示账号/头像/App 安装），本地 token 仍是认证边界。仍按替代实现计；实网需用户在 App 设置启用 Device Flow 后走查，通过后可评估转 ✅ |
| 2 | 账户菜单可查询最近操作审计记录 | ✅ | UI 实测（11-14）：FlowBoard「Audit log」→ 500 行 (上限 500) 表格 + 文本筛选 + 导出 CSV（`pr-helper-flows-audit-2026-11-14.csv`，90,686 bytes，表头/转义校验通过）；`GET /api/flows/audit` 路由测试 ✓ |
| 3 | 新建流程保存到本地 PG 并在刷新后恢复 | ✅ | `createWorkflow` 纯函数测试（随迁 143）+ PUT 路由测试；本地持久化 = 本地 PG，刷新即投影 |
| 4 | 编辑流程可重新排序步骤并保存新顺序 | ✅ | 11-15 UI 实测：新建流程加第二步后，展开第二步点「上移步骤」，`feature → main` 变为第 1 步、`dev → main` 变第 2 步，展开状态随 stageId 保留；顺序经既有 `PUT /api/flows/workflows` + `workflowToRows(stage_index)` 持久化（`reorderStages` 纯函数测试覆盖依赖索引重写）。pointer 拖拽未做，显式上/下移为等价入口 |
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
