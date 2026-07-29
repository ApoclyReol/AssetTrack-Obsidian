# Security and Privacy

AssetTrack 是本地优先的桌面 Obsidian 插件，不提供账户、云同步或远程财务服务。

## 数据位置与所有权

- 用户必须明确选择 Vault 内的“Asset-track 数据目录”。
- 正式数据库固定为 `<数据目录>/accounting_system.db`。
- 操作前保护快照保存在 `<数据目录>/backups/`，不上传到仓库或网络。
- 插件 `data.json` 只保存数据目录和导入映射等设置，不保存财务事实。
- 卸载或禁用插件不会自动删除数据库、保护快照或用户导出的备份；如需删除财务
  数据，必须由用户在文件系统中另行确认和处理。

SQLite 只由插件内 TypeScript Repository 通过 Obsidian Electron 提供的
`node:sqlite` 读写。数据库、WAL/SHM、备份、账单文件、Vault、日志和构建产物
均不属于源码仓库交付物。

## 备份类型

AssetTrack 有两类用途不同的备份：

- **保护快照**：迁移当前数据库到另一数据目录、切换并载入另一数据库，以及恢复
  备份前，由插件自动在当前 `<数据目录>/backups/` 创建。它用于操作失败后的本地
  回退，不替代用户的长期备份。
- **手动 ZIP 备份**：用户从设置页选择导出目录后创建，包含一致性 SQLite 快照、
  CSV、manifest、hash、schema 和行数摘要。用户负责把它保存到合适的位置并定期
  验证。

插件不执行定时、启动时或联网自动备份。候选恢复会先经过安全解压、manifest、
hash、schema、行数和 SQLite `integrity_check`；验证通过后才创建恢复前保护快照
并原子替换数据库。验证或替换失败时保留当前数据库。

## 本地运行边界

- 插件不联网、不含遥测，不启动 HTTP 服务、子进程或监听端口。
- CSV、XLSX 和 XLS 的读取、字段映射与解析全部在当前设备本地完成。
- 发布目录只包含 `main.js`、`manifest.json` 和 `styles.css`，不包含平台二进制。
- 插件延迟打开数据库；运行时缺少 Node ≥22.16、`DatabaseSync` 或
  `sqlite.backup` 时只显示兼容提示，不创建或修改数据库。

## 诊断与问题报告

“复制诊断”包含插件/Service/protocol/schema 版本、schema 校验摘要、用户设置的
Vault 相对数据目录、数据库运行时路径、数据 revision 和 TypeScript 运行时标识。
其中路径可能暴露用户名、Vault 或目录命名。

报告问题时只提供脱敏诊断、版本和最小复现。不要在公开 issue 中粘贴数据库、备份、
真实流水、借款对方、完整路径、完整日志、账单文件或 token。
