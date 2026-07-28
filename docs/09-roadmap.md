# 09 路线图

## 当前发行边界

1.3.0 是完整目录安装版本：插件主程序依赖同目录下的 Python/FastAPI
sidecar，当前以本地完整 bundle 交付；如需公开分发，应先准备包含 sidecar 的
完整 Release，不提交 Obsidian Community Plugins。完整原因、门槛和提交步骤见
[Community Plugins 发布规划](10-community-release-plan.md)。

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
- 去 Python、跨架构验证和公开发布资料齐备后，按
  [Community Plugins 发布规划](10-community-release-plan.md) 执行社区提交。
