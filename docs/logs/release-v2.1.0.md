# v2.1.0 金额规则与流水合并

相对 v2.0.0 的更新。维护者已确认推送和发布，正式资产由 `2.1.0` tag 的发行流程生成。

发行入口：[GitHub Release 2.1.0](https://github.com/ApoclyReol/AssetTrack-Obsidian/releases/tag/2.1.0)。

## English

Compared with 2.0.0:

- **Transaction merging:** Merge recurring items directly from item or counterparty summaries. Preview first, keep categories and complete tag sets separate, and opt tagged transactions in when needed. Confirmation updates the draft; saving replaces the original records.
- **Amount rules:** Identify transactions by an exact amount, comparisons or ranges, with independently inclusive or exclusive endpoints. Combine amounts with item or counterparty conditions to distinguish different purchases on the same platform.
- **Fixes and improvements:** Identify conflicting rules while editing, simplify rule filters and header sorting, clarify blank rewrite behavior, remove the empty category editor section, and improve merge previews and backup validation.

After updating, open Asset Track and choose **Back up and upgrade** when prompted. The plugin creates a local protection backup and upgrades your existing ledger automatically. Existing data is preserved; choosing **Later** leaves it unchanged.

Minimum Obsidian version: 1.13.0. Use the latest 1.13.x desktop version before updating.

## 中文

相对 v2.0.0，本次更新包括：

- **流水合并：** 在商品或交易对手汇总中，将重复项目实际合并。先预览，按分类和完整标签组合分别处理，有标签流水可主动选择参与。确认后进入草稿，保存时替换原逐笔记录。
- **金额规则：** 支持精确金额、低于／不超过、高于／至少及区间，可独立设置是否包含端点。与商品或交易对手条件组合，区分同一平台上的不同消费。
- **问题修复与体验优化：** 编辑规则时指出具体冲突，精简筛选与表头排序，明确重写留空行为，移除分类编辑空区域，改善合并预览和备份校验。

更新后直接打开 Asset Track，在提示中选择 **备份并升级**。插件先创建本地保护备份，再自动升级现有账本，已有数据保留；选择 **稍后** 不会修改数据库。

最低支持 Obsidian 1.13.0，更新前请使用当前最新的 1.13.x 桌面版。

## 维护与验证

- 正式数据库版本统一为 schema 13：schema 12 一步升级，金额、范围和重写设置一并加入。确认前只读检测，确认后保护备份并单事务升级，取消不写入。
- 进入插件即提示升级，无需先跳到设置。多个页面共用同一提示；稍后可继续，修改目录或卸载后不执行过期选择。
- 更早账本默认保留并转换旧分类属性，设置页仍可选择清除；本地开发数据库的结构识别与兼容细节见[规则中心架构](../11-rule-center-architecture.md)。
- 备份格式保持 12，兼容格式 8–11。真实 Obsidian 宿主与目标平台验收按[界面回归协议](../16-ui-regression-protocol.md)记录，自动化和浏览器合成测试不替代宿主验收。
- 发布流程从 CHANGELOG 的本版本 English/中文段落生成正式说明；原本地迭代及安装记录保存在[开发归档](development-amount-rules-merge.md)。

### 2026-10-24 验证与本地安装

- 完整自动化通过：45 个测试文件、400 项测试；typecheck、lint、生产构建、release:check、标准三文件与 `node:sqlite` 冒烟、文档本地链接和 `git diff --check` 均通过。
- 合成 SQLite 覆盖正式 schema 12→13、旧本地开发结构兼容、完整 schema 13 不重复升级、部分损坏与未知版本拒绝、旧备份恢复。提交前校验行数、外键和完整性；损坏引用触发失败回滚，原版本、规则和保护备份均保留。
- 升级入口覆盖多个页面共用提示、稍后后重试、目录变更、卸载及失败状态；卸载期间重新检查账本时不会再创建可写服务。
- 浏览器使用生产组件与样式、合成数据和模拟 Obsidian Modal，实际点击稍后、确认、重开；检查中文浅色 1280×720、中文浅色及英文深色 420×800，无横向溢出且按钮可见。该验证未连接账本，不替代真实 Obsidian 宿主验收。
- 正式说明提取验证通过：仅提取 CHANGELOG 中本版本的 English/中文正文，错误版本拒绝生成，版本源文件统一为 2.1.0。

已将同次构建的三个插件文件安装至当前 Vault，哈希与 build 一致；旧插件文件和安装记录保存在 `/tmp/assettrack-before-install-schema13-20261024/`。未打开或修改正式数据库，`data.json` 哈希保持不变，未自动重载 Obsidian。

上述为候选阶段记录。维护者随后确认推送并发布 v2.1.0；真实宿主与各平台验收不因发布授权而自动记为通过。

### 正式发布检查

维护者于 2026-10-24 确认“推送和发布新版本”。同一工作树重新通过 45 个测试文件 / 400 项测试、typecheck、lint、生产构建、release:check、三文件与 SQLite 冒烟、文档链接及差异检查。发布说明使用已确认的 English/中文正文，发布 tag 为 `2.1.0`，不带 `v` 前缀。

GitHub Actions 在发布前再次检查与构建，并为 `main.js`、`manifest.json`、`styles.css` 分别生成 attestation。正式资产与说明以该 Release 及对应 Actions 记录为准；本地安装或自动化结果不替代真实宿主验收。
