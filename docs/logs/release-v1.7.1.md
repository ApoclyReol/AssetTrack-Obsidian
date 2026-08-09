# Release v1.7.1

## 中文

Asset Track 1.7.1 是一次以稳定导入、规则匹配和草稿保存为重点的修复版本，目标是让月度账单从“预览”到“保存”的链路更可解释、更不容易被旧状态卡住。

### 修复的用户问题

- 修复导入账单后错误出现“流水操作预览”窗口。导入确认现在只把接受的流水放入当前草稿，规则应用仍由流水页单独触发。
- 修复导入草稿保存时报“流水预览已失效”。月份、流水子页面、草稿来源或规则 revision 变化后，旧的异步预览会失效并被安全清理，不再阻塞新草稿保存。
- 导入预览现在可以展开查看被忽略、跨月过滤、状态过滤和其他未进入草稿的条目，降低漏账风险。
- 修复第一次应用规则时把未分类流水误判为“已有分类”的提示；判断改为使用真实保存字段，而不是显示层文本。
- 修复规则直接保存后，旧流水操作日志仍携带旧规则 revision，导致后续月份保存失败的问题。
- 修复多编辑窗口、切换月份或切换子页面后，旧请求回写当前草稿、覆盖新数据或刷新错误页面的问题。
- 修复保存后 canonical 数据、revision 和缓存没有同步，避免出现保存成功但页面仍显示旧数据的情况。
- 修复备份恢复与写入竞争、恢复候选选择、schema 9→10 多理财账户迁移歧义、AI 分类结果错配，以及历史商品分析大小写/空格误判。
- 修复商品总览日期文字与日历图标重叠。

### 规则和警告体验优化

- 规则仍按“交易对手 + 商品 > 商品 > 交易对手”的固定优先级单次匹配。
- 重写字段后再次命中时，只要同级别没有分类冲突，就允许继续命中；同分类重写链不再被当成阻塞错误，真正的分类冲突仍会被明确提示。
- 流水警告按“会阻止保存的错误优先，其次按字段重要性”排序，最多显示 10 条，并显示还有多少条被省略。
- 警告只出现在流水子页面，不干扰资产、借款、固定资产、分析和配置页面。
- 导入失败保留可重试状态；保存前后重新校验月份 revision、规则 revision、前置值和最终流水，减少旧预览造成的误导。

### 兼容性和数据边界

- 版本号为 1.7.1，最低 Obsidian 版本仍为 1.13.0。
- 不新增 schema、数据库路径、备份格式或设置迁移；现有 schema 10 数据继续使用原路径和备份规则。
- 正式安装包仍只包含 `main.js`、`manifest.json` 和 `styles.css`。

### 验证结果

- `npm test -- --run`：39 个测试文件、218 个测试全部通过。
- `npm run typecheck`、`npm run lint`、`npm run test:perf`、`git diff --check` 全部通过。
- `npm run build`、`npm run release:check` 和 `bash scripts/smoke_test_plugin.sh build` 全部通过。

## English

Asset Track 1.7.1 is a corrective release focused on making bill import, rule matching, and draft saving predictable and recoverable.

### User-facing fixes

- Removed the unexpected transaction-operation preview after bill import. Import confirmation now only adds accepted rows to the current draft; rule application remains an explicit Transactions-page action.
- Fixed “transaction preview expired” when saving an imported draft. Stale previews are invalidated when the month, Transactions subpage, draft source, or rule revision changes, so they no longer block a fresh save.
- Import previews can now expand ignored, cross-month-filtered, status-filtered, and otherwise excluded rows to make missing transactions visible.
- Fixed the first rule application claiming that rows already had categories when they were actually unclassified; the check now uses the persisted category field rather than display text.
- Fixed old operation metadata retaining a previous rule revision after a direct rule save and blocking the next month save.
- Fixed stale async results across multiple editor views, month changes, subpage changes, and draft replacement.
- Fixed canonical draft, revision, and cache synchronization after save.
- Fixed restore/write races, recovery candidate selection, ambiguous schema 9→10 migration with multiple investment accounts, AI result mismatches, and case/whitespace false positives in historical product analysis.
- Fixed the Item overview date text overlapping its calendar icon.

### Rule and warning experience

- Rules still use one-pass matching with fixed priority: counterparty + item, item, then counterparty.
- Rewritten fields may match again when no same-level category conflict exists. Same-category rewrite chains are allowed; genuine category conflicts remain visible.
- Transaction issues are sorted with save-blocking errors first and field priority second, capped at 10 visible entries with an omitted-count hint.
- Warnings appear only on the Transactions subpage and no longer distract from other editor pages.
- Failed imports preserve retry state; save-time checks revalidate month revisions, rule revisions, before-values, and final rows.

### Compatibility and validation

- Version 1.7.1 keeps the Obsidian 1.13.0 minimum, schema 10, database paths, backup format, and settings boundary unchanged.
- The release bundle contains only `main.js`, `manifest.json`, and `styles.css`.
- Typecheck, lint, 39 Vitest files / 218 tests, SQLite performance, production build, release validation, and plugin smoke testing all passed.
