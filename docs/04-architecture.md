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
schema 9 在流水和自动规则中分别保存 `counterparty`；插件运行时不包含旧 schema
自动迁移逻辑。

当前版本起，`data.json` 还保存基础货币、金额格式、平账容差和大额支出阈值；v1.4.0
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

- UI 已完成一轮按职责拆分：`AnalysisView.tsx` 只负责分析导航，首页、商品、年度和月度分析
  分别位于独立模块；流水表、固定资产表、借款编辑、规则工作台和共享编辑原语也已独立。
  `AssetTrackEditorApp.tsx` 仍保留 ItemView 路由、草稿 reducer 和 `MonthEditor`，后续只继续
  拆出边界清晰且不改变草稿/事务契约的部分；
- `RuleHistoryModal.tsx` 现在只负责历史回溯与分类迁移，商品统一和规则创建分别位于
  `ProductRenameModal.tsx`、`RuleCreationModal.tsx`，旧导出入口仅作为兼容层保留；
- `AssetTrackRepository.ts` 仍是事务与 SQL 的主 facade，纯行转换和规则报告已抽到
  `repositoryPrimitives.ts`、`ruleReporting.ts`。继续拆分时必须保持同一 `DatabaseSync`
  事务内的 revision、校验和写入边界；
- 账单解析仍在主线程执行，尚未迁入 Worker；
- 国际化仍以双参数 `t()` 为主，部分历史错误仍依赖中文文本映射，尚未全面切换
  到消息键和结构化错误码。

后续重构必须保持 schema、Service/Repository 接口、月度事务和导入预览契约稳定，
不得把结构整理与财务事实迁移混在同一变更中。

## 实例与写入边界

- 插件实例共享 DatabaseManager、Repository、Service、写入队列和数据变更事件。
- 每个 ItemView 独立保存当前页面、月份、排序、筛选、草稿和 dirty 状态。
- ItemView 持续接收月流水、借款、分类和规则编辑器的可序列化草稿快照。由于
  Obsidian 的 `onClose()` 不能取消关闭，用户取消放弃时由插件内存中的一次性恢复令牌
  重新打开同一模式并恢复草稿；令牌不写数据库、设置或 workspace layout，插件卸载时清空。
  恢复后仍以草稿携带的旧 revision 保存，数据库 revision 已变化时只提示外部修改，不覆盖草稿。
- 月份、借款、规则、分类和账户保存均携带 revision。
- 月份校验、revision 检查、所有月度表更新和 revision 增加位于同一
  `BEGIN IMMEDIATE` 事务。
- 规则工作台首次使用 `ruleWorkspaceShell()` 读取轻量分类、规则和 revision，历史分析在首次绘制后
  通过 `ruleWorkspaceAnalytics()` 加载；冲突工作区默认使用分类冲突条件调用 `productHistoryIndex()`，
  商品搜索和其他筛选条件变化后自动刷新，具体商品详情才打开回溯 Modal。商品统一通过
  `previewProductRename()` / `applyProductRename()` 只修改商品字段；分类迁移 Modal 直接使用
  `category_key` 加载源分类商品。商品编辑默认按同一收支类型和主要分类加载，可切换分类并
  通过商品搜索自动刷新；选择全部分类时必须带搜索条件。所有商品历史只读取
  `month_status.status='saved'` 的月份。
  分析页商品总览使用独立的 `productOverview()` 读取全历史商品统计，不改变规则冲突处理接口的“必须带筛选条件”约束。
  规则解析共享 `src/domain/rules.ts`，按精确、商品、交易对方三层优先级处理，同层不同分类返回冲突；
  `RuleConflictGroup` 由现有规则和已保存流水派生，不新增数据库结构。
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

## 发布边界

正式运行不依赖 Python、FastAPI、Pandas、Uvicorn、PyInstaller、sidecar、原生
扩展或 CPU 架构包。安装目录只包含：

```text
main.js
manifest.json
styles.css
```
