# Maintenance audit 2026-10-01

> 状态：只读代码质量审查记录。未修改代码、schema、版本号或构建产物。

## 审查基线

- 基线提交：`d49e01c`（`v2.0.0`，CSS 清理与重复规则收束）。
- 运行时依赖方向保持为：UI → Service Port → Repository → SQLite。
- 未发现运行时相对导入循环；发现的 `settings.ts`、`AssetTrackEditorView.ts` 与 `types/analysis.ts` 反向引用均为类型导入。
- `typecheck`、`lint`、314 项测试、`build`、`release:check`、插件冒烟和 `git diff --check` 均通过。

## 模块状态

| 模块 | 当前规模 | 状态 | 后续建议 |
| --- | ---: | --- | --- |
| `src/database/schema.ts` | 1705 行 | 拆分候选 | 将 schema 定义、校验、版本迁移和种子数据按职责拆开；保持迁移链和回滚测试不变。 |
| `src/database/AssetTrackRepository.ts` | 1501 行 | facade 稳定，内部偏重 | 暂不重写 facade；后续按业务增长抽取读取映射和跨域编排。 |
| `src/ui/CsvImportDialog.tsx` | 1456 行 | 拆分候选 | 拆为文件结构、字段映射、预览三个步骤组件，并保留统一请求序列和焦点管理。 |
| `src/ui/TransactionTables.tsx` | 1107 行 | 拆分候选 | 将逐项表、商品/交易对手汇总表、嵌套明细和固定资产表分开，降低布局修复影响面。 |
| `src/ui/month/useTransactionOperations.ts` | 915 行 | 拆分候选 | 抽出请求上下文/重基逻辑，再分离规则、批量、标签和 AI 操作入口。 |
| `src/database/DatabaseManager.ts` | 883 行 | 高风险基础设施，暂不动 | 若拆分，需先补并发、备份、恢复和切换测试；控制面锁和写入排空边界必须保持。 |
| `src/services/BackupService.ts` | 908 行 | 高风险基础设施，暂不动 | ZIP 校验、manifest、导出、staging 和恢复可分层，但必须保持 TOCTOU 与原子替换保护。 |
| `src/i18n.ts` | 1365 行 | 集中式目录，暂不动 | 当前单一入口有利于一致性；只有出现高频冲突时再按命名空间拆分。 |
| `src/services/LocalAssetTrackService.ts` | 635 行 | 运行时 facade 稳定 | 继续作为唯一运行时实现，子页面使用更窄的 capability port。 |
| `src/services/ports.ts` | 204 行 | capability 边界稳定 | `EditorShellPort` 是组合接口，子组件仍应依赖窄接口；暂无必要拆更多 Service 类。 |

## 兼容与遗留状态

- `src/ui/RuleHistoryModal.tsx` 目前只是旧内部导入的 re-export，不再提供第二个 Modal 外壳或关闭入口；待内部和测试引用迁移后，可在一次主版本清理中删除。
- schema 12 仍保留 `category_definitions.necessity`、`pattern`、`is_big_ticket` 兼容字段。它们仍被旧 schema 迁移、旧备份恢复和保留旧属性流程使用，暂不删除。
- 流水和规则中的分类显示快照属于历史兼容数据，不视为本次可安全清理的冗余字段。

## 后续重构顺序

1. 先拆 `CsvImportDialog`，并补齐三个步骤的 UI 回归测试。
2. 再拆 `useTransactionOperations` 和 `TransactionTables`，保持 revision、草稿重基和操作日志契约。
3. 最后评估 `schema.ts`、`DatabaseManager.ts` 和 `BackupService.ts` 的基础设施拆分，先补并发/恢复测试。
4. 如仍需清理兼容字段，单独设计 schema 13、备份兼容和回滚方案，不与普通 UI 重构合并。

本记录只描述状态和候选方向；在获得新的修改请求前，不执行上述拆分。
