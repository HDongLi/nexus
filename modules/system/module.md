# 模块卡：系统信息（system）

| 项         | 内容                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| 名字       | `@nexus/system`                                                          |
| 一句话     | 健康探测、版本、启动登记                                                 |
| 2026-11-26 | 随骨架建立。它也是模块解剖的样板：路由、用例、仓储、事件、测试各一个文件 |

## 职责

告诉外界「这个进程活着吗、是哪个版本、什么时候起的」。它不认识别的模块的业务，是所有模块里最靠底的一个。

## 公开接口

- `createSystemModule(deps)` → `{ bindings, service }`
- `service.health()`、`service.info()`、`service.recordStart(bootId)`
- 路由（声明在 `routes.ts`，只依赖 `@nexus/http-kit` 和 `zod`）：

| 方法与路径                  | 访问级别 | 作用                         |
| --------------------------- | -------- | ---------------------------- |
| `GET /api/v1/system/health` | public   | 健康探测。数据库连不上回 503 |
| `GET /api/v1/system/info`   | user     | 版本、本次启动、最近五次启动 |

## 事件

- 发出：`system.started`，payload 是 `{ bootId, version, node }`。

## 拥有的表

没有。仓储里只有一句 `select 1`，所以没有 `schema.ts`。

## 不做什么

- 不做鉴权，只声明访问级别。执行的是应用层的访问闸，身份来自身份模块（`modules/identity`）的会话：没登录回 401 `auth_required`。2026-11-27 身份模块接入之前，这里回的是 501 `auth_not_wired`。
- 不管配置。配置在应用的组合根里读环境变量，模块只接收它需要的东西。
