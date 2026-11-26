# 清点分类：工作说明与数据格式

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-26 |
| 依据 | 任务书 §7.2：清点与分类先于规格 |
| 旧仓 | `C:\Users\14395\Desktop\nexus`，**只读**。本目录的产出是规格素材，不是代码 |
| 读者 | 规格代理（做清点的人）；产品负责人（只看 `decisions.md`） |

## 产物

| 文件 | 内容 | 来源 |
|---|---|---|
| `routes.raw.csv` | 旧系统服务端 272 个路由的底表 | `inventory_routes.py` 机械抽取，条数与装饰器计数一致 |
| `client.raw.csv` | 本机端 74 个路由的底表，编号 `C001`–`C074` | 同上，抽取根换成本机端目录 |
| `parts/<批次>.jsonl` | 每个路由的清点结论 | 规格代理逐条读码 |
| `routes.csv` | 底表加结论的合并表 | `merge_parts.ts` 生成 |
| `decisions.md` | 裁决清单：判不准的条目，每题是选择题 | `merge_parts.ts` 生成 |
| `answers.json` | 产品负责人的答复，一条路由一条 | 规格代理登记 |
| `workers.md` | 非路由能力清单 | `merge_parts.ts` 从各批次的 `_meta.workers` 汇总 |
| `backlog.md` | 旧系统缺陷待办：每条变成新版的验收项 | 规格代理从各批次的 `reason` 转录 |

合并命令：`node docs/parity/merge_parts.ts --check` 只校验，不写文件；去掉 `--check` 校验通过后重写三个产物；`--strict` 要求 272 条全部有结论；`--apply-defaults` 让没答复的题按默认项走。校验有问题时退出码为 1，什么都不写。

## 底表的列

`rid, services, file, line, method, path, handler, path_resolved, raw_path_expr`

`services` 的取值：`dev` 是开发面，`prod` 是生产面，`dev,prod` 是两面都挂载，`core` 是事件库。

## parts 文件的格式

每行一个 JSON 对象，对应一个路由。字段固定如下：

| 字段 | 类型 | 说明 |
|---|---|---|
| `rid` | 字符串 | 与底表一致，如 `R042` |
| `summary` | 字符串 | 它做什么，中文，40 字以内 |
| `actor` | 字符串 | 谁调用：用户页面、客户端、外部机器、内部后台、无人 |
| `callers_evidence` | 字符串 | 证据：哪个页面、模块或测试调用了它。写不出证据就写「无调用方证据」 |
| `deps.stores` | 字符串数组 | 读写了哪些数据：库表、jsonl、文件、目录 |
| `deps.external` | 字符串数组 | 外部依赖：子进程、ssh、git、其他服务的端口、模型接口 |
| `side_effect` | 字符串 | `read`、`write`、`exec`、`network` 之一或组合 |
| `dest` | 字符串 | `kernel`、`m`、`tool`、`retire`、`unclear` 之一 |
| `confidence` | 字符串 | `high`、`mid`、`low` |
| `reason` | 字符串 | 判据说明：换一家单位还需不需要，为什么 |
| `question` | 对象或 `null` | `dest` 为 `unclear` 或 `confidence` 为 `low` 时必填 |

`question` 的结构：`q` 是题干，`options` 是两到四个选项，`default` 是默认选项的下标，`evidence` 是支持默认项的证据。

每个选项可以是一个字符串，也可以是 `{"dest": "kernel", "label": "……"}`。选项文字里要写明归宿（内核、定制包、工具、退役），答复之后才能落成结论。

几条路由共用一个裁决时，给它们的 `question` 填同一个 `topic`（短英文，如 `feedback-pool`）。合并后只出一道题，答复一次作用于全部。同题的各条选项数和默认项下标必须一致。

`answers.json` 的样子：`{"R042": {"pick": 1, "dest": "kernel", "note": "2026-11-26 答复"}}`。`pick` 是选项下标，从 0 起。`dest` 可以省略，省略时取选项文字里写明的归宿；文字里写不出唯一归宿时必须填。

文件最后一行可以是一个 `_meta` 对象，记录读码时看到的**非路由能力**：后台循环、定时器、启动钩子。格式是 `{"_meta": {"batch": "…", "workers": [{"name": "…", "file": "…", "what": "…"}]}}`。

## 归宿的判据

只问一句：**换一家单位，这条还需要吗？**

| `dest` | 判据 |
|---|---|
| `kernel` | 任何单位都需要的平台能力 |
| `m` | 只有这家单位或这套部署环境才这样 |
| `tool` | 只为给同事做的某个工具服务 |
| `retire` | 没人用，或当初只为补一个洞 |
| `unclear` | 判不准，必须附 `question` |

四条规则：

1. **机制和适配分开。** 别的单位也需要「和身份系统对接」这个机制，归 `kernel`；但不需要这一套具体协议，归 `m`。
2. **桌面壳、本机端、离线应用不进新版**（任务书 D-2）。只为它们存在的路由归 `retire`，并在 `reason` 里写明。
3. **证据先行。** 没有证据就写没有，不要猜。
4. **不写内网名。** 机器名、账号名、内网地址不进本目录，写「开发机」「生产机」「本机」。合并脚本会拦。

读码时发现旧系统的缺陷，不要改旧仓，也不要只在返回的话里提一句：写进那一行的 `reason` 末尾，格式是「旧系统缺陷：……」，合并后由规格代理转录进 `backlog.md`。

## 批次

| 批次 | 路由文件 | 路由数 |
|---|---|---|
| `a-prod` | `prod/app.py` | 58 |
| `b-core` | `cyberneticscore/app.py`、`cyberneticscore/observer.py` | 50 |
| `c-platform` | `dev/routers/platform_routes.py`、`datamap_routes.py`、`tick_routes.py`、`observer_routes.py`、`dsh_routes.py` | 38 |
| `d-devflow` | `dev/routers/release_routes.py`、`ai_routes.py`、`agent_routes.py`、`queue_routes.py`、`sandbox_routes.py`、`feedback_routes.py` | 40 |
| `e-data` | `dev/routers/data_routes.py`、`datajobs_routes.py`、`docs_elfinder.py`、`projects.py`、`pages.py` | 51 |
| `f-identity` | `identity/registry.py`、`identity/oracle.py`、`prod/ai_gateway.py`、`prod/client_update.py` | 35 |
| `g-client` | 本机端 `client/nexus_client/main.py`，底表是 `client.raw.csv`，编号 `C001`–`C074` | 74 |

## 本机端这一批判什么

前六批是服务端的 272 条，是任务书 §7.2 说的那张表。本机端（开发者电脑上的客户端）不进新版，它的 74 条路由本身都退役，所以这一批判的是**它承载的能力**由谁接：

| `dest` | 含义 |
|---|---|
| `retire` | 能力随本机端一起退役；或服务端那张表里已有路由承接了它——`reason` 以「由 Rxxx 承接」开头，写上编号 |
| `kernel` | 能力新版必须有，服务端表里没有对应的路由，需要在内核里新建 |
| `unclear` | 判不准，附 `question` |

壳（`nexus_exe/`）的迷你服务只有登录页和数据工单转发三四条，随壳退役，不单列。
