# Release v1.8.0

## 中文

Asset Track 1.8.0 聚焦账单导入后的整理体验、代付规则和升级安全。原计划在
1.7.1 中修复的规则循环冲突、特定规则下月账单无法保存等严重问题已合并到本版本；
1.7.1 不单独作为正式发布版本，建议用户直接升级到 1.8.0。

### 主要变化

- 代付现在可以创建和保存独立匹配规则，仍使用支出分类，适合处理 AA、聚餐和代付回款。
- 导入账单、应用规则、批量编辑和保存提示更清晰；被过滤条目可在预览中检查，避免漏导重要流水。
- 流水支持通过逐项、商品汇总和交易对手汇总视图按数量发现重复账单，并快速沉淀成个人规则集。
- 商品总览、年度周期消费、导入字段确认等界面更紧凑，减少宽松布局和日期控件重叠。

### 升级与数据

- 数据库模式升级到 schema 11；旧 schema 9/10 会自动备份并迁移到最新版本。
- 升级前会在数据目录创建 `backups/before-schema11-*.db` 保护备份，迁移失败不会覆盖原数据库。
- README、用户指南和安全说明补充了 Obsidian 文件系统访问警告的边界：该能力只用于本地 SQLite、保护快照和备份恢复管理。
- 最低 Obsidian 版本仍为 1.13.0；建议先升级到当前最新 1.13.x 桌面版，再安装或更新插件。

## English

Asset Track 1.8.0 focuses on bill-import cleanup, daifu rules, and safe upgrades. The
serious rule-loop conflict and draft-saving fixes originally prepared for 1.7.1 are included
in this release; 1.7.1 is not published separately, so users should upgrade directly to 1.8.0.

### Highlights

- Daifu transactions can now use their own matching rules while still using expense categories.
- Bill import, rule application, batch edits, and save feedback are clearer; filtered rows can be reviewed in the import preview.
- Detail, product summary, and counterparty summary views make repeated bills easier to find and turn into reusable rules.
- Product overview, annual recurring spending, and import field mapping layouts are more compact.

### Upgrade and data

- The database schema upgrades to schema 11; older schema 9/10 databases are backed up and migrated automatically.
- A protective `backups/before-schema11-*.db` copy is created before migration, and failed migrations do not overwrite the original database.
- The README, user guide, and security notes clarify the Direct Filesystem Access warning: it is used for local SQLite, protection snapshots, and backup/restore management.
- Obsidian 1.13.0 or later is still required. Update to the latest available 1.13.x desktop release before installing or updating.
