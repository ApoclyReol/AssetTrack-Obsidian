# Release v1.7.0

## English

Asset Track 1.7.0 expands monthly bill settlement into a consistent rule and transaction-operation workflow.

- Generic exact rules now support item-only, counterparty-only, and counterparty-plus-item scopes with fixed priority, rewrite fields, duplicate detection, conflict reporting, and rewrite-chain validation.
- Imports, rule application, bulk edits, income/daifu conversion, historical category backfills, and item/counterparty renames use a preview → confirmation → draft → save flow with revision and before-value revalidation.
- The Transactions page adds Outgoing, Incoming, and Investment tabs plus individual, item-summary, and counterparty-summary views. Summary groups map back to stable source transaction IDs and can create rules directly.
- Added protected-row handling, bulk counterparty/item/category edits, income/daifu conversion, and local audit details with success, skipped, failed, and before/after information; the Transactions page no longer exposes a separate operation-history button.
- Category definitions now persist descriptions. Data health opens item-category conflict results directly; Item overview supports saved-history filters, item/counterparty editing, category backfill, and rule creation with impact preview.
- Investment deposits and withdrawals can be assigned to an investment account. Monthly analysis shows each account's principal, current-month flows, market value, liquid funds, position, return, and comparison with the previous month.
- Tables now use tighter fixed column proportions, centered controls, differentiated selects, and clearer latest-month rule reporting.
- Annual analysis now distinguishes total assets from market net assets in cards and trend legends; the recent 12-month legend keeps cash in the third position.
- Optional AI classification uses Obsidian SecretStorage for the API key, sends only selected classifiable rows, excludes protected rows unless explicitly included, groups results by status, supports retries, and never creates permanent rules automatically.
- Schema 10 adds investment-account links for deposit and withdrawal transactions while retaining category descriptions, generic rule fields, transaction import sources, normalized rule uniqueness, and local operation logs. Opening schema 9 creates a protection backup before the rollback-safe 9→10 migration.
- The P3 many-to-many relationship between daifu and expenses remains intentionally out of scope.

Automated validation for this update includes typecheck, lint, the full Vitest suite, schema migration, backup, transaction-operation, AI parsing, and SQLite performance coverage. Real Obsidian macOS/Windows smoke testing has also passed; the release is ready to publish from the standard three-file bundle.

## 中文

Asset Track 1.7.0 将月度账单结算扩展为统一的规则与流水操作流程。

- 规则升级为仅商品、仅交易对手、交易对手 + 商品三种精确匹配范围，固定按组合规则、商品规则、交易对手规则匹配，并支持重写字段、重复检测、冲突报告和重写链校验。
- 导入、应用规则、收入/代付转换、历史分类回写以及商品/交易对手统一都采用“预览 → 确认 → 草稿 → 保存”流程；批量修改在同一个编辑窗口中显示简要前后对比并直接进入草稿，保存时重新校验 revision 和前置值。
- 流水页增加出账、入账、理财 Tab，以及逐项、按商品汇总、按交易对手汇总三种视图；汇总组仍映射回稳定的原始流水 ID，也可以直接创建规则。
- 新增保护流水、批量修改交易对手/商品/分类、类型转换和本地审计详情，记录成功、跳过、失败及前后字段；流水页不再显示独立的操作记录按钮。
- 分类定义正式保存描述字段；数据健康直接展示商品-分类冲突处理结果；商品总览支持已保存历史筛选、商品/交易对手编辑、分类回写和直接保存规则创建。
- 加仓和提现可以绑定具体理财账户；月度分析按账户展示本金、本月加仓/提现、市值、流动资金、仓位、收益率和上月对比。
- 表格统一使用更紧凑的固定列宽、居中控件、区分明显的下拉框，并在匹配规则中展示最近月份。
- 年度分析区分总资产与市场净资产的卡片和趋势图例，近 12 个月图例保持现金位于第三项。
- 可选 AI 分类使用 Obsidian SecretStorage 保存 API Key，只发送选中的可分类流水，保护流水默认不发送，按状态分组并支持重试，不自动创建永久规则。
- 数据库升级至 schema 10，在保留分类描述、通用规则字段、流水导入来源、规范化规则唯一性和本地操作日志的基础上，为加仓/提现增加理财账户关联；打开 schema 9 前先创建保护备份，再执行可回滚的 9→10 迁移。
- P3 代付与支出的多对多关系仍按设计保留在未来范围，不在本版本实现。

本次更新已覆盖类型检查、lint、完整 Vitest、schema 迁移、备份、流水操作、AI 解析和 SQLite 性能测试；真实 Obsidian macOS/Windows smoke 已通过，可以使用标准三文件产物发布。
