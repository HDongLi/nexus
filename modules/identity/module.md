# 模块卡：身份与会话（identity）

| 项 | 内容 |
|---|---|
| 名字 | `@nexus/identity` |
| 一句话 | 口令登录、会话 cookie、登录锁定、本人改密，外加建账号的用例和审计事件 |
| 2026-11-27 | 随开发面重置第 1 片建立。行为以 [规格](../../docs/spec/identity.md) 为准，落在哪见 [设计 01](../../docs/changes/2026-11-26-dev-face/design-01-login.md) |

## 职责

回答「现在是谁」。四条路由和它们底下的东西都在这里：口令散列、会话的生成与吊销、登录锁定、审计事件，外加一个建账号的用例。

访问闸和来源校验住在应用层（`apps/api/src/http/`）：这个模块只交出两样东西给它们，一是「令牌换成人」的用例，二是会话 cookie 的属性。锁定的规则、cookie 的属性、事件 payload 的形状这些来由，写在各自的文件里，注释带规格编号。

不管：用户组与工程授权、建号改号的界面和路由（第 3 片）、单点登录和跨实例的票、给脚本用的接口令牌、找回口令。

## 公开接口

- `createIdentityModule(deps)` → `{ bindings, service, sessionCookie }`：交给应用挂载的东西。
- `createIdentityService(deps)` → `IdentityService`：只要用例、不要路由的时候用，建账号的脚本就是这么做的。
- 用例：

  | 用例 | 做什么 |
  |---|---|
  | `service.login({ username, password, ip, traceId })` | 登录。顺序是锁定、口令、停用 |
  | `service.authenticate(令牌)` | 访问闸用：令牌换成当前的人；会话过期或账号停用回空；剩余不足 15 天时顺手续期 |
  | `service.logout({ token, ip, traceId })` | 删掉这一条会话 |
  | `service.changePassword({ token, currentPassword, newPassword, ip, traceId })` | 本人改密：吊销其它会话，当前会话换令牌 |
  | `service.createUser({ username, password, isAdmin })` | 建账号。四种拒绝都回理由，不写库 |
  | `service.setDisabled(账号编号, 是否停用)` | 置停用位；同一个事务里删光这个账号的会话 |

- `sessionCookie.set(c, 令牌)`、`sessionCookie.clear(c)`：cookie 的属性只有这一份，访问闸续期之后也从这里拿。
- `authErrorCodes`：身份这件事的九个失败码。应用层的访问闸和来源校验从这里拿，不另写字面量。
- `identityUsers`：账号表的定义，2026-11-27 起随出口导出。只给别的模块建引用约束用：工程模块的 `projects.created_by_id` 指向它（`ON DELETE RESTRICT`，建过工程的账号因此删不掉）。别的模块不在它上面读写数据；要读账号，走用例。
- 依赖全部由创建函数传进来：数据库、仓储、事件日志、口令最短长度。`now` 拨表，`password` 换成计数桩，测试靠这两样不真等、不真算。
- 路由（声明在 `routes.ts`，只依赖 `@nexus/http-kit` 和 `zod`）：

  | 方法与路径 | 访问级别 | 作用 |
  |---|---|---|
  | `POST /api/v1/auth/login` | public | 口令登录。成功直接把人带回来，会话在 HttpOnly cookie 里 |
  | `GET /api/v1/auth/me` | user | 我是谁，恰好四个键 |
  | `POST /api/v1/auth/logout` | user | 退出。删会话，清 cookie |
  | `POST /api/v1/auth/password` | user | 本人改密。下发新的会话 cookie，不用重新登录 |

## 文件

| 文件 | 放什么 |
|---|---|
| `index.ts` | 唯一出口：把路由声明绑到用例上 |
| `routes.ts` | 四条路由的声明，纯数据 |
| `service.ts` | 登录、会话（认令牌、续期、退出） |
| `accounts.ts` | 改密、建号、停用 |
| `shared.ts` | 依赖和结果的形状、几个用例共用的帮手（发事件、记失败） |
| `repo.ts`、`schema.ts` | 这个模块唯一写 SQL 的地方，和三张表 |
| `password.ts`、`tokens.ts`、`lockout.ts`、`cookies.ts` | 口令散列、令牌、锁定规则、cookie 属性，各自一个文件 |
| `events.ts`、`codes.ts` | 五个事件和它们 payload 的形状；九个失败码 |
| `testing/fake.ts` | 单元测试用的内存替身 |

## 事件

都走事件日志，`source` 是 `identity`，`subject` 是用户名，请求里发的带 `traceId`（等于该请求的请求号）。登录成功、退出、改密成功这三个由人触发的写事件，payload 里都带 `userId`（当事人的账号编号）：用户名以后可能允许改，编号才是不变的，别的模块对账、审计查询都用它。要写库的事件和写入在同一个事务里。发出去之前先过 `events.ts` 里的形状：多一个键当场抛，不让夹带口令、散列、盐的事件落库。

| 事件 | 什么时候发 | payload |
|---|---|---|
| `identity.login.succeeded` | 登录成功 | `userId`、`ip` |
| `identity.login.failed` | 用户名或口令不对、锁定中被拒、停用账号口令正确 | `ip`、`reason`。不带 `userId`：失败时未必有这个人 |
| `identity.logout` | 退出成功 | `userId`、`ip` |
| `identity.password.changed` | 改密成功 | `userId`、`ip`、`revokedSessions` |
| `identity.user.created` | 命令行建号成功 | `userId`、`isAdmin`、`via` |

订阅：无。

## 拥有的表

| 表 | 存什么 |
|---|---|
| `identity_users` | 账号。`password_hash` 为空就是没有口令；`lower(username)` 上有唯一索引，两个用户名不许只差大小写 |
| `identity_sessions` | 会话。只存令牌的 SHA-256；退出时删行，不留吊销标记；删账号时级联删 |
| `identity_login_failures` | 登录失败的计数和锁定，存在库里，重启不清零 |

## 规格没写到、实现时定下的

- **「用户名已被占用」沿 cause 链判定。** drizzle 把数据库的错包了一层，SQLSTATE 在 cause 上；只看最外层的话，并发建同名账号的输家会拿到 500 而不是 409。判定函数住在 `@nexus/db`（`isUniqueViolation`），工程模块同款共用（2026-11-28，工程模块建短名的并发实弹迁过来的）。进程内的库一次只跑一个事务，造不出真并发，这条没有专门的用例。
- **查用户名不分大小写。** 锁定的键不分大小写，两个用户名又不许只差大小写，所以登录时 `Alice` 找得到 `alice`。
- **失败记录「先占位、再加行锁」。** 「读、加一、写」分三步的话，并发下会丢数，连错的次数就数不到 5（`repo.ts` 的 `lock`）。
- **清理窗口外的记录时，不等别的请求锁着的行。** 每次记失败都顺手扫全表；真库上两个请求各锁着一行、又都去删对方的，会互相等死。跳过的那几行留给下一次失败去删（`repo.ts` 的 `prune`）。这两条是读码推演出来的：进程内的库一次只跑一个事务，测试里造不出真正的并发。
- **`last_seen_at` 只在续期时更新。** 每个请求都写它，等于给每个读请求加一次写。
- **建账号的脚本不看库被谁占着就写，会打印「created」而服务认不出这个账号。** 进程内的库一次只能被一个进程打开，脚本开库之前先看数据目录里有没有 `postmaster.pid`，有就拒。

## 不做什么

- 不验 `Authorization` 头。这一片只有浏览器会话。
- 不认旧系统的散列，不试旧算法：存的不是 argon2id 就按口令不对处理。
- 不按来源地址计数或锁定。来源地址靠代理头带进来，可以伪造。
- 不做找回口令、会话列表、锁定开关、改用户名。
- 不自己读环境变量、不自己起线程。配置由应用读，过期的会话行在下次登录时顺手删。
