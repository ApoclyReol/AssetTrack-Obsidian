# Maintenance audit 2026-09-16

> 状态：已合入待发布 v1.9.1。当前稳定版仍为 v1.9.0；本记录不改变 schema 或备份格式。

## 本次修复

- 修复 `src/main.ts` 在创建、载入和切换数据目录时调用部分 `saveData()` 导致显示设置、阈值、AI 配置和账单映射被重置的问题；现在统一保存完整设置快照，失败时恢复旧目录设置。
- 将 Electron `shell` 和原生文件选择器的加载限制在桌面能力调用边界，并通过 `Platform.isDesktop` 提前拒绝不支持的运行环境。
- 把备份校验、恢复结果和规则保存结果抽为明确类型，减少跨层 `as unknown as` 转换；内容 revision 接受只读对象数组。
- 将 `AssetTrackEditorApp.tsx` 的顶部导航、上下文导航和月度摘要抽到 `AssetTrackEditorToolbar.tsx`，根组件继续保留路由、数据订阅和未保存保护。
- 为数据目录设置持久化补充成功与失败回滚测试；同步更新规则、备份和 revision 的类型边界。
- 将运行中分析阈值改为显式运行时同步，并在设置变更后失效分析缓存；设置写入统一串行化，普通设置和映射删除失败时恢复内存快照。
- 目录迁移改为 `*.incoming` 临时快照，验证通过后原子改名，并在失败时清理临时文件。
- CI 和 Release 增加标准 bundle 冒烟，checkout/setup-node 升级到 Node.js 24 action runtime。

## 文档修订

- 清理长期产品、财务、架构和设计文档中的过期 v1.8.x/v1.8.0 当前状态标签。
- 在 v1.9.0 release 日志和人工测试清单中补记：真实 Obsidian 安装、更新、重载、卸载与重启验收已由项目维护者完成；此前只是文档遗漏。
- `CHANGELOG.md` 和 `release-v1.9.1.md` 已整理本次修复；GitHub Release 仍待创建。

## 本次验证

- `npm run typecheck`、`npm run lint`、`npm test`（36 个测试文件 / 288 个测试）、`npm run build`、
  `npm run notices:update`、`npm run release:check`、`bash scripts/smoke_test_plugin.sh build` 和
  `git diff --check` 均通过。
- 文档相对链接检查通过；`build/` 只包含 `main.js`、`manifest.json`、`styles.css`，本次维护线生成的
  `build/main.js` 为 1,557,551 bytes。

## 尚未纳入本次修复

- 跨层诊断/导入 issue 的 `Record<string, unknown>` 契约收紧、CSV/XLSX/XLS Worker 化、
  大型 `CsvImportDialog.tsx`/`schema.ts` 的进一步拆分、大数据量真实 Vault 采样和自动化
  Obsidian smoke 仍按路线图维护；本次只清理了已具备稳定边界的高风险转换。
- 审计修复没有修改 schema、数据库路径、财务计算口径或用户数据；版本号已在 v1.9.1 发布准备中统一同步。
