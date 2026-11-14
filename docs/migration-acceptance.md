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
| 1 | GitHub App 授权返回后载入工作台并显示仓库管理入口 | 🔀 | 本地产品用 token bootstrap + PAT/App 服务端凭据（e2e 已有 token/cookie 用例）；无 GitHub App OAuth 用户流程，属认证形态替代，不是功能误砍 |
| 2 | 账户菜单可查询最近操作审计记录 | 🔶 | `GET /api/flows/audit` 路由测试 ✓；UI 入口走查（audit 记录同时落 audit.log） |
| 3 | 新建流程保存到本地 PG 并在刷新后恢复 | ✅ | `createWorkflow` 纯函数测试（随迁 143）+ PUT 路由测试；本地持久化 = 本地 PG，刷新即投影 |
| 4 | 编辑流程可重新排序步骤并保存新顺序 | ✅ | `reorderStages` 纯函数测试；编辑器步骤卡（拖拽 UI 走查项，见 #4 注） |
| 5 | 编辑时步骤表单默认折叠、添加后重新折叠 | ⬜ | 编辑器 UI 细节（折叠交互）待 |
| 6 | 新建时步骤表单保持展开 | ⬜ | 同上 |
| 7 | 编辑流程换仓库需确认 | ⬜ | 当前编辑器仓库字段锁定（新建后不可换仓），交互不存在；非云依赖，D-002-v2 后归 P3-11 恢复 |
| 8 | 确认换仓库转为新建流程 | ⬜ | 同上 |
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
| 19 | 前置缺失时开关禁用 | 🔶 | 前置简化为诚实提示（AI 凭据面 M-E 未迁移）；阈值/规则缺失拒绝编辑已实测 |
| 20 | 删除流程需确认后本地删除 | 🔶 | DELETE 路由测试 ✓；确认交互与入口走查 |
| 21 | 部署回滚二次确认 + 不可变运行标识 | ⬜ | D-002-v2 后恢复为必迁；后端 `requestDeploymentRollback` 在，回滚路由 + 二次确认 UI 待 P3-10 |
| 22 | 部署门禁收起表单 + 配置警告 | ⬜ | D-002-v2 后恢复为必迁；FlowEditor 部署表单/配置警告待 P3-10 |
| 23 | 移除部署门禁可撤销 | ⬜ | 同上 |
| 24 | 详情返回时目标泳道高亮后褪去 | ⬜ | return-highlight UI 细节待 |
| 25 | 固定步骤打开抽屉并重触发 Actions | ✅ | StepDrawer + rerun 路由（同 #10） |
| 26 | 进度条按服务端阶段决策标注每一步 | ✅ | `flows-detail.ts flowProgress` 测试（tones → nodes） |
| 27 | 进度条只统计连续完成前缀 | ✅ | 同上（明确断言后续已合并不算本轮） |
| 28 | 全部完成后进度条无当前步 | ✅ | `workflowProgress` firstUnfinished === -1 → currentIndex null |
| 29 | 深色主题下 PR 编号链接色 | ✅ | 全站 token 化（--accent），无浏览器默认色 |
| 30 | GitHub Environment 字段列出可选值 | ⬜ | D-002-v2 后恢复为必迁；Environment 可选值/警告待 P3-10 |
| 31 | 无 Environment 时提示留空 | ⬜ | 同上 |
| 32 | PR 引用悬停显示地址、点击复制 | 🔶 | `pr-reference.ts` 直拷待（M-F19）；看板当前为普通外链 |
| 33 | 手机竖屏无横向溢出，Lane 与抽屉可用 | ✅ | Chrome headless 390×844 仿真验收（14 lanes 无溢出）+ 700px 断点 |
| 34 | 手机竖屏失败中心与创建弹窗不溢出 | 🔶 | 失败中心/编辑器为单列布局；走查确认 |

**统计**：✅ 18 · 🔶 5 · 🔀 1 · ⬜ 10（合计 34）。D-002-v2 后 🚫 类归零：验收 #1 改为认证形态替代；#7/#8 换仓库、#21/#22/#23/#30/#31 部署/Environment 全部转为待补；其余 ⬜ 为编辑器折叠、return-highlight 等 UI 细节。**“34/34 已映射”不等于“34/34 已通过”**，P3-9 不得再以 🚫 计数宣布功能闭环。

走查方式：`npm run dev` → Flows 视图（桌面）或 /m（手机），逐条对照本表。
