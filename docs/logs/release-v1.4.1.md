# Release v1.4.1

日期：2026-08-02

状态：性能与开发维护更新。要求 Obsidian `1.13.0` 或更高版本；安装或更新前，
请先将 Obsidian 桌面版升级到当前最新的 `1.13.x` 版本。

## 发布声明

v1.4.1 主要用于性能优化和开发维护，不改变财务口径、SQLite schema、数据库路径、
备份格式或既有 `data.json` 兼容字段。

## 用户可见更新

- 优化规则匹配和历史规则分析查询，减少重复扫描，在较大数据量下提升商品总览和规则工作台的响应速度。
- 优化生产构建配置，减少 `main.js` 体积并改善插件加载效率。
- 保持现有分析、流水、规则和资产数据口径；本版本不新增财务事实或数据库迁移。

## 开发与维护更新

- 分析页按首页、商品、年度和月度职责拆分；编辑器表格、规则历史弹窗和规则创建/商品统一 Modal 分离。
- Repository 抽离通用行转换、校验错误和规则报告职责，保留事务 facade、revision 校验和单事务写入边界。
- 增加规则匹配索引和大数据量回归基准，继续覆盖 Obsidian 1.13 设置边界、Vault 枚举限制和标准三文件构建。

## Release notes (English)

Asset Track v1.4.1 is primarily a performance and development-maintenance release. It
requires Obsidian `1.13.0` or later. Before installing or updating, upgrade the desktop
application to the latest available `1.13.x` release.

- Optimized rule matching and historical rule-analysis queries to avoid repeated scans and
  improve Item overview and Rules workspace responsiveness on larger datasets.
- Improved the production build configuration to reduce `main.js` size and improve plugin
  loading efficiency.
- Financial definitions, SQLite schema, database paths, backup formats, and compatible
  `data.json` fields remain unchanged. No financial fact or database migration is introduced.
- Split analysis pages, editor tables, rule-history modals, and Repository helpers into clearer
  maintenance boundaries while preserving Service/Repository and transaction contracts.
- Added indexed rule-matching coverage and a large-data regression benchmark; the Obsidian 1.13
  settings boundary, Vault-enumeration guard, and standard three-file build remain covered.

## 兼容边界

- `manifest.json` 和 `versions.json` 的最低 Obsidian 版本为 `1.13.0`。
- SQLite schema 保持 9，不新增表、字段或迁移逻辑。
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
git diff --check
```

构建目录必须且只能包含：

```text
build/main.js
build/manifest.json
build/styles.css
```

自动化结果（2026-08-02）：

- `npm run typecheck`：通过；
- `npm run lint`：通过，0 error、0 warning；
- `npm test`：22 个测试文件、102 项测试全部通过；
- `npm run build`：通过，`build/main.js` 为 1,265,342 bytes；
- `npm run release:check`：通过，版本为 `v1.4.1`；
- `bash scripts/smoke_test_plugin.sh build`：通过，标准三文件与 `node:sqlite` 冒烟成功；
- `npm audit --omit=dev`：0 vulnerabilities；
- `git diff --check`：通过。

最终三文件 SHA-256：

- `main.js`: `215cdbed0f942cdcd176a55229621607ded15a992aa99ba4ff6e7f351c93b363`；
- `manifest.json`: `518fe11438e654ac9a1af6b993165ad267507e82294624e298484eb859a94b40`；
- `styles.css`: `478053ed8fdae14551b3f2515fd0558245bf8ebbb3e9c3a9d3dfcd4b71a01ef6`。

Release workflow、GitHub Release 资产和 artifact attestation 在正式发布后补录于本文。
