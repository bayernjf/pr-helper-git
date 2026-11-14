# launchd 常驻 server（P2-9 / D-008）

`launchd/install.sh` 把 pr-helper-git 装成 macOS 用户级 LaunchAgent：

- **常驻**：`RunAtLoad` 登录即启动；`KeepAlive` 崩溃后 10s 内自动重启（`ThrottleInterval=10`）。
- **自动化引擎随启**：默认注入 `PR_HELPER_GIT_AUTOMATION=1`，drain/reconcile/retention 调度器随 server 启动
  （见 `server/automation.mjs`）。`PR_HELPER_GIT_AUTOMATION=0 bash launchd/install.sh` 可只装 server 不装引擎。
- **回环监听**：`127.0.0.1:4789`（产品标准端口）。改端口用 `PR_HELPER_GIT_AGENT_PORT=NNNN`。
- **日志**：`~/Library/Logs/pr-helper-git/server.{out,err}.log`。

## 安装 / 卸载

```bash
bash launchd/install.sh      # 安装并启动
bash launchd/uninstall.sh    # 停止并移除（日志保留）
```

安装脚本会预检端口占用：`npm run dev` 也用 4789，开发前先 `bash launchd/uninstall.sh`，
开发完再装回。换 Node 路径用 `PR_HELPER_GIT_NODE=/path/to/node`（桌面捆绑 runtime 亦可指向
`build/PR Helper Git.app/Contents/Resources/runtime/node`）。

## 打开 UI

```bash
grep -o 'token=[a-f0-9]*' ~/Library/Logs/pr-helper-git/server.out.log | tail -1
# → http://127.0.0.1:4789/?token=<取到的 token>
```

token 每次启动随机生成（写在日志里，bootstrap URL 打开一次即种 cookie）。

## 与桌面 app / 开发实例的关系

- launchd 实例与桌面 app 各自独立进程；自动化引擎的队列与对账基于租约（`reconciliation_leases`）
  与幂等键，多实例并发安全，但**建议同一时刻只跑一个**（常驻交给 launchd，开发时先卸载）。
- 数据目录同为 `~/.pr-helper-git/`，OrbStack Postgres 同为 `127.0.0.1:54329`。
