# Security and Privacy

AssetTrack 是本地优先工具，不提供账户或远程财务服务。

## 数据边界

- 正式数据库位于用户明确选择的 Vault 内 Asset_Track 根目录。
- 数据库固定为 `<根目录>/data/accounting_system.db`。
- 当前 SQLite 仅由 Python sidecar 读写。
- 插件不自动备份；手动备份和恢复由用户从设置页触发。
- Git 不跟踪数据库、WAL/SHM、CSV、备份、Vault、日志或构建产物。

## 本地服务

- sidecar 只监听 `127.0.0.1` 随机端口。
- 一次性 bootstrap token 通过进程环境传递，并换取 header session。
- token 不进入 URL、SQLite、备份、诊断或日志。
- sidecar 监控 Obsidian 父进程并在插件卸载时关闭。

## 恢复保护

候选恢复必须经过安全解压、manifest、hash、schema、行数和 SQLite
`integrity_check`。验证通过后先创建当前数据库安全快照，再原子替换；失败保持
当前数据库不变。

## 报告问题

请只提供脱敏诊断、版本和最小复现。不要在公开 issue 中粘贴数据库、真实流水、
借款对方、完整日志或 token。
