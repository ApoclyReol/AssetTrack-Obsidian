# Changelog

## 1.7.0

### 中文更新

- 规则升级为“仅商品 / 仅交易对手 / 交易对手 + 商品”三种精确匹配范围，固定按组合规则、商品规则、交易对手规则优先匹配；重复条件、无效分类和重写链会在保存前阻止。
- 账单导入、应用规则、批量修改、收入/代付转换和历史回写统一先生成影响预览，确认后进入草稿，保存时复核月份 revision、规则 revision、前置值和最终流水。
- 流水页增加出账、入账、理财 Tab，以及逐项、按商品汇总、按交易对手汇总三种视图；支持稳定流水选择、保护范围、批量编辑和汇总组操作，操作审计保存在本地但不再显示独立按钮。
- 新增本地操作日志，记录来源、业务范围、选择范围、成功/跳过/失败数量、前后字段、规则编号和 AI 批次结果；历史统计只读取已保存月份。
- 支出与代付支持可追溯的类型转换并保留分类；当前阶段不建立代付与支出的多对多关系，也不计算个人承担额。
- 分类定义增加描述字段；数据健康直接展示商品-分类冲突；商品总览支持商品/交易对手历史汇总、筛选、编辑和规则创建。
- 新增可选 AI 分类建议：API Key 使用 Obsidian SecretStorage，只发送选中的可分类流水，结果按已分类、未分类、待确认和失败分组，支持重试，不自动生成永久规则。
- 加仓和提现可以绑定具体理财账户；月度分析按账户展示本金、本月资金流、市值、流动资金、仓位、收益率和上月对比。
- 表格列宽、复选框、下拉框和规则最近月份展示进一步统一；固定资产、分类定义和匹配规则表的主要字段更易编辑。
- 数据库升级至 schema 10，增加理财流水账户字段；schema 9 首次打开会先创建保护备份并执行可回滚的 9→10 迁移。

### English updates

- Matching rules now support three exact scopes: item only, counterparty only, and counterparty + item. Fixed priority is combination, item, then counterparty; duplicate conditions, invalid categories, and rewrite chains are blocked before saving.
- Imports, rule application, bulk edits, income/daifu conversion, and historical backfills now produce impact previews, enter the draft only after confirmation, and revalidate month revisions, rule revisions, before-values, and final rows at save time.
- The Transactions page now provides Outgoing, Incoming, and Investment tabs with individual, item-summary, and counterparty-summary views; stable row selection, protected rows, bulk edits, group rule creation, and operation history are supported.
- Added local operation logs for source, business scope, selection, success/skipped/failed counts, before/after fields, rule IDs, and AI batch results. Historical reports read saved months only.
- Income and daifu support auditable type conversion. The current release does not add many-to-many daifu/expense links or personal-share calculations.
- Category definitions now include descriptions. Data health opens item-category conflict results directly; Item overview supports historical item/counterparty summaries, filters, edits, and rule creation.
- Added optional AI classification suggestions using Obsidian SecretStorage for the API key. Only selected classifiable rows are sent; results are grouped by classified, unclassified, needs review, and error, with retry support and no automatic permanent rules.
- Investment deposits and withdrawals can now be assigned to investment accounts. Monthly analysis shows account-level principal, monthly flows, market value, liquid funds, position, return, and previous-month comparison.
- Table proportions, checkboxes, selects, and latest-month rule reporting are further standardized; key fields in fixed assets, category definitions, and matching rules are easier to edit.
- Database schema 10 adds investment-account links for investment flows. Opening schema 9 creates a protection backup before the rollback-safe 9→10 migration.

## 1.6.0

### 中文更新

- 重整主导航为“分析 / 记录 / 配置”，并将资产账户、流水、借款、固定资产拆分为独立页面。
- 各记录区块支持独立保存、放弃并重载；切换页面、月份或编辑范围时，会提示处理未保存修改。
- 数据健康直接展示商品-分类冲突处理表；商品总览支持筛选、搜索、创建规则、编辑商品和编辑分类。
- 匹配规则改为仅按收支类型和商品匹配；交易对方仍保留在流水和历史详情中，但不参与规则匹配。
- 年度分析补充年末总资产、净资产、现金、借款和当年出现过的固定资产；月度分析以总资产展示资产变化，年度与月度储蓄率及对账状态口径保持一致。
- 统一表格、输入框、下拉框和复选框的布局与样式，压缩页面顶部操作区，并在新增行后自动滚动到编辑位置。
- 补充重复规则、未来借款限制及数据健康、商品和分类编辑相关的中英文提示。

### English updates

- Reorganized the primary navigation into Analysis, Records, and Configuration, with separate pages for Accounts, Transactions, Debts, and Fixed assets.
- Each record section now supports independent save or discard-and-reload actions, with unsaved-change confirmation when switching pages, months, or editing scopes.
- Data health now opens the item-category conflict table directly. Item overview supports filtering, search, rule creation, item editing, and category editing.
- Matching rules now use only transaction type and item. Counterparty remains available in transactions and history details, but does not participate in rule matching.
- Annual analysis now shows year-end total assets, net assets, cash, debt, and fixed assets recorded during the year. Monthly analysis uses total assets for asset changes, while annual and monthly savings and reconciliation wording remain aligned.
- Standardized the layout and styling of tables, inputs, selects, and checkboxes, compacted the page action area, and auto-scrolls to newly added rows for editing.
- Added user-facing mappings for duplicate-rule validation, future-debt restrictions, and data-health, item-editing, and category-editing messages.

## 1.5.0

### 中文更新

- 借款管理整合到月流水页：上月未还借款会自动继承，用户在对应月份新增借款或勾选“本月还清”，底层仍写入全局借款事实表。
- 借款变化进入月流水顶部对账差额的实时计算，新增、还清或修改当月借款金额后不必等保存即可看到差额变化。
- 关闭未来月份已还清借款的历史月份修改入口；若历史月份修改会覆盖未来还清事实，界面和 Repository 都会拒绝。
- 代付、加仓、提现不再显示分类列、分类选择或“无需分类”占位；保存时继续拒绝特殊类型携带分类。
- 按商品汇总移除“最近日期”列，优化商品、分类等列宽，并支持按收支和分类排序。
- 保持 Obsidian 1.13.0+、SQLite schema 9、数据库路径、备份格式和既有 `data.json` 兼容字段不变。

### English updates

- Debt management is now part of the monthly transaction page. Unpaid debts carry forward automatically, and users add or mark debts as paid in the relevant month while the global debt fact table remains the source of truth.
- Debt changes now feed the live reconciliation difference in the monthly editor. Adding, repaying, or changing same-month debt amounts updates the difference before saving.
- Historical months cannot overwrite a debt that has already been paid in a future month; both the UI and Repository reject that boundary.
- Proxy payment, investment deposit, and investment withdrawal rows no longer show category columns, category selectors, or “no category required” placeholders.
- Item summary removes the Latest date column, improves item/category column proportions, and supports sorting by type and category.
- Obsidian 1.13.0+, SQLite schema 9, database paths, backup formats, and compatible `data.json` fields remain unchanged.

## 1.4.1

### 中文更新

- 优化规则匹配和历史规则分析查询，减少重复扫描，在大数据量下提升商品总览和规则工作台响应速度。
- 优化生产构建配置，减少 `main.js` 体积并改善插件加载效率；本次版本主要是性能优化和开发维护更新。
- 拆分分析页、编辑器表格、规则历史弹窗和 Repository 辅助职责，降低后续维护和迭代成本。
- 保持 Obsidian 1.13.0+、schema 9、数据库路径、`data.json` 兼容字段和备份格式不变。

### English updates

- Optimized rule matching and historical rule-analysis queries to avoid repeated scans and improve Item overview and Rules workspace responsiveness on larger datasets.
- Improved the production build configuration to reduce `main.js` size and improve plugin loading efficiency. This release is primarily a performance and development-maintenance update.
- Split the analysis pages, editor tables, rule-history modals, and Repository helpers into clearer maintenance boundaries.
- Obsidian 1.13.0+, schema 9, database paths, compatible `data.json` fields, and backup formats remain unchanged.

## 1.4.0

### 中文更新

- 最低兼容 Obsidian 版本提升至 1.13.0；安装或更新前请先升级到当前最新的 1.13.x 桌面版。
- 设置页改用 Obsidian 1.13 `getSettingDefinitions()`，数据目录使用原生文件夹控件，
  备份恢复和账户管理使用独立设置页；移除已弃用的 `PluginSettingTab.display()`。
- 移除插件对 `getAllLoadedFiles()`、`getFiles()` 和 `getMarkdownFiles()` 的调用，避免主动
  获取 Vault 中的全部文件路径。
- 分类定义仅保留历史流水数；商品冲突处理表移除交易对方数、月份数和金额字段，完整统计移至分析页“商品总览”。
- 商品总览移除健康状态和所属规则列，保留分类、交易统计和金额统计。
- 规则页移除 revision 技术信息和 SQLite 实现说明，统一分类、规则和商品历史表头样式。
- 流水编辑器优化创建月份顺序和提示；空的未编辑月份删除时不再重复确认，行号支持排序，操作列补齐表头。
- 分类定义操作按钮统一为满宽按钮，并收窄大额、颜色和流水数列；商品总览统一背景、对齐和金额显示。
- 所有表格采用固定资产摘要的响应式行为，内容自动换行并仅保留纵向滚动，避免不必要的横向滚动。
- 保持 schema 9、数据库路径、`data.json` 兼容字段和备份格式不变。

### English updates

- The minimum supported Obsidian version is now 1.13.0. Update to the latest available 1.13.x desktop release before installing or updating.
- Settings now use Obsidian 1.13 `getSettingDefinitions()` with the native folder control; backup and account management use dedicated settings pages, and the deprecated `PluginSettingTab.display()` entry point has been removed.
- The plugin no longer calls `getAllLoadedFiles()`, `getFiles()`, or `getMarkdownFiles()`, so it does not proactively enumerate every path in the Vault.
- Category definitions now keep only the historical transaction count; conflict handling no longer shows counterparty, month, or amount metrics, which are available in the new Item overview analysis tab.
- Item overview no longer includes Health or Matching rule columns; it focuses on category, transaction, and amount statistics.
- The Rules workspace removes revision and SQLite implementation details and applies consistent table-header styling across category, rule, and item-history tables.
- The transaction editor improves month creation order and messaging; deleting an unedited empty month no longer asks for repeated confirmation, row numbers are sortable, and operation headers are visible.
- Category action buttons now use the shared full-width action style, compact columns are used for large-expense flag, color, and transaction count, and Item overview aligns backgrounds, amounts, counts, and dates consistently.
- All tables follow the Fixed asset summary responsive behavior with wrapping and vertical scrolling only, avoiding unnecessary horizontal scrolling.
- SQLite schema, database paths, compatible `data.json` fields, and backup formats remain unchanged.

## 1.3.0

- 规则工作台增加商品/分类冲突与规则冲突双视图；规则冲突按重复、同条件不同分类和条件重叠分组展示，后台层级不暴露给用户。
- 商品回溯支持按收支、分类和商品搜索动态选择多个商品组并统一名称；分类迁移和商品统一均使用预览、revision 校验与 SQLite 单事务写入。
- 规则审计和实际覆盖范围分开显示；精确规则只覆盖部分交易对方时标记为“部分覆盖”，未覆盖流水仍可生成规则建议。
- 分类删除改为弹窗说明历史流水或规则引用；分类定义不再显示商品冲突字段，推荐规则排除历史/规则冲突候选。
- 规则工作台移除整体保存，分类和匹配规则分别保存并分别报告结果；推荐规则并入健康摘要中的无规则商品面板，创建确认后直接保存并刷新冲突统计。
- 商品统一支持按“分类 + 商品”或“商品”多选聚合；商品/分类回溯写入后恢复当前筛选并刷新冲突统计表。
- 账单导入允许缺少日期或保留空日期，统一默认到当前月份 1 日；空状态可选择导入，安全警告流水可以先保存，真正无效的日期、金额和收支值仍被拦截。
- 统一限制 Modal 和普通表格的最小宽度，长文本自动换行，避免商品、回溯、导入和规则表在窄窗口产生不必要的横向滚动；统一表头、正文小字号和上下居中规则。
- 流水编辑页顶部增加实时对账差额、收入和净支出摘要，月份选择器统一右对齐；对账状态改为“多消费少收入”和“少收入多支出”。
- 关闭有未保存内容的编辑视图时，取消放弃会在同一插件会话中重新打开并恢复月流水、借款、分类或规则草稿；外部 revision 变化仍会阻止旧草稿覆盖。
- 创建新月份的限制不再作为常驻提示文字显示；点击创建按钮后才提示具体原因。
- 加强英文界面的领域错误和导入错误翻译，避免未映射的中文系统错误泄漏到英文界面；移除未使用的弃用路径别名，并修复开发依赖审计中的高危锁定版本。
- 不可排序表头改用静态文本语义，不再伪装成禁用按钮；操作列继续保留隐藏的无障碍名称。
- 保持 schema 9、数据库和备份格式兼容；构建仍只生成 `build/main.js`、`build/manifest.json` 和 `build/styles.css`。

## 1.2.0

- 设置新增基础货币、标准/会计金额格式、平账容差和大额支出阈值，所有界面金额统一通过 `Intl.NumberFormat` 显示。
- 资产分析并列提供资金投入资产与市场净资产；对账继续使用本金口径，财富趋势使用市值与理财账户现金。
- 年度分析新增最近 12 个有数据月份的只读周期消费面板，按商品汇总周期分类支出。
- 月度草稿改为 reducer 动作标记 dirty，增加 React Error Boundary，并移除账单导入的 Data URL/Base64 中间副本。
- 保持 SQLite schema 9、数据库路径、备份格式和中文业务枚举不变。

## 1.1.0

- 同步 Community Plugins 审核通过状态，社区目录改为首选安装方式，手动三文件
  安装保留为备用方式；路线图转为发布后质量与功能演进。
- `release:check` 自动核对由 lockfile 和生产构建生成的第三方依赖版本、许可证、
  插件版本与 `main.js` 实际大小。
- 界面自动跟随应用语言：中文环境显示中文，其他语言回退英文；设置、编辑器、分析、
  账单导入、弹窗、系统文件选择器、提示和无障碍文本均接入统一语言层。
- 内置业务枚举提供英文显示标签，但 schema 9、数据库原值和用户创建的账户、分类、
  交易对方、商品及流水内容保持不变。
- README 完善英文说明，并新增独立 `README.zh-CN.md` 中文版本，覆盖安装、使用、
  语言、数据、备份、隐私和开发说明。

## 1.0.5

- 修正 Community Plugins 要求的英文 manifest 描述及结尾标点。
- README 改为英文优先并补齐安装、开始使用、权限与数据边界说明，同时保留中文
  快速说明。
- 移除未使用的程序化剪贴板访问；生产 React 运行时调整为 18.3.1，消除 bundle
  中被审核器判定为动态脚本注入的代码。
- 新增 tag 驱动的 GitHub Release 工作流，只发布标准三文件并生成 artifact
  attestations；发布校验增加 manifest、README 和生产 bundle 审核门禁。

## 1.0.4

- 修复异常设置、非法 Vault 相对路径和损坏 schema 9 数据库未能被完整拦截的问题；
  数据库恢复继续遵守校验后替换和失败不覆盖边界。
- 修复账单导入准备失败后草稿已被部分修改、重试可能重复追加的问题，并限制单个
  导入文件为 20 MiB。
- 修复弹出窗口中的事件归属、重复订阅和插件卸载问题；确认窗口改用 Obsidian
  Modal，并补齐 CSV 映射窗口的键盘与辅助功能行为。
- 修复大流水表全部渲染及分块编号重复扫描导致的卡顿。
- 修复主题颜色、焦点状态和窄窗口布局兼容问题，保持收入红、支出绿语义。
- 修复安装替换失败可能丢失旧插件的问题；严格 lint 达到零 warning，并补充
  三平台静态构建验证。

## 1.0.3

- 显著增强普通、主操作、选中和危险按钮的 hover 对比度、强调色外环、阴影、
  上浮与轻微放大反馈。
- 可点击按钮强制显示手型指针，禁用按钮显示禁用指针；按下时增加回落反馈。
- 增加键盘 `focus-visible` 轮廓，并在减少动态效果偏好下取消 hover 位移。

## 1.0.2

- 添加根目录 MIT License、package 许可证元数据和直接生产依赖许可证声明。
- 安全文档与数据目录、保护快照、手动 ZIP、本地导入、诊断和卸载行为保持一致。
- README 增加五步快速开始、账单格式、兼容要求、数据保留和备份责任说明。
- 增加 ESLint、Obsidian 规则、GitHub Actions 与版本、三文件、bundle 大小及
  SheetJS integrity 发布校验。
- 社区发布流程更新为 1.0.2，并把三平台真实 Obsidian smoke 保持为未完成硬门槛。
- 增强按钮 hover 的边框、背景、阴影和轻微位移反馈；可点击按钮使用指针光标，
  禁用按钮使用禁用光标并支持减少动态效果偏好。

## 1.0.1

- 插件启动只加载设置和注册界面，数据库仅在显式创建、载入或打开已配置
  ItemView 时初始化。
- 设置改为“Asset-track 数据目录”；数据库直接保存为
  `<数据目录>/accounting_system.db`，不再套用 `data/`。
- 新增未配置、初始化、就绪和错误状态；未就绪 ItemView 显示设置引导。
- 目录输入只读检查，创建、载入、迁移和切换均为显式操作。
- 切换及恢复前的保护快照统一写入当前数据目录的 `backups/`。
- 设置页将备份恢复和“打开数据目录”合并到数据库存储区域，移除数据库重开、
  复制诊断和重复路径说明。

## 1.0.0

- 流水按类型分块编号，新建流水不再默认选择分类，并完整展开编辑表。
- 账单导入增加 XLSX/XLS、交易对方和文件内动态交易状态选择。
- 交易与规则增加交易对方，规则可组合交易对方和商品精确匹配。
- 月度分析增加理财环比，分类对比排除大额分类，异常变化增加阈值。
- 分类对比将增减额与上月/本月金额并入单图；异常表改为自动换行的三列表。
- 对账差额绝对值小于 100 元标记为平账。
- 设置页隐藏内部 schema 和备份格式术语。
- 完成旧私有数据离线过渡，开发目录删除一次性迁移工具、Python 缓存、
  虚拟环境、旧 sidecar 构建和本地数据库副本。
