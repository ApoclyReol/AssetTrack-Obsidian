# Release v1.5.0

日期：2026-08-03

状态：月流水事实链路更新。要求 Obsidian `1.13.0` 或更高版本；安装或更新前，
请先将 Obsidian 桌面版升级到当前最新的 `1.13.x` 版本。

## 发布声明

v1.5.0 把借款从独立顶层入口整合到月流水页，让借款新增、继承、还清和对账差额都在
同一个月度结算流程中完成。本版本不改变 SQLite schema、数据库路径、备份格式或既有
`data.json` 兼容字段。

## 用户可见更新

- 借款区块位于月流水页内：上月未还借款会自动出现在后续月份，用户在对应月份新增借款
  或勾选“本月还清”。
- 借款仍写入全局 `debt_manager` 事实表，不写入月度借款快照；历史月份不能覆盖未来月份
  已还清的借款事实。
- 月流水顶部对账差额会读取草稿中的借款变化，新增借款、修改当月借款金额或勾选本月还清
  后立即刷新，不再等保存后才反映借款影响。
- 代付、加仓和提现不使用分类；逐项表、商品汇总展开和特殊流水编辑区不再显示分类列、
  分类选择入口或“无需分类”占位。
- 按商品汇总移除“最近日期”列，重新调整收支、商品、次数、总金额、分类和操作列宽，
  并支持按收支和分类排序。
- 保存月份时同时提交月流水、资产、固定资产和月内借款草稿；若存在未来还清借款冲突，
  Repository 会以结构化错误拒绝写入。

## Release notes (English)

Asset Track v1.5.0 moves debt handling into the monthly transaction workflow. It requires
Obsidian `1.13.0` or later; before installing or updating, upgrade the desktop application
to the latest available `1.13.x` release.

- The monthly transaction page now includes a debt section. Unpaid debts carry forward
  automatically, and users add new debts or mark debts as paid in the relevant month.
- Debts still use the global `debt_manager` fact table instead of monthly debt snapshots.
  Historical months cannot overwrite a debt that has already been paid in a future month.
- The monthly editor's reconciliation difference now uses draft debt changes, so adding,
  repaying, or changing same-month debt amounts updates the difference immediately before save.
- Proxy payment, investment deposit, and investment withdrawal rows do not use categories.
  Their detail tables and item-summary details no longer show category columns, selectors, or
  “no category required” placeholders.
- Item summary removes the Latest date column, improves column proportions for item and
  category readability, and supports sorting by type and category.
- SQLite schema 9, database paths, backup formats, and compatible `data.json` fields remain
  unchanged.

## 兼容边界

- `manifest.json` 和 `versions.json` 的最低 Obsidian 版本为 `1.13.0`。
- SQLite schema 保持 9，不新增表、字段或迁移逻辑。
- 借款事实继续保存在 `debt_manager`；月流水页只是当前月份投影和编辑入口。
- 数据库路径、备份格式、账户、月份和既有 `data.json` 设置保持兼容。
- 正式 Release 只包含 `main.js`、`manifest.json` 和 `styles.css`，不包含 ZIP、sidecar、
  Python 或平台二进制。

## 验证记录

最终构建已在同一工作树执行：

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
bash scripts/smoke_test_plugin.sh build
npm audit --omit=dev
git diff --check
```

构建目录必须且只能包含：

```text
build/main.js
build/manifest.json
build/styles.css
```

自动化结果（2026-08-03）：

- `npm run typecheck`：通过；
- `npm run lint`：通过，0 error、0 warning；
- `npm test`：23 个测试文件、108 项测试全部通过；
- `npm run build`：通过，`build/main.js` 为 1,268,923 bytes；
- `npm run release:check`：通过，版本为 `v1.5.0`；
- `bash scripts/smoke_test_plugin.sh build`：通过，标准三文件与 `node:sqlite` 冒烟成功；
- `npm audit --omit=dev`：0 vulnerabilities；
- `git diff --check`：通过；
- 最终 bundle 能力扫描：未发现 `getAllLoadedFiles()`、`getFiles()`、`getMarkdownFiles()` 或程序化剪贴板访问。

最终三文件 SHA-256：

- `main.js`: `8b7c537c84f3d442eb3e69b6b69c7b5325cd6cdb1619ef2de91c9d2ccc096408`；
- `manifest.json`: `6ab1e22a872a1a3f4688e124f182e7b1cf0d4b99ec6841f13bd7ccf28895c584`；
- `styles.css`: `3bde3ba5780e99c29427994626a1abfc432e43f002551fcfd4840b7a2a6125d5`。

## 发布后核验

推送标签 `1.5.0` 后，`.github/workflows/release.yml` 会在 Ubuntu 重新执行安装、
typecheck、lint、测试、构建、发行校验、版本核对、三文件检查、artifact attestation
和 GitHub Release 发布。远端 workflow、Release 资产和 attestation 以发布后的 GitHub
核验结果为准。

## 后续注意

- 继续在复制 Vault 中验证月流水借款区块、未来还清借款锁定、实时对账差额、特殊流水
  无分类列和商品汇总排序。
- 继续补充 macOS、Windows 和 Linux 真实 Obsidian 安装、更新、重载和卸载后重启记录；
  这些人工 smoke 不能替代自动化测试，也不能记录真实账单或私有路径。
