# Release v1.8.1

## 中文

Asset Track 1.8.1 是一个补丁级更新，重点修复部分账单日期格式导致有效交易被过滤的问题，
并降低规则列表的管理成本。本版本不改变财务计算口径、数据库 schema、备份格式、数据库路径
或设置数据结构。

### 修复与改进

- 修复 `8/31/26 9:23` 这类两位年份日期无法解析，导致交易成功流水被当作无效行过滤的问题。
- 日期解析支持多种格式，并允许同一份账单混用不同格式，包括：`YYYY-MM-DD`、`M/D/YYYY`、`M/D/YY`、中文年月日、
  `YYYYMMDD`、Excel 日期序列和带时间的日期值。

### 规则管理面板加强

- 规则列表新增搜索、收支、状态、作用域和分类筛选，常用筛选直接显示。
- 支持按状态、最近使用、流水数、分类、匹配范围和编号排序，也支持按状态、收支、作用域和分类分组。

## 兼容性

- 要求 Obsidian `1.13.0` 或更高版本，仅支持桌面版。

## English

Asset Track 1.8.1 is a patch release that fixes valid bill transactions being filtered by certain
date formats and makes larger rule lists easier to manage. It does not change financial definitions,
the database schema, backup format, database path, or settings data structure.

### Fixes and improvements

- Fixed dates such as `8/31/26 9:23` being rejected, which incorrectly filtered otherwise successful transactions.
- Date parsing supports multiple formats and allows mixed formats within the same bill, including:
  `YYYY-MM-DD`, `M/D/YYYY`, `M/D/YY`, Chinese date notation, `YYYYMMDD`, Excel serial dates, and date-time values.

### Rule management panel improvements

- The rule list now adds search, transaction type, status, scope, and category filters, with common filters shown directly.
- Rules can be sorted by status, latest use, transaction count, category, match scope, and ID, and grouped by status, transaction type, scope, and category.

## Compatibility

- Requires Obsidian `1.13.0` or later and is desktop-only.

## 验证记录

- 目标版本：`1.8.1`；`package.json`、`package-lock.json`、`manifest.json`、`versions.json` 和构建产物版本一致。
- 自动化验证：`npm run typecheck`、`npm run lint`、`npm test`（33 个测试文件 / 251 个测试）、`npm run test:perf`、`npm run build`、`npm run release:check` 和 `git diff --check` 均通过。
- `build/` 只包含 `main.js`、`manifest.json` 和 `styles.css`；最终 `build/main.js` 为 1,486,928 bytes。
- 真实 Obsidian 安装/更新 smoke 需另行记录，本轮不以单元测试代替该人工门禁。
