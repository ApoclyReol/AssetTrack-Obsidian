# 用户指南

## 首次使用

1. 安装完整 `asset-track/` 插件目录并在 Obsidian 中启用。
2. 打开“设置 → Asset Track”。
3. 在“Asset_Track 根目录”中输入关键词，从 Vault 文件夹联想列表选择已有目录；
   也可以使用推荐的 `Asset_Track` 新目录。
4. 点击“使用并初始化”。数据库固定创建或读取于
   `<根目录>/data/accounting_system.db`。
5. 完成前，Ribbon 和“打开编辑器”只会引导回设置，不会创建数据库。

## 日常使用

- “分析”：Home、年度、月度实时图表。
- “流水”：现金、理财、支出、收入、代付、加仓、提现和固定资产。
- “借款”：维护发生日期、金额、是否还清和还清日期。
- “规则”：维护动态分类和商品匹配规则。

正向增长和收入显示为红色，下降和支出显示为绿色。

## 备份与恢复

插件不执行自动备份。

- “立即备份”生成一致性 SQLite、9 张 CSV 和格式 2 manifest。
- 恢复支持格式 2 目录、ZIP 或 schema 8 SQLite。
- 候选数据必须先通过 hash、表、行数、schema 和 `integrity_check`。
- 替换数据库前会创建当前数据安全快照。

重要修改前应手动备份，并把重要备份复制到 Vault 或仓库之外。

## 安装环境

当前完整插件包含 React/Recharts 和 PyInstaller Python sidecar，运行时不要求
用户安装 Node、Python、uv 或虚拟环境。当前构建按 CPU 架构生成；Apple
Silicon 和 Intel Mac 需要各自匹配的完整安装目录。
