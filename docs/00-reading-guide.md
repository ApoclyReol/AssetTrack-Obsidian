# 00 文档阅读指南

`docs/` 主目录只保存当前版本仍然有效的长期文档，并按建议阅读顺序使用两位数字
编号。版本更新记录统一放入 `docs/logs/`，避免历史说明和当前事实混在一起。

本项目明确分为两条阅读路径：README 和用户指南服务最终用户；编号文档主要服务
产品、开发、测试、发布和维护。用户文档只解释“为什么做、现在做什么、完成后看到
什么”，不展开 schema、revision、Repository、WAL 等内部实现。

## 用户阅读路径

| 顺序 | 文档 | 适用场景 |
| --- | --- | --- |
| 1 | [README](../README.md) / [中文 README](../README.zh-CN.md) | 了解产品价值、工作方式和安装入口 |
| 2 | [用户指南](02-user-guide.md) | 完成第一次安装和一次月度结算 |

## 开发与维护路径

| 顺序 | 文档 | 适用场景 |
| --- | --- | --- |
| 00 | 本文 | 了解文档角色、事实来源和维护入口 |
| 12 | [产品理念](12-product-philosophy.md) | 确认为什么每月一次、功能如何取舍 |
| 01 | [产品需求](01-product-requirements.md) | 把产品原则落实为当前需求和边界 |
| 14 | [数据可信性模型](14-data-trust-model.md) | 核对唯一事实、追溯和数据质量边界 |
| 03 | [财务计算口径](03-financial-model.md) | 核对公式、流水和导入语义 |
| 15 | [流水标签与分类属性](15-transaction-taxonomy.md) | 核对 schema 12、属性、标签、迁移和分析重叠口径 |
| 04 | [架构](04-architecture.md) | 理解运行链、生命周期和事务边界 |
| 13 | [体验设计](13-experience-design.md) | 维护月度状态、渐进展示和异常处理体验 |
| 05 | [设计系统](05-design-system.md) | 维护界面、状态和响应式布局 |
| 06 | [开发说明](06-development.md) | 搭建环境、测试和构建 |
| 16 | [界面回归测试协议](16-ui-regression-protocol.md) | 每次更新后需要实际点击的页面、场景、证据和 debug 交接格式 |
| 07 | [构建与发行](07-release.md) | 生成、安装和验证完整插件 bundle |
| 08 | [故障排查](08-troubleshooting.md) | 处理启动、恢复、revision 和重复流水 |
| 09 | [路线图](09-roadmap.md) | 查看当前验证和后续方向 |
| 10 | [发布后质量与功能路线](10-community-release-plan.md) | 跟踪发布后质量与功能演进 |
| 11 | [规则中心与容错导入架构补充](11-rule-center-architecture.md) | 核对导入、质检和规则洞察接口 |
| logs | [发行日志索引](logs/README.md) | 查看历史版本变化和发布 handoff |

## 更新日志

每个发行版本新增一份 `docs/logs/release-vN.N.N.md`，记录用户可见变化、数据兼容
边界、验证结果和后续 handoff。当前稳定版为 v2.0.0，schema 12 与流水标签/分类属性
重构已正式发布；状态详见 [Release v2.0.0](logs/release-v2.0.0.md)，
历史索引见 [logs/README](logs/README.md)。

## 事实优先级

发生冲突时按以下顺序核对：

1. 当前代码、schema 常量、测试和构建产物；
2. 本目录编号文档；
3. `docs/logs/` 历史版本记录。

产品定位以[产品理念](12-product-philosophy.md)为上位叙事，以
`01-product-requirements.md`和[路线图](09-roadmap.md)
为当前需求约束。后续功能评审先检查这些文档和[财务计算口径](03-financial-model.md)，再进入界面或
数据库设计；不要只根据某个发行日志或单个页面的现状推导产品方向。

更新功能时应同步修改受影响的编号文档、`CHANGELOG.md` 和对应 release 日志；其中
当前代码、编号文档和测试仍优先于历史日志，不要只在日志中记录当前行为。

当前开发线使用 schema 12 的流水标签与分类属性模型。schema 9/10/11 首次打开先只读展示迁移影响，
确认保留、清除或取消后才创建保护备份并迁移；取消保持原文件不变。完整备份仍兼容旧 schema 11 格式。

## 文档去冗余与事实归属

- 用户行为只在[用户指南](02-user-guide.md)维护；schema 12 的属性、标签、迁移、备份和分析边界只在
  [流水标签与分类属性](15-transaction-taxonomy.md)维护；每次更新后的真实点击步骤只在[界面回归测试协议](16-ui-regression-protocol.md)维护。
- [架构](04-architecture.md)是运行链、生命周期和事务边界的唯一入口；[规则中心补充](11-rule-center-architecture.md)
  保留导入、规则和查询窗口契约，虽然有少量交叉但职责不同，暂不合并文件。
- 产品理念、体验设计和数据可信性模型属于决策/治理来源；历史审计和临时计划留在 `docs/temporary/`，不作为当前行为事实。
