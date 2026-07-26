# AGENTS.md

## 项目定位

AssetTrack 是 macOS 桌面 Obsidian 插件。正式运行链为 React/TypeScript
ItemView、只监听 loopback 的 bundled FastAPI/Python sidecar 和本地 SQLite。
Python 是当前版本的唯一计算与数据库读写方；下一主要版本计划迁移到
TypeScript，但迁移完成前不得复制或悄悄改变财务公式。

## 事实来源与交付边界

- 开始任务先检查实时 Git、目录、schema、数据路径和相关测试。
- 根目录插件清单与构建配置、`src/`、`backend/`、`tests/`、`scripts/`、`docs/` 是唯一长期源码边界。
- `build/`、`.var/`、`.venv/`、`node_modules/` 和 `dist/` 都是忽略内容。
- 可安装产物只能是完整 `build/obsidian/asset-track/`。
- 正式数据只能位于用户明确选择的 Vault 内 Asset_Track 根目录。
- 数据库路径固定为 `<根目录>/data/accounting_system.db`。

## 常用命令

```bash
uv sync
npm ci
.venv/bin/pytest -q
npm run typecheck
npm test
npm run build
zsh scripts/build_plugin_bundle.sh
```

## 分层边界

```text
backend/assettrack/api/                 FastAPI 路由与仓储
backend/assettrack/domain/              财务计算、解析、规则和校验
backend/assettrack/infrastructure/      SQLite、路径与格式 2 备份
src/                                    Obsidian 宿主、React 界面和 sidecar 生命周期
scripts/                                插件构建、安装和冒烟
tests/                                  Python/API/备份/计算测试
docs/                                   当前架构、用户、开发与发行文档
```

## 数据与编辑约束

- React 只保存未提交草稿、dirty 状态和当前编辑会话；保存后用服务端 canonical
  rows 和新 revision 重建 clean 草稿。
- 月份保存携带 `expected_revision`，校验和写入必须在同一事务。
- 持久化行使用数据库 `id`，新草稿使用 `client_id`。
- 有质检错误时前端不得调用保存 API，后端再次以结构化 422 拒绝。
- 未保存导航必须允许用户确认放弃后继续原操作。
- 恢复备份前先完整验证，失败不得覆盖当前数据库。
- 插件不自动备份；手动备份和恢复只从设置页执行。

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

- Python tests、插件 test/typecheck/build、compileall 和 `git diff --check`。
- PyInstaller bundle、签名、安装目录和仓库外 cwd 的 sidecar 冒烟。
- 检查 Git 不包含数据库、备份、日志、密钥、Vault、构建或依赖目录。
