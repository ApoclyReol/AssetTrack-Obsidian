# Release v1.4.0

日期：2026-08-02

状态：Obsidian 1.13 兼容升级候选。完成自动验证并经过真实 Obsidian 1.13.x
smoke 后，才允许创建 `1.4.0` 标签和正式 Release。

## 发布声明

v1.4.0 要求 Obsidian `1.13.0` 或更高版本。安装或更新插件前，请先将 Obsidian
桌面版升级到当前最新的 `1.13.x` 版本；旧版 Obsidian 不在本版本支持范围内。

## 用户可见更新

- 设置页改用 Obsidian 1.13 的声明式设置 API，数据目录使用原生文件夹控件。
- 数据目录选择先保留在设置页草稿中，只有创建新数据库、载入数据库或迁移成功后才
  保存到插件 `data.json`。
- 备份恢复和现金/理财账户管理迁移到独立设置页，原有操作和数据边界保持不变。
- 移除旧的 `PluginSettingTab.display()` 设置入口。
- 插件不再主动枚举 Vault 中的全部文件路径。
- 分类定义仅保留历史流水数；商品冲突处理表移除交易对方数、月份数和金额字段，完整统计
  移至分析页新增的“商品总览”标签。
- 规则页移除顶部 revision 技术信息和 SQLite 实现说明；分类、规则、商品历史表统一为
  按钮式表头，所属分类、所属规则和健康状态居中显示。
- 流水编辑器将创建月份按钮与月份选择器分开并突出显示；未编辑的空草稿月份可直接删除，
  流水行号支持排序且样式与其他表格统一。
- 分析页固定资产、周期消费和异常变化表头对齐，周期消费分类列收窄；规则分类表按实际列数
  铺满可用宽度，去除右侧空白。
- 分类定义和规则表的操作列补齐统一的“操作”按钮式表头，分类操作列收窄；流水虚拟表格的
  操作列也补齐表头。所有下拉控件隐藏箭头，统一居中文本并在窄列中使用省略显示。
- 商品总览表移除所属规则和健康状态列，保留分类、交易统计和金额统计；分类定义操作列固定为窄列并保持按钮居中。
- 分类定义操作按钮统一为通用操作列的满宽按钮，并收窄大额、颜色和流水数列；商品总览统一表体背景与金额、数量、日期对齐。
- 所有表格统一采用固定资产摘要的响应式布局：表格自适应容器宽度、内容换行、只保留纵向滚动，
  移除规则、历史商品、商品总览和流水网格的表格级最小宽度。

## Release notes (English)

Asset Track v1.4.0 requires Obsidian `1.13.0` or later. Before installing or updating,
upgrade the desktop application to the latest available `1.13.x` release. Older Obsidian
versions are outside this release's support range.

- Settings now use Obsidian 1.13 `getSettingDefinitions()` and the native folder control;
  the deprecated `PluginSettingTab.display()` entry point has been removed.
- The plugin no longer calls `getAllLoadedFiles()`, `getFiles()`, or `getMarkdownFiles()` and
  does not proactively enumerate every path in the Vault.
- Category definitions keep only historical transaction count. Conflict handling removes
  counterparty, month, and amount metrics; the new Item overview tab provides transaction and
  amount statistics.
- Item overview removes the Health and Matching rule columns and uses the same table background,
  alignment, compact semantic widths, and responsive behavior as the other analysis tables.
- The Rules workspace removes revision and SQLite implementation details and standardizes table
  headers, centered status fields, action buttons, and narrow-window wrapping.
- The transaction editor improves month creation order and messaging, allows an unedited empty
  month to be deleted without repeated confirmation, supports sortable row numbers, and shows
  operation headers.
- SQLite schema 9, database paths, compatible `data.json` fields, and backup formats remain
  unchanged. The supported release contains only `main.js`, `manifest.json`, and `styles.css`.

## 兼容边界

- `manifest.json` 的最低 Obsidian 版本为 `1.13.0`；`versions.json` 已同步声明该边界。
- 生产运行仍要求桌面版提供 `node:sqlite`、`DatabaseSync` 和 `sqlite.backup` 能力。
- SQLite schema 保持 9，不新增表、字段或索引，不执行 schema 迁移。
- `data.json` 已有设置、数据库路径、备份格式、账户和月份数据保持兼容。
- 发布产物仍只有 `main.js`、`manifest.json` 和 `styles.css`，不发布 ZIP、sidecar、
  Python 或平台二进制。

## 代码与依赖审查

- `src/settings.ts` 实现 `getSettingDefinitions()`，使用 `control`、`render` 和
  `SettingPage` 表达设置页；页面更新使用 `update()`。
- 数据目录草稿通过设置页实例状态维护，不在用户选择路径时写入 `data.json`。
- 源码和生产 bundle 扫描同时拦截 `getAllLoadedFiles()`、`getFiles()` 与
  `getMarkdownFiles()`，防止重新引入 Vault 全库枚举。
- `obsidian` 开发依赖固定到已验证的 `1.13.1` 类型版本，插件最低运行版本设置为
  `1.13.0`；React、Recharts、SheetJS 和 schema 9 不在本次升级中改变。

官方声明式设置迁移参考：[Migrate to declarative settings](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)。

## 验证记录

本地候选完成所有源码和文档修改后，必须以同一工作树执行：

```text
npm ci
npm run notices:update
npm test
npm run typecheck
npm run lint
npm run build
npm run release:check
bash scripts/smoke_test_plugin.sh build
npm audit
npm audit --omit=dev
git diff --check
```

自动化结果（2026-08-02）：

- `npm ci`：通过，安装 457 个包，审计 0 vulnerabilities；
- `npm run notices:update`：通过；
- `npm test`：22 个测试文件、101 项测试全部通过；
- `npm run typecheck`：通过；
- `npm run lint`：通过，0 error、0 warning；
- `npm run build`：通过，`build/main.js` 为 2,177,425 bytes；
- `npm run release:check`：通过，版本为 `v1.4.0`；
- `bash scripts/smoke_test_plugin.sh build`：通过，标准三文件与 `node:sqlite` 冒烟成功；
- `npm audit` 与 `npm audit --omit=dev`：均为 0 vulnerabilities；
- `git diff --check`：通过；
- 最终 bundle 能力扫描：未发现 `getAllLoadedFiles()`、`getFiles()` 或
  `getMarkdownFiles()` 调用。

最终三文件 SHA-256：`main.js` 为
`c3ee0a5ab5cb8800b0d7d2c2e748895f4859b7392957b1975c8b8a8193e8cc42`，
`manifest.json` 为
`0069b9b423a59cc21d8c21a8f7833abfb52b04d02749a8d5e697de85f24335ed`，
`styles.css` 为
`478053ed8fdae14551b3f2515fd0558245bf8ebbb3e9c3a9d3dfcd4b71a01ef6`。

以上只代表本地自动化验证完成；在真实 Obsidian 1.13.x smoke、跨平台人工门禁和
Release workflow/attestation 完成前，不将本候选标记为可发布。

最终构建目录必须只包含：

```text
build/main.js
build/manifest.json
build/styles.css
```

## 发布前人工门禁

1. 在隔离复制 Vault 中用 v1.3.0 数据验证更新后设置、schema 9、账户、月份、流水和
   备份未被改写。
2. 在当前最新 Obsidian 1.13.x 桌面版中验证设置页打开、声明式设置搜索、原生目录
   控件、目录草稿不提前落盘、创建/载入/迁移、备份恢复和账户保存。
3. 分别验证中文和英文界面、未配置门禁、数据库错误、窗口重载、禁用/启用以及多
   ItemView；确认没有 Vault 全库扫描导致的性能或权限异常。
4. 在 macOS 与 Windows 上记录 Obsidian 版本、插件版本、测试日期和安装/更新/重载/
   卸载后重启结果；Linux 按发布后质量计划记录。
5. 确认最终三文件来自同一次构建，Git 不包含数据库、备份、真实账单、Vault、依赖或
   其他敏感文件。
6. 人工门禁通过后，创建不带 `v` 前缀的 `1.4.0` 标签，由 Release workflow 生成三文件
   并核验 artifact attestation。

### 当前人工门禁状态

| 门禁 | 当前状态 |
| --- | --- |
| Obsidian 1.13.x 设置页与目录草稿 | 未测试 |
| macOS 安装、更新、重载、卸载后重启 | 未测试 |
| Windows 安装、更新、重载、卸载后重启 | 未测试 |
| 复制 Vault 数据、schema 9 与备份兼容 | 未测试 |
| 最终三文件、Release workflow 与 attestation | 未测试 |
