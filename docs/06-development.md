# 06 开发说明

> 文档角色：开发与维护。本文服务源码修改、测试、构建和代码评审，不承担用户使用说明。

## v1.5.0 维护边界

- 金额展示统一调用 `src/domain/moneyFormat.ts`。
- 分析阈值来自 `AssetTrackSettings`，Repository 不复制界面常量。
- `cost_assets` 是对账稳定口径，`market_net_assets` 是财富趋势口径，
  `total_assets` 仅作为兼容别名。
- 导入契约使用 `ArrayBuffer`，不得重新引入 Data URL/Base64 中间副本。
- 领域错误在 UI 边界统一经过 `displayError()`；新增用户可见错误时必须同时补充中英文
  文案或稳定错误码，不要让纯领域模块直接依赖 Obsidian。
- 设置页使用 Obsidian 1.13 `getSettingDefinitions()`；设置值变更后调用 `update()`
  刷新页面，不恢复 `PluginSettingTab.display()` 或其他已弃用的 imperative 设置入口。
- 月流水页拥有当月借款草稿；实时对账差额必须使用草稿中的交易、现金和借款事实，
  不能回退到保存快照中的旧 `debt_change`。
- 目录选择使用原生 `folder` 控件和本地草稿；不得调用 `getAllLoadedFiles()`、`getFiles()`
  或 `getMarkdownFiles()` 枚举 Vault 文件。
- Recharts 3 会通过 Redux 进入生产 bundle；构建阶段对 Redux 私有 action 后缀的点号写法做
  等价改写，避免被社区扫描器误判为运行时域名拼接。该改写不改变图表、财务计算或网络行为，
  `release:check` 会阻止该写法重新进入最终 `main.js`。

## 延后到下一正式版本的扫描器维护项

- 社区扫描器曾提示“Plugin assembles domain names at runtime”。当前判断为 Recharts 间接依赖
  Redux 的内部随机 action 后缀写法触发的误报，不是 Asset Track 的联网代码，也不影响图表、
  SQLite、财务计算或现有用户使用。
- 构建层面的等价改写和 bundle 回归门禁已经纳入当前发布线；后续若上游依赖或社区扫描规则
  变化，发布前仍需重新确认最终 `main.js`。

## 产品驱动的开发决策

- 默认围绕“月度账单导入 → 统一规范 → 资产补充 → 对账验证 → 分析”设计，不把高频
  手工记账、每日预算或连续打卡当作主流程。
- 所有财务事实只能通过 SQLite schema、Repository 和事务写入；`data.json`、React
  草稿、图表、缓存和导出结果不得保存第二份财务事实。
- 新增支付平台适配时，只扩展输入映射或本地模板，最终必须进入现有的日期、收支、
  交易对方、商品、分类、金额和状态语义；禁止为平台复制交易表和计算逻辑。
- 新增指标必须复用领域计算和测试，并说明从指标回到分类、商品、流水或导入来源的
  解释路径；不要在 React 组件中临时计算金额、资产或对账口径。
- 导入、规则、资产和分析修改必须说明对数据覆盖、冲突、对账差额和用户确认的影响。
  有质检错误时阻止写入，警告保留但必须可见；涉及历史事实的修改先预览、校验 revision，
  再由单个 SQLite 事务提交。
- 新功能不能引入账户注册、联网同步、遥测或未经用户确认的 AI 财务事实。AI 若未来
  用于映射、归一化或异常解释，只能生成建议，不能直接写库。

## 源码边界

```text
src/domain/              财务计算、账单解析、规则和质检
src/database/            schema 9、DatabaseManager 和 Repository
src/services/            UI Service、备份恢复和原生对话框
src/ui/、src/views/      React 与 ItemView
tests/plugin/            TypeScript、SQLite、golden 和备份测试
scripts/                 构建、安装和冒烟
docs/                    长期文档与 release 日志
```

项目不包含 Python 环境或后端。不要在源码目录保存数据库、备份、日志、测试
Vault、node_modules 或构建产物。

## 初始化与验证

```bash
npm ci --cache /private/tmp/asset-track-obsidian-npm-cache
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
git diff --check
```

发布文件验证：

```bash
npm run build
npm run notices:update
npm run release:check
```

`npm run build` 会先清空 `build/`，再直接生成三个可安装文件：

```text
build/
├── main.js
├── manifest.json
└── styles.css
```

### 每次构建都使用最新版本

构建不会自动升级版本号；`build/manifest.json` 由根目录的 `manifest.json` 复制生成。
因此每次准备构建时必须按以下顺序执行：

1. 先确定目标版本，并同步 `package.json`、根目录 `manifest.json` 和 `versions.json`；
2. 完成源码、测试、文档和发行配置修改后，再运行一次 `npm run build`；
3. 运行 `npm run release:check`，确认 `build/manifest.json` 与根目录版本一致；
4. 只使用这次构建生成的 `build/main.js`、`build/manifest.json` 和 `build/styles.css`，
   不直接编辑或复用旧的 `build/` 文件。

如果只是当前版本内的修复，也要在最终修改完成后重新构建；如果版本号发生变化，必须
先同步三个版本源文件再构建，不能只替换 `build/manifest.json`。

`notices:update` 从 lockfile、当前插件版本和
`build/main.js` 生成第三方依赖声明。
`release:check` 会重新计算并验证依赖版本、许可证、插件版本与 bundle 实际大小，
防止声明漂移，并检查最终 bundle 不包含已知的动态域名拼接误报模式。

正常验证结果应满足：

- `typecheck` 无错误退出；
- `lint` 零 error、零 warning；
- `test` 中的 `tests/plugin/` 测试全部通过；
- 项目不使用 `dist/` 或 `out/`，`build/` 根目录只保留标准三文件；
- `release:check` 验证版本、许可证、标准三文件和生产 bundle。

测试覆盖 schema 9、中文路径、WAL、整体事务、revision、冻结 golden、
CSV/XLSX/XLS、备份恢复、5 万笔流水和数据库锁释放。恢复和写入只能使用隔离
Vault 与合成数据库。

## 数据库版本边界

当前开发、测试、备份和恢复统一使用 schema 9。schema 8 私有数据过渡已完成，
仓库不再保留一次性迁移脚本或双 schema 生产路径。若未来确需迁移真实数据库，
应在仓库外按根目录 `AGENTS.md` 的正式数据修改协议建立独立、可审计的一次性
工具，不把兼容代码并入插件运行链。

长期文档按 `docs/00-*.md` 至当前编号文档维护；每次发行的详细 handoff 写入
`docs/logs/release-vN.N.N.md`。

## 任务到代码入口

| 修改目标 | 主要入口 | 重点测试 |
| --- | --- | --- |
| 财务公式与对账 | `src/domain/calculator.ts`、`src/database/AssetTrackRepository.ts` | `tests/plugin/databaseRepository.test.ts`、`analysisModel.test.ts` |
| schema 与结构校验 | `src/database/schema.ts`、`DatabaseManager.ts` | `schemaValidation.test.ts`、`databaseRepository.test.ts` |
| 月份校验和保存 | `AssetTrackRepository.saveMonth()` | `databaseRepository.test.ts` |
| 账单解析与字段映射 | `src/domain/csv.ts` | `csvService.test.ts` |
| 导入交互与草稿提交 | `CsvImportDialog.tsx`、`csvImportCommit.ts` | `csvImportDialog.test.tsx`、`csvImportCommit.test.ts` |
| 规则工作台、商品统一与历史迁移 | `src/ui/RulesEditor.tsx`、`RuleHistoryModal.tsx`、`ProductRenameModal.tsx`、`RuleCreationModal.tsx`、`TablePrimitives.tsx`、`AssetTrackRepository.ts` | `databaseRepository.test.ts`、`ruleHistoryModal.test.tsx`、`tablePrimitives.test.tsx` |
| ItemView 草稿恢复 | `src/ui/editorDraft.ts`、`src/views/AssetTrackEditorView.ts`、`src/main.ts` | `editorDraft.test.ts`、`editorDraftRecovery.test.tsx`、`assetTrackEditorView.test.ts` |
| 备份与恢复 | `src/services/BackupService.ts` | `backupService.test.ts` |
| 数据目录生命周期 | `src/main.ts`、`src/services/workspacePath.ts` | `workspacePath.test.ts`、`settingsValidation.test.ts` |
| 分析界面 | `src/ui/AnalysisView.tsx`、`analysisModel.ts` | `analysisModel.test.ts` |

表格 UI 维护应复用 `src/ui/TablePrimitives.tsx` 的统一表头原语，并遵守
`docs/05-design-system.md` 的表格响应式规范。新增表格时，必须明确语义列宽、正文小字号、
上下居中、金额/数量/日期对齐方式，并验证窄窗口下不会出现无意义的横向溢出或表格级最小宽度。

规则工作台的商品历史只读取 `month_status.status='saved'` 的月份；规则覆盖范围必须按
每条历史流水计算，不能用单条规则把整个商品组标记为已覆盖。商品统一和分类回溯必须
先预览、校验每月 revision，再由单个 SQLite 事务提交。分类和匹配规则分别保存，不恢复
后台匹配层级到用户界面。关闭视图恢复使用插件内存中的一次性令牌，不得写入
`data.json` 或 Obsidian workspace layout。

真实 Obsidian smoke 不能由单元测试代替；版本状态见
`docs/logs/release-vN.N.N.md` 和 `docs/10-community-release-plan.md`。
