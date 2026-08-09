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
| 04 | [架构](04-architecture.md) | 理解运行链、生命周期和事务边界 |
| 13 | [体验设计](13-experience-design.md) | 维护月度状态、渐进展示和异常处理体验 |
| 05 | [设计系统](05-design-system.md) | 维护界面、状态和响应式布局 |
| 06 | [开发说明](06-development.md) | 搭建环境、测试和构建 |
| 07 | [构建与发行](07-release.md) | 生成、安装和验证完整插件 bundle |
| 08 | [故障排查](08-troubleshooting.md) | 处理启动、恢复、revision 和重复流水 |
| 09 | [路线图](09-roadmap.md) | 查看当前验证和后续方向 |
| 10 | [发布后质量与功能路线](10-community-release-plan.md) | 跟踪发布后质量与功能演进 |
| 11 | [规则中心与容错导入架构补充](11-rule-center-architecture.md) | 核对导入、质检和规则洞察接口 |
| logs | [发行日志索引](logs/README.md) | 查看历史版本变化和发布 handoff |

## 更新日志

每个发行版本新增一份 `docs/logs/release-vN.N.N.md`，记录用户可见变化、数据兼容
边界、验证结果和后续 handoff。当前版本详见
[Release v1.8.0](logs/release-v1.8.0.md)，历史索引见
[logs/README](logs/README.md)。

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
