# 11 规则中心与容错导入架构补充

> 文档角色：开发与维护。本文说明规则中心和导入接口边界；用户只需按
> [用户指南](02-user-guide.md)处理分类和异常。

本文补充 v1.7.0 当前架构中与导入容错、月流水警告、通用规则、批量操作和配置中心有关的接口边界。
它以 schema 10、月份 `saved` 状态和 SQLite 写入事务为事实边界。理财流水的 `account_key`
只用于加仓和提现，交易对手仍是流水统计字段，不参与账户关系或规则范围扩展。

## 导入契约

`src/domain/csv.ts` 负责 CSV/XLSX/XLS 的源文件解析和预览，不写数据库。
`CsvInspection.empty_values` 标记每个表头是否出现空单元格；状态列的空字符串以
`included_statuses: string[]` 中的 `""` 表示。缺少日期列使用 `__month_start__`，
空日期单元格也规范化为当前月份 1 日，并在 `CsvImportStats.defaulted` 中计数。

预览过滤独立统计跨月、状态过滤、忽略类型和无效行。无法解析的非空日期、空/非数字
金额和未映射的收支值进入无效统计；空商品和零金额仍作为流水保留，分类匹配由
Service 在预览后使用当前分类定义完成。

## 月流水质检与写入

`validateTransactions` 返回带 `severity` 和 `blocking` 的结构化问题。无法解析日期、
金额或收支类型是错误；空商品、零金额、缺少/不匹配分类是警告。`MonthEditor` 只在
存在错误时停止保存，Repository 在同一月份事务中再次校验并只拒绝错误。写入后和
重新打开月份时重新运行质检，因此警告不会丢失；“暂存”仍是现有 `saved` 状态。

异常输入不会被写成可伪装的有效事实：错误行不会提交，事务失败会回滚账户、流水和
固定资产的同次修改。警告行的空分类写入空值，零金额写入 `0`。

## 配置中心一期

规则页首次进入使用轻量的 `ruleWorkspaceShell()`，再按当前页面需要加载
`ruleWorkspaceAnalytics()`；规则候选由当前配置端口按需读取，不再保留旧的
`ruleWorkspace()`、`ruleInsights()` 或 `saveRuleWorkspace()` 公共接口。
数据健康直接使用 `productHistoryIndex({ issue_filter: 'conflict' })` 加载近 5 年商品-分类冲突表，并返回实际
读取范围；商品总览使用 `productOverview()` 默认加载最近 1 年，起止日期由用户选择，筛选变化后自动刷新。具体商品详情通过浮动回溯窗口加载，分类迁移 Modal
通过带 `category_key` 的 `productHistory()` 加载指定分类下的全部商品。历史查询只连接
`month_status.status='saved'` 的月份；空商品按独立商品键展示，不会因为商品为空而从统计中消失。

规则解析统一由 `src/domain/rules.ts` 提供，按收支类型和规范化交易对手/商品建立三种作用域唯一匹配键。
相同键命中多个不同分类时，兼容诊断会返回冲突并让 `applyRulesWithIssues()` 保留原分类；
正常保存路径会阻止同一键重复写入；组合、商品、交易对手按固定优先级解析一次，重写结果不触发第二轮。
月流水和历史详情使用同一个解析结果，因此规则解释和规则 ID 不会因页面不同而产生分歧。

交易对方既是流水/历史字段，也是规则条件；规则页面维护收支类型、匹配作用域、交易对手、商品、可选重写字段和分类。

`productHistory(query)` 返回稳定的数据库流水 ID、月份、日期、交易对方、商品、原分类、
分类启用状态、金额和规则解释。商品统计按“收支类型 + 规范化商品”聚合，商品-分类冲突按
商品级审计。多数分类只作为建议，不自动改写历史。

规则审计状态与实际覆盖范围由后端独立计算。数据健康直接显示商品-分类冲突；旧规则硬冲突和重写链只保留为兼容诊断与历史回溯保护，
正常跨作用域覆盖只在流水解释和汇总覆盖状态中显示，不误报为冲突。规则建议只根据未覆盖且分类稳定的流水生成。

分类回溯通过 `previewCategoryBackfill()` 和 `applyCategoryBackfill()` 完成。请求携带
`transaction_ids`、`target_category_key` 和每个受影响月份的
`expected_month_revisions`；预览展示旧分类分布、流水数、月份数和 revision。写入在
`DatabaseManager.write()` 的单个 SQLite 事务中完成，只更新 `category_key` 与 `category`，
每个月份 revision 增加一次，任何流水校验、分类类型校验或 revision 冲突都会整批回滚。

商品统一通过 `previewProductRename()` 和 `applyProductRename()` 完成。窗口默认使用当前
商品的收支类型和出现次数最多的分类查询；未分类商品默认选择未分类。用户可切换分类并
按商品搜索自动刷新，选择多个商品组。请求携带 `transaction_ids`、`target_product` 和每月
`expected_month_revisions`；写入只更新 `transactions.product`，不自动同步规则。统一商品
名称后刷新商品-分类冲突统计。

分类定义和匹配规则分别通过 `saveCategories()` 与 `saveRules()` 保存，并分别检查 revision；分类表只显示读取窗口内的历史流水数，
商品总览负责用户选择范围内的统计，默认近 1 年。分类删除失败和确认都使用原生 Modal。旧规则冲突由现有规则和已保存流水派生为
`RuleConflictGroup`，仅用于兼容诊断和阻止可能覆盖历史语义的回溯；当前界面没有独立规则冲突面板。回溯成功后
发布现有数据变更事件：无草稿的月份窗口重新读取数据库，有草稿的窗口保留草稿并提示外部 revision 已变化，
旧草稿最终仍由 revision 校验保护。

## 规则洞察与能力端口

`ruleWorkspaceAnalytics(minOccurrences = 2)` 查询最近 5 年已保存月份中的 `transactions`，
不读取 React 草稿，并返回实际读取范围。配置 UI 通过 `ConfigurationEditorPort` 访问它，并返回规则 revision、
推荐分类规则和历史商品统计：

- 推荐按规范化的收支类型和商品聚合；历史统计按收支类型和商品聚合，并给出变体、交易对方、
  分类次数、置信度、月份数和最近月份；
- 历史统计给出总/平均/最近金额、最近日期、分类冲突、分类启用状态和匹配规则状态；
- 完全相同的规范化规则标为重复，通配字段与具体字段重叠且分类不同标为冲突；同一历史
  商品出现多个分类也标为历史冲突；
- 创建推荐规则使用当前规则 revision，成功后只新增 `auto_rules`，不回写历史账单。

规则界面消费同一规则解析结果，分类定义、已保存匹配规则和数据健康表各自维护排序与内部滚动容器。
商品详情、商品统一、分类迁移和规则创建使用浮动原生 Modal；历史回溯和商品统一仍必须生成 revision 预览
后才能确认写入，规则创建与规则表保存直接保存当前规则草稿；商品总览提供规则创建入口，不提供“打开最近月份”导航入口。
流水批量操作统一使用 `TransactionOperationPreviewRequest`，批量编辑在同一个编辑窗口中显示简要前后对比，确认后进入草稿，
保存时由 Repository 在同一月份事务中重新校验目标和 revision，并写入 `operation_logs`。AI 批次预览也写入本地审计元数据，不产生专用财务表。
