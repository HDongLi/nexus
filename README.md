# nexus（重写版）

全新重写中的 nexus：前后端完全分离、契约驱动、面向智能体并行开发的 Web 平台内核。

| 项 | 内容 |
|---|---|
| 状态 | 任务书 v0.3.1 定稿，2026-11-26 开工。现在在 D1（架构约定）和 D2（行为规格）的第一步 |
| 先读 | [`docs/charter.md`](docs/charter.md)（任务书）。人读 §0–§2、§8–§10、§12 |
| 要你决定的事 | [`docs/parity/decisions.md`](docs/parity/decisions.md)：全是选择题，一行一题，不答按默认项走 |
| 旧系统的毛病 | [`docs/parity/backlog.md`](docs/parity/backlog.md)：旧仓不修，每条变成新版的验收项 |

## 现在在做什么

先把旧系统的每一条路由清点一遍，再写规格。旧系统是需求的来源，不是产品的定义：换一家单位还要的进内核，只有这家单位才这样的进定制包，没人用的退役。

- 服务端 272 条路由，分六批清点，结论在 [`docs/parity/routes.csv`](docs/parity/routes.csv)。
- 本机端 74 条路由，随本机端退役，逐条记下能力由谁接。
- 判不准的汇总成裁决清单，只拿这一张清单问人。

工作说明与数据格式在 [`docs/parity/SCHEMA.md`](docs/parity/SCHEMA.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `docs/charter.md` | 任务书 |
| `docs/adr/` | 架构决策记录：编号、背景、决定、后果 |
| `docs/parity/` | 旧系统的清点、裁决清单、缺陷待办 |
| `docs/strategy/` | 策略文档，持有者自管，不入库 |
