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
| b-core | 事件流水线工作线程 | server/nexus_server/cyberneticscore/app.py:75-119 → engine.py:139-276 | 启动钩子起常驻守护线程消费进程内队列（数量取环境变量 NEXUS_EVENTHUB_WORKERS，默认 1）。新入库的事件逐条走六步：②分诊调 kev 安检接口与 AI 网关各一次（5 秒超时，失败记旁路标签）；③按规则卡首中路由，含去重窗口折叠、跳数熔断、事项在途闸；④派单：落卡或记流水，入队列与唤醒会话则调 dev server 回环；⑥起草卡面（模型不可用回机械人话）。队列在内存里，线程异常全吞；进程重启靠启动时重放「落库超 10 分钟仍是 new」的事件补救。 |
| b-core | 探测循环（prod 探活） | server/nexus_server/cyberneticscore/app.py:153-162 → probe.py:53-93 | 启动 30 秒后起，每 300 秒一拍：读本机配置的 platform_servers，对 prod 角色的机器用各自的 push_key 签票去探 /api/platform/prod-apps；只在状态翻转时发事件（probe.down 为 error，probe.up 为 info），首次只建档不发。每拍顺带补投发件箱、盯 git 闸日志。 |
| b-core | git 闸日志尾巴监视 | server/nexus_server/cyberneticscore/probe.py:96-142 | 每拍读 logs/git-gate.log 的新增行（以文件大小为游标，变小视为轮转）：GATE-FAIL 与 ARCHIVE-FAIL 发 barepush.gate.rejected（error），GATE-PASS 发 barepush.gate.passed（info）。钩子与日志在发布机上，不在仓内。 |
| b-core | 死线循环 | server/nexus_server/cyberneticscore/app.py:121-146 → store.py:1066-1103 | 启动即起，每 60 秒一拍：给没有死线的活卷按案型默认小时数补死线；把过了死线的活卷置为 expired，并弹一张升级卡（批准是重开，拒绝是维持了结）。 |
| b-core | 启动钩子（对账与保留） | server/nexus_server/cyberneticscore/app.py:102-118 → store.py:1126-1229,1232-1244,1390-1405 | 启动时依次做：rules.json 不存在则落包内种子；起工作线程；重放超龄未处理事件；给案卷功能上线前的存量事件按动作性回填案卷（幂等）；跑一次保留对账——90 天前的事件搬进 events_archive 后删行，结案超 90 天的卷连信搬进归档表，rules_hist 只留 50 版，崩溃残留的已抢占卡退回待批；补投一次发件箱。保留对账只在启动时跑，没有定时。 |
| b-core | 事件发件箱与补投（在调用方进程里） | server/nexus_server/cyberneticscore/send.py:69-83,138-212 | 事件源每发一条就起一个守护线程 POST 引擎的 /api/event（5 秒超时，不走系统代理）；失败或钥匙缺位则追加写 logs/eventhub-outbox.jsonl（上限 2000 行）。之后每次投递顺带节流 60 秒补投，引擎的探测循环每拍也补投。这段代码跑在调用方进程（dev server 等）里，不在引擎进程。 |
| b-core | 回执投递线程（在调用方进程里） | server/nexus_server/cyberneticscore/send.py:118-135 | 会话回执解析成功后另起线程 POST /api/receipt；失败静默，不进发件箱（原文已在开发面落库）。 |
| b-core | 写请求闸与响应处理（引擎中间件） | server/nexus_server/cyberneticscore/app.py:40-67 → core/guard.py:114,132 | 引擎的 POST、PUT、DELETE 先过写闸：Host 须是回环集，带 Origin 时须在盘上 web_origins 白名单内，不带 Origin 的机间通道放行。另有两件：响应统一加安全头；请求体校验失败一律回 400 人话。 |
| b-core | 进程内易失状态 | server/nexus_server/cyberneticscore/app.py:185-203；probe.py:25 | 已见票缓存上限 1024 条，防同一张票重放，重启即清；探测基线在内存，重启后首拍只建档不发，重启窗口里的状态翻转不会报。 |
| b-core | 读路径上的隐写与惰性建表 | server/nexus_server/cyberneticscore/store.py:32-149,1390-1405；app.py:695,741 | 不是后台任务，写规格时要知道：每次取数据库连接都执行一遍建表、补列、建索引（没有迁移脚本）；任何读规则的请求在 rules.json 缺失时会写盘落种子；名人堂的读面与投票都会顺手把到期提名的状态改掉（没有定时收卷）。 |
| b-core | 探测器会话票（无服务端状态） | server/nexus_server/cyberneticscore/observer.py:83-123 | 不是后台任务：会话票是用本机 identity_push_key 签的 HMAC 三段串，30 天有效，不落库、无法吊销，退出只清 cookie；登录失败计数借 core.auth 的进程内表（15 分钟窗口，按账号与来源各一把锁）。 |
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
| g-client | 入口监督循环（单实例保护、异装指纹闸、换血自重启） | client/nexus_client/__main__.py（main、_serve_once、_already_running、_guard_cross_install） | 启动时逐个连 8200 到 8210 十一个端口，发现活着的同类进程即退出；再探目标口的装根指纹，不是本装即拒启并落 client/logs/cross-install.log。起服务后未设不弹页标志就自动打开浏览器；收到版本更新信号后同端口重建——Windows 上以分离子进程重建自身后退位，其它系统用 execv。写 client/nexus.pid。 |
| g-client | 版本自更新监视器 | client/nexus_client/main.py（_version_watch） | 每 10 秒读磁盘上 config.py 的版本常量，高于运行中的版本就把「用户想让跑着的工程」写进 client/resume-on-restart.json 并触发自重启。 |
| g-client | 重启后恢复工程 | client/nexus_client/main.py（_resume_projects） | 启动时读 resume-on-restart.json（读完即删），等 3 秒后把重启前在跑的工程逐个拉起；手动关停不写该文件，所以不恢复。 |
| g-client | 在线升级巡检 | client/nexus_client/updater.py（loop、update_once） | 启动 8 秒后首查，此后每 6 小时一轮：向开发面问更新源，取生产面清单比对版本，分片下载，校验哈希与尺寸，解压预校验，整目录替换代码，合并依赖，写封条，之后由版本监视器触发自重启。每轮结果写 client/logs/update.log。手动触发口是 C002。 |
| g-client | 自动数据同步循环 | client/nexus_client/main.py（_auto_sync_loop、_sync_one）→ datasync.py（sync_all、sync_one） | 启动 15 秒后每 60 秒一轮，各启用工程并行：对工程声明的每条数据路径比对双侧基线，服务器变了拉、本机变了（双向路径）推、两边都变记冲突不裁决，替换库文件前备份并停起预览后端；全部路径挂暂停旗时整轮短路。 |
| g-client | 回执镜像循环 | client/nexus_client/main.py（_reports_loop） | 每 120 秒按两个受众（给用户的、给平台的）各自的游标拉开发面 /api/ai/reports（R024），追加写 client/ai-inbox.jsonl 与 ai-inbox-platform.jsonl，游标原子写；断网不丢、恢复后补收。开发机上这两份镜像到 2026-11-20 仍在更新。 |
| g-client | 自动预览（搭回执心跳） | client/nexus_client/main.py（_auto_preview_tick） | 与回执镜像同一拍（每 120 秒）：读开发面工程清单里各工程的开发分支头，与 client/dev-preview-seen.json 的记录比对，前移了就在本机拉开发分支、重建前端、起或重启预览后端；首次运行只建基线不启动；被用户显式停掉的预览只记账不复活；服务器不可达不记账；离线镜像工程不参与。 |
| g-client | 启动清理 | client/nexus_client/main.py 的 lifespan → processes.py（cleanup_stale、cleanup_foreign）、offline.py（sweep_stale_codepacks、heal_registrations）、tunnels.py（cleanup_stale） | 启动时依次：按 runtime.json 的登记杀掉上次异常退出留下的后端进程；跨装清点——离线端口段里监听、命令行带启动脚本且不属于本装、父进程已死的进程整树杀掉，父进程还活的只记录；删 tmp 下超过两小时的代码包与半成品；台账里已启用而配置里缺项的离线应用按包清单补登记；隧道端口段里只杀 ssh 进程的残留。 |
| g-client | 启动后一次性更新检查与预热 | client/nexus_client/main.py 的 lifespan（_offline_upd_once）→ offline.py（check_updates、warm_all） | 启动 45 秒后若本机有身份：拉生产面的离线更新清单算角标，并对全部可见应用串行预热代码包（触发生产面打包、下载校验、解压、装依赖、导入冒烟、注册，不灌数据）。会话移交（C032）时也触发同一组动作。 |
| g-client | 离线长任务（按需后台） | client/nexus_client/main.py（_guard_task）、offline.py（enable、update、sync_data、warm_code、open_smart） | 由 C036 至 C040 触发后不等待结果，进度只写进程内状态表供轮询；打开链是全链兜底：未预热先预热、程序旧了先换、未灌数据先灌轻库，再起本机实例。失败只记一个错误相位。 |
| g-client | 重目录后台校准 | client/nexus_client/main.py（_bg_align） | 预览启动时把非数据库的数据路径放后台，逐个以服务器为准拉平；进度在进程内，完成态留 5 分钟后清。 |
| g-client | 打包后台任务 | client/nexus_client/main.py（_run_package_job） | C073 触发后在子进程里跑 git archive 或工程声明的脚本（上限 2 小时），把运行期间新出现的文件登记为产物（大小与哈希），写 client/packages/<工程>/index.json；每个工程同时只许一个任务，状态只在进程内存。 |
| g-client | 离线写出站箱回放 | client/nexus_client/opoutbox.py（replay、replay_all；由 offline.py 的 check_updates、sync_data 与反代触发） | 不是定时器：更新检查成功、手动同步、实例打开时，按序把排队的离线写操作带会话 cookie 与幂等键回放到生产面的应用入口；400、409、422 挂为冲突等人工裁决，其余重试至多 5 次；网络断即停以保序。入箱发生在反代（见下）。 |
| g-client | 通配反向代理（用 add_route 注册，不在底表的 74 条里） | client/nexus_client/main.py（host_router_middleware 与 create_app 末行）、proxy.py（proxy_handler、_ws_bridge）、tunnels.py | 所有请求先过虚拟主机中间件：<工程>.localhost 的请求整体交给反代，其余路径不命中任何路由时也落到反代的 /p/<工程>/ 前缀分支。反代把请求转给本机预览后端，或经懒建立的 SSH 隧道转给服务器上的生产实例（<工程>-server.localhost，本机隧道端口 18220 起）；后端没在跑回 503 并指向中继页；给预览页的 HTML 注入版本横幅脚本；向工程后端注入身份头（预览是开发者名加管理员视角，缺登录名时兜底一个固定身份；离线镜像是离线身份加缓存的真实角色，管理员可降级不可升权）；离线镜像的已声明写路由双写进出站箱，实例不在场时入箱即回 202；另有 WebSocket 双向桥。 |
| g-client | 跨域中间件（本机端的实际暴露面） | client/nexus_client/main.py（cors_middleware） | 所有 /api/ 路径的应答与预检请求一律回通配的跨域放行头；本机端 74 条路由没有一条有自己的鉴权，只靠只监听回环地址。 |
| g-client | 进程内易失状态 | client/nexus_client/main.py、offline.py、updater.py、datasync.py、processes.py | 同步相位、后台校准进度、在途同步集合、打包任务表、离线进度表、视角覆盖表、升级器在飞闸、数据票缓存、进程托管器的进程表都只在进程内存：不持久化，重启即丢（其中一部分另有盘上的登记或标记文件）。 |

