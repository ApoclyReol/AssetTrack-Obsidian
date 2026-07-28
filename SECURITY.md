# Security and Privacy

AssetTrack 是本地优先工具，不提供账户或远程财务服务。

## 数据边界

- 正式数据库位于用户明确选择的 Vault 内 Asset_Track 根目录。
- 数据库固定为 `<根目录>/data/accounting_system.db`。
- SQLite 仅由插件内 TypeScript Repository 通过 Electron `node:sqlite` 读写。
- 插件延迟打开数据库；卸载、切换根目录和恢复前必须关闭连接并释放文件锁。
- 插件不自动备份；手动备份和恢复由用户从设置页触发。
- 数据库、WAL/SHM、用户 CSV、备份、Vault、日志和构建产物不属于仓库交付物；
  发布前必须检查 Git 状态和提交内容，避免把真实财务数据带入公开仓库。

## 运行边界

插件不启动本地服务、子进程或监听端口，不传输财务数据。发布目录只包含
`main.js`、`manifest.json` 和 `styles.css`，不包含平台二进制。

## 恢复保护

候选恢复必须经过安全解压、manifest、hash、schema、行数和 SQLite
`integrity_check`。验证通过后先创建当前数据库安全快照，再原子替换；失败保持
当前数据库不变。

## 报告问题

请只提供脱敏诊断、版本和最小复现。不要在公开 issue 中粘贴数据库、真实流水、
借款对方、完整日志或 token。
