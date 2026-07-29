# Release v1.0.4

日期：2026-07-29

本次为兼容 schema 9 的补丁更新，集中修复数据安全、生命周期、导入、界面兼容和
大数据量交互问题，不改变财务公式、数据库字段、数据目录或核心编辑流程。

> [!IMPORTANT]
> 当前版本尚未进入 Obsidian Community Plugins，不能通过 Obsidian 社区插件市场
> 搜索或自动安装。请下载本 Release 的 `main.js`、`manifest.json` 和
> `styles.css`，放入 `<Vault>/.obsidian/plugins/asset-track/` 后手动启用。

## 稳定性与数据安全修复

- 设置数据改为结构化解析；非法数据目录安全回退，无效账单映射会被忽略。
- 数据目录拒绝绝对路径、Windows 盘符、UNC、`.`、`..` 和 Vault 外解析结果。
- schema 9 校验增加必需字段、索引、外键和 `foreign_key_check`，并用于载入、
  保护备份和恢复候选。
- CSV/XLSX/XLS 导入先保存映射并生成规则候选，全部成功后才一次性修改草稿；
  失败重试不再重复追加。单文件限制为 20 MiB。
- ItemView 使用所属窗口、稳定 React 回调和托管 DOM 事件；插件卸载方法恢复为
  Obsidian 支持的同步生命周期签名。

## 界面与性能修复

- 放弃草稿和恢复数据库使用 Obsidian 原生确认 Modal。
- CSV 导入窗口增加标题关联、焦点进入与恢复、Tab 焦点陷阱、Escape、背景关闭
  和错误播报。
- 流水逐项表改为可视行窗口化渲染；分块编号从逐行重复扫描改为一次线性计算。
- 图表颜色和财务语义改用 `--asset-track-*` 作用域令牌映射 Obsidian 主题变量。
- 移除 `!important`，补充理财增长/下降状态与窄窗口单列布局。

## 工程与发布

- `npm run lint` 执行完整规则，当前为零 warning。
- CI 在 Ubuntu、macOS 和 Windows 执行类型、lint、测试、构建和发布静态验证。
- 版本更新为 1.0.4，最低 Obsidian 版本仍为 1.9.10，schema 仍为 9，备份格式和
  财务口径不变。

## 自动验证

- `npm run typecheck`：通过。
- `npm run lint`：通过，零 warning。
- `npm test`：14 个测试文件、45 个测试通过。
- `npm run build` 与 `npm run release:check`：通过。
- production `dist/main.js`：1,905,551 bytes。
- 标准三文件内容和 `node:sqlite` smoke 已复核。

## 尚需人工完成

- macOS、Windows、Linux 真实 Obsidian Vault smoke 仍为未测试。
- 发布前需验证弹出窗口、窄窗口、键盘导航、CSV/XLSX/XLS、备份恢复、锁释放及
  真实 1 万行以上月份的滚动体验。
