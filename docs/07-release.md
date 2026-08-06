# 07 构建与发行

> 文档角色：开发与维护。本文服务发布、安装验证和发行门禁；用户安装请按 README 或
> [用户指南](02-user-guide.md)操作。

v1.7.0 标签必须为 `1.7.0`，并与 `package.json`、`manifest.json` 和
`versions.json` 完全一致。发布前除标准命令外，应在中英文界面检查金额设置、
双资产趋势、周期消费表、容错导入、数据健康、商品总览、商品统一、
月流水借款区块、出账/入账/理财 Tab、理财流水账户、按账户月度分析、逐项/商品/交易对手三种流水视图、
批量预览与本地审计记录、通用规则、收入/代付转换、AI 分类预览和统一表格布局。

v1.7.0 要求 Obsidian `1.13.0` 或更高版本；发布声明必须要求用户先升级到当前
最新的 `1.13.x` 桌面版，再安装或更新插件。当前发布文案见
[Release v1.7.0](logs/release-v1.7.0.md)。

## 安装产物

GitHub Release 直接上传 `main.js`、`manifest.json` 和 `styles.css`。三个文件
组成统一桌面插件，不包含 sidecar、Python、平台二进制或架构目录。

## 构建与验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

项目只使用 `build/` 作为产物目录，不创建 `dist/` 或 `out/`。构建前会清空
`build/`；完成后其根部只包含 `main.js`、`manifest.json` 和 `styles.css`，
不生成 ZIP 或子目录。发布 workflow 直接上传这三个文件。

## 每次构建的版本同步规则

`npm run build` 不会自动增加版本号，而是把根目录 `manifest.json` 原样复制到
`build/manifest.json`。所以每次构建必须确保产物对应当前最新版本：

1. 先同步 `package.json`、根目录 `manifest.json` 和 `versions.json` 的目标版本；
2. 完成全部代码、文档和发行配置修改后，把 `npm run build` 作为最后的产物生成步骤；
3. 紧接着运行 `npm run release:check`，确认版本、三文件内容和生产 bundle 均为本次构建结果；
4. 发布或手动安装只取同一次构建生成的三个文件，不手工修改 `build/`，也不沿用旧产物。

版本未改变时也必须在最终修改后重新构建；版本改变时不能只改 build 中的 manifest，必须先
修改三个版本源文件，再重新生成整个 `build/`。

## 本地安装

正常用户应从 Community Plugins 目录直接安装。以下手动流程仅用于开发验证或社区
目录不可用时的备用安装。

退出 Obsidian 后，在 `<Vault>/.obsidian/plugins/asset-track/` 中放入同一
Release 的 `main.js`、`manifest.json` 和 `styles.css`。更新时保留已有
`data.json`，然后重新启动 Obsidian。

## GitHub Release

- tag 与 manifest 版本完全一致，使用不带 `v` 前缀的当前版本号；
- 推送版本 tag 后由 `.github/workflows/release.yml` 重新执行完整验证和生产构建；
- 只上传 `main.js`、`manifest.json` 和 `styles.css`，不上传插件 ZIP；
- 对标准三文件生成 GitHub artifact attestations；
- 仓库根目录保留 `versions.json`，声明各版本最低兼容 Obsidian 版本；
- 首次正式版先使用复制 Vault，真实数据测试前创建并校验 ZIP 备份；
- 发布后的质量验证和功能演进见
  [发布后质量与功能路线](10-community-release-plan.md)。

## 发布前验证

- 新安装、schema 9→10 直接打开、迁移保护备份、未配置门禁和根目录切换；
- dirty 导航、多 ItemView、禁用/启用和 Obsidian 重启；
- CSV/XLSX/XLS 映射、增量不去重、覆盖草稿、规则和账户；
- 缺少日期、空状态、警告保存、无效导入统计；
- 数据健康商品-分类冲突、商品名称统一、分类迁移和多月份 revision 回溯；
- 商品/交易对手/组合规则创建、重复规则和重写链阻止，以及固定优先级解释；数据健康只显示商品-分类冲突；
- 加仓/提现账户选择、按账户月度理财状态和最近月份规则命中展示；
- 流水 Tab 隔离、三种视图的原始 ID 映射、全选/全不选、保护范围和批量预览；
- 规则应用、批量修改、收入/代付转换的确认、revision 复核和保存后本地日志写入；
- AI 未配置时普通功能不受影响；配置后检查最小请求字段、分类校验、失败分组、重试、
  SecretStorage 和 API 失败审计；
- 关闭月流水、月内借款、分类和规则脏草稿时的取消恢复与确认放弃；
- 分类删除提示、规则/分类分别保存、英文错误文案、统一按钮式表头和窄窗口表格换行；
- ZIP/SQLite 恢复、恢复前安全快照和失败回滚；
- macOS、Windows 发布验证，以及持续补充的 Linux 最新安装器真实 smoke；
- 关闭插件后数据库连接和文件锁释放。
