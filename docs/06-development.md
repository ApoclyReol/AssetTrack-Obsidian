# 06 开发说明

## v1.2.0 维护边界

- 金额展示统一调用 `src/domain/moneyFormat.ts`。
- 分析阈值来自 `AssetTrackSettings`，Repository 不复制界面常量。
- `cost_assets` 是对账稳定口径，`market_net_assets` 是财富趋势口径，
  `total_assets` 仅作为兼容别名。
- 导入契约使用 `ArrayBuffer`，不得重新引入 Data URL/Base64 中间副本。

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

`notices:update` 从 lockfile、当前插件版本和
`build/main.js` 生成第三方依赖声明。
`release:check` 会重新计算并验证依赖版本、许可证、插件版本与 bundle 实际大小，
防止声明漂移。

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

长期文档按 `docs/00-*.md` 至 `docs/10-*.md` 维护；每次发行的详细 handoff 写入
`docs/logs/release-vN.N.N.md`。

## 任务到代码入口

| 修改目标 | 主要入口 | 重点测试 |
| --- | --- | --- |
| 财务公式与对账 | `src/domain/calculator.ts`、`src/database/AssetTrackRepository.ts` | `tests/plugin/databaseRepository.test.ts`、`analysisModel.test.ts` |
| schema 与结构校验 | `src/database/schema.ts`、`DatabaseManager.ts` | `schemaValidation.test.ts`、`databaseRepository.test.ts` |
| 月份校验和保存 | `AssetTrackRepository.saveMonth()` | `databaseRepository.test.ts` |
| 账单解析与字段映射 | `src/domain/csv.ts` | `csvService.test.ts` |
| 导入交互与草稿提交 | `CsvImportDialog.tsx`、`csvImportCommit.ts` | `csvImportDialog.test.tsx`、`csvImportCommit.test.ts` |
| 备份与恢复 | `src/services/BackupService.ts` | `backupService.test.ts` |
| 数据目录生命周期 | `src/main.ts`、`src/services/workspacePath.ts` | `workspacePath.test.ts`、`settingsValidation.test.ts` |
| 分析界面 | `src/ui/AnalysisView.tsx`、`analysisModel.ts` | `analysisModel.test.ts` |

真实 Obsidian smoke 不能由单元测试代替；版本状态见
`docs/logs/release-vN.N.N.md` 和 `docs/10-community-release-plan.md`。
