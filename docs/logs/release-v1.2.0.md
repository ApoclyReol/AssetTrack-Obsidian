# Release v1.2.0

日期：2026-07-31

状态：自动检查与用户工程版测试全部通过，正式发布。

## 用户可见更新

- 设置新增基础货币、标准/会计金额格式、平账容差和大额支出阈值。
- 全部金额统一使用 `Intl.NumberFormat`；收入/提现显示正向，支出/代付/加仓显示负向。
- 资产分析并列展示资金投入资产与市场净资产。
- 年度页新增最近 12 个有数据月份的只读周期消费面板。

## 兼容边界

- SQLite schema 保持 9，数据库路径、备份格式和中文业务枚举不变。
- 新设置只保存在插件 `data.json`；旧设置自动使用 CNY、标准格式、100 元平账容差和 1000 元大额阈值。
- `total_assets` 保留为资金投入资产兼容字段；新增 `cost_assets` 和 `market_net_assets`。
- 月度草稿通过 reducer 动作维护 dirty，增加 React Error Boundary；导入不再构造 Data URL/Base64 副本。

## 发布验证

- `typecheck`、lint、15 个测试文件共 56 项测试、生产构建、`release:check` 和
  `git diff --check` 全部通过。
- 用户已确认工程测试版通过全部测试。
- 正式标签为 `1.2.0`，Release 只包含 `main.js`、`manifest.json`、`styles.css`。
- 发布后修正第三方声明中的平台相关 bundle 字节数校验，并将 Release 工作流改为
  可重复执行，避免已存在 Release 时重复创建失败。
