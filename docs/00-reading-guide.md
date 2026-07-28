# 00 文档阅读指南

`docs/` 主目录只保存当前版本仍然有效的长期文档，并按建议阅读顺序使用两位数字
编号。版本更新记录统一放入 `docs/logs/`，避免历史说明和当前事实混在一起。

## 建议阅读顺序

| 顺序 | 文档 | 适用场景 |
| --- | --- | --- |
| 00 | 本文 | 了解文档结构和事实来源 |
| 01 | [产品需求](01-product-requirements.md) | 确认产品边界和当前支持范围 |
| 02 | [用户指南](02-user-guide.md) | 安装后初始化、导入、编辑和备份 |
| 03 | [财务计算口径](03-financial-model.md) | 核对公式、流水和 CSV 数据语义 |
| 04 | [架构](04-architecture.md) | 理解 Obsidian、TypeScript Service、SQLite 和写入边界 |
| 05 | [设计系统](05-design-system.md) | 维护界面、状态和响应式布局 |
| 06 | [开发说明](06-development.md) | 搭建环境、测试和构建 |
| 07 | [构建与发行](07-release.md) | 生成、安装和验证完整插件 bundle |
| 08 | [故障排查](08-troubleshooting.md) | 处理启动、恢复、revision 和重复流水 |
| 09 | [路线图](09-roadmap.md) | 查看当前验证和后续方向 |
| 10 | [Community Plugins 发布规划](10-community-release-plan.md) | 核对社区发布门槛 |

## 更新日志

每个发行版本新增一份 `docs/logs/release-vN.N.N.md`，记录用户可见变化、数据兼容
边界、验证结果和后续 handoff。当前版本详见
[Release v1.0.1](logs/release-v1.0.1.md)，历史索引见
[logs/README](logs/README.md)。

## 事实优先级

发生冲突时按以下顺序核对：

1. 当前代码、schema 常量、测试和构建产物；
2. 本目录编号文档；
3. `docs/logs/` 历史版本记录。

更新功能时应同步修改受影响的编号文档、`CHANGELOG.md` 和对应 release 日志；
不要只在日志中记录当前行为。
