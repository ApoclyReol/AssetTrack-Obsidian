# 04 架构

> 文档角色：开发与维护。本文说明运行链、数据路径、生命周期和写入边界；用户无需阅读
> 这些实现细节。

## 国际化边界

`src/i18n.ts` 是界面语言的唯一入口，通过 Obsidian `getLanguage()` 把 `zh-*`
映射为 `zh-CN`，其他语言映射为英文。React 界面、Setting API、Modal、Notice
和 Electron 原生文件选择器共享该入口。

国际化只存在于展示层。Repository、Service、schema 9、CSV 解析和财务计算继续
使用既有规范值；中文业务枚举在展示时映射为英文标签，提交时仍写入原规范值。

## 当前运行链

```mermaid
flowchart LR
    A["Obsidian ItemView"] --> B["React + Recharts"]
    B --> C["AssetTrackService"]
    C --> D["TypeScript Repository"]
    D --> E["node:sqlite"]
    E --> F["SQLite schema 9"]
```

| 层 | 当前职责 |
|---|---|
| Obsidian 插件 | View、Ribbon、设置、文件夹选择和生命周期 |
| React | 草稿、表格交互、导航保护和实时图表 |
| Service | UI 稳定接口、账单导入、备份恢复和诊断 |
| Repository | 财务计算、校验、revision、事务和 SQL |
| DatabaseManager | 单例连接、WAL、写入队列、快照和关闭 |
| SQLite | 唯一持久化事实 |

## 产品定位对架构的约束

运行链服务的是“月度结算”，不是高频手工记账：账单从用户明确选择的文件进入导入
预览，经过统一字段语义、规则匹配和质检后写入月度草稿，再由 Repository 在单个
SQLite 事务中提交。手工编辑用于纠错、补漏和特殊交易；不能因为增加快捷录入入口，
就绕过同一套校验、revision 和事务边界。

SQLite 是唯一事实层。界面草稿、导入映射、分析缓存、Markdown 内容和导出文件都
必须被视为临时状态、配置或查询结果；新增财务对象必须先定义 schema、Repository
canonical rows 和领域计算，再接入 UI。不能把某个平台的账单另存为独立事实表，
也不能在页面组件中复制一套金额或资产计算。

资产对账属于数据质量闭环的一部分。新导入、规则、月末资产和分析功能都应说明它
如何影响覆盖检查、对账差额或结果追溯；只增加图表而不改善事实完整性和解释路径的
功能不应优先于结算链路。

未来的导入批次、数据源、日期覆盖和重复风险元数据，若进入正式实现，必须落在同一
SQLite 事实模型中并由同一 Service/Repository 管理；不得引入云端服务、平台专属
交易表或第二个本地账本。

插件加载时只注册 View、设置、Ribbon 和命令，不创建 Service 或打开数据库。用户
显式创建/载入数据库或打开已配置 ItemView 时才探测 `node:sqlite`。插件卸载和
恢复前关闭连接；目录切换的新库验证与设置提交完成后才关闭旧连接，
不启动子进程、不监听端口、不产生 HTTP 会话。

## 数据路径与运行时

数据库固定解析为：

```text
<Vault>/<dataDirectory>/accounting_system.db
<Vault>/<dataDirectory>/backups/
```

未配置时不创建数据库。运行时要求 Node 22.16 以上且提供 `DatabaseSync` 和
`sqlite.backup`；能力不足时只返回升级提示。最低 Obsidian 版本为 1.13.0；发布
当前版本发布前请先升级到当前最新的 1.13.x 桌面版。

插件 `data.json` 只保存 `dataDirectory` 和账单映射元数据，不保存财务事实。
schema 9 在流水和自动规则中分别保存 `counterparty`；流水字段继续作为事实和统计数据使用，
自动规则中的该列仅为历史兼容字段，当前规则匹配忽略它；插件运行时不包含旧 schema 自动迁移逻辑。

当前版本起，`data.json` 还保存基础货币、金额格式、平账容差和大额支出阈值；v1.6.0
不改变这些设置的兼容方式。
这些字段只影响展示与分析，不改变 schema 9 或备份格式。月度草稿使用 reducer
动作标记 dirty，保存后以 canonical workspace 和新 revision 重置。账单文件以
`ArrayBuffer` 读取，不再构造 Data URL/Base64 中间副本。

设置页使用 Obsidian 1.13 的 `getSettingDefinitions()` 声明设置项；数据目录使用
原生 `folder` 控件，备份恢复和账户管理使用独立 `SettingPage`。目录选择只更新
设置页草稿，只有创建、载入或迁移成功后才写入 `data.json`。插件代码不调用
`getAllLoadedFiles()`、`getFiles()` 或 `getMarkdownFiles()`，不主动枚举 Vault 中的
全部文件。

当前仍保留的技术债：

- UI 已完成第二轮按职责拆分：`AnalysisView.tsx` 负责分析导航，年度和月度分析位于独立模块；
  `AssetTrackEditorApp.tsx` 负责 ItemView 路由和页面级导航，`MonthEditor.tsx` 保留草稿、dirty、
  revision、保存和重载协调，纯计算与导入模型位于 `monthEditorModel.ts`，资产、流水、借款和
  固定资产区块位于 `src/ui/month/`；
- `RulesEditor.tsx` 保留分类/规则 workspace、dirty、revision、保存和数据健康协调，分类定义表与
  匹配规则表位于 `src/ui/rules/`。数据健康、商品总览和历史迁移位于
  `src/ui/configuration/`；`RuleHistoryModal.tsx` 只保留 Modal 生命周期和旧导出兼容层；
- `AssetTrackRepository.ts` 现在是兼容 facade、读取协调和事务上下文入口。月份、账户余额、流水、借款、
  固定资产写入位于 `monthWriteRepository.ts`，分类、规则和账户定义写入位于
  `configurationWriteRepository.ts`，分类回溯和商品名称统一位于 `historyWriteRepository.ts`。
  规则读取进一步拆为 `ruleReportReadModel.ts` 和 `productHistoryReadModel.ts`，由
  `ruleHistoryReadModel.ts` 兼容 facade 协调。所有写侧模块都接收 facade 传入的同一个
  `DatabaseSync` 上下文；每个公开写入入口仍只调用一次 `manager.write()`，不得让子模块自行打开连接；
- 账单解析仍在主线程执行，尚未迁入 Worker；
- 国际化仍以双参数 `t()` 为主，部分历史错误仍依赖中文文本映射，尚未全面切换
  到消息键和结构化错误码。

后续重构必须保持 schema、Service/Repository 接口、月度事务和导入预览契约稳定，
不得把结构整理与财务事实迁移混在同一变更中。

## 实例与写入边界

- 插件实例共享 DatabaseManager、Repository、Service、写入队列和数据变更事件。
- 每个 ItemView 独立保存当前页面、月份、排序、筛选、草稿和 dirty 状态。
- ItemView 持续接收月流水、月内借款、分类和规则编辑器的可序列化草稿快照。由于
  Obsidian 的 `onClose()` 不能取消关闭，用户取消放弃时由插件内存中的一次性恢复令牌
  重新打开同一模式并恢复草稿；令牌不写数据库、设置或 workspace layout，插件卸载时清空。
  恢复后仍以草稿携带的旧 revision 保存，数据库 revision 已变化时只提示外部修改，不覆盖草稿。
- 月份、月内借款、规则、分类和账户保存均携带 revision。
- 月份校验、revision 检查、所有月度表更新和 revision 增加位于同一
  `BEGIN IMMEDIATE` 事务。
- 规则工作台首次使用 `ruleWorkspaceShell()` 读取轻量分类、规则和 revision，数据健康和商品总览按需要
  通过 `productHistoryIndex()` / `productOverview()` 加载；筛选变化后自动刷新，具体商品详情才打开回溯 Modal。
  商品编辑通过 `previewProductRename()` / `applyProductRename()` 只修改商品字段；分类迁移 Modal 直接使用
  `category_key` 加载源分类商品。所有商品历史只读取 `month_status.status='saved'` 的月份。
  规则解析共享 `src/domain/rules.ts`，只按收支类型和商品索引；旧 `RuleConflictGroup` 和规则覆盖诊断仍由
  后端兼容接口派生，不新增数据库结构，也不作为当前数据健康页面的独立问题类型。
- 商品历史把规则审计与实际覆盖范围分开派生：`rule_coverage` 为 `none`、`partial` 或
  `full`，同时记录命中、未命中和冲突次数。无规则筛选包含完全未覆盖和部分覆盖商品；
  建议只使用未覆盖且没有未解决规则冲突的流水计算。
- `previewCategoryBackfill()` / `applyCategoryBackfill()` 携带流水 ID 和每月 revision，在一个 SQLite
  事务中只更新分类字段，并对所有受影响月份各增加一次 revision；商品名称统一使用同样的事务边界，
  只更新 `transactions.product`。
- 规则页面分别通过 `saveCategories()` 与 `saveRules()` 保存分类和自动规则，各自校验对应 revision；
  `saveRuleWorkspace()` 继续保留为兼容接口和需要原子保存的调用方。
- 保存后使用 Repository canonical rows 重建 clean 草稿。
- 账单检查和预览不写数据库；增量模式严格不去重。
- 恢复先校验、staging 和安全快照，再关闭连接并原子替换；失败恢复原数据库。

## Repository 当前拆分状态

Repository 的第一轮读写拆分已经完成，`AssetTrackRepository` 继续作为 Service 依赖的兼容 facade：

```text
src/database/
├─ AssetTrackRepository.ts          # 对外 facade、事务入口和兼容方法
├─ monthWriteRepository.ts          # 月份、账户余额、流水、借款、固定资产写入
├─ configurationWriteRepository.ts  # 分类、规则、账户定义写入
├─ historyWriteRepository.ts        # 分类回溯、商品名称统一及 revision 校验
├─ analysisReadModel.ts             # 年度、月度和资产只读分析
├─ ruleReportReadModel.ts           # 规则定义、匹配预览、冲突报告和规则候选
├─ productHistoryReadModel.ts       # 商品历史、分类统计和商品详情
└─ ruleHistoryReadModel.ts          # 规则历史兼容 facade 和跨模型健康汇总
```

写入拆分通过 `repositoryWriteContext.ts` 传递显式上下文，包含当前 `DatabaseSync`、revision
检查、`touchMonth()`、读取回调和规则历史读取模型。子模块只执行传入连接上的 SQL 和校验；
facade 的每个公开写入方法只调用一次 `manager.write()`：

- `saveMonth()`、`saveMonthSection()` 及借款/固定资产写入必须继续共享月度 revision 和同一事务；
- `saveRuleWorkspace()` 必须继续在一个事务中同时校验并写入分类和规则；
- 分类回溯、商品名称统一必须继续在一个事务中校验所有受影响月份并逐月增加 revision；
- `saveAccounts()` 的账户定义和月度账户余额属于不同 revision 边界，不能为了文件拆分而合并；
- 月度账户余额、流水、借款和固定资产共享月份 revision，但分别由月份写模块中的方法执行；
- `databaseRepository.test.ts` 仍是集中式回归测试，后续可以按月度、配置、历史和分析拆分，
  但不应在没有新增测试边界前单独重排测试文件。

后续只在业务边界继续增长时拆分，不为降低单文件行数而重新组织 facade 或只读模型。

## 发布边界

正式运行不依赖 Python、FastAPI、Pandas、Uvicorn、PyInstaller、sidecar、原生
扩展或 CPU 架构包。安装目录只包含：

```text
main.js
manifest.json
styles.css
```
