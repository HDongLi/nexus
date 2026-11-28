# 模块卡：身份与会话（identity）

| 项 | 内容 |
|---|---|
| 名字 | `@nexus/identity` |
| 一句话 | 口令登录、会话 cookie、登录锁定、本人改密，外加建账号的用例和审计事件 |
| 2026-11-27 | 随开发面重置第 1 片建立。行为以 [规格](../../docs/spec/identity.md) 为准，落在哪见 [设计 01](../../docs/changes/2026-11-26-dev-face/design-01-login.md) |
| 2026-11-28 | 随第 3 片加盖：管账号的八条路由、同事名录、用户组六条；认证结果带上用户组编号。人员那一半以 [人员规格](../../docs/spec/people.md) 为准，落在哪见 [设计 03](../../docs/changes/2026-11-26-dev-face/design-03-people.md) |

## 职责

回答「现在是谁」，外加「账号和用户组由管理员来管」：人员清单、建号、改显示名和管理员位、重置口令、停用启用、删号、同事名录；用户组的建、改名、换成员、删。口令散列、会话的生成与吊销、登录锁定、审计事件都在这里。

访问闸和来源校验住在应用层（`apps/api/src/http/`）：这个模块只交出「令牌换成人（连他所属的组）」的用例和会话 cookie 的属性。锁定的规则、cookie 的属性、事件 payload 的形状这些来由，写在各自的文件里，注释带规格编号。

不管：工程的可见性判断和「哪个组看得见哪些工程」的关系表（那是工程模块的，[人员规格](../../docs/spec/people.md) G-31）；单点登录和跨实例的票；给脚本用的接口令牌；找回口令。

## 公开接口

- `createIdentityModule(deps)` → `{ bindings, service, sessionCookie }`：交给应用挂载的东西。
- `createIdentityService(deps)` → `IdentityService`：只要用例、不要路由的时候用，建账号的脚本就是这么做的。
- 用例：

  | 用例 | 做什么 |
  |---|---|
  | `service.login({ username, password, ip, traceId })` | 登录。顺序是锁定、口令、停用 |
  | `service.authenticate(令牌)` | 访问闸用：令牌换成当前的人**和他所属的用户组编号**；会话过期或账号停用回空；剩余不足 15 天时顺手续期 |
  | `service.logout({ token, ip, traceId })` | 删掉这一条会话 |
  | `service.changePassword({ token, currentPassword, newPassword, ip, traceId })` | 本人改密：吊销其它会话，当前会话换令牌 |
  | `service.createUser({ username, password, isAdmin })` | 命令行建账号（via: cli）。管理员建号走 createAccount，同一个底层 |
  | `service.setDisabled(账号编号, 是否停用)` | 置停用位，不发事件（I-29 的用例）。管账号的停用走 setAccountDisabled，会发事件 |
  | `service.listAccounts()` / `listPeople()` | 人员清单（全部）；同事名录（只列启用），都按用户名升序 |
  | `service.getAccount(编号)` / `createAccount(…)` / `updateAccount(…)` | 查、建、改（显示名和管理员位） |
  | `service.resetAccountPassword(…)` | 重置口令：换散列、删光这个账号的会话，操作者的会话不动 |
  | `service.setAccountDisabled({ operatorId, userId, disabled, … })` | 停用/启用，带操作者和事件 |
  | `service.deleteAccount({ operatorId, userId, … })` | 删号；建过工程的回 `has_projects`（库拒绝翻译来的） |
  | `service.listGroups()` / `getGroup(编号)` / `groupExists(编号)` | 组的读；`groupExists` 是对工程模块的唯一公开查询（G-31） |
  | `service.createGroup(…)` / `renameGroup(…)` / `replaceGroupMembers(…)` / `deleteGroup(…)` | 组的写 |

- `sessionCookie.set(c, 令牌)`、`sessionCookie.clear(c)`：cookie 的属性只有这一份，访问闸续期之后也从这里拿。
- `authErrorCodes`：身份这件事的九个失败码。`identityErrorCodes`：管账号、管组的五个失败码（`identity_username_taken`、`identity_group_name_taken`、`identity_last_admin`、`identity_self_change`、`identity_user_has_projects`）。应用层的访问闸和来源校验从这两张表拿，不另写字面量。
- `identityUsers`、`identityGroups`：账号表和用户组表的定义，随出口导出。只给别的模块建引用约束用：工程模块的 `projects.created_by_id` 指向账号表（`ON DELETE RESTRICT`，建过工程的账号因此删不掉）。别的模块不在它们上面读写数据；要读账号，走用例。
- 依赖全部由创建函数传进来：数据库、仓储、事件日志、口令最短长度。`now` 拨表，`password` 换成计数桩，测试靠这两样不真等、不真算。
- 路由（声明按片拆：`routes.ts` 登录会话四条，`account-routes.ts` 管账号八条加同事名录，`group-routes.ts` 用户组六条；只依赖 `@nexus/http-kit`、`zod` 和纯规则的 `names.ts`）：

  | 方法与路径 | 访问级别 | 作用 |
  |---|---|---|
  | `POST /api/v1/auth/login` | public | 口令登录。成功直接把人带回来，会话在 HttpOnly cookie 里 |
  | `GET /api/v1/auth/me` | user | 我是谁，恰好四个键 |
  | `POST /api/v1/auth/logout` | user | 退出。删会话，清 cookie |
  | `POST /api/v1/auth/password` | user | 本人改密。下发新的会话 cookie，不用重新登录 |
  | `GET /api/v1/users` | admin | 人员清单。全部账号，停用的也在内 |
  | `POST /api/v1/users` | admin | 建号。没有占位号：一律要口令 |
  | `GET /api/v1/users/{userId}` | admin | 查一个账号 |
  | `PATCH /api/v1/users/{userId}` | admin | 改显示名和管理员位。至少带一个 |
  | `POST /api/v1/users/{userId}/password` | admin | 重置口令。给自己重置回 409 |
  | `POST /api/v1/users/{userId}/disable` | admin | 停用。同一个事务里删光会话 |
  | `POST /api/v1/users/{userId}/enable` | admin | 启用。不恢复任何会话 |
  | `DELETE /api/v1/users/{userId}` | admin | 删号。建过工程的删不掉 |
  | `GET /api/v1/people` | user | 同事名录。只列启用，四个键，非管理员也调得通 |
  | `GET /api/v1/groups` | admin | 用户组清单，创建早的在前 |
  | `POST /api/v1/groups` | admin | 建组。组名不分大小写全平台唯一 |
  | `GET /api/v1/groups/{groupId}` | admin | 查一个组 |
  | `PATCH /api/v1/groups/{groupId}` | admin | 改组名 |
  | `PUT /api/v1/groups/{groupId}/members` | admin | 整体替换成员 |
  | `DELETE /api/v1/groups/{groupId}` | admin | 删组。不要求是空的 |

  「一个组的可见工程」那两条（`GET/PUT /api/v1/groups/{groupId}/projects`）在工程模块：关系表是它的（G-31）。

## 文件

| 文件 | 放什么 |
|---|---|
| `index.ts` | 唯一出口：登录会话的绑定在这里汇，管账号的绑定在 `admin-bindings.ts`，组的在 `group-bindings.ts` |
| `routes.ts`、`account-routes.ts`、`group-routes.ts` | 路由声明，纯数据 |
| `service.ts` | 登录、会话；全部用例的门面 |
| `accounts.ts` | 本人改密、建号（命令行和管理员共用）、置停用位 |
| `admin-accounts.ts` | 管理员管账号：清单、建号、改号、重置口令、停用启用、删号 |
| `admin-guard.ts` | 护栏的帮手：「不动自己」和「会不会失去最后一个启用的管理员」 |
| `groups.ts` | 用户组的用例，加「组在不在」的公开查询 |
| `names.ts` | 用户名、显示名、组名的规则（纯规则，路由声明和用例校验共用） |
| `shared.ts` | 依赖和结果的形状、几个用例共用的帮手（发事件、记失败） |
| `repo.ts`、`schema.ts` | 这个模块唯一写 SQL 的地方，和五张表 |
| `password.ts`、`tokens.ts`、`lockout.ts`、`cookies.ts` | 口令散列、令牌、锁定规则、cookie 属性，各自一个文件 |
| `events.ts`、`group-events.ts`、`codes.ts` | 登录会话与账号的事件、用户组的事件；两组失败码 |
| `testing/fake.ts` | 单元测试用的内存替身 |

## 事件

都走事件日志，`source` 是 `identity`，请求里发的带 `traceId`（等于该请求的请求号）。登录会话的 `subject` 是用户名；用户组四个事件的 `subject` 是组编号。要写库的事件和写入在同一个事务里。发出去之前先过 payload 的形状：多一个键当场抛，不让夹带口令、散列、盐的事件落库。

| 事件 | 什么时候发 | subject | payload |
|---|---|---|---|
| `identity.login.succeeded` | 登录成功 | 用户名 | `userId`、`ip` |
| `identity.login.failed` | 用户名或口令不对、锁定中被拒、停用账号口令正确 | 用户名 | `ip`、`reason`。不带 `userId` |
| `identity.logout` | 退出成功 | 用户名 | `userId`、`ip` |
| `identity.password.changed` | 改密成功 | 用户名 | `userId`、`ip`、`revokedSessions` |
| `identity.user.created` | 建号成功（脚本 via: cli；管理员 via: admin 另带 actorId） | 用户名 | `userId`、`isAdmin`、`via`、`actorId?` |
| `identity.user.updated` | 显示名或管理员位真的变了 | 用户名 | `userId`、`actorId`、`changes` |
| `identity.user.password.reset` | 管理员重置口令 | 用户名 | `userId`、`actorId`、`revokedSessions` |
| `identity.user.disabled` / `identity.user.enabled` | 停用 / 启用 | 用户名 | `userId`、`actorId` |
| `identity.user.deleted` | 删号 | 用户名 | `userId`、`actorId`、`groupIds`（删前他在哪些组） |
| `identity.group.created` | 建组 | 组编号 | `groupId`、`actorId`、`name` |
| `identity.group.renamed` | 组名真的变了 | 组编号 | `groupId`、`actorId`、`changes` |
| `identity.group.members.changed` | 成员真的变了 | 组编号 | `groupId`、`actorId`、`changes`（from/to 全量） |
| `identity.group.deleted` | 删组 | 组编号 | `groupId`、`actorId`、`name`、`memberCount` |

订阅：无。

## 拥有的表

| 表 | 存什么 |
|---|---|
| `identity_users` | 账号。`password_hash` 为空就是没有口令；`lower(username)` 上有唯一索引，两个用户名不许只差大小写 |
| `identity_sessions` | 会话。只存令牌的 SHA-256；退出时删行，不留吊销标记；删账号时级联删 |
| `identity_login_failures` | 登录失败的计数和锁定，存在库里，重启不清零 |
| `identity_groups` | 用户组。`lower(name)` 上有唯一索引，两个组名不许只差大小写 |
| `identity_group_members` | 组的成员关系。组和账号删了它随外键一起没（G-22、G-30）；`user_id` 上另有索引，认证按人取组用 |

## 规格没写到、实现时定下的

- **「用户名已被占用」沿 cause 链判定。** drizzle 把数据库的错包了一层，SQLSTATE 在 cause 上；只看最外层的话，并发建同名账号的输家会拿到 500 而不是 409。判定函数住在 `@nexus/db`（`isUniqueViolation`），工程模块同款共用（2026-11-28，工程模块实弹后迁到公共包）。
- **「建过工程的删不掉」认两个错误码。** 这套进程内的库基于新版的 Postgres，`ON DELETE RESTRICT` 被拒绝报 23001，老版本报 23503；只认一个就会把 409 翻译成 500。判定函数 `isForeignKeyViolation` 也住 `@nexus/db`（2026-11-28）。
- **护栏的两道 409 都命中时（最后一个管理员动自己），数量那道闸先说。** 走得到路由的操作者只能是管理员；系统只剩一个启用的管理员时，他动自己同时命中「失去最后一个」和「动自己」。`identity_last_admin` 先回，才让五个失败码在集成测试里都打得到（规格 G-04）；「不动自己」的四个动作在有两个启用的管理员的场景里验（2026-11-28 实现定下）。两道闸都在写库的同一个事务里，先数再写（规格 G-20）。
- **并发下互相降级**：真 Postgres 上两个会话同时降对方，恰有一个 200、一个 409——进程内的库一次只跑一个事务，造不出来，集成测试只盖串行场景（规格 G-20、[人员规格](../../docs/spec/people.md)「未确定」）。
- **写用例的行读取都在事务里（2026-11-29 审查 D-01 后定下）。** 事务外的快照在真库并发下会旧：事件的 `changes.from`、降级判定、护栏吃的目标行和返回值都以事务里读到的那次为准。读到与写下之间再有并发提交的残余窗口接受——显示名类改动没有行锁可依托，属审计精度不是权限口子；进程内的库串行跑事务，集成测试盖不到这条。
- **查用户名和组名不分大小写。** 用户名的键不分大小写（锁定），用户名和组名又都不许只差大小写，所以登录时 `Alice` 找得到 `alice`，建组查重也是小写比。
- **显示名和组名存的是去掉首尾空白之后的值。** 规格只说「去掉首尾空白后」要合规则；「没变就不动」（G-13、G-29）比的也是存下来的值。工程模块的显示名同一条（2026-11-27）。
- **停用/启用已是目标状态时回 200 不写不发。** 规格的 G-39 只点了三处「没变不发」，但停用已是停用的账号写不出区别，照「没变就不动」（G-13 的原则）办（2026-11-28 实现定下）。
- **失败记录「先占位、再加行锁」。** 「读、加一、写」分三步的话，并发下会丢数（`repo.ts` 的 `lock`）。清理窗口外的记录时，不等别的请求锁着的行（`prune`）。
- **`last_seen_at` 只在续期时更新。** 每个请求都写它，等于给每个读请求加一次写。
- **建账号的脚本不看库被谁占着就写，会打印「created」而服务认不出这个账号。** 进程内的库一次只能被一个进程打开，脚本开库之前先看数据目录里有没有 `postmaster.pid`，有就拒。
- **认证结果里的组一次取来。** `authenticate` 顺手查一次「这个人属于哪些组」（一次查询），放进请求上下文；路由和别的模块从上下文拿，不再各问一遍（G-34）。

## 不做什么

- 不验 `Authorization` 头。这一片只有浏览器会话。
- 不认旧系统的散列，不试旧算法：存的不是 argon2id 就按口令不对处理。
- 不按来源地址计数或锁定。来源地址靠代理头带进来，可以伪造。
- 不做找回口令、会话列表、锁定开关、改用户名、占位号、超管、按工程的角色。
- 不管「哪个组看得见哪些工程」：关系表归工程模块，这边连查询都不提供（`groupExists` 只答「组在不在」，G-31）。
- 不自己读环境变量、不自己起线程。配置由应用读，过期的会话行在下次登录时顺手删。
