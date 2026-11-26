# 非路由能力清单

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-26 |
| 来源 | 各批次 `_meta.workers`，`merge_parts.ts` 生成 |

路由之外还在跑的东西：后台循环、定时器、启动钩子。写规格时逐个定归宿。

| 批次 | 名称 | 文件 | 做什么 |
|---|---|---|---|
| a-prod | 数据任务派发循环（datajobs worker） | server/nexus_server/prod/app.py:156-176 → dev/datajobs.py:231-262 | 启动钩子 _start_datajobs：注入工程后端定位器（nexus.json 的 container.url，否则 deploy 的 health_port 加 systemd 活性）并起 asyncio 循环，每 1 秒把排队的 ingest/export 工单派给已部署工程（并发数取环境变量 NEXUS_DATA_WORKERS，默认 1）；账本落 data-jobs.jsonl |
| a-prod | 身份桥用户名同步 flusher | server/nexus_server/prod/app.py:179-184 → identity/bridge.py:282-295 | 启动钩子 _start_identity_bridge：配了 identity_dev_base 才起守护线程，每 30 秒把 data/identity-sync-queue.jsonl 批量签名推到 dev 机 /api/identity/sync，成功后删队列文件 |
| a-prod | 登录后身份问询线程 | server/nexus_server/identity/bridge.py:149-175（prod/app.py:365-369、1007-1009 调用） | 口令登录与 SSO 回调成功后起后台线程向 dev 机 /api/identity/verify 问询开发者投影（is_dev、dev_admin），回写 data/identity-cache.json（24 小时缓存）与 nexus-server.json 用户行；不阻塞登录，dev 不可达走缓存 |
| a-prod | 云端容灾推送线程 | server/nexus_server/prod/app.py:1595-1614（dr_push 在 1437-1574） | POST /api/backup/dr-run 起守护线程，把最新热备与控制面束（脱敏配置、登录日志、部署日志、迁移登记）推腾讯云 COS 并轮换；进度存进程内存 _dr_job，重启即丢；推送期间另起每 3 秒一拍的进度采样线程（读 /proc/net/dev） |
| a-prod | 离线演示包打包线程 | server/nexus_server/prod/app.py:2227-2252（_pack_run 在 2099-2181） | POST offline-pack 起守护线程：整拷码树、热备库、写启动脚本与 README、打 zip、按工程轮换留 3 份；全局单任务互斥，任务态存进程内存 _pack_job |
| a-prod | 离线代码包打包线程 | server/nexus_server/prod/app.py:2516-2549（_code_run 在 2355-2473） | POST offline-codepack 起守护线程：拷码树、剔除数据面、现场 venv freeze、写安装清单、打 zip、轮换；任务态存进程内存 _code_job |
| a-prod | 每日备份定时器（进程外的 systemd timer） | tools/ops/nexus-daily-backup.timer + nexus-daily-backup-run.py | 每天 04:33 由回环 POST /api/backup/run（回环来源免鉴权），非 2xx 即 unit failed 进 journal；另有 nexus-registry-backup.timer 备份注册表文件，不经 HTTP |
| a-prod | 安全头与 CSRF/CORS 中间件 | server/nexus_server/prod/app.py:86-98、100-105、116-117 → core/guard.py | 每个应答加 nosniff、SAMEORIGIN、no-referrer 与 HSTS；写请求过 Host、Origin、X-Forwarded-Host 三通道闸（白名单惰性重算，5 分钟）；CORS 只放登记表入口与 web_origins |
| a-prod | 挂载的其它路由器 | server/nexus_server/prod/app.py:106、110、114、153 | 身份注册表 identity.router、AI 网关 ai_gateway、客户端在线升级分发 client_update、数据任务队列 datajobs（配 prod 鉴权家族）——分属 f-identity 与 e-data 批次，不在本批 |
| a-prod | 一次性码与任务态的进程内存表 | server/nexus_server/prod/app.py:385、515、577、817-818、1592、2184、2476 | _GRANT、_OTC、_BRIDGE、_SSO_POLL、_dr_job、_pack_job、_code_job 都只在进程内存：不持久化、多进程不共享、重启即丢；过期清扫靠各自路由被调用时顺手做 |
| c-platform | 隧道验活循环 | server/nexus_server/dev/app.py（_ka_loop；探活体 server/nexus_server/dev/tunnel_keepalive.py） | 启动 45 秒后每 180 秒对登记表里勾了验活的服务器 SSH 端口做一次 TCP 连接，制造流量防零信任隧道闲置断线；结果存进程内存，经 /api/platform/servers 的 ka 字段出成服务器卡徽章 |
| c-platform | 身份拉平定时器 | server/nexus_server/identity/pull.py（systemd 单元 nexus-identity-pull.timer；单元文件不在 tools/ops） | 每 5 分钟以新进程跑 main：逐台 prod 拉 /api/identity/export，合并后写 users；逐台连败 3 拍发事件库告警与登录日志管理行，状态存 logs/identity-pull-state.json。POST /api/identity/pull 是同一 main 的手动触发 |
| c-platform | 数据分布后台重建线程 | server/nexus_server/dev/routers/datamap_routes.py（_rebuild） | 缓存过 15 秒后请求先回旧数据并标 stale，同时起守护线程现探各 prod；整台不可达进 60 秒冷却表。缓存与冷却表都是进程内存，重启即失 |
| c-platform | 平台多机分发线程 | server/nexus_server/dev/routers/platform_routes.py（platform_release_remote 内的 _go） | POST /api/platform/release-remote 起守护线程，顺序对每台在册服务器打包、上传、远端换码重启、健康核对；任务状态只存进程内存 _dist_jobs，重启即丢；每台结果追加部署留痕 |
| c-platform | 平台自更新脚本孵化 | server/nexus_server/dev/routers/platform_routes.py（platform_release） | 生成 dev_server/platform/release.sh（契约闸自检、推 main、备份、换码、重启 nexus-server 并 try-restart 事件库与探测器），经 systemd-run --scope 脱离服务 cgroup 后孵化；成败写 release.flag，输出写 release.log |
| c-platform | 部署留痕失败联动事件库 | server/nexus_server/dev/deps.py（_deploy_log） | 写 logs/deploy-log.jsonl 后，若 status 为 error 则向事件库发 release.failed 事件，发不出去落源侧 outbox；发布路由与平台分发都经它 |
| c-platform | 发布作业回放启动钩子 | server/nexus_server/dev/deps.py（_rel_load，import 时执行） | 启动时回放 release-jobs.jsonl，把上个进程留下的 running 作业改判为 error（日志线程已死）；域属 d-devflow 批，此处只登记 |
| c-platform | 配置内存快照启动钩子 | server/nexus_server/core/config.py（CFG） | import 时把 nexus-server.json 整份读进内存 CFG；写端点各自经 _disk_cfg 落盘后再手工回填内存（本批 R081、R085、R086、R088 都有回填段），不回填的写口会造成内存与盘上不一致 |
| c-platform | DSH 注册表同步定时器 | server/nexus_server/dev/routers/dsh_routes.py:41 的注释（源稿在 tools/ops，如 dsh-user-sync.timer） | 每用户 DSH 实例的 registry.json 由仓外定时器约 30 秒同步一次，代理侧以 30 秒缓存跟上；代理自身没有循环 |
| c-platform | 事件库探针循环（本批路由的生产端对端） | server/nexus_server/cyberneticscore/probe.py | 300 秒一拍，按目标机 push_key 签名直探各 prod 的 /api/platform/prod-apps（prod 侧同名路由，a-prod 批），只在状态迁移时发事件；域属 b-core 批，因依赖与 R080 同名的路径而登记。只读了文件头与常量 |
| c-platform | dev 应用其余启动循环 | server/nexus_server/dev/app.py（_start_queue_loop） | 队列派发 10 秒一拍、prod 信箱拉取 5 分钟、职能会话保活 1 分钟、校准快照清扫 1 小时、数据任务队列循环；域属 d-devflow 与 e-data 批，此处只登记避免漏登 |
| c-platform | tools/ops 下的其余 systemd 定时器源稿 | tools/ops/ | 只见文件名、未读内容：nexus-daily-backup、nexus-hub-backup、nexus-registry-backup、dsh-user-sync、dsh-user-manager、dsh-workspace-watch、证书续期 七组 service 与 timer；身份拉平定时器的单元文件不在此目录 |
| d-devflow | 队列派发与完成检测循环 | server/nexus_server/dev/app.py 的队列循环 + dev/queue.py 的派发拍 | 启动即起，10 秒一拍，在线程池跑：每个工程没有在跑任务时按优先级取首条待办，建工作树沙盒并拉起 AI 会话发任务书；完成检测靠 claude 轨迹静默、dev HEAD 前移或回执文件；之后自动合入、冲突转派沙盒 AI（最多 5 轮）、空闲 900 秒零产出判失败、配额满时回收死工位；意见池来源的任务完工后起线程写回生产机；回执游标落 dev_server/queue/.receipt-cursor.txt |
| d-devflow | 职能会话保活循环 | server/nexus_server/dev/app.py 的保活循环 + dev/manager_keepalive.py | 每 60 秒检查职能会话是否在场，缺则拉起；受 nexus-server.json 的 manager_keepalive 配置门控制，默认关 |
| d-devflow | 生产机信箱拉取循环 | server/nexus_server/dev/app.py 的信箱循环 + dev/app_messages.py | 每 5 分钟经 SSH 到各生产机读取并截断应用消息文件，转成队列任务（来源记为生产机信箱） |
| d-devflow | 职权书启动升级 | server/nexus_server/dev/app.py 启动事件 + dev/charter.py 的 upgrade_all | 每次启动把职能会话 AGENTS.md 的一期占位升到职权书 v2，幂等 |
| d-devflow | 发布任务落盘与回放 | server/nexus_server/dev/deps.py 的发布任务读写与部署留痕 | 导入时回放 release-jobs.jsonl 并把在途任务改标失败；状态一变就全量重写（只留 200 条）；部署留痕追加到 logs/deploy-log.jsonl，失败时向事件中台发发布失败事件 |
| d-devflow | 会话轨迹钉线程 | server/nexus_server/dev/ai.py 的启动钉与懒钉 | 会话启动后起守护线程盯 20 秒、缺映射时再盯 60 秒，把新出现的轨迹文件名钉进 ai-task-files.json |
| d-devflow | 字节流懒清扫 | server/nexus_server/dev/ai.py 的流清扫 | 每次字节流观察拍顺带检查，无观察者 10 分钟即关 tmux 管道并删文件；单文件超过 64MB 旋转一代 |
| d-devflow | 对话素材自净 | server/nexus_server/dev/ai.py 的图片与附件保存 | 每次上传时顺手删除 ai-images、ai-files 下超过 14 天的文件 |
| d-devflow | tmux 进程树迁出服务 cgroup | server/nexus_server/dev/ai.py 的会话分离函数 | 会话启动后用 sudo 把 tmux 进程树写入独立 cgroup 切片，避免平台重启时连坐杀掉 AI 会话 |
| d-devflow | 常驻 tmux AI 会话 | server/nexus_server/dev/ai.py | 每个工程、每个任务一个 tmux 会话跑 AI 助手命令行，页面关闭后仍在；claude 固定安装路径、powercontext 令牌、家目录信任预置都依赖这台机器的环境 |
| d-devflow | 事件中台反向调用 | server/nexus_server/cyberneticscore/engine.py 的派单动作 | 不在本批文件内，但它是入队接口 R105 与发消息接口 R013 的后台调用方：规则命中后经回环直打 |
| d-devflow | 工程裸仓的接收后钩子 | tools/release_hook.py（安装器） | 装在各工程裸仓上，dev 分支到达即同步工作树并回环调自动发布入口 R111 |
| e-data | 数据任务派工循环 | server/nexus_server/dev/datajobs.py（dev/app.py 与 prod/app.py 的启动钩子调 start_loop） | 每秒一拍：按环境变量 NEXUS_DATA_WORKERS（默认 1）从 data-jobs.jsonl 取排队中的摄入与导出任务，用 urllib 调工程的 /api/ingest 或 /api/export（单任务上限 30 分钟，只传本机暂存路径不搬字节）。启动时回放账本，running 回落 queued；每次落盘修剪 24 小时前的终态并只留 500 条，被修剪行随行清暂存。 |
| e-data | 快照清扫循环 | server/nexus_server/dev/app.py 启动钩子里的 _sweep_loop | 启动即跑、之后每小时调 sync_lib/datasync.sweep_tmp：删 tmp/ 下超过 6 小时的 snap- 与 push- 残留，并经 sudo srv_io gc 清 root 属主残留（注释记 2026-10-15 实弹：写了从未被调，2.4 万份泄漏快照塞满磁盘）。 |
| e-data | 分片会话清扫（随路由触发，不是定时器） | server/nexus_server/dev/routers/datajobs_routes.py | 每次 chunk/begin 顺带删 data-staging/.uploads 下超过 12 小时的孤儿会话；没人开新上传就不清扫。 |
| e-data | 回环机器信任（不是后台任务，是本批路由的实际暴露面） | server/nexus_server/core/auth.py | 来自 127.0.0.1 的请求一律免鉴权并视为管理员身份（工程 AI 会话与工具链的 curl 出口）；本批所有带 _auth 的路由都受此影响。 |
| e-data | 任务派发循环（不属本批路由文件，装配文件无批次认领，顺带登记） | server/nexus_server/dev/app.py 启动钩子里的 _queue_loop | 每 10 秒一拍 queue.dispatch_tick（git 与 tmux 子进程数随工程数增长，丢线程池跑）；「每工程同时只有一个 AI 在干活」的红线由它守。 |
| e-data | 隧道验活循环（不属本批路由文件，顺带登记） | server/nexus_server/dev/app.py 启动钩子里的 _ka_loop | 启动 45 秒后每 180 秒对勾选了隧道验活的服务器做 SSH 端口 TCP 探活（防单位零信任接入客户端闲置断线）。 |
| e-data | 生产面信箱拉取循环（不属本批路由文件，顺带登记） | server/nexus_server/dev/app.py 启动钩子里的 _mailbox_loop | 启动 60 秒后每 300 秒经 SSH 拉各生产面的 data/app-messages/，认领后转任务队列。 |
| e-data | 职能会话保活循环（不属本批路由文件，顺带登记） | server/nexus_server/dev/app.py 启动钩子里的 _mgr_ka_loop | 启动 60 秒后每 60 秒对职能会话做在场检查，缺的补拉起；受配置项 manager_keepalive 控制，默认关。 |
| e-data | 职权书升级（不属本批路由文件，顺带登记） | server/nexus_server/dev/app.py 启动钩子 | 启动时把职能会话的一期占位职权书升级为 v2（charter.upgrade_all，幂等，失败不阻断启动）。 |
| f-identity | 身份同步队列刷新线程（生产面） | server/nexus_server/identity/bridge.py（start_flusher、sync_flush_once；prod/app.py:179-184 的启动钩子拉起） | 启动即起守护线程，每 30 秒把盘上 data/identity-sync-queue.jsonl 里积压的用户名增停删事件合并（同名取最后一条），签名后推开发面 /api/identity/sync，推成功才删队列文件；开发面不可达则留盘下轮重试。没配 identity_dev_base 的机器不启动 |
| f-identity | 登录后权限投影问询线程（生产面） | server/nexus_server/identity/bridge.py（refresh_async、dev_verify、_writeback；prod/app.py:367 与 :1008 在口令登录和单点登录成功后调） | 每次登录成功起一条一次性守护线程，向开发面 /api/identity/verify 问该人的开发者权限投影（4 秒超时），结果写 data/identity-cache.json（24 小时有效，顺带清 7 天外的旧条目）并回写用户行的开发者旗与平台管理员旗；不阻塞登录，同名在途去重。代码里还硬编码了一个把旧隧道域名改写到新正门的兜底 |
| f-identity | 身份拉平定时器（c-platform 批已登记，此处补齐对端关系） | server/nexus_server/identity/pull.py（main；开发机 systemd 定时器 nexus-identity-pull，单元文件不在 tools/ops） | 每 5 分钟以新进程逐台拉各 prod 的 /api/identity/export（R138）取并集，按权限取云、开发者旗取本机合并后整表写回 users；逐台连败 3 拍经状态侧车 logs/identity-pull-state.json 发事件库告警与登录日志管理行。它的第④步（向各 prod 回推开发者旗，R139）已退役 |
| f-identity | 身份推送定时器（已退役） | server/nexus_server/identity/push.py（main；入口 push_identity.py） | 原由 开发机 上的定时器每 5 分钟把本机非开发者用户表签名推到各副本 prod 的 /api/identity/replica（R134）。台账记该定时器已除名、推送日志停在 2026-10-21，是死件；仓内无单元源稿 |

