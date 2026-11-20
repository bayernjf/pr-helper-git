# P5-2 切换审批清单（草案）

> **状态：未批准、未执行。** 本文件只用于影子期判定通过后的逐项审批。
>
> **D-016 铁律**：P5-2 的每一个动作都必须先由 owner 明确批准；批准一项、执行一项、报告一项。影子期判定一致本身不构成执行授权。审批后由 owner 执行，AI 不代为执行。
>
> **停止条件**：任何一步出现不可解释差异、重复动作、错误分支合并、webhook/cron 仍指向旧执行者，立即停止并按第 5 节回滚。

## 1. 进入本清单的前置条件

- [ ] P5-1 已连续 5–7 天无不可解释差异；判定证据填入第 3 节。
- [ ] P3-10 / P3-11 已关闭（2026-11-15 已完成，台账 Phase 3.5）。
- [ ] 4789 影子服务健康：`127.0.0.1:4789` 在听、队列 `0/0/0`、`trackedWorkflows` 符合预期。
- [ ] 最近一次 `npm run sync:shadow` 成功，云端/本地动作计数逐日一致。
- [ ] 已确认 GitHub App 管理入口、Vercel 项目入口和本地 PAT/credential 状态；不得在终端或文档中打印 token、PAT、webhook secret。
- [ ] 已保存当前 launchd plist 和 webhook URL 的原值，供回滚使用。

## 2. 逐项审批表

| # | 动作 | 审批 | 执行 | 验证 | 回滚 |
|---|---|---|---|---|---|
| 1 | 本地引擎从 shadow 转为执行 | [ ] | [ ] | [ ] | [ ] |
| 2 | 摘除 GitHub App 的 Vercel webhook 订阅 | [ ] | [ ] | [ ] | [ ] |
| 3 | 停 Vercel cron | [ ] | [ ] | [ ] | [ ] |
| 4 | 跑一次真实端到端流程 | [ ] | [ ] | [ ] | [ ] |

### 动作 1：本地引擎转执行

**执行（owner）：**

```bash
cd /Users/jiangfeng/000mycodes/pr-helper-git
cp "$HOME/Library/LaunchAgents/local.pr-helper-git.server.plist" \
   "/Users/jiangfeng/000mycodes-backups/pr-helper-git/launchd-plist-pre-p5-2.plist"

bash launchd/uninstall.sh
lsof -nP -iTCP:4789 -sTCP:LISTEN    # 期望无输出

PR_HELPER_GIT_AUTOMATION=1 PR_HELPER_AUTOMATION_SHADOW=0 bash launchd/install.sh
plutil -p "$HOME/Library/LaunchAgents/local.pr-helper-git.server.plist" \
  | rg 'PR_HELPER_GIT_AUTOMATION|PR_HELPER_AUTOMATION_SHADOW'
```

**验证：**

- launchd 输出 `automation=1, shadow=0`。
- `~/Library/Logs/pr-helper-git/server.err.log` 出现 `[automation] schedulers started`，且**不再**带 `— SHADOW MODE`。
- `~/.pr-helper-git/automation-shadow.log` 不再增长；新的 drain/reconcile 走执行入口。
- 首轮 drain 后队列没有卡死；无重复执行或异常回退。

**回滚：**

```bash
bash launchd/uninstall.sh
PR_HELPER_GIT_AUTOMATION=1 PR_HELPER_AUTOMATION_SHADOW=1 bash launchd/install.sh
```

或直接恢复 `launchd-plist-pre-p5-2.plist` 后重新 bootstrap。

### 动作 2：摘除 GitHub App 的 Vercel webhook 订阅

**执行（owner，GitHub 网页）：**

1. GitHub → Settings → Applications → Installed GitHub Apps → `pr-helper` → Configure。
2. 记录当前 Webhook URL（只记录域名/路径，不记录 secret）。
3. 删除指向 Vercel 的订阅 URL，或按 D-004 选定的可达性方案改为本地 `/api/github-webhook`。

**决策点：** 是否让本地接收端接管 webhook。

- **接管**：先落实 D-004 三选一的可达性方案，并确认 `GITHUB_WEBHOOK_SECRET` 已配置；否则本地端点会按 fail-closed 返回 503。
- **暂不接管**：摘除订阅后，本地引擎依赖定时 drain/reconcile，实时性下降；在 P5-3 前必须补上可达性方案或明确接受该降级。

**验证：**

- GitHub App 的 deliveries 不再发往 Vercel。
- 若本地接管：GitHub 测试 delivery 返回 200；不带签名的请求返回 401/503，不能绕过 HMAC。
- 服务端日志出现 `[automation:shadow] webhook ...` 的行应消失；执行模式下 webhook 正常投影。

**回滚：** 把 Webhook URL 恢复为原 Vercel 地址，并在 GitHub 上重发一次测试 delivery 验证云端恢复。

### 动作 3：停 Vercel cron

**执行（owner，Vercel 项目）：**

1. 在云端 pr-helper 的 Vercel 项目保存当前 `vercel.json` 或当前部署配置。
2. 移除 `crons` 字段（或关闭对应 cron job）。
3. redeploy，确认部署成功。

**验证：**

- Vercel 项目的 Cron Jobs 列表为空。
- 观察一个调度周期，确认没有新的云端定时运行。
- 云端 `workflow_automation_actions` 不再新增由 cron 触发的动作。

**回滚：** 恢复 `crons` 字段并 redeploy；确认下一次 cron 正常触发。

### 动作 4：真实端到端流程

**执行（owner）：**

- 只使用 `test-repos.md` 中已登记的测试仓（优先 `bayernjf/git-e2e-test`），不新建测试仓。
- 按台账 P2-3 的验收链路：push → 阈值 → 自动建 PR → 门禁 → 自动合并 → 推进 stage。
- 记录本次运行的 action id、PR 编号、合并 commit、stage 审计事件。

**验证：**

- PR 由本地引擎创建并合并到预期分支，不能重复建 PR 或合并错分支。
- `workflow_automation_actions` 状态为 `succeeded`，审计出现 `stage-advanced`。
- 云端不再产生同一动作的第二份执行记录。

**回滚：** 关闭误建 PR / 回退错误合并（按 Git 历史恢复），并把本地切回 shadow；已产生的数据副作用需单独记录，不能假装回滚。

## 3. 判定日证据（执行前填写）

| 项目 | 值 |
|---|---|
| 影子期启动 | 2026-11-14 16:24 CST |
| 判定时间 | 2026-11-21 16:24 CST 后 |
| 连续一致天数 |  |
| 最近一次 sync |  |
| 云端/本地逐日计数 |  |
| 不可解释差异 |  |
| 4789 PID / 队列 |  |
| 判定结论 | 通过 / 不通过 |

判定命令与比对口径以 [`phase5-runbook.md`](phase5-runbook.md) 为准；差异必须写入 [`pr-helper-migration.md`](pr-helper-migration.md) §12，修复后重跑影子计数，不能带着差异进入 P5-2。

## 4. 审批记录

| 动作 | 批准人 | 批准时间 | 执行结果 | 备注 |
|---|---|---|---|---|
| 1. 本地转执行 |  |  |  |  |
| 2. 摘 webhook |  |  |  |  |
| 3. 停 Vercel cron |  |  |  |  |
| 4. 真实端到端 |  |  |  |  |

## 5. 回滚顺序与停止条件

**立即停止：**

- 本地出现重复创建 PR、重复合并、重复推进 stage。
- 合并到非预期分支，或门禁未通过却合并。
- webhook 仍发往 Vercel，或 cron 仍在触发。
- 本地队列持续卡在 `running`，或连续出现执行错误。

**回滚顺序：**

1. 本地切回 shadow（动作 1 的回滚）。
2. 恢复 GitHub App webhook 的 Vercel URL（动作 2 的回滚）。
3. 恢复 Vercel `crons` 并 redeploy（动作 3 的回滚）。
4. 观察云端恢复执行；P5-3 之前数据仍双写云端，不需要回滚数据库。

## 6. 切换后观察

- 首日：每 2 小时检查一次 drain/reconcile 日志和失败通知。
- 首周：每日记录执行结果、失败重试、重复动作；稳定 1 周后才进入 P5-3。
- P5-3 的 Supabase 冷备/下线同样逐项审批，不在本清单授权范围内。
