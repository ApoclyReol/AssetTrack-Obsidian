# AGENTS.md

## 项目定位

AssetTrack 是桌面版 Obsidian 插件。正式运行链为 React/TypeScript ItemView、
TypeScript Service/Repository、Obsidian Electron 内置 `node:sqlite` 和本地
SQLite。项目不再包含 Python、HTTP API、sidecar 或平台原生扩展。

## 事实来源与交付边界

- 开始任务先检查实时 Git、目录、schema、数据路径和相关测试。
- 根目录插件清单与构建配置、`src/`、`tests/`、`scripts/`、`docs/` 是唯一长期源码边界。
- `build/`、`.var/`、`.venv/`、`node_modules/` 和 `dist/` 都是忽略内容。
- 可安装产物只能是完整 `build/obsidian/asset-track/`。
- 正式数据只能位于用户明确选择的 Vault 内 Asset-track 数据目录。
- 数据库路径固定为 `<数据目录>/accounting_system.db`，保护备份位于
  `<数据目录>/backups/`。

## 常用命令

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

## 分层边界

```text
src/domain/                             财务计算、账单解析、规则和校验
src/database/                           schema 9、连接管理和 Repository
src/services/                           本地 Service、备份恢复
src/ui/、src/views/                     React 界面与 ItemView
scripts/                                插件构建、安装和冒烟
tests/plugin/                           TypeScript/schema/备份/计算测试
docs/                                   当前架构、用户、开发与发行文档
```

## 当前 handoff

- v1.0.4 是当前正式版本：保持 schema 9 和财务口径，修复设置、Vault 相对路径、
  数据库结构和恢复校验；失败的账单导入不会部分修改草稿，单文件限制为 20 MiB。
- 确认操作使用 Obsidian 原生 Modal，CSV 映射窗口支持焦点陷阱、Escape 和状态
  播报；流水逐项表按可视行渲染，分块编号为线性预计算。
- schema 8 私有数据已在 2026-07-28 使用一次性离线流程迁移并核验；迁移工具及
  旧 Python/sidecar 目录不再保留在开发仓库。当前源码、测试和文档只维护
  schema 9 正式路径。
- 流水按类型分块编号并完整展开；新流水分类为空。月度分析增加理财环比，分类
  对比排除大额分类，异常变化使用 30% 与 100 元双阈值；对账差额绝对值小于
  100 元显示为平账。
- 插件实例共享 `DatabaseManager`、Repository、Service、写入队列和数据变更事件；
  每个 ItemView 仍独立保存草稿与 dirty 状态。
- 继续维护前先读 `docs/00-reading-guide.md`；本次实现、兼容边界、测试和后续
  注意事项详见 `docs/logs/release-v1.0.4.md`。
- 后续每次正式更新都在 `docs/logs/` 新增 `release-vN.N.N.md`，并同步修改受影响
  的编号长期文档，不把当前事实只留在 release 日志中。

## 数据与编辑约束

- React 只保存未提交草稿、dirty 状态和当前编辑会话；保存后用 Repository canonical
  rows 和新 revision 重建 clean 草稿。
- 月份保存携带 `expected_revision`，校验和写入必须在同一事务。
- 持久化行使用数据库 `id`，新草稿使用 `client_id`。
- 有质检错误时前端不得调用保存 Service，Repository 再次以结构化 422 拒绝。
- 未保存导航必须允许用户确认放弃后继续原操作。
- 恢复备份前先完整验证，失败不得覆盖当前数据库。
- 插件不执行定时或联网备份；目录切换、迁移和恢复前自动创建本地保护快照，
  手动 ZIP 备份和恢复只从设置页执行。

## 财务口径

- 理论消费 = 上月现金 + 本月收入 + 借款变动 - 本月现金 - 理财加仓 + 理财提现。
- 对账差额 = 实际流水净支出 - 理论消费。
- 总资产 = 现金 - 借款余额 + 理财投入本金。
- 固定资产不进入总资产、对账、年度趋势或储蓄率。
- 加仓是支出，提现是收入；两者不使用消费分类。
- 正向增长和收入使用红色，下降和支出使用绿色。
- 金额写库保留两位，界面显示一位。

## 正式数据修改协议

```text
确认实际数据库
→ 创建一致性手动备份
→ 只读统计影响
→ 展示映射与冲突
→ 获得用户确认
→ 单事务写入
→ 校验行数、唯一性和抽样
→ 保留回退产物
```

## 提交前检查

- 插件 test、typecheck、build 和 `git diff --check`。
- 标准三文件 bundle、`node:sqlite`、安装目录、备份和数据库锁释放冒烟。
- 检查 Git 不包含数据库、备份、日志、密钥、Vault、构建或依赖目录。
- 检查工作树不残留 `backend/`、Python 测试、虚拟环境、旧 sidecar 构建和真实
  数据库副本。
