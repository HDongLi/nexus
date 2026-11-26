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
| `routes.raw.csv` | 旧系统 272 个路由的底表 | `inventory_routes.py` 机械抽取，条数与装饰器计数一致 |
| `parts/<批次>.jsonl` | 每个路由的清点结论 | 规格代理逐条读码 |
| `routes.csv` | 底表加结论的合并表 | `merge_parts.py` 生成 |
| `decisions.md` | 裁决清单：判不准的条目，每题是选择题 | `merge_parts.py` 生成 |

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

三条规则：

1. **机制和适配分开。** 别的单位也需要「和身份系统对接」这个机制，归 `kernel`；但不需要这一套具体协议，归 `m`。
2. **桌面壳、本机端、离线应用不进新版**（任务书 D-2）。只为它们存在的路由归 `retire`，并在 `reason` 里写明。
3. **证据先行。** 没有证据就写没有，不要猜。

## 批次

| 批次 | 路由文件 | 路由数 |
|---|---|---|
| `a-prod` | `prod/app.py` | 58 |
| `b-core` | `cyberneticscore/app.py`、`cyberneticscore/observer.py` | 50 |
| `c-platform` | `dev/routers/platform_routes.py`、`datamap_routes.py`、`tick_routes.py`、`observer_routes.py`、`dsh_routes.py` | 38 |
| `d-devflow` | `dev/routers/release_routes.py`、`ai_routes.py`、`agent_routes.py`、`queue_routes.py`、`sandbox_routes.py`、`feedback_routes.py` | 40 |
| `e-data` | `dev/routers/data_routes.py`、`datajobs_routes.py`、`docs_elfinder.py`、`projects.py`、`pages.py` | 51 |
| `f-identity` | `identity/registry.py`、`identity/oracle.py`、`prod/ai_gateway.py`、`prod/client_update.py` | 35 |
