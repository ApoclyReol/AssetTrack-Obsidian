# 路线图

## 下一主要版本：去 Python

目标是把当前 bundled Python sidecar 全部替换为 TypeScript，实现更小、更符合
Obsidian 生态的单一插件运行时，并为标准 GitHub/Community 分发创造条件。

迁移范围：

1. 用 schema 8 fixture 和 Python golden tests 固化所有公式、API 和备份结果。
2. 选择 TypeScript SQLite 方案，验证 macOS ARM/Intel、WAL、事务与恢复。
3. 先迁移只读分析计算，再迁移校验和预览。
4. 最后迁移月份、借款、规则、账户和备份恢复写入。
5. 新实现完全通过对照测试后删除 FastAPI、Pandas、NumPy、PyInstaller 和
   sidecar 生命周期代码。

约束：

- 不允许 Python 和 TypeScript 长期各自维护一套财务公式。
- schema 8、格式 2 备份和用户数据必须保持可验证兼容。
- 不以减小体积为由降低恢复校验、revision 或事务保证。

## 后续考虑

- Intel 架构构建与签名自动化。
- 标准 GitHub Release 打包。
- 去 Python 完成后再评估 Obsidian Community Plugins。
