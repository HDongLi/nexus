# 设计：第 4 片——AI 会话与沙盒

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-29 |
| 状态 | 定稿（2026-11-29，编排者审毕；五道待裁点全部照建议采纳，见「编排者裁决」）。实现照它做，改动走新的变更 |
| 跟着 | [proposal.md](proposal.md)、[规格：AI 会话与沙盒](../../spec/ai-sessions.md)（74 条 + 八道裁决）、[设计 02](design-02-projects.md)、[设计 03](design-03-people.md)、[ADR 0002](../../adr/0002-模块解剖与契约管线.md)、[ADR 0006](../../adr/0006-模块之间的三种关系.md)、[ADR 0007](../../adr/0007-新建工程的耗时与预算例外.md) |

行为以规格为准（规格 2026-11-27 定稿，八道裁决不再重裁）；这里记它落在哪些文件、哪些表、哪些契约上。规格没写到、实现要拿主意的地方，本文定下并说为什么。

## 编排者裁决（2026-11-29，审草稿后）

五道待裁点全部采纳设计代理的默认建议：

1. **预算例外采纳**：建沙盒 p95 ≤ 500ms、合入/废弃 ≤ 2s，论证照 ADR 0007（低频、同步语义值得保）；数字实现时记模块卡「实测」，任务书 §10.3 的补记放第 4 片收口时（照第 1–3 片收口的样子）。
2. **迁移编号 0004/0005 确认**：实数四条迁移（`apps/api/drizzle/0000`–`0003`，编排者亲自点过），下一号 0004；派工说明的「从 0005 起」是编排者笔误。
3. **废弃的进程收尾不留宽限**：废弃是终点动作，当场强杀、5 秒封顶——规格只说「先结束它的会话」，姿势由本文定。
4. **工程模块出口加三样只读小口**（`projectRepoPath`、`service.canSee`、`service.slugOf`）：ADR 0006 第一种关系的正常开销，方向仍是 sessions → projects 单向；模块卡补记落在 T-0028 的卡里。
5. **总览「冲突中」用库内近似口径**（撞过冲突且未收场）：总览是「要人看的态势」，多算一个待处理的比漏算安全；页面文案用「有冲突记录」，逐沙盒的精确状态在清单里现算。

## 模块边界

**新模块叫 `sessions`，住在 `modules/sessions/`**（2026-11-29 定）。理由：事件 `source` 是 `sessions`（规格 A-67 表），任务卡的领域名也是 `sessions`，模块标识符跟两者走同一个名字，回溯事件和读代码时只对一个词。规格说「代码里是一个模块还是几个、怎么拆文件，归设计」：**一个模块**——三种会话、沙盒、回执、安检检查点共用一套「工程 + 调用者」的入参和同一个仓储，拆成几个模块只会把「沙盒会话」这类两栖东西的归属撕开；大是靠文件拆来管的（见「文件怎么分」，规格「未确定」自己也指了这条路）。

**和工程模块的关系：ADR 0006 的第一种——调用对方出口，方向 sessions → projects，单向。**理由：沙盒的检出源自工程的裸仓库，合入写回工程的默认分支，没有一条数据或调用是反方向的；工程模块的卡上早就写着「不管服务器端的工作树和 AI 会话怎么用仓库（第 4 片）」。运行时只调三个**纯读库、不跑 git** 的出口（第 4 片给工程模块加的三样小东西，落在它的 `index.ts`，模块卡补一笔）：

| 新出口 | 形状 | 为什么 |
|---|---|---|
| `projectRepoPath(projectId)` | 纯函数，`<PROJECTS_ROOT>/<编号>.git` | 裸仓库的目录规则是工程模块的（P-19），规则只写一处 |
| `service.canSee(caller, projectId)` | `Promise<boolean>`，只读库 | 13 条按工程的路由和总览都要「看不看得见」（A-05、G-32）；现有的 `service.get` 会为 `head` 跑一次 git，总览和轨迹按 A-09、A-36 一个子进程都不许起，所以要一个不碰仓库的判定 |
| `service.slugOf(projectId)` | `Promise<string \| undefined>`，只读库 | 合并提交的说明带工程短名（A-50：`sandbox(<短名>): …`），短名是工程模块的字段 |

**和身份模块：零运行时调用。**调用者形状同工程模块的 `Caller`（`{ id, isAdmin, groupIds }`），`groupIds` 由访问闸在认证时放进请求上下文（G-34 的同一条接法，第 3 片已落地），处理函数组装给模块。会话的创建人只存编号，不加「不许删」的引用约束（A-10 明说：建过会话的账号照样能删）。

**和事件日志：**写库和发事件同一个事务（A-69），`emit(input, tx)`。

**模型网关是谁的账，一句话：**不归这一片。助手怎么拿到模型（端点、密钥）不在平台的代码路径里——这一片只按配置拉起进程、给它一份最小环境；按工程选模型、令牌用量统计在「明确不做的」清单上，将来若做，是网关模块消费 `sessions` 的事件，不反过来。

## 形状

```
浏览器 ──会话 cookie──▶ 访问闸 ──▶ sessions 模块 ──┬──▶ 6 张表（库）
                        │            │             ├──▶ git（异步子进程带超时，复用工程模块的执行器）
                        │            │             │     ├─▶ PROJECTS_ROOT/<编号>.git（工程的裸仓）
                        │            │             │     ├─▶ PROJECTS_ROOT/.sandboxes/<工程编号>/<任务名>/
                        │            │             │     ├─▶ PROJECTS_ROOT/.workspaces/<会话编号>/（说会话检出）
                        │            │             │     └─▶ PROJECTS_ROOT/.merge/<沙盒编号>/（合入临时树）
                        │            │             ├──▶ 代理进程（平台的孩子，每会话一个，NDJSON 协议）
                        │            │             ├──▶ DATA_DIR/attachments/（附件文件，元数据在库）
                        │            │             └──▶ 事件日志（和写入在同一个事务）
                        │            └──▶ projects 出口：canSee / slugOf / projectRepoPath
                        └─▶ 代理进程 ──▶ POST /api/v1/receipts（Bearer 会话凭据，public 路由自带验证）

平台关停 ──▶ 监管器请每个代理退出（10 秒宽限，强杀）；平台启动 ──▶ 对账（会话、沙盒、附件各一遍）
```

| 住在哪 | 放什么 |
|---|---|
| `modules/sessions` | 18 条路由的声明、用例、仓储、六张表、十个事件、进程监管器、适配器与假助手、检查点（规则层）、合入协议、测试。骨架用 `pnpm new:module sessions --title <一句话>` 起 |
| `modules/projects` | 出口加三样（见上表）：`projectRepoPath`、`service.canSee`、`service.slugOf`。模块卡补一笔：第 4 片按 ADR 0006 第一种关系调用 |
| `apps/api` | 组合根接线（含把 `canSee` 接进 sessions 的构造参数）；配置加 `ASSISTANTS`、`SANDBOX_QUOTA`、`CHAT_QUOTA`；启动顺序里加对账（会话 → 沙盒残枝 → 合入临时树 → 附件清理）和清理的定时器；进程关停钩子 |
| `apps/web` | 会话总览页、工程会话页（消息流 + 沙盒面板）。归任务卡 T-0030 |
| `packages/contracts` | 事件名 18 条全是三段，现有的 `eventName` 直接放行，不用改 |

## 契约

### 十七条路由（规格 A-01 的表）加一条流

| 方法与路径 | 访问级别 | 请求体 | 成功 |
|---|---|---|---|
| `GET /api/v1/assistants` | user | 无 | 200 `{ assistants }` |
| `GET /api/v1/overview` | user | 无 | 200 `{ projects }` |
| `GET /api/v1/projects/{projectId}/sessions` | user | 无 | 200 `{ sessions }` |
| `POST /api/v1/projects/{projectId}/sessions` | user | `{ kind, name?, assistant? }` | 201；主会话已有时 200 回已有的 |
| `GET /api/v1/projects/{projectId}/sessions/{sessionId}` | user | 无 | 200 `{ session }` |
| `POST /api/v1/projects/{projectId}/sessions/{sessionId}/start` | user | `{ assistant?, reset? }` | 200 `{ session }` |
| `POST /api/v1/projects/{projectId}/sessions/{sessionId}/stop` | user | 无 | 200 `{ session }` |
| `POST /api/v1/projects/{projectId}/sessions/{sessionId}/interrupt` | user | 无 | 200 `{ session }` |
| `POST /api/v1/projects/{projectId}/sessions/{sessionId}/messages` | user | `{ text, attachments? }` | 201 `{ entry, session, inspection }` |
| `GET /api/v1/projects/{projectId}/sessions/{sessionId}/transcript` | user | 查询 `after`、`before`、`limit` | 200 `{ entries, lastSeq, hasMore }` |
| `POST /api/v1/projects/{projectId}/attachments` | user | multipart，恰好一个文件 | 201 `{ attachment }` |
| `POST /api/v1/projects/{projectId}/sandboxes` | user | `{ task, assistant? }` | 201；同名的在役沙盒已有时 200 |
| `GET /api/v1/projects/{projectId}/sandboxes` | user | 无 | 200 `{ sandboxes, quota }` |
| `POST /api/v1/projects/{projectId}/sandboxes/{sandboxId}/merge` | user | 无 | 200 `{ sandbox }`，状态 merged |
| `POST /api/v1/projects/{projectId}/sandboxes/{sandboxId}/discard` | user | `{ force? }` | 200 `{ ok: true }` |
| `POST /api/v1/receipts` | public | 见 A-61，`Authorization: Bearer <会话凭据>` | 201 `{ receipt }` |
| `GET /api/v1/receipts` | user | 查询 `after`、`audience`、`projectId` | 200 `{ receipts, nextAfter, hasMore }` |

第十八条是活的条目和状态怎么到页面（规格把传输方式留给设计，见它「未确定」的推荐）：

| `GET /api/v1/projects/{projectId}/sessions/{sessionId}/stream` | user | 查询 `after`（收过的最后序号） | 200，`text/event-stream`：先补 `after` 之后的条目，再推条目和会话状态，15 秒一行注释当心跳 |

- 选**每会话一条单向流（SSE）**、总览低频轮询（5 秒），照规格「未确定」的推荐。SSE 是单向的、过得了现有访问闸（cookie 随请求走）、断了页面上能看出来；双向长连接这一片用不上。
- 流的响应头带 `X-Accel-Buffering: no`（旧系统的截屏流就是这么穿过缓冲的）。新仓还没有反向代理配置，能不能穿过去要等部署配置落下来再实弹对一遍——记入「遗留」。
- 它不是取数，A-70 的「不手写接口路径」照样管它：契约里声明这条操作，生成的客户端给它一个**返回流地址的方法**，页面拿地址开 `EventSource`，URL 不是手写的。
- 回执入口是 public，但验证不靠访问闸：处理函数自己验 Bearer 凭据（A-60）。写请求的来源校验照挂，代理进程的 curl 不带 `Origin`，按既有规矩放行（设计 01：不带 Origin 的放行）。

### 旧路由的归宿（逐条有着落）

| 旧路由 | 去向 |
|---|---|
| R008 助手清单 | 进内核：`GET /api/v1/assistants`，清单来自配置（A-07），不再有写死的注册表和安装路径 |
| R009 单会话状态 | 进内核：`GET …/sessions/{sessionId}`（Session 形状里有状态和工作态）；`pane_tail`、`last_kind`、`age` 不做（规格旧字段表） |
| R010 态势聚合 | 进内核：`GET /api/v1/overview`，只读库（A-09） |
| R011 启动 | 进内核：`POST …/sessions` + `POST …/sessions/{sessionId}/start`。建会话和启动拆开是新的形状：启动幂等（A-12）、就绪前排队（A-13） |
| R012 停止 | 进内核：`POST …/stop` |
| R013 发消息 | 进内核：`POST …/messages`。安检照走（进方向），发送人在条目上（A-28）；工作目录和启动参数的键一律 400（A-02） |
| R014 + R015 图片/附件两条上传 | 并成一条进内核：`POST …/attachments`（清点结论，A-39） |
| R021 轨迹 | 进内核：`GET …/transcript`，数据源换成平台自己的库（A-33、A-36） |
| R023 交回执 | 进内核：`POST /api/v1/receipts`，凭据换成会话级（A-60），结构化部分按形状校验（A-61） |
| R024 读回执 | 进内核：`GET /api/v1/receipts`，游标改对（A-63），可见性过滤（A-63） |
| R112 建沙盒 | 进内核：`POST …/sandboxes` |
| R113 沙盒清单 | 进内核：`GET …/sandboxes` |
| R114 聊天位 | 进内核：`POST …/sessions`（`kind: "chat"`）+ start。聊天位不再共享开发工作树，拿自己的检出（A-15）；配额数的是在跑的位（A-24） |
| R115 合入 | 进内核：`POST …/sandboxes/{sandboxId}/merge`，合入成功即收回（A-54，裁决 6） |
| R116 废弃 | 进内核：`POST …/sandboxes/{sandboxId}/discard` |
| R117 清残 | 退役为路由，改成平台启动时的对账（A-59，裁决 6：「更该做成后台例程」） |

不在本片清单里的旧路由（终端字节流、截屏差分、职能会话、任务别名、会话迁入、Agent 目录等）照规格「明确不做的」退场或归定制包，这一片不接。旧路径一律 404（A-03）：访问闸对没有声明的路由本来就不放行、回 404，模块不用写任何代码。

### 形状与错误码

`Session`（13 键）、`Entry`（9 键）、`Attachment`（4 键）、`Sandbox`（15 键）、`Inspection`、`Receipt`（11 键）、`Assistant`（3 键）、`ProjectState`（5 键）照规格的路由表逐键落地，生成的契约包是唯一出处。十三条错误码照规格的表；`not_found`、`invalid_request`、`internal_error`、`auth_required` 用已有的。看不见和不存在回 404 且逐字相等（A-05），处理函数共用一句话，同工程模块的做法。

## 表

六张表。迁移两条：`0004_sessions.sql`（会话、条目、凭据、附件、回执）、`0005_sandboxes.sql`（沙盒）——接在现有四条迁移（`apps/api/drizzle/0000`–`0003`，编号已核实）之后按序排号；两条迁移跟着两张后端卡走，先会话核心后沙盒。

| 表 | 列 | 键与约束 |
|---|---|---|
| `sessions` | `id`、`project_id`、`kind`（main/chat/sandbox）、`name`、`assistant`、`sandbox_id`、`status`、`working`、`created_by_id`（可空）、`context_id`、`created_at`、`last_activity_at`、`last_seq`、`last_exit_at`、`last_exit_code`、`last_exit_reason` | 主键 `id`。部分唯一索引：`(project_id) WHERE kind='main'`——主会话恰一（A-10）靠库；`(project_id, name) WHERE kind='chat'`——聊天位不重名（A-11）。`sandbox_id` 唯一索引（一个沙盒一个会话），可空。**不建**指向账号表的外键（A-10：建过会话的账号能删） |
| `session_entries` | `session_id`、`seq`、`kind`、`text`、`tool`、`call_id`、`sender_id`（可空）、`attachments`（jsonb，`{id,name,size}` 数组）、`at`、`truncated`、`delivered` | 联合主键 `(session_id, seq)`：序号在会话内从 1 连续递增（A-33）由库的键保住。`delivered` 记这条用户消息投出去没有——对账时找「没送达的」（A-66）全靠它，不另设队列表 |
| `session_credentials` | `id`、`session_id`、`token_hash`、`created_at` | `token_hash` 唯一。**作废即删行**：进程一结束就删，查无此散列就是 401，不留吊销标记（同身份会话「退出即删行」的既定做法） |
| `session_attachments` | `id`、`project_id`、`name`、`size_bytes`、`kind`（image/file）、`stored_ext`、`created_at` | 主键 `id`。文件在 `DATA_DIR/attachments/<id><ext>`，盘名不用原文件名（路径分隔符、引号、中文都进不了盘名；原名在 `name` 里按 A-41 原样保存）。接口的 `Attachment` 四键里没有路径（A-39 的契约测试盯它） |
| `sandboxes` | `id`、`project_id`、`task`、`branch`、`session_id`、`base_commit`、`merge_commit`（可空）、`created_by_id`（可空）、`created_at`、`merged_at`（可空）、`discarded_at`（可空）、`last_conflict_at`（可空） | 部分唯一索引 `(project_id, task) WHERE discarded_at IS NULL`——废弃之后名字可以再用（A-57），在役的不重名（A-11、A-46）。`ahead`、`behind`、`dirty`、`state` **不存库**：清单按 A-48 现算 |
| `receipts` | `seq`（bigserial 主键）、`session_id`、`project_id`、`sandbox_id`（可空）、`audience`、`status`、`report`、`asks`（jsonb）、`emits`（jsonb）、`text`（可空）、`at` | `seq` 全平台连续递增（A-62）就是游标（A-63 的 `after`/`nextAfter`） |

**安检命中不建表。**命中只有元数据（类型、次数）：脱敏时在响应的 `inspection.hits` 里回给页面（A-32）、发一条 `sessions.message.redacted` 事件（A-67 表），原文哪里都不留（A-32、A-68）。旧系统另写一份审计文件、配置还能关掉脱敏只留痕——新版没有「只留痕」这个模式：要么放行（无命中）、要么脱敏（事件即审计）、要么拦截（422，什么都不落），检查点是构造参数，第 8 片换模型层时换构造参数就行。

**会话上不存配额。**配额是配置（A-24、A-45），查的时候数库。

## 进程

**代理进程是平台的孩子（裁决 3），监管器（supervisor）是模块里的一个部件，进程的生命周期归它管。**它是组合根构造模块时建的一个普通对象，不是单例服务、不自带线程：

- **登记**：`Map<sessionId, AgentProcess>`。每一项：子进程句柄、就绪定时器、没响应定时器、待投递队列、凭据编号。进程随会话起、随请求或关停结束——**铁律 15「不留永生线程」相容的理由写在注释里**：会话进程不是后台工作线程，是请求触发的、有登记可查、关停钩子会逐个收掉的孩子；定时器全部登记在监管器里，关停时逐个清掉，进程退出后不留任何会再醒来的东西。真正常驻的只有附件清理那一个定时器（A-43 要「定时做」），它 unref、关停时清、不碰请求路径。
- **拉起**：进程启动器是构造参数（A-27 的验收缝），缺省实现用 `child_process.spawn`，`detached: false`。启动路由只做**踢一脚**：登记、置状态 starting、spawn——立即返回（A-13 启动不等人，响应 200 毫秒预算内）。就绪、退出全是流上的异步事件。
- **就绪**：适配器报 `ready` 才置 running、开闸投递队列。60 秒没就绪：结束进程、状态 stopped、`lastExit.reason=start_timeout`、系统条目一条（A-14，注入时钟验）。
- **崩溃怎么发现**：stdout/stderr 的 `close`/`exit` 事件就是发现（A-21）：置 stopped、记退出码和时刻、`reason=exited`、退出时还在处理就补一条系统条目。没有轮询探活——事件驱动的就够，旧系统「每次去问 tmux」的形状不进新版。
- **重启对账（A-65、A-66）**：启动时（组合根按序调一次 `service.reconcileAtBoot()`）库里 status 是 starting/running 的会话一律置 stopped、`reason=platform_restart`、每个补一条系统条目、**删光它们的凭据行**（A-25 的「随进程结束作废」在重启后也得成立）；`delivered=false` 的用户条目后面各补一条「未送达」的系统条目，不自动重投。对话一条不少。
- **关停（A-64）**：应用层的进程生命周期钩子（ADR 0002 决定 8，钩子住在 `apps/api`）调 `supervisor.stopAll()`：逐个请退、10 秒宽限、强杀，写 stopped/`platform`/系统条目，等全部落定再退进程。强杀在 Windows 上是 `taskkill /T /F`（助手命令行是带子进程的进程树，只杀直系会留孙子）。
- **和请求的界线**：拉起、停、打断都在请求路径上，但它们只做登记、踢进程、写库三件异步的事，最长的同步等待是零——停止路由**立即回 200**（A-17 的验收只要求「15 秒内回 200、之后进程不在」），宽限强杀序列在后台走完。废弃是例外：它要在摘目录前确认进程死透（A-57 注释的教训），当场强杀（丢弃是终点，不用宽限）、最多等 5 秒。

**并发与排队（A-13 的就绪前排队）**：每会话一个进程，没有全局上限（规格「未确定」明说没有）；并发上限是两条配额——聊天位按在跑的位数（缺省 3，A-24），沙盒按在役数（缺省 2，A-45）。就绪前的消息：落库（先落轨迹，A-28）后进会话的待投递队列，`ready` 一到按 `seq` 顺序逐条写进程的标准输入、逐条置 `delivered`——一条不丢、一条不乱。发消息自动拉起（A-23）踢不起来不影响 201，轨迹里跟一条没送达。

**凭据（A-25、A-26）**：拉起前铸 32 字节随机数、base64url、库里只存 SHA-256，行跟着会话。子进程的环境是**白名单**：操作系统的最小集（PATH、PATHEXT、SYSTEMROOT、COMSPEC、TEMP/TMP；POSIX 的 HOME、TMPDIR），加平台给的三样 `NEXUS_SESSION_CREDENTIAL`、`NEXUS_SESSION_ID`、`NEXUS_API_BASE`（回执要往哪打），再加助手配置自己声明的 `env`。`process.env` 不整包传——旧系统把数据库连接串传给助手的形状，A-26 的验收（假助手报环境变量名）直接钉死。

**适配器与假助手（A-27）**：进程的线协议是 **NDJSON**：代理向标准输出一行一个事件——`ready`、`turn_start`（开始处理）、`text`、`thinking`、`tool_call`（带 `tool`、`callId`）、`tool_result`（带 `callId`）、`turn_end`；平台向标准输入一行一个命令——`message`（正文 + 附件的服务器路径，路径按 A-42 不进条目）、`interrupt`。适配器把这个翻成条目和状态；退出不靠输出，进程退出事件就是退出。这一片只带**通用 NDJSON 适配器**和仓里的假助手（`modules/sessions/testing/fake-assistant.ts`，行为可控：几秒后就绪、说哪几段、进长回合、自己退出、报环境变量名、支持/不支持续接两种配置）。真助手的适配器以后一种一个文件进来，每种配一份录好的输出样本和期望事件序列的一致性测试，翻译错一点就丢事件或重事件，这道测试是它的闸。助手声明不支持续接的（配置里 `resume: false`），每次启动记一条系统条目（A-20）；续接传的是会话的上下文标识（`sessions.context_id`，重置时换新——A-19 说「从空的上下文重新开始」，标识不换就接回去了），平台不读任何助手的私有文件。

## 沙盒与合入

**目录布局**（都在 `PROJECTS_ROOT` 下、点前缀，不与 `<编号>.git` 混）：

| 目录 | 是什么 | 建于 | 收于 |
|---|---|---|---|
| `.sandboxes/<工程编号>/<任务名>/` | 任务工作树（A-44 规定的路径） | 建沙盒 | 合入收回（A-54）/废弃（A-57） |
| `.workspaces/<会话编号>/` | 说会话的检出（A-15 的「平台给的目录」） | 会话启动 | 会话停止（A-15：停了就收回） |
| `.merge/<沙盒编号>/` | 合入用的临时树 | 每次合入 | 合入收尾（成败都收） |

**说会话的检出用 `git archive` 抽出来，不用工作树。**`git archive main | tar -x` 到 `.workspaces/<会话编号>/`：这棵目录里**没有 `.git`**——代理在里面改了什么平台一概不收（A-15），比工作树更硬：工作树带着指回裸仓的 git 连接，代理真能提交；一个纯目录连提交的入口都没有，「默认分支不会因此多出提交」从约定变成了没有钥匙。下次启动按那时的默认分支重抽（A-15 的尾巴：检出不随分支更新，裁决已定不做自动刷新）。

**建沙盒（A-44）**：查配额（A-45，建之前查）→ 查助手可用（不可用 409，不起进程）→ `git worktree add -b nexus-task/<任务名> <目录> main`（基线是默认分支**当时的提交**；A-46 的续挂：分支在、目录不在就 `worktree add <目录> <分支>`，提交都还在）→ 事务写沙盒行 + 沙盒会话行 + `sessions.sandbox.created` → 铸凭据、踢进程（就绪前排队照走）。跑 git 的规矩全盘照工程模块：异步带超时（缺省 30 秒，A-56）、不读服务器用户的 git 配置、分支和作者显式给——git 执行器直接复用工程模块出口的 `createGitRunner`。

**合入协议（A-49 到 A-55）**。裸仓库没有能 `merge` 的主工作树，合入在**临时树**里做；「默认分支动没动」是协议的核心，步骤按「先备料、后落锤」排：

1. 拿工程的合入/废弃互斥锁（**同一工程同一时刻只跑一个合入或废弃**，A-50；进程内的按工程排队，不占数据库锁——锁横跨多次 git，占库锁会把事务拖过子进程）。
2. 前置检查（A-49，任一不过 409、什么都不动）：分支不在或无未合入提交（`rev-list --count main..分支`）→ `sessions_sandbox_nothing_to_merge`；沙盒代理正在处理（`working` 为真）→ `sessions_sandbox_busy`。
3. 备料：记下 main 的当前提交 `oldMain`；`git worktree add --detach .merge/<沙盒编号> <oldMain>`；在临时树里 `git merge --no-ff -m "sandbox(<短名>): 合入任务沙盒 <任务名>" nexus-task/<任务名>`（作者提交者 `nexus <nexus@localhost>`）。到此 main 的引用**一个字节没动**，合并提交只活在临时树的 HEAD 上。
4. 撞冲突（A-51）：临时树里 `merge --abort`、删临时树、库记 `lastConflictAt`、发 `sessions.sandbox.conflicted`、回 409 `sessions_sandbox_conflict`（`details.commits` 是待合数）。随后按 A-52 给沙盒会话派固定指令（「把默认分支并进自己的分支，逐个解冲突，提交；不推送，不变基，不动默认分支」——指令文本是模块里的一段常量），会话没在跑先拉起（`cause: sandbox_conflict`）；指令以 user 条目落轨迹、`senderId` 空；派没派成写进 409 的 `message` 和事件的 `resolveDispatched`。解完之后落后数归零、状态 resolved（A-53），人再点一次合入。
5. 落锤（唯一的提交点）：`git update-ref refs/heads/main <新提交> <oldMain>`——带期望旧值的比较并交换。有工程级互斥锁在，CAS 是第二道保险：锁失效或将来多实例时，两个并发合入只有一个能落锤。
6. 记账：事务写 `merge_commit`、`merged_at` + 结束沙盒会话（stopped、`reason=platform`）+ 发 `sessions.sandbox.merged`。**事务失败则反向落锤**：`update-ref` 把 main 拨回 `oldMain`（期望旧值=新提交），回 500 `sessions_merge_failed`——默认分支回到合入前（A-55）。反向也失败（不该发生：有锁、单写者）就记 CRITICAL 日志，启动对账兜底（见下）。
7. 收回（A-54）：短宽限停掉会话进程、摘任务工作树、删任务分支、删凭据行、删临时树。**工作树里有未提交改动就不摘不删**：记录仍是 merged，清单里它带着 `dirty` 标记（A-48 里 merged 判在 dirty 之前），等人废弃。收不干净不算合入失败，错误进日志。已合入是终点：再启动它的会话回 409 `sessions_sandbox_closed`（A-54）。

失败面（A-55 的验收是「git 执行器换成在第 k 步失败的桩」）：第 3 步之前任何一步失败——删临时树、回 500，main 没动、状态没变、没发事件。第 4 步冲突是**预期内的结果**不是失败。第 5、6 步之间是协议里唯一需要善后的缝，上面的反向落锤和启动对账兜底是缝上的两道闸。

**废弃（A-57、A-58）**：拿工程锁 → 已废弃的直接 200（幂等，废弃后名字可再用）→ **先强杀会话进程**（A-57 原注释的教训：防代理往被摘的目录里写；终点动作不留宽限）→ 强制闸：未合入提交数（目录在就从工作树数、不在就从裸仓数——旧系统目录不在就跳过检查是个洞，A-58 验收明说这条不变）或未提交改动，任一为真且没带 `force` → 409 `sessions_sandbox_unmerged`，`details` 里是提交数和有没有改动 → `worktree remove`（force 时 `--force`）、`branch -D`、库记 `discarded_at`、发 `sessions.sandbox.discarded`。

**清残（A-59）**：不是路由。启动对账时按有沙盒的工程逐个跑：`git worktree prune`（手工删目录的残登记）、记录在目录不在的沙盒清单里自然显成 missing（A-48 第一判，不用写库）、`.sandboxes/<工程编号>/` 下的空目录删掉、`.merge/` 下的残留临时树删掉。

**状态现算（A-48）的次序照抄规格**：目录不在 missing → git 失败/超时 unknown → 已合入（`merged_at` 非空）merged → 撞过冲突未合（`last_conflict_at` 非空且未收场）时落后数 >0 conflict、=0 resolved → 有未合入提交 ready → 有未提交改动 dirty → 其余 idle。废弃的 discarded。清单每个沙盒至多 4 次 git（脏树、领先、落后、头提交）加一次工作树清单（A-47），一个沙盒的 git 出事只它自己 unknown、字段留空，别的照常。

**总览的「冲突中的沙盒数」是库里的近似口径**（A-09 只读库是硬的，落后数不跑 git 算不出来）：数 `last_conflict_at` 非空且未合入未废弃的。撞过冲突、代理解完还没人再合的沙盒会被这个口径多算着——总览是「要人看的态势」，多算一个待处理的比漏算安全；逐沙盒的精确状态在清单里现算。口径差异写进模块卡和页面的提示文案（「有冲突记录」）。

## 安检

**检查点是构造参数**（A-30）：`inspect(text, direction, projectId) → { text, hits, verdict }`，`verdict` 是 passed/redacted/blocked。这一片接上的实现是规则层——九类高置信凭据模式，纯函数，不调任何外部服务（裁决 4；模型层、配置和管理面归第 8 片，换检查点就是换构造参数）。九类的名字和次序沿用旧规则表的：`anthropic-key`、`openai-key`、`aws-access-key`、`github-token`、`slack-token`、`google-api-key`、`jwt`、`private-key-block`、`named-secret`。`named-secret` 的防误杀两件套照旧：值至少 12 个连续 ASCII、值里不带中文——「这个 password 是不是错了」这类讨论不命中。规则表是 `inspection.ts` 里的一段数据，单元测试表驱动，九类各一例脱敏。

**何时扫：两条路各一次**（A-30）。发消息：进方向，先于写轨迹——拦截 422 什么都不落（A-31），脱敏则**只有脱敏版**进轨迹、事件、投递和响应（A-32，验收要查日志里也没有）。交回执：出方向，先于落库，拦截回 422 `sessions_message_blocked`（A-60 的错误表）。事件 `sessions.message.redacted` 只记方向和类型次数（A-68）。

## 回执

只做数据面（裁决 5）：入库 + 带游标的读。收件箱页面、已读位置、分流到控制芯核之后的后果是第 8 片的。

- **入口（A-60）**：`POST /api/v1/receipts`，public 级，处理函数验 `Authorization: Bearer`——没带、不对、已作废（凭据行已删）一律 401 `sessions_bad_credential`。请求体里自报 `sessionId`、`projectId`、`from` 之类直接 400（形状校验的严格对象模式自然拒掉）：工程、沙盒从凭据的会话推出来，不由请求自报。
- **形状（A-61）**：请求体恰好 `status`、`report`、`asks?`、`emits?`、`text?`、`audience?` 六个键，逐项验（`asks` 每项至少两个选项、`emits` 每项要有 `summary`、`text` 至多 4000 码点……），不合 400 且回执不落、原因逐项说清。不再从正文里抠代码块——旧系统 145 条回执全没结构化、发的一方不知道，就是没按形状校验的下场。
- **落库（A-62）**：出方向检查点 → 同一事务写 `receipts`（`seq` 是 bigserial，全平台连续）+ 发 `sessions.receipt.recorded` → 201。`audience` 两种都落库都发事件，读接口按它过滤。
- **读（A-63）**：user 只回看得见的工程的（逐条问 `canSee`，管理员全量）；`after` 游标升序、每次至多 200 条、`nextAfter` 是这批最后一条的序号、`hasMore` 照实——旧系统「回最后 200 条、游标按全量算」导致中间永远取不到的形状不进新版。造 450 条分三次取完的验收直接钉这个。

## 事件

十个事件照规格 A-67 的表落地，`source` 都是 `sessions`，`traceId` 是请求号（对账发的不带）。payload 的形状校验和工程、身份模块同款：多一个键当场抛——A-68（事件不带正文、不带路径、不带凭据）靠这道闸保住，不靠自觉。

| 事件 | subject | payload |
|---|---|---|
| `sessions.session.created` | 会话编号 | `sessionId`、`projectId`、`kind`、`name`、`actorId` |
| `sessions.session.started` | 会话编号 | `sessionId`、`projectId`、`kind`、`actorId`、`cause`（person/message/sandbox_conflict） |
| `sessions.session.stopped` | 会话编号 | `sessionId`、`projectId`、`reason`（五值之一）、`exitCode`、`actorId`（人带起的才带：person、合入收回、废弃） |
| `sessions.message.sent` | 会话编号 | `sessionId`、`seq`、`actorId`、`attachmentCount`、`redacted` |
| `sessions.message.redacted` | 会话编号 | `sessionId`、`projectId`、`direction`、`hits`、`actorId`（回执路不带） |
| `sessions.sandbox.created` | 沙盒编号 | `sandboxId`、`projectId`、`task`、`branch`、`baseCommit`、`actorId` |
| `sessions.sandbox.merged` | 沙盒编号 | `sandboxId`、`projectId`、`task`、`mergeCommit`、`commits`、`actorId` |
| `sessions.sandbox.conflicted` | 沙盒编号 | `sandboxId`、`projectId`、`task`、`commits`、`actorId`、`resolveDispatched` |
| `sessions.sandbox.discarded` | 沙盒编号 | `sandboxId`、`projectId`、`task`、`unmergedCommits`、`forced`、`actorId` |
| `sessions.receipt.recorded` | 会话编号 | `receiptSeq`、`sessionId`、`projectId`、`sandboxId`、`audience`、`status`、`asksCount`、`emitsCount` |

十个名字全是三段，`eventName` 现有规则放行。`started` 的 `actorId`：人点启动是操作者；发消息带起的是发消息的人；冲突派单是点合入的人；对账重启后由人再点，才有 `actorId`。

## 文件怎么分

体量大，拆文件按铁律 8 办（规格「未确定」点名了这条）。每个文件 ≤400 行、`service.ts` ≤300 行，超了就再拆，不调限额。

| 文件 | 放什么 |
|---|---|
| `index.ts` | 唯一出口：把三组路由声明绑到用例上，汇出契约、错误码、事件、类型 |
| `routes-core.ts`、`routes-sandbox.ts`、`routes-receipts.ts` | 18 条路由的声明（纯数据）：会话与消息、沙盒、回执与总览助手。声明多了拆文件，`index.ts` 汇成一个 `sessionsContract` |
| `service.ts` | 门面：所有用例的入口，只做分派（≤300 行） |
| `lifecycle.ts` | 会话的一生：建（主会话唯一约束、并发只成一个）、启动（幂等、超时）、停止、打断、重置、续接（A-10…A-23） |
| `messages.ts` | 发消息（先落轨迹再投递）、待投递队列、没响应提醒、读轨迹三种取法（A-28…A-38） |
| `attachments.ts` | 上传（边读边拒、文件名取基本名）、自净（A-39…A-43） |
| `sandboxes.ts` | 建、清单、状态现算、废弃、清残对账（A-44…A-48、A-56…A-59） |
| `merge.ts` | 合入协议、冲突派单指令、临时树（A-49…A-55、A-52） |
| `receipts.ts` | 回执入口、凭据校验、带游标的读（A-60…A-63） |
| `overview.ts` | 总览与助手清单（A-07…A-09） |
| `supervisor.ts` | 进程登记、拉起、就绪/退出事件、定时器、停止序列、重启对账的会话半边 |
| `adapter.ts` | 线协议类型、NDJSON 适配器（输出翻条目） |
| `inspection.ts` | 检查点接口 + 规则层实现 + 九类模式表 |
| `schema.ts`、`repo.ts` | 六张表的定义；全部 SQL。repo 一张卡一个面：`repo.ts`（会话、条目、凭据、附件、回执）跟着 0004 走，`repo-sandboxes.ts` 跟着 0005 走——铁律 4 的意思是「SQL 不散进用例文件」，仓库文件按面拆不违背它；若架构闸只认字面，实现卡里先跑 `pnpm run arch`，不放行就把两份并回一个 `repo.ts` |
| `codes.ts`、`events.ts`、`shared.ts` | 13 个失败码；10 个事件与 payload 形状；依赖形状、Caller、上下文 |
| `testing/` | 假助手脚本、内存替身（进程启动器、git 执行器、检查点、时钟） |

`apps/api` 的接线：组合根构造模块（数据库、事件日志、`PROJECTS_ROOT`、git 执行器、`canSee`/`slugOf`/`projectRepoPath`、检查点、进程启动器、时钟）；启动顺序 = 连库 → 迁移 → **对账（会话 → 沙盒残枝 → 临时树）** → 附件清理一遍 → 起定时器 → 挂路由 → 听端口；进程生命周期钩子挂 `supervisor.stopAll()`。

## 配置

`apps/api/src/config.ts` 加三项，照「环境变量是配置的唯一来源」的既有规矩：

| 变量 | 缺省 | 说明 |
|---|---|---|
| `ASSISTANTS` | `[]` | JSON 数组：`[{ id, name, command: [可执行文件, …参数], resume?: 布尔, env?: {…} }]`。启动时校验形状，不合法起不来。**代码里不写死任何一家的名字、位置、旗标**（A-07） |
| `SANDBOX_QUOTA` | `2` | 每工程在役沙盒上限（A-45，沿用旧值） |
| `CHAT_QUOTA` | `3` | 每工程在跑聊天位上限（A-24，沿用旧值） |

时长与长度类是模块常量（规格的初值）：启动超时 60 秒、停止宽限 10 秒、没响应提醒 60 秒、消息 20000 码点、条目 32000 码点、附件 10/20 MB、保留 14 天、附件清理每 6 小时、git 超时 30 秒——都能从构造参数替换，测试拨表、换桩。

**可用性的核对不起子进程**：`available` 按 PATH 逐目录找可执行文件（Windows 认 `PATHEXT`），纯文件系统检查、结果缓存 60 秒——清单和启动都查它，但一个子进程都不为它起。命令找得到就算可用：装了但坏是运行时的事，启动超时会如实记 `start_timeout`。

## 页面

| 路由 | 谁能看 | 内容 |
|---|---|---|
| `/sessions` | 所有登录用户 | 工作台总览：看得见的每个工程一个点——灰没起、绿空闲、黄在干活（A-08 的数据：主会话状态、在役沙盒数、冲突记录数、在跑聊天位数）。5 秒轮询。拉取失败如实说「拉取失败」，不显示成「还没有」（A-71） |
| `/sessions/{projectId}` | 看得见该工程的人（看不见直接 404，和后端同口径） | 左侧会话清单：主会话置顶，聊天位、沙盒会话跟着；右侧消息流 + 输入框；旁边沙盒面板（在役沙盒、各自状态徽章、合入/废弃按钮、配额余量） |

交互规矩（A-71 到 A-74，全部自绘、不用浏览器原生对话框）：

- **发送即见**：201 带回的条目直接画，不做乐观气泡和事后对账——旧页面那套虚线泡的对不上不删，随 A-28 退场。失败把话还回输入框、原因卡内常显。
- **脱敏常显**：响应带命中类型和次数时，画的是脱敏版并加一行「已自动脱敏 N 项」；页面不存原话（sessionStorage 那套不进新版）。
- **两步确认**：合入、要强制的废弃、停主会话、重置主会话——第一下按钮变成确认字样，3 秒不点第二下复原（A-72）。
- **就绪不是连接中**：没说过话的会话显示「已就绪，发第一条消息开始」，不显示「连接中」、不重试（A-73）。
- **活的条目**：进会话页先 `transcript` 补历史，再开 SSE 流推增量；流断开显「实时连接断开，已切换轮询」的行内条并回落 2 秒轮询，不自动重连风暴。图片附件显示名字和大小，没有路径（A-74）。
- 回执收件箱不在这片（第 8 片）。

## 验证

| 验的是什么 | 在哪一层 |
|---|---|
| 任务名、消息长度、条目截断、九类安检模式（含防误杀）、事件 payload 形状、配额缺省值、状态现算的次序表 | 单元测试，表驱动，不碰数据库 |
| 18 条路由的访问级别、路径参数名都是编号、`Attachment` 响应无路径字段、建会话/启动的请求体无 `cwd`/`args`/`env` | 契约测试，读接口文档 |
| 十七条 + A-03 的旧路径 404；A-05 十三条路由看不见逐字 404；A-02 七种形状不合各 400 且计数桩全零 | 集成测试 |
| A-06 不出服务器路径：每个成功和失败场景的响应正文不含 `PROJECTS_ROOT`、`DATA_DIR` 的值，`message` 不带底层报错原文，失败场景日志里有同一请求号的报错行 | 集成测试 |
| 会话一生：主会话恰一并发只成一个、启动幂等并发只起一个、启动不等人 + 就绪前排队有序、启动超时（注入时钟）、停止立即回 200 后台收尾、打断、重置、续接、进程自退、没响应提醒（注入时钟）、发消息自动拉起、聊天位配额 | 集成测试，假助手 + 启动器/时钟注入 |
| 轨迹：先落库再投递（启动器挂起仍 201）、序号连续、一字不差（含四字节字符、万字行）、32000 截断带标记、三种取法 + 只读库、按会话隔离 | 集成测试 |
| 安检：恒拦桩 422 什么都不落、恒放行桩原文进轨迹、脱敏后处处是脱敏版（轨迹、事件、日志）、回执出方向同款 | 集成测试 |
| 附件：两档上限各多一字节 413 且盘上无文件、空文件 400、中文名/带路径名、消息里投给代理的是路径而条目里没有、自净（注入时钟，没人上传也清） | 集成测试 |
| 沙盒：建（目录、分支指向默认分支当时提交、默认分支一字未动）、配额、幂等与续挂、清单的 4 次 git 与 unknown 隔离、状态九态表驱动、合入前置三查、合入协议每步失败桩（k 取遍）默认分支不动、冲突整体撤回 + 派单、解完再合、合入后收回（脏树不收）、强制闸（含目录已不在）、废弃、清残对账 | 集成测试，`PROJECTS_ROOT` 指临时目录、真 git、失败桩 |
| 回执：三种 401、形状逐项 400、三种 status 各 201、凭据跨路由 401、停会话后凭据失效、450 条分三次取完、看不见的工程读不到 | 集成测试 |
| 重启：关停 15 秒内进程不在、启动对账 platform_restart、未送达说明、凭据全作废 | 集成测试，直写表 + 重建模块和应用 |
| 事件：十事件逐场景断言类型/`source`/`subject`/键集合/`traceId`、A-68 不含正文路径凭据、同事务回滚（A-69 的六个场景） | 集成测试 |
| 环境白名单：假助手报环境变量名，无平台配置项、有凭据 | 集成测试 |
| 预算：发消息、启动、建会话 p95 ≤ 200ms 记实测；例外见下节 | 集成测试里量，记模块卡 |
| 真浏览器：A-74 的整段走查（发话、带图、脱敏、自动拉起、建沙盒→提交→两步合入→工程详情见合并提交→沙盒出列、废弃消失、越权 404、全程无原生弹窗） | 端到端（T-0030） |

## 预算

写接口 p95 ≤ 200 毫秒（任务书 §10.3）的例外，照 ADR 0007 的样子单独论证：

| 路由 | 预算提议 | 理由 |
|---|---|---|
| 发消息、启动、停止、打断、建聊天位、读轨迹、总览、回执两条 | ≤ 200ms | 纯库 + 流上的异步动作；停止立即回 200，收尾在后台 |
| 建沙盒 | ≤ 500ms | 一回 git（worktree add）+ 事务 + 异步拉起。低频操作（一个工程同时至多 2 个在役），同步语义（201 时会话已拉起）照 ADR 0007 的裁决值得保 |
| 合入 | ≤ 2 秒 | 三回 git（临时树、merge、update-ref）+ 收回序列。低频、终态动作；改异步要把「merged」拆成中间态给页面轮询，语义复杂化换没人需要的快——和 ADR 0007 同一条理由，规模更大 |
| 废弃 | ≤ 2 秒 | 强杀等待（≤5 秒封顶，通常亚秒）+ 两回 git |

超了或这些动作变高频，按 ADR 0007 的先例回决策记录重裁。数字实现时记进模块卡的「实测」。

## 卡拆分

四张卡，T-0028 起（前一片用到 T-0027）。后端拆「会话核心」和「沙盒合入」两步：沙盒协议依赖会话核心的进程监管和轨迹，拆开让第一张卡能独立验收（假助手就能走通会话一生，不碰 git）。

| 编号 | 卡 | scope（tasks.json 的字段） | 验收 | 依赖 |
|---|---|---|---|---|
| T-0028 | 实现：会话核心（后端）。`sessions` 模块骨架、迁移 `0004`（会话/条目/凭据/附件/回执）、13 条路由（助手、总览、会话五条、消息、轨迹、附件、回执两条）+ SSE 流、进程监管器、NDJSON 适配器 + 假助手、检查点规则层、对账与清理的启动接线、配置三项；`modules/projects` 出口加三样 + 模块卡补记 | `modules/sessions/**`、`modules/projects/**`、`apps/api/**`、`packages/api-client/**`、`packages/contracts/**`、`pnpm-workspace.yaml`、`turbo.json`、`AGENTS.md`、本文档、`tasks.json` | `pnpm contracts -- --check`；`pnpm --filter @nexus/sessions test`；`pnpm --filter @nexus/api test:integration`；`pnpm verify` | T-0021（规格）、T-0025 |
| T-0029 | 实现：沙盒与合入（后端）。迁移 `0005`、沙盒四条路由、建/清单/状态/废弃/清残对账、合入协议与冲突派单、`sessions.sandbox.*` 三事件 | 同 T-0028 的范围字段 | `pnpm contracts -- --check`；`pnpm --filter @nexus/sessions test`；`pnpm --filter @nexus/api test:integration`；`pnpm verify` | T-0028 |
| T-0030 | 实现：会话页与总览（前端）。`/sessions` 总览、`/sessions/{projectId}` 会话页与沙盒面板、SSE 接入与轮询兜底、两步确认、脱敏提示、A-74 端到端 | `apps/web/**`、`packages/ui-kit/**` | `pnpm --filter @nexus/web test`；`pnpm --filter @nexus/web typecheck`；`pnpm gate:l3` | T-0029 |
| T-0031 | 审查：第 4 片。独立对着规格 74 条复验，产出 `review-04-ai-sessions.md` | `docs/changes/2026-11-26-dev-face/review-04-ai-sessions.md` | 审查报告里每道论断有验证；复跑复测的数与实现卡的差值有解释 | T-0030 |

收口（T-0015 那条线的延续）：任务书 §10.3 的预算例外补三行（建沙盒/合入/废弃），模块卡落 `modules/sessions/module.md`。

## 不做什么（照规格「明确不做的」）

终端画面与送键、职能会话、任务别名、按工程存会话配置、回执收件箱与已读位置、安检模型层、队列派发与自动合入、删聊天位、沙盒装依赖灌数据起预览、OS 级隔离（B-017 另立片，裁决 8：这一片接受没有，只收紧环境白名单、会话凭据、不按地址放行三样）、合入审批与历史改写、上下文压缩、令牌统计与选模型。

## 遗留（不阻塞本片，记在案）

- SSE 穿反向代理：响应头带了 `X-Accel-Buffering: no`，但新仓的部署配置还没落；配置落地时实弹对一遍长连接。
- 真实域名的端到端（任务书 §11 条款 4）：本机先走回环 + 页面代理，发布前补。
- 合入目标是 `main`：第 6 片若引入开发/预发分支，基线与合入目标跟着改（规格「未确定」已记）。
