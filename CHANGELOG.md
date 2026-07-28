# Changelog

## 1.3.0

- sidecar 保持按需启动，移除 Obsidian 启动时的全局准备提示，并延迟加载 Pandas。
- 备份与恢复改为 Finder 路径选择；备份默认生成单个格式 2 ZIP。
- CSV 增加通用列映射、映射复用、状态过滤和明确的增量/覆盖模式。
- 增量导入追加全部有效流水，不执行去重；商品汇总只影响查看。
- 增加高频商品规则建议、两个默认账户和理财账户行对齐修复。
- 长期文档按 00–10 阅读顺序整理，版本 handoff 统一归档到 `docs/logs/`。

## 1.2.0

- 数据库固定为 Vault 内用户选择根目录下的 `data/accounting_system.db`。
- 增加 Vault 文件夹联想和首次初始化门禁。
- 备份仅保留设置页手动备份、校验和恢复，不执行自动备份。
- 将 CSV 导入改为明确的主操作按钮，并明确 3–5 列简化流水格式。
- 收敛为独立 Obsidian 源码仓库，并记录下一主要版本的 TypeScript 路线。

## 1.1.0

- 将 Obsidian ItemView 收敛为分析、流水、借款、规则四个主栏。
- 增加 Home、年度、月度实时 Recharts 分析，不再生成 Markdown/SVG。
- 使用动态分类、动态账户、流水日期和五类独立流水编辑区。
- 增加严格质检、revision、月份创建限制、删除、排序和 CSV 草稿导入。
- bundled Python sidecar 无需系统 Python；下一主要版本计划迁移到 TypeScript。
