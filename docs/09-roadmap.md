# 09 路线图

## 当前版本

v1.2.0 已完成纯 TypeScript 架构、个性化金额设置、双资产口径、周期消费面板与自动中英文界面：

- TypeScript Service/Repository 和 `node:sqlite`；
- schema 9、交易对方和当前备份兼容；
- 标准三文件、跨 CPU 架构产物；
- 月份事务、revision、计算、CSV/XLSX/XLS、规则、账户和备份恢复测试。
- 路径与 schema 结构校验、失败导入原子性、可访问弹窗和可视行渲染。
- 中文环境显示中文，其他语言回退英文；用户内容和数据库规范值保持不变。
- 全部金额统一格式化，平账和大额阈值可配置；
- 对账使用资金投入资产，财富趋势并列展示市场净资产；
- 年度页按商品汇总最近 12 个有数据月份的周期消费。

## 发布后质量路线

Asset Track 已通过 Community Plugins 审核并支持从社区目录直接安装。后续质量
工作不再作为首次发布门槛：

1. 补充 Linux 最新 Obsidian 安装器真实 smoke；macOS 和 Windows 已完成。
2. 使用复制 Vault 验证 schema 9 备份恢复、数据库替换和锁释放。
3. 处理 Linux 本地验证反馈，保持 schema 9 和财务口径冻结。
4. 持续采集正式产物的插件加载耗时并维护 Community Plugin 质量清单。

## 后续考虑

- 将 `AssetTrackEditorApp.tsx` 按分析、月度编辑、流水、导入、规则和共享组件逐步
  拆入 `features/`；拆分时保持 Service/Repository 接口和用户行为不变。
- 将 CSV/XLSX/XLS 解析真正迁入 Worker；v1.2.0 只完成 `ArrayBuffer` 读取并移除
  Data URL/Base64 中间副本。
- 将现有中文错误文本和 `t("中文", "English")` 逐步迁移为稳定消息键与完整
  `AssetTrackError { code, params, status, cause }`，测试只依赖错误代码。
- 大数据量分析的分片、缓存和真实 Vault 性能采样；
- 自动化 Electron/Obsidian 三平台 smoke；
- 在不改变 SQLite 事实层前提下扩展支付平台导入模板；
- 移动端仅作为独立长期研究，不纳入当前桌面版路线。
