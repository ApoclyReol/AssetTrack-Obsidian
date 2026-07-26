# Changelog

## 1.2.0

- 数据库固定为 Vault 内用户选择根目录下的 `data/accounting_system.db`。
- 增加 Vault 文件夹联想和首次初始化门禁。
- 备份仅保留设置页手动备份、校验和恢复，不执行自动备份。
- 收敛为独立 Obsidian 源码仓库，并记录下一主要版本的 TypeScript 路线。

## 1.1.0

- 将 Obsidian ItemView 收敛为分析、流水、借款、规则四个主栏。
- 增加 Home、年度、月度实时 Recharts 分析，不再生成 Markdown/SVG。
- 使用动态分类、动态账户、流水日期和五类独立流水编辑区。
- 增加严格质检、revision、月份创建限制、删除、排序和 CSV 草稿导入。
- bundled Python sidecar 无需系统 Python；下一主要版本计划迁移到 TypeScript。
