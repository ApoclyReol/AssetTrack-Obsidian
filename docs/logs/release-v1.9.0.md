# Release v1.9.0

## 中文

Asset Track 1.9.0 主要改善账单导入和月度整理的易用性，让用户更容易理解当前步骤、待处理问题和草稿状态。财务计算口径、数据库结构和数据安全边界保持不变。

### 账单导入

导入流程拆分为文件读取、确认映射和检查预览三个可返回步骤，支持工作表、表头和说明段落确认，并集中说明过滤原因。分类不再作为导入阶段的警告；流水先加入草稿后保存映射，映射保存失败时保留草稿并提示“流水已加入，但映射未保存”。

### 流水与月度工作台

月度进度、导入反馈和问题数量统一到一个状态栏，具体问题通过流水行号旁的标记定位，减少重复警告。汇总子表层级、原始账单行回溯、月份切换和对账差额说明也得到整理。

## English

Asset Track 1.9.0 focuses on making bill import and monthly review easier to understand. Financial definitions, database schema, database path, backup format, and settings shape are unchanged.

### Bill import

Import is split into navigable file-reading, mapping, and preview steps, with clearer worksheet, header, explanatory-row, and filtering guidance. Categories no longer produce import-stage warnings; accepted rows enter the draft before mapping persistence, and a mapping failure keeps the draft while showing “Transactions were added, but the mapping was not saved.”

### Transactions and monthly workspace

Monthly progress, import feedback, and issue counts are consolidated, while row markers keep problem details close to the affected transaction. Summary table hierarchy, raw-row tracing, month navigation, and reconciliation explanations are clearer.

## Validation

- Automated validation passed: `npm run typecheck`, `npm run lint`, `npm test` (36 test files / 280 tests),
  `npm run build`, `npm run release:check`, `bash scripts/smoke_test_plugin.sh build`, and `git diff --check`.
- The generated `build/` directory contained only `main.js`, `manifest.json`, and `styles.css`; the final
  `main.js` size was 1,553,967 bytes.
- Real Obsidian installation, update, reload, uninstall, and restart acceptance passed, confirmed by the
  project maintainer on 2026-09-16. The result had been completed but was missing from the earlier release
  documentation; this section records that fact without storing private paths, databases, or bill samples.
