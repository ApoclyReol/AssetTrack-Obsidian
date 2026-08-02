# 09 路线图

## 当前发布候选

v1.4.0 代码候选继承纯 TypeScript 架构、个性化金额设置、双资产口径、周期消费面板、自动中英文界面与规则工作台，并完成 Obsidian 1.13 兼容升级：

- TypeScript Service/Repository 和 `node:sqlite`；
- schema 9、交易对方和当前备份兼容；
- 标准三文件、跨 CPU 架构产物；
- 月份事务、revision、计算、CSV/XLSX/XLS、规则、账户和备份恢复测试。
- 路径与 schema 结构校验、失败导入原子性、可访问弹窗和可视行渲染。
- 中文环境显示中文，其他语言回退英文；用户内容和数据库规范值保持不变。
- 全部金额统一格式化，平账和大额阈值可配置；
- 对账使用资金投入资产，财富趋势并列展示市场净资产；
- 年度页按商品汇总最近 12 个有数据月份的周期消费。
- 导入容错、月流水警告保存、商品历史/分类回溯、规则冲突解释和商品名称统一；
- 分类与规则分别保存，普通表格统一表头、字号、对齐、列宽和窄窗口换行；
- 规则实际覆盖与重复/冲突审计分离，部分覆盖商品仍可处理未覆盖流水；
- ItemView 关闭时取消放弃可在当前会话恢复月流水、借款、分类和规则草稿。
- 设置页改用 `getSettingDefinitions()` 和原生目录控件；插件代码不再枚举 Vault 全部文件。
- 最低 Obsidian 版本提升至 1.13.0，发布声明要求使用当前最新的 1.13.x 桌面版。

## v1.4.0 发布门禁

Asset Track 项目已通过 Community Plugins 审核并支持从社区目录安装当前稳定版。
v1.4.0 推送标签前仍需完成：

1. 在隔离复制 Vault 验证 v1.2.0 数据库、schema 9、备份、商品统一和回溯。
2. 完成 macOS 与 Windows 真实 Obsidian 安装、更新、重载和卸载后重启 smoke。
3. 验证多窗口 revision、关闭草稿恢复、中英文界面和窄窗口布局。
4. 完成后再提交、推送 `1.4.0` 标签并核验 GitHub Release 三文件与 attestations。

## 后续考虑

- 将 `AssetTrackEditorApp.tsx` 按分析、月度编辑、流水、导入、规则和共享组件逐步
  拆入 `features/`；拆分时保持 Service/Repository 接口和用户行为不变。
- 将 CSV/XLSX/XLS 解析真正迁入 Worker；v1.4.0 仍只完成 `ArrayBuffer` 读取并移除
  Data URL/Base64 中间副本。
- 将现有中文错误文本和 `t("中文", "English")` 逐步迁移为稳定消息键与完整
  `AssetTrackError { code, params, status, cause }`，测试只依赖错误代码。
- 大数据量分析的分片、缓存和真实 Vault 性能采样；
- 自动化 Electron/Obsidian 三平台 smoke；
- 在不改变 SQLite 事实层前提下扩展支付平台导入模板；
- 移动端仅作为独立长期研究，不纳入当前桌面版路线。
