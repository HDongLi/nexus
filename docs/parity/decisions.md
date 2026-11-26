# 裁决清单

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-26 |
| 来源 | `merge_parts.ts` 生成，不要手改。答复登记进 `answers.json` 后重新生成 |
| 怎么答 | 一行一题：`R042 a`。不答的按默认项走（任务书 §6.8） |
| 已到批次 | a-prod、b-core、c-platform、d-devflow、e-data、f-identity（服务端 229 / 272；本机端 0 / 74 条） |
| 待你裁决 | 14 题，涉及 20 条路由 |
| 已有答复 | 0 条 |
| 按默认项走 | 0 条 |

## 归宿总览

| 归宿 | 条数 |
|---|---|
| 进内核（kernel） | 118 |
| 进定制包（m） | 30 |
| 作为工具重建（tool） | 0 |
| 退役（retire） | 68 |
| 判不准（unclear） | 13 |

| 批次 | 进内核 | 定制包 | 工具 | 退役 | 判不准 | 未到 |
|---|---|---|---|---|---|---|
| a-prod | 17 | 12 | 0 | 22 | 7 | 0 |
| b-core | 7 | 0 | 0 | 0 | 0 | 43 |
| c-platform | 14 | 4 | 0 | 17 | 3 | 0 |
| d-devflow | 26 | 8 | 0 | 6 | 0 | 0 |
| e-data | 31 | 2 | 0 | 15 | 3 | 0 |
| f-identity | 23 | 4 | 0 | 8 | 0 | 0 |
| g-client | 0 | 0 | 0 | 0 | 0 | 74 |

## 待裁决

### a-prod

#### feedback-pool（影响 5 条）

- R191 GET /feedback：意见反馈页：按工程提 bug/想法/咨询并看处理进度
- R212 GET /api/my/feedback：自己的意见列表与处理时间线（滤掉内部备注）
- R213 POST /api/my/feedback：提交意见：校验工程归属、类型、限长与 60 秒限频
- R214 POST /api/my/feedback/{fid}/like：给意见点赞或取消（同人幂等切换）
- R215 POST /api/my/feedback/{fid}/reply：用户追加留言；追问、完结或驳回态自动重开

- 谁在用：用户页面
- 证据：server/web/shell.html:418（壳栏「意见」钮）；server/web/dev.html:1373（dev 页「许愿」钮跳目标机 /feedback）；client/web/settings.html:262-269；tools/ops/nginx/nexus-443.platform.template:37；docstring 称 nginx 注入各应用页的 💬 钮落此页
- 依赖：数据 server/web/feedback.html、nexus-server.json（users，校验会话）；外部 无
- 初判：判不准（把握 low）
- 问：用户意见池（按工程提交问题/想法/咨询、点赞、追问、看处理进度）是否作为新版平台的内置能力？
  - a. 进内核：作为通用能力保留（用户侧提交与进度可见） ← 默认
  - b. 退役：新版不做意见池，意见走别的渠道
  - c. 进内核但收缩：只留提交入口并入任务队列，不做点赞与时间线
- 默认项的依据：入口遍布用户面（壳栏、各应用页注入钮、apps 页弹窗、dev 页许愿钮），在役且是应用用户与开发者之间的唯一反馈回路

#### R200

- 做什么：生产数据路径清单与文件指纹（只读）
- 谁在用：外部机器
- 证据：client/nexus_client/server_api.py:272（datasync.py:162 预览校准、offline.py:394 离线镜像）；dev/routers/datamap_routes.py:107（dev 数据页持数据票读取）
- 依赖：数据 prod_server/nexus_project/<名>.git 的 main:nexus.json（data_paths）、工程 app_dir 下数据文件与边车的 stat；外部 git show（子进程）、sudo srv_io stat（权限不足时）
- 初判：判不准（把握 low）
- 问：新版是否保留「读生产应用数据」的通道（数据路径清单与分块快照拉取）？
  - a. 退役：原消费者本机 client 与离线应用都退役，dev 数据页改读别处 ← 默认
  - b. 进内核（只留清单）：保留数据路径清单这一只读面，不做快照拉取
  - c. 进内核（整套保留）：清单加分块快照，作为通用的导出或迁移能力
- 默认项的依据：五个数据端点的调用方只有本机 client（server_api.py:272-346）与 dev 数据页的清单读取（datamap_routes.py:107）；分块快照三步协议完全为客户端增量同步而设。选整套保留时 R201 至 R204 需一并复议

#### R211

- 做什么：prod 信箱：同机应用投递消息，暂存后由 dev 拉取转任务
- 谁在用：外部机器
- 证据：仓内无生产方代码：prod/app_messages.py 模块 docstring 称 prod 机上的托管应用（如 certm 生产）上报；消费方 dev/app_messages.py 每 300 秒 SSH 拉取转队列任务；server/tests/test_app_messages.py。dev.html:2830、devpage.html:2324 调的是 dev 面同名路由
- 依赖：数据 data/app-messages/<工程>.jsonl（封顶 500 行）、data/app-messages/.token（懒生成）；外部 无
- 初判：判不准（把握 low）
- 问：托管应用向平台投递消息/任务的通道（现为 prod 本机信箱，dev 机每 5 分钟 SSH 拉取转队列）是否进新版？
  - a. 进内核：做成通用的「托管应用→平台任务入口」，平台直接接收入队 ← 默认
  - b. 进定制包：只为 dev 机单向 SSH 到 prod 这套拓扑保留
  - c. 退役：不再需要应用向平台投递
- 默认项的依据：起因是 certm 生产应用上报恒 404 的实弹缺陷（BUG-2026-10-28-31），说明确有应用侧需求；仓内无生产方代码，拉取方在 dev/app_messages.py

### c-platform

#### dsh（影响 3 条）

- R046 GET /dsh：DSH 入口：读启动令牌后 302 补票，按人选实例
- R047 GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS /dsh/{path:path}：DSH HTTP 透传：剥前缀、穿 cookie、回带换票头与缓存头
- R048 WEBSOCKET /dsh/api/remote.mux：DSH 的 WebSocket 中继：握手前验票，双向泵消息

- 谁在用：用户页面
- 证据：server/web/dev.html:1834（openDsh 设 iframe 地址）、server/web/devpage.html:2381,2420（DSH 浮层与右栏面板）；测试 server/tests/test_dsh_routes.py；客户端代理段已删只剩注释（client/nexus_client/main.py:1214）
- 依赖：数据 ~/.dsh-users/registry.json（用户到实例端口，只读，30 秒缓存）；外部 journalctl -u nexus-dsh（或 nexus-dsh@用户）子进程，取启动令牌，30 秒缓存
- 初判：判不准（把握 low）
- 问：（与 R047 同一裁决）DSH 的入口跳转要不要进新版？
  - a. 进定制包：DSH 是这家单位选用的具体工具，入口补票作为定制模块保留 ← 默认
  - b. 进内核：随「内嵌第三方 Web 工具」的通用代理能力一起进
  - c. 退役：新版不再内嵌 DSH
- 默认项的依据：同 R047：现役入口 dev.html:1834、devpage.html:2381 与 2420；docs/借用登记.md 记 DSH 为换装第二候选、未转正；路由写死用户目录 与单元名 nexus-dsh

#### R079

- 做什么：审计各工程未声明的大目录（外源下载资产可见面）
- 谁在用：用户页面
- 证据：server/web/dev.html:1741（工程行的外源资产提示，随工程列表低频刷新）
- 依赖：数据 各工程 nexus.json（data_paths、run、deploy、post_pull，只读）、工程目录树的体积扫描（只读）；外部 无
- 初判：进定制包（把握 low）
- 问：工程数据声明审计（未声明的大目录告警，C007 的可见面）放哪？
  - a. 进定制包：随 C007「未声明不搬运」纪律走，是这家单位的迁移约束 ← 默认
  - b. 进内核：作为数据声明机制的通用完整性检查
  - c. 退役：只是工程行的一个提示，由数据同步规格自行覆盖
- 默认项的依据：处理函数注释明写服务于 C007 硬约束；唯一调用方是 dev.html:1741 的行内提示；任务书 §2.3 开发面的已知领域里没有单列此项

#### R084

- 做什么：SSH 到目标机读其推送钥匙，写进本机登记表
- 谁在用：无人
- 证据：无调用方证据：dev.html、devpage.html、客户端、exe 均无调用，git 历史里页面也从未有过；旧审计快照 tools/audit_out/routes.csv:134 记 0 调用；只有 docs/fleet-bootstrap.md:13,28 把「拉取 push_key 按钮」写成接装步骤，与页面不符
- 依赖：数据 nexus-server.json（platform_servers 各行的 push_key 写）、deploy/id_nexus 部署私钥（供 ssh 使用）；外部 ssh 子进程到登记的 ssh_host（读对端 nexus-server.json）
- 初判：退役（把握 low）
- 问：实例配对（取对端推送钥匙）要不要做成应用内能力？
  - a. 退役为路由：配对归部署引导或命令行（任务书 D5 自部署包） ← 默认
  - b. 进内核：做成实例配对能力，任何多实例部署都要配对
  - c. 进定制包：保留 SSH 取钥匙的形态
- 默认项的依据：处理函数与页面均无调用证据，仅 runbook 提及；任务书 §4.1 把部署定为 systemd 加 nginx 加原子发布，D5 另有自部署包

#### R085

- 做什么：设定、迁移或清除工程的主场服务器
- 谁在用：用户页面
- 证据：server/web/dev.html:1693,1698（工程首次拖入某台服务器时自动设锚，从该台移除时自动清除，不是用户直接操作）；datamap_routes.py:121 与 devpage.html:1164 读主场表定权威库与建议数据源
- 依赖：数据 nexus-server.json（app_home 写；platform_servers 作校验读）；外部 无
- 初判：退役（把握 low）
- 问：工程的「主场服务器」（现在是首次绑定时的自动锚，数据地图按它定权威库）怎么处置？
  - a. 退役为独立端点：由工程与环境的绑定关系推导，数据地图规格自行定义权威源 ← 默认
  - b. 进内核：作为工程「权威数据所在实例」属性的显式写口
  - c. 进定制包：只有多 prod 孤岛布局才需要标注主场
- 默认项的依据：dev.html:1690-1700 只在首次绑定与移除时自动调用；release_routes.py:186 主场降级为意见锚；datamap_routes.py:104-108 只对主场指向该台的工程问权威库清单；架构总览 1.3 决策 2 是被推翻的旧裁定

#### R094

- 做什么：安检闸状态：配置、kev 探活、最近 30 条审计
- 谁在用：用户页面
- 证据：server/web/devpage.html:1806,1835（消息安检卡的状态行与审计查看）
- 依赖：数据 nexus-server.json（security 节，只读）、security-audit.jsonl（尾 30 条，只读）；外部 kev 模型接口的 /v1/models（默认 127.0.0.1:8009，2 秒超时）
- 初判：进内核（把握 low）
- 问：AI 消息安检闸（规则脱敏加 kev 灰区判定）及其管理面放哪？
  - a. 进内核：凭据防外泄是通用能力，规则层进内核，模型层做成可配置 ← 默认
  - b. 进定制包：只有这家单位因合规需要才开
  - c. 退役：新版不做这道闸
- 默认项的依据：规则层只含通用厂商密钥格式，不依赖本单位数据（security_scan.py:30-45）；kev 不可达时自动放行、不阻断业务（security_scan.py:8、151-155）；安检闸接在三个路由模块的 AI 收发口上；任务书 §2.3 的已知产品面没有单列此项

### d-devflow

#### R003

- 做什么：平台广播：同一条内容落各工程队列或直进 AI 会话
- 谁在用：用户页面；内部工具
- 证据：server/web/dev.html:3727（组织页仅管理员可见的广播对话框）；tools/platform_broadcast.py:56（命令行瘦客户端）；server/tests/test_agent_broadcast.py；docs/BUGS.md:984 记有用户找不到该功能入口
- 依赖：数据 dev_server/queue/<工程>.jsonl（落队列模式逐工程写条目）、nexus-server.json（agent_cards 标签筛选）、security-audit.jsonl（安检留痕）；外部 tmux（直进会话模式与经理知情消息经 send-keys）、kev 安检模型接口（本机 8009，带触发词才调）
- 初判：进定制包（把握 low）
- 问：平台广播（向多个工程队列群发同一任务，或直进各会话）在新版去哪？
  - a. 进第一条客户线定制包，按现状语义重做 ← 默认
  - b. 退役：没有使用证据，且与「不把委派关系做进产品」的原则相左
  - c. 进内核，做成通用的批量派单
- 默认项的依据：dev.html 组织页仍有入口、tools/platform_broadcast.py 依赖它、有单测；但 docs/BUGS.md:984 记录用户找不到入口，仓内无使用日志

#### R104

- 做什么：列出某工程队列的全部任务条目
- 谁在用：无人
- 证据：无调用方证据：队列界面在 2026-10-03 提交 3ca006e 退役（提交说明写明队列界面退役、引擎端点保留），此后没有页面或工具调用；tools/inbox.mjs:38 看队列概览是经 SSH 直接读队列文件
- 依赖：数据 dev_server/queue/<工程>.jsonl；外部 无
- 初判：进内核（把握 low）
- 问：任务队列的列表与操作接口现在没有调用方，新版还提供吗？
  - a. 进内核：队列是核心能力，读与操作接口一并提供 ← 默认
  - b. 退役：现在没有调用方，需要时另建
  - c. 进定制包：只给这家单位用
- 默认项的依据：队列引擎在役（10 秒一拍的派发循环，事件中台与 DSH 都在入队）；只是读与操作的界面在 0.21.1 退役

#### R106

- 做什么：队列任务人工操作：取消、置顶、改状态、收尾
- 谁在用：无人
- 证据：无调用方证据：随队列界面在 2026-10-03 一并退役；只有 server/tests/test_review.py:227 直调底层操作函数
- 依赖：数据 dev_server/queue/<工程>.jsonl；外部 tmux（取消运行中的沙盒任务时停会话）
- 初判：进内核（把握 low）
- 问：队列的人工操作接口（取消、置顶、手改状态）现在没有调用方，新版怎么处理？
  - a. 进内核，只保留取消与置顶，去掉手改状态 ← 默认
  - b. 整条进内核，含手改状态
  - c. 退役：现在没有调用方
- 默认项的依据：底层函数有单测且逻辑在役（置顶会抬高优先级，取消会停沙盒会话）；手改状态曾因校验错位出过缺陷（docs/nexus-架构总览.md:627），属调试补洞

### e-data

#### R034

- 做什么：把生产数据强制全量对齐到开发工作树
- 谁在用：内部后台（服务器上的工程 AI 会话，回环 curl）
- 证据：页面、client、exe 均无调用；docs/共识文档v2-架构整合.md 记它是「AI 自助同通道，仅服务器本机免鉴权」；docs/版本历史/server.md 0.54.70、0.58.03 记有 certm、std-assistant 实弹使用；tests/test_align_dirsync.py 只测底层 align_data 与 pull_file
- 依赖：数据 工程 nexus.json（data_paths、server_root、ssh_host、paused）、开发工作树内的数据文件（覆盖写入）、dev_server/preview/<工程>/preview.pid（预览运行检查）；外部 sudo（stat、test、python3 SQLite 在线备份、cp -a）、ssh 与 scp（声明 ssh_host 时到生产机取数）、本机预览端口的 /api/health 探活
- 初判：判不准（把握 low）
- 问：「把生产数据对齐到开发工作树」目前由工程 AI 会话在服务器本机免鉴权触发，经 sudo、ssh、scp 拉取。新版还要不要这条能力？
  - a. 进定制包：只给这家单位保留，改成有权限和审计的受控操作 ← 默认
  - b. 进内核：做成通用的「工作区数据快照」用例，任何单位可用
  - c. 退役：预览与调试只用脱敏样例数据，不再拉生产数据
- 默认项的依据：共识文档记它是工程 AI 会话的自助通道，版本历史有 certm、std-assistant 两次实弹使用，说明这家单位在用；但没有「任何单位都需要」的证据，拉生产数据进开发环境通常受各单位数据政策约束

#### R126

- 做什么：取消数据任务：排队中的立即清暂存，运行中的协作式生效
- 谁在用：无人
- 证据：无调用方证据：页面、exe、工具脚本均无调用；client/nexus_client/main.py 只有通用代理路由；tests/test_boundaries.py 只测底层函数
- 依赖：数据 data-jobs.jsonl（状态改为已取消）、data-staging/（排队中的任务清暂存）；外部 无
- 初判：判不准（把握 low）
- 问：数据任务的「取消」现在没有任何页面或程序调用，新版队列要不要提供？
  - a. 进内核：作为队列基本操作保留，并在任务面板给出入口 ← 默认
  - b. 退役：维持现状，排队或失败任务等 24 小时自动清理
  - c. 进定制包：只给这家单位的工程按需调用
- 默认项的依据：代码路径完整且有底层测试，说明是有意设计的队列能力；但 devpage、prod.html、exe、client 均无调用，用户今天无法取消任务

#### R127

- 做什么：重试失败或已取消的数据任务（摄入需暂存仍在）
- 谁在用：无人
- 证据：无调用方证据：页面、exe、工具脚本均无调用；client/nexus_client/main.py 只有通用代理路由
- 依赖：数据 data-jobs.jsonl（状态回到排队）、data-staging/（摄入任务重试依赖暂存文件仍在）；外部 无
- 初判：判不准（把握 low）
- 问：数据任务的「重试」现在没有任何页面或程序调用，失败任务只能重新上传。新版要不要提供？
  - a. 进内核：作为队列基本操作保留，并在任务面板给出入口 ← 默认
  - b. 退役：失败任务一律重新上传
  - c. 进定制包：只给这家单位的工程按需调用
- 默认项的依据：datajobs.py 注释写明失败任务保留暂存文件是为了「排查或重试」，重试是设计意图；但页面只显示失败原因，没有重试按钮，也无人调用

## 顺带的疑问

这些已有归宿，清点的人只是留了个疑问。可以不看。

- **R166 POST /api/auth/machine-grant**（初判 进定制包）：dev 机超管向各 prod 认领开发者身份的跨机通道（R166 铸码、R167 核销）按定制处理即可？
- **R172 POST /api/auth/bridge-code**（初判 进定制包）：prod 为 dev 面担保身份的桥接三条（R172 铸码、R173 验码、R174 中继页）按定制处理即可？
- **R192 GET /api/platform/servers**（初判 退役）：生产面的服务器清单只读接口是否确随本机 client 退役？
- **R193 GET /api/platform/kuma**（初判 进定制包）：管理面的存活监控视图绑死 uptime-kuma，按定制处理即可？
- **R197 POST /api/backup/dr-run**（初判 进定制包）：异地容灾三条（R196 状态、R197 推送、R198 任务）实现写死腾讯云 COS，按定制处理即可？
- **R216 GET /api/feedback/export**（初判 进定制包）：意见库在 prod、分拣在 dev 机的两条机间同步（R216 拉取、R217 写回）按定制处理即可？
- **R134 POST /api/identity/replica**（初判 退役）：注册表整表推送（replica）要不要按任务书 §7.1 当作必须兼容的身份同步契约保留？

