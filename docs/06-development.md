# 06 开发说明

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
npm run release:check
```

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
