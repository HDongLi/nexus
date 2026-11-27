# 设计：第 1 片——登录、会话、应用外壳

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-26 |
| 状态 | 定稿。实现照它做，改动走新的变更 |
| 跟着 | [proposal.md](proposal.md)、[规格：身份与会话](../../spec/identity.md) |

行为以规格为准；这里记它落在哪些文件、哪些表、哪些契约上。

## 形状

```
浏览器 ──会话 cookie──▶ 来源校验 ──▶ 访问闸 ──▶ identity.authenticate(令牌) ──▶ identity_sessions、identity_users
                        （只管写请求）    │                    │
                                         │ 级别不够，回 403      └ 登录、退出、改密各发一条事件到事件日志
                                         └ 公开路由直接放行
```

| 住在哪 | 放什么 |
|---|---|
| `modules/identity` | 四条路由的声明、用例、仓储、三张表、事件、单元测试。照 `modules/system` 的样子长 |
| `apps/api` | 组合根把身份模块接上，访问闸的验证器换成真的；来源校验中间件；请求体不是合法 JSON 时回 400 的中间件；建账号的脚本；配置里加两项；集成测试和契约测试 |
| `packages/contracts` | `CurrentUser` 的形状；事件名允许三段 |
| `packages/http-kit` | 上下文变量 `user`，和取它的 `requireUser`；会话 cookie 的名字；请求的协议 |
| `apps/web` | 登录页、应用外壳、用户菜单、改密对话框、主题切换、端到端 |

## 契约

| 方法与路径 | 访问级别 | 作用 | 成功 | 失败 |
|---|---|---|---|---|
| `POST /api/v1/auth/login` | public | 口令登录 | 200 `{ user }`，`Set-Cookie` 下发会话 | 400 `invalid_request`；401 `auth_invalid_credentials`；403 `auth_account_disabled`、`csrf_origin_mismatch`；429 `auth_locked_out` |
| `GET /api/v1/auth/me` | user | 现在是谁 | 200 `{ user }` | 401 `auth_required` |
| `POST /api/v1/auth/logout` | user | 退出 | 200 `{ ok: true }`，清掉 cookie | 401 `auth_required`；403 `csrf_origin_mismatch` |
| `POST /api/v1/auth/password` | user | 本人改密 | 200 `{ ok: true }`，下发新的会话 cookie，当前会话不中断 | 400 `auth_password_too_weak`（最先查）、`auth_current_password_wrong`、`auth_password_reused`；401 `auth_required`；403 `csrf_origin_mismatch`；429 `auth_locked_out` |

`csrf_origin_mismatch` 来自应用层的来源校验：它管全部写请求，不分访问级别，所以登录这条公开路由也会回它（规格 I-35）。429 的 `details` 里带 `retryAfterSeconds`。四条路由都另外声明了 500 `internal_error`。

请求和响应的形状：

```ts
loginRequest    = { username: string /* 1 到 64 个字符 */, password: string /* 1 到 128 */ }
passwordRequest = { currentPassword: string /* 1 到 128 */, newPassword: string /* 1 到 128 */ }
user            = { id: string, username: string, displayName: string, isAdmin: boolean }
meResponse      = { user }
okResponse      = { ok: true }
```

登录直接把人带回来，页面不用再问一次「我是谁」。`id` 是别的模块记录「这件事是谁做的」时用的编号。响应里永远没有口令散列、盐、令牌本身（缺陷 B-002）。

`GET /api/v1/system/info` 声明的失败里去掉 501。

## 表

模块拥有三张表，定义在 `modules/identity/schema.ts`，迁移由 `pnpm --filter @nexus/api db:generate` 生成到 `apps/api/drizzle/`。

| 表 | 列 | 说明 |
|---|---|---|
| `identity_users` | `id` uuid 主键、`username`、`display_name`、`password_hash`、`is_admin`、`disabled_at`、`password_changed_at`、`created_at`、`updated_at` | `username` 按原样保存，不允许两个用户名只差大小写（`lower(username)` 上一个唯一索引）。`password_hash` 为空就是账号没有口令。`disabled_at` 为空就是启用 |
| `identity_sessions` | `id` uuid 主键、`user_id` 外键、`token_hash`、`created_at`、`last_seen_at`、`expires_at` | `token_hash` 唯一。删用户时级联删除。退出时删行，不留吊销标记。`last_seen_at` 只在续期时更新：剩余还多的时候不动库 |
| `identity_login_failures` | `username` 主键（小写）、`failure_count`、`window_started_at`、`locked_until` | 锁定状态存库，重启不清零。每次记失败时顺手删掉窗口外的记录 |

## 令牌与散列

- 会话令牌是 32 个字节的随机数，编码成 43 个字符，只出现在 cookie 里。库里存它的 SHA-256。
- 口令用 argon2id 散列，参数是内存 19456 KiB、迭代 2 次、并行 1，写在模块里的一处常量上。`argon2` 这个包自带各平台的预编译件，不需要跑它的安装脚本（2026-11-26 实测）。
- 用户名不存在或账号没有口令时，照样对一份固定的假散列算一遍校验。三种「不对」回同一个状态码、同一个错误码、同一句话。

## 会话

- 有效期 30 天。带着有效会话的请求进来时，剩余不足 15 天才续期并重发 cookie；剩余还多的时候不动库。
- 退出：删掉当前这一行。改密：删掉这个人的其它全部会话，当前会话换一个新令牌。
- 登录时顺手删掉已经过期的会话行，不另起后台线程（实弹条款 15）。

## 锁定

只有一把键：提交的用户名，不分大小写。15 分钟内失败 5 次，从第 5 次起锁 15 分钟。锁定期间不验口令，回 429，`details.retryAfterSeconds` 是还要等的秒数。

改密时旧口令不对，也算一次失败；这个用户名处于锁定时，改密同样回 429。登录成功删掉这个用户名的失败记录。

阈值和时长是模块里的常量。测试不真等：模块收一个时钟，拨表就行。

## cookie

名字是 `nexus_session`（契约里已经声明）。属性：`HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age=2592000`，不写 `Domain`。请求的协议是 https 时加 `Secure`：进程自己不终结 TLS，协议看 `X-Forwarded-Proto` 的最后一跳，没有这个头就是 http。

`Path=/` 不能省。省了，浏览器会把 cookie 的作用范围缩到下发它的那个目录，别的接口永远拿不到（旧系统的实弹事故）。

## 访问闸

`apps/api` 里的验证器换成真的，`src/verify.ts`（回 501 的占位）删掉。每个需要登录的请求走这几步：

1. cookie 里没有令牌：401 `auth_required`。
2. 令牌找不到对应的会话，或会话已过期：401 `auth_required`。
3. 账号已停用：删掉这条会话，401 `auth_required`。停用账号的用例本来就会在同一个事务里删光它的会话，这一步是兜底。
4. 把 `CurrentUser` 放进上下文变量 `user`。访问级别是 `admin` 而这个人不是管理员：403 `auth_forbidden`。

模块里取当前用户用 `requireUser(c)`。它只在声明成 `user`、`admin` 的路由上有值；在没有登录人的路由上调用它是接线错误，直接抛，回 500 并留下日志，不说成「没登录」回 401。

## 来源校验

跨站请求伪造靠两样东西挡：`SameSite=Lax`，加上对写请求的来源校验。后者是一条中间件，挂在 `/api/v1/*` 上、访问闸之前，只管 `GET`、`HEAD`、`OPTIONS` 以外的方法，不分访问级别：

- 请求带 `Origin`：它必须等于系统对外的地址，否则 403 `csrf_origin_mismatch`。`Origin: null` 也拒绝。
- 请求不带 `Origin`：放行。命令行、代理、测试不是浏览器，它们的 cookie 不会被别的页面自动带上。
- 对外的地址：配置项 `PUBLIC_ORIGIN` 优先；没配时，协议取请求的协议，主机取 `Host` 头。两边都按地址解析后比较，默认端口折算。

开发时页面服务转给后端不改写主机名，所以不用配置也对得上。

## 配置

都在 `apps/api/src/config.ts` 里读。

| 变量 | 缺省 | 作用 |
|---|---|---|
| `PUBLIC_ORIGIN` | 不填 | 对外地址，形如 `https://nexus.example.com`，不带路径。生产必填，填了就在启动时校验 |
| `PASSWORD_MIN_LENGTH` | `8` | 口令最短长度，取值 1 到 128，越界启动即失败 |

来源地址只写进事件，不参与任何判断：有 `X-Real-IP` 头就是它，没有就是连接的对端地址。

## 事件

都走事件日志，`source` 是 `identity`，`subject` 是用户名。请求里发的事件带 `traceId`，等于该请求的请求号；和同一次请求的写入在同一个事务里。登录成功、退出、改密成功这三个由人触发的写事件，payload 里都带 `userId`（当事人的账号编号）：用户名以后可能允许改，编号才是不变的。

| 事件 | 什么时候 | payload |
|---|---|---|
| `identity.login.succeeded` | 登录成功 | `{ userId, ip }` |
| `identity.login.failed` | 口令不对、锁定中被拒、停用账号口令正确 | `{ ip, reason }`，`reason` 是 `invalid_credentials`、`locked_out`、`account_disabled` 之一。`subject` 是提交上来的用户名。不带 `userId`：失败时未必有这个人 |
| `identity.logout` | 退出成功 | `{ userId, ip }` |
| `identity.password.changed` | 改密成功 | `{ userId, ip, revokedSessions }` |
| `identity.user.created` | 命令行建号成功 | `{ userId, isAdmin, via: "cli" }` |

payload 里不许有口令、散列、盐、令牌，键只有表里列的这些（规格 I-40）。契约里的事件名原先只认「模块.动作」两段，现在允许「模块.对象.动作」三段，两段的照旧合法。

## 建账号

库是空的时候没有任何人能登录，所以有一条命令：在 `apps/api` 下运行 `node src/scripts/create-user.ts --username <用户名> --admin --password-stdin`，口令从标准输入读第一行。`--admin` 可选。

它和正式进程读同一份配置（`DATA_DIR` 或 `DATABASE_URL`），自己跑迁移。用户名已存在、不合规，口令太短，标准输入是空的，都以非零退出码结束，原因写在标准错误，不写库。成功时标准输出一行 `created <用户名>`，并记一条 `identity.user.created`。口令不进命令行参数，不进日志。

用法不对（没带 `--password-stdin`、没给 `--username`）打印用法，退出码 2，不读标准输入，也不碰库。进程内的库一次只能被一个进程打开：服务还在跑的时候建号，脚本开库之前就拒，说清先停服务，否则它会照样打印「created」，服务却认不出这个账号。

端到端也用它准备测试账号。

## 页面

| 路由 | 要不要登录 | 内容 |
|---|---|---|
| `/login` | 不要 | 居中一张卡：标志、「登录到 nexus」、用户名、口令、登录按钮。失败原因常显在卡里 |
| 其余页面 | 要 | 侧栏加内容区。侧栏底部是当前用户，点开有「改密」「退出登录」；侧栏顶部一个按钮切换浅色、深色、跟随系统 |
| 改密对话框 | 要 | 旧口令、新口令、重复新口令。自绘的对话框，不用浏览器原生的 |

没登录时访问任何要登录的页面，都转到 `/login`，登录后回到原来要去的页面。只接受站内的相对路径。

## 验证

| 验的是什么 | 在哪一层 |
|---|---|
| 散列、锁定规则、cookie 属性、用例的顺序和结果、事件名、判定来源校验的函数、配置的取值范围 | 单元测试，不碰数据库：`modules/identity/*.test.ts`、`apps/api/src/*.test.ts`、`apps/api/src/http/origin-guard.test.ts` |
| 登录、退出、改密、停用、锁定各自的回应，和库里的状态（读库的断言） | 集成测试，整条竖切：`apps/api/src/identity-*.integration.test.ts` |
| 访问闸：没有 cookie、错 cookie、过期、停用、级别不够 | 集成测试：`apps/api/src/access-guard.integration.test.ts` |
| 来源校验：对、错、`null`、不带、端口不同 | 单元测试判定函数，集成测试走真路由（`apps/api/src/origin.integration.test.ts`） |
| 响应形状里没有散列和盐 | 契约测试扫接口文档（`apps/api/src/identity-contract.test.ts`）；集成测试看每个回应的正文 |
| 令牌在库里存的是散列 | 集成测试直接查表 |
| 建账号脚本：空库上建管理员、四种拒绝、用法不对 | 集成测试起真进程跑它：`apps/api/src/create-user*.integration.test.ts` |
| 真浏览器：没登录被转走、口令错提示常显、登录后看到启动信息、退出回到登录页、改密后旧口令失效；`/api/v1/system/info` 不带会话 401、带会话 200 | 端到端（下一张卡） |

细目见规格每条要求的「验收」一列。

## 实现时对照规格改对的（2026-11-27，任务卡 T-0012）

都是这份文档和规格不一致的地方，以规格为准：

- 事件的 payload 照规格的事件表：`login.succeeded`、`logout` 是 `userId`、`ip`，`password.changed` 是 `userId`、`ip`、`revokedSessions`。其中 `userId` 是规格在 2026-11-27 补的（由人触发的写事件都带操作者编号）。原稿在 `login.succeeded` 里多写的 `via: "password"` 不在表里，不发（规格 I-40：键只有表里列的）。
- 契约表补上三条写路由的 403 `csrf_origin_mismatch`（规格 I-35：来源校验不分访问级别），改密的三个 400 标明了先查哪个（I-32）。
- `password_hash` 可以为空：规格 I-10 的「账号没有口令」就是它。`last_seen_at` 只在续期时更新（I-22：剩余还多的时候不动库）。
- 验证表写明了测试实际在哪：集成测试要打真路由，离不开应用层的访问闸和来源校验，所以和契约测试一起住在 `apps/api/src/`；模块里只有单元测试。

## 规格和设计都没写到、实现时定下的（同日）

- 查用户名不分大小写。锁定的键不分大小写，两个用户名又不许只差大小写，登录时 `Alice` 找得到 `alice`。
- 失败记录「先占位、再加行锁」再计数。「读、加一、写」分三步，并发下会丢数，连错的次数就数不到 5。
- 事件发出之前先校验 payload 的形状：多一个键当场抛，不让夹带口令、散列的事件落库。
- 声明了 JSON 请求体的路由，正文不是合法 JSON、或者没标成 JSON 时回 400 `invalid_request`。交给框架的话，前者是一句纯文本，后者是契约里没有的 415。
- `bind()` 让处理函数可以回 `fail()` 的 `Response`。成功回应照旧按路由声明查类型。
- 会话 cookie 的名字、请求的协议（`X-Forwarded-Proto` 的最后一跳）放在 `http-kit`：身份模块和应用层的访问闸、来源校验都要用。
- 启动时的接线抽成 `compose.ts` 和 `database.ts`，集成测试和启动走同一份，不各写一遍。
- 建账号脚本：用法不对退出码 2，和「被拒」的 1 分开；口令超过 128 个字符也拒；口令最短长度读的是同一个配置项；脚本不写任何日志。
- `PUBLIC_ORIGIN` 填了空串按没填处理，末尾多一个斜杠照常接受。
