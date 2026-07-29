# 09 路线图

## 当前版本

v1.0.3 已完成纯 TypeScript 架构、账单体验与基础社区发布自动化：

- TypeScript Service/Repository 和 `node:sqlite`；
- schema 9、交易对方和当前备份兼容；
- 标准三文件、跨 CPU 架构产物；
- 月份事务、revision、计算、CSV/XLSX/XLS、规则、账户和备份恢复测试。

## Community 发布门槛

1. 在 macOS、Windows、Linux 最新 Obsidian 安装器完成真实 smoke。
2. 使用复制 Vault 验证 schema 9 备份恢复、数据库替换和锁释放。
3. 处理 v1.0.3 三平台本地验证反馈，保持 schema 9 和财务口径冻结。
4. 从正式产物采集界面截图、插件加载耗时，并完成 Community Plugin 质量清单。
5. 使用同一 v1.0.3 三文件产物提交 Community Plugins。

## 后续考虑

- 大数据量分析的分片与缓存；
- 自动化 Electron/Obsidian 三平台 smoke；
- 在不改变 SQLite 事实层前提下扩展支付平台导入模板；
- 移动端仅作为独立长期研究，不纳入当前桌面版路线。
