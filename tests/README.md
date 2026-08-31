# 测试结构

测试按契约边界组织，Vitest 会递归发现各目录中的 `*.test.ts` 和 `*.test.tsx`：

```text
tests/
├─ domain/       纯财务计算、规则、金额、读取窗口和交易质检
├─ database/     SQLite repository、schema/migration、revision 和事务边界
├─ import/       CSV/XLS/XLSX 解析、映射、导入生命周期和草稿提交
├─ ui/           React 组件、ItemView、草稿恢复、异步生命周期和展示模型
├─ services/     备份恢复、AI 建议、i18n、设置和 Vault 数据目录边界
├─ performance/  独立 SQLite 性能门禁
└─ mocks/        Obsidian 测试替身
```

当前测试分为 30 个文件、228 个用例。文件数量优化不以删除安全网为目标：

- 财务计算、schema constraint/migration/rollback、revision、备份恢复、Preview → Commit、规则优先级、导入解析、stale async、草稿恢复和 SQLite 性能测试必须保留。
- 同一契约只在最接近的层补回归测试；纯算法放 `domain`，SQLite 约束与事务放 `database`，跨页面异步状态放 `ui`，只有真正跨层的问题才增加更高层测试。
- 金额、读取窗口、设置边界、服务 capability ports、表格原语、商品分组和虚拟行等小型测试合并到同域文件，避免一条断言占用一个文件。
- CSV 解析、Dialog、Session 和 Commit 继续分开，因为它们分别验证文件理解、映射交互、异步生命周期和草稿提交契约。

普通测试和性能门禁分开运行：

```bash
npm test -- --exclude tests/performance/sqlite.test.ts
npm run test:perf
```

`npm test` 仍会运行全部测试；CI 先运行普通测试，再单独运行性能门禁。
