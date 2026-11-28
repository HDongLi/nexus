# 设计：第 3 片——人员与用户组

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-27 |
| 状态 | 定稿（2026-11-28，对着第 2 片落地的真实文件名定稿）。实现照它做，改动走新的变更 |
| 跟着 | [proposal.md](proposal.md)、[规格：人员与用户组](../../spec/people.md)、[规格：工程](../../spec/projects.md)（P-10、P-12、P-29） |

行为以规格为准；这里记它落在哪些文件、哪些表、哪些契约上。

## 形状

```
管理员 ──▶ 访问闸 ──▶ identity 模块 ──┬──▶ identity_users、identity_sessions
                         │             ├──▶ identity_groups、identity_group_members
                         │             └──▶ 事件日志
                         └──▶ projects 模块 ──┬──▶ projects（创建者 → identity_users，不许删）
                                                 ├──▶ project_groups（组 → identity_groups，随组删）
                                                 └──▶ 事件日志

每个请求：identity.authenticate ──▶ { user, groupIds } ──▶ 请求上下文 ──▶ projects 的可见性判定、建工程时挂组
```

| 住在哪 | 放什么 |
|---|---|
| `modules/identity` | `schema.ts` 加两张表（组、成员）；账号的管理用例、用户组的用例各自成文件；`routes.ts` 加十五条路由（账号八条、同事名录一条、用户组六条）；`events.ts` 加十个事件；`index.ts` 加「用户组在不在」的公开查询。单文件超 400 行就拆（铁律 8） |
| `modules/projects` | `schema.ts` 加关系表 `project_groups`；`repo.ts` 加关系的读写和可见性过滤；`routes.ts` 加两条（一个组的可见工程：读、整体替换）；`events.ts` 加 `projects.visibility.changed`；`create.ts` 建工程的事务里挂组；`service.ts` 的可见性判定换成带用户组的实现 |
| `packages/http-kit` | 请求上下文多一样：当前用户的用户组编号 |
| `apps/api` | 认证器（`src/http/identity-verifier.ts`）把认证结果里的用户组编号放进上下文；组合根 `src/compose.ts` 把「用户组在不在」的查询接到工程模块上 |
| `apps/web` | 人员页、用户组页；工程页上创建者的显示回落（T-0026） |

两个模块之间只有「工程 → 身份」一个方向（规格 G-31）：表定义上的引用约束，加运行时一个公开查询。身份模块对工程一无所知。

## 契约

### 账号（身份模块，八条，都是 admin）

| 方法与路径 | 请求体 | 成功 | 失败 |
|---|---|---|---|
| `GET /api/v1/users` | 无 | 200 `{ accounts: Account[] }`，用户名升序 | 401、403 |
| `POST /api/v1/users` | `{ username, password, displayName?, isAdmin? }` | 201 `{ account }` | 400 `invalid_request`、`auth_password_too_weak`；409 `identity_username_taken` |
| `GET /api/v1/users/{userId}` | 无 | 200 `{ account }` | 404 |
| `PATCH /api/v1/users/{userId}` | `{ displayName?, isAdmin? }`，至少一个 | 200 `{ account }` | 400；404；409 `identity_self_change`、`identity_last_admin` |
| `POST /api/v1/users/{userId}/password` | `{ newPassword }` | 200 `{ ok: true }` | 400 `auth_password_too_weak`；404；409 `identity_self_change` |
| `POST /api/v1/users/{userId}/disable` | 无 | 200 `{ account }` | 404；409 `identity_self_change`、`identity_last_admin` |
| `POST /api/v1/users/{userId}/enable` | 无 | 200 `{ account }` | 404 |
| `DELETE /api/v1/users/{userId}` | 无 | 200 `{ ok: true }` | 404；409 `identity_self_change`、`identity_last_admin`、`identity_user_has_projects` |

`Account` 七个键：`{ id, username, displayName, isAdmin, isDisabled, createdAt, passwordChangedAt }`。建号时 `displayName` 没给就是用户名，`isAdmin` 没给就是否。请求体一律是严格对象：多一个键回 400。

### 同事名录（身份模块，一条，user）

| `GET /api/v1/people` | 无 | 200 `{ people: User[] }`，只列启用的，用户名升序 | 401 |
|---|---|---|---|

`User` 是身份规格的四个键。

### 用户组（身份模块，六条，都是 admin）

| 方法与路径 | 请求体 | 成功 | 失败 |
|---|---|---|---|
| `GET /api/v1/groups` | 无 | 200 `{ groups: Group[] }`，创建早的在前 | 401、403 |
| `POST /api/v1/groups` | `{ name, memberIds? }` | 201 `{ group }` | 400；409 `identity_group_name_taken` |
| `GET /api/v1/groups/{groupId}` | 无 | 200 `{ group }` | 404 |
| `PATCH /api/v1/groups/{groupId}` | `{ name }` | 200 `{ group }` | 400；404；409 `identity_group_name_taken` |
| `PUT /api/v1/groups/{groupId}/members` | `{ userIds }` | 200 `{ group }` | 400；404 |
| `DELETE /api/v1/groups/{groupId}` | 无 | 200 `{ ok: true }` | 404 |

`Group` 五个键：`{ id, name, memberIds, createdAt, updatedAt }`。

### 一个组的可见工程（工程模块，两条，都是 admin）

| 方法与路径 | 请求体 | 成功 | 失败 |
|---|---|---|---|
| `GET /api/v1/groups/{groupId}/projects` | 无 | 200 `{ projectIds }` | 404（组不存在） |
| `PUT /api/v1/groups/{groupId}/projects` | `{ projectIds }` | 200 `{ projectIds }` | 400（工程编号不存在或重复）；404 |

## 表

| 表 | 归谁 | 列 | 说明 |
|---|---|---|---|
| `identity_groups` | 身份 | `id` uuid 主键、`name`、`created_at`、`updated_at` | `lower(name)` 上有唯一索引：组名不分大小写唯一 |
| `identity_group_members` | 身份 | `group_id`、`user_id`，联合主键 | `group_id` 引用用户组，`user_id` 引用账号，都是 `ON DELETE CASCADE`：删组、删号时成员关系自动没了（规格 G-22、G-30）。`user_id` 上另有索引：每个请求认证时要按人取组 |
| `project_groups` | 工程 | `project_id`、`group_id`，联合主键 | `project_id` 引用工程，`group_id` 引用用户组（身份模块出口导出的表定义），都是 `ON DELETE CASCADE`（规格 G-30、G-31）。`group_id` 上另有索引：按组读可见工程 |

第 2 片已经给 `projects.created_by_id` 建了指向账号表的引用约束（不许删）。这一片只管把库的拒绝翻译成 409。

迁移是一条：`0003`，三张表一起。

## 认证结果带上用户组

`service.authenticate(令牌)` 的结果多一样 `groupIds`（这个人所属的用户组编号，没有就是空数组）。一次查询带出来，不多跑一趟。访问闸把它放进请求上下文 `c.get("groupIds")`；对外的 `me` 还是四个键，不带它（规格 G-34）。

用户组变了，下一个请求就生效：每个请求都重新认证。停用不摘组，所以停用再启用，看得见的工程原样回来（规格 G-17）。

## 护栏

三条规矩，都在写库的那个事务里查（规格 G-18 到 G-20）：

- **不动自己**：路径里的编号等于操作者的编号就回 409 `identity_self_change`。降级、停用、删除、给自己重置口令四个动作。
- **留一个管理员**：改管理员位或停用位之前，`SELECT … FOR UPDATE` 锁住全部「管理员位为真且没停用」的行再数。两个管理员同时互相降级，后到的等前一个提交，再数就是 1 以外的数，回 409 `identity_last_admin`。系统里始终至少有一个启用的管理员，所以总有行可锁，不用占位。
- **建过工程的不删**：直接删，库因为 `projects.created_by_id` 的引用约束拒绝（Postgres 错误码 23503），翻译成 409 `identity_user_has_projects`。不先查后删。

删号的事务：删账号行；会话和成员关系随外键级联；事件里带上删前它在哪些组。

## 用户组

- 组名：去掉首尾空白后 1 到 64 个码点，不含控制字符；存原样；查重用 `lower(name)` 上的唯一索引，撞了回 409 `identity_group_name_taken`。
- 成员：整体替换。先查编号都存在（账号表是自己的），再删再插；和原来一样（不看顺序）就回 200 不写不发。停用的账号也算存在。
- 改名：名字没变回 200 不写不发。
- 删组：不要求是空的。工程模块关系表里的行随外键删掉，没有工程模块的代码参与，也不发工程模块的事件。

## 工程模块这一侧

- **建工程挂组**（规格 G-34）：建工程的事务里，除了工程记录和 `projects.project.created`，按上下文里的 `groupIds` 给 `project_groups` 插行，每个组发一条 `projects.visibility.changed`（`cause: "project_created"`）。一次提交。上下文里没有组就什么都不加。
- **可见性**（规格 G-32）：判定换成带用户组的实现。这一片落地的判定是同步谓词、清单整表读出后逐条问（设计 02「实现实测」记的形状）；带用户组之后数据在库里，判定改为交出一个「范围」给仓储，仓储照它在库里过滤清单；单条的详情和改，再问同一个判定。三种范围：管理员是全部；否则「创建者是我」或者「关系表里有我的任何一个组」。看不见回 404，和不存在一样。范围仍然从构造参数进来，测试换成恒假、恒真。
- **一个组的可见工程**：整体替换。先问身份模块「组在不在」（不在回 404），再查工程编号都存在（不存在的回 400），然后删再插；和原来一样就回 200 不写不发。变了就发 `projects.visibility.changed`（`cause: "admin"`）。读是纯读库，组不在也回 404。
- 「用户组在不在」是身份模块的一个公开查询，身份模块只读自己的表。组合根把它接到工程模块的构造参数上。

## 事件

| 事件 | 归谁 | `subject` | payload |
|---|---|---|---|
| `identity.user.created` | 身份 | 用户名 | `userId`、`isAdmin`、`via`（`cli` 或 `admin`）。`via` 是 `admin` 时带 `actorId` |
| `identity.user.updated` | 身份 | 用户名 | `userId`、`actorId`、`changes` |
| `identity.user.password.reset` | 身份 | 用户名 | `userId`、`actorId`、`revokedSessions` |
| `identity.user.disabled` | 身份 | 用户名 | `userId`、`actorId` |
| `identity.user.enabled` | 身份 | 用户名 | `userId`、`actorId` |
| `identity.user.deleted` | 身份 | 用户名 | `userId`、`actorId`、`groupIds` |
| `identity.group.created` | 身份 | 组编号 | `groupId`、`actorId`、`name` |
| `identity.group.renamed` | 身份 | 组编号 | `groupId`、`actorId`、`changes` |
| `identity.group.members.changed` | 身份 | 组编号 | `groupId`、`actorId`、`changes` |
| `identity.group.deleted` | 身份 | 组编号 | `groupId`、`actorId`、`name`、`memberCount` |
| `projects.visibility.changed` | 工程 | 组编号 | `groupId`、`actorId`、`changes`、`cause`（`admin` 或 `project_created`） |

`changes` 只列真变了的键，每个键带 `from` 和 `to`；成员和可见工程是编号的数组，全量记。事件名过契约包的 `eventName`（三段第 1 片放行，四段这一片放行——`identity.user.password.reset`；五段仍拒，2026-11-29 勘误，见审查 D-02）。

## 文件怎么分

身份模块的管理员用例单独成文件，不往 `service.ts` 里塞：账号的管理（清单、建号、改号、重置口令、停用启用、删号）一个文件，用户组一个文件，护栏的帮手一个文件。路由的绑定按账号、用户组分文件，`index.ts` 只做汇出。事件多了也按账号、用户组分文件。单文件不超过 400 行。

## 页面

| 路由 | 谁能看 | 内容 |
|---|---|---|
| `/people` | 管理员 | 人员清单：用户名、显示名、管理员位、是否停用、建号时间。右上一个「新建账号」。每行的操作：改显示名和管理员位、重置口令、停用或启用、删除 |
| `/groups` | 管理员 | 用户组清单：名字、成员数。右上一个「新建用户组」。点开一个组：改名、成员、可见的工程 |
| 工程页 | 所有登录用户 | 创建者的显示：拿编号去同事名录换名字；查不到显示编号前八位并标「已停用」 |

- 非管理员打开 `/people`、`/groups`：导航里不显示入口；直接输地址，页面显示「需要管理员」的卡片，不发请求。
- 失败常显在行内或卡内。三种 409 让人看得懂是哪一种：「这是最后一个管理员」「不能对自己做这个」「建过工程的账号只能停用」。最后一种出现时，这一行的「删除」换成「停用」（规格 G-24）。
- 删号、删组：两击确认（第一下变成「再点一次确认」，几秒后恢复）。自绘，不用浏览器原生对话框。
- 重置口令：对话框里输两遍新口令，成功后把新口令留给管理员复制（只显示这一次）。
- 用户组卡片的成员和可见工程问两处：成员是身份模块的，可见工程是工程模块的。

## 验证

| 验的是什么 | 在哪一层 |
|---|---|
| 用户名、显示名、组名、数组不重复的规则 | 单元测试，表驱动 |
| 十七条路由的访问级别、路径参数名、响应里没有凭据字段名 | 契约测试 |
| 人员清单、同事名录、建号、改号、重置口令、停用启用（并入身份规格的停用场景） | 集成测试 |
| 护栏：最后一个管理员的三种动作、两种人数；不动自己的四个动作；删建过工程的账号 | 集成测试 |
| 删号：账号、会话、成员关系一起没了；同名可重建 | 集成测试 |
| 用户组：建、改名、换成员、删组（关系表的行跟着没）；不存在的编号回 400 | 集成测试 |
| 认证结果带组；上下文里有组；`me` 不带 | 集成测试 |
| 建工程挂组：建完立刻生效；建仓失败组不变；创建者之后换组不影响已挂的 | 集成测试 |
| 可见性：规格 P-12 的三个场景；移出组立刻看不见；停用再启用恢复 | 集成测试 |
| 一个组的可见工程：读、整体替换、不存在的组和工程、没变不写不发 | 集成测试 |
| 十一个事件的内容、`traceId`、同事务回滚 | 集成测试 |
| 真浏览器：管理员建号后这个人能登录；停用后刷新回到登录页；建组、拉人、挂工程后这个人清单里有；非管理员被挡；三种 409 的文字常显；两击确认 | 端到端（T-0023） |

并发的护栏（两个管理员互相降级）只在真 Postgres 上验，写进模块卡。
