# Release v1.3.0

日期：2026-07-28

本日志记录 v1.3.0 已完成实现，当前长期行为分别归档在
[用户指南](../02-user-guide.md)、[财务口径](../03-financial-model.md)、
[架构](../04-architecture.md)和[设计系统](../05-design-system.md)。

## 主要变化

- Obsidian 启动时不再显示 Asset Track 全局准备提示；sidecar 仍按需启动。
- CSV 支持通用列映射、映射复用、状态过滤和增量/覆盖导入。
- 增量导入会追加本次全部有效记录，不执行去重。
- 流水增加逐项/商品汇总视图和高频商品规则建议。
- 备份与恢复通过 Finder 选择路径，备份生成单个格式 2 ZIP。
- 新数据库仅创建默认现金账户和默认理财账户。
- 修复多个理财账户名称与金额输入框对齐，并延迟加载 Pandas/NumPy。

## 数据兼容边界

- SQLite 仍为 schema 8；本次没有新增表、字段或 schema 8 → 9 迁移。
- 新数据库直接创建 schema 8，只改变初始账户数据为默认现金、默认理财两个账户。
- 已有 schema 8 数据库不删除、不停用账户；非 schema 8 数据库仍拒绝自动修改。
- CSV 映射配置保存在 Obsidian 插件 `data.json`，只包含表头指纹和映射元数据，
  不保存账单内容。
- 流水仍逐笔写入原 `transactions` 表；商品汇总和规则候选都是计算/视图能力。
- 备份格式保持为 2，恢复继续支持格式 2 ZIP、目录和 schema 8 SQLite。

## 实现 handoff

- 插件 `onload()` 只注册 View、设置、Ribbon 和命令；第一次 API 请求才启动
  sidecar。等待超过约 500ms 时，准备状态只出现在编辑面板内。
- FastAPI 启动路径不再 eager import Pandas、计算、CSV 或备份模块；普通数据库
  启动只执行轻量 schema 校验，完整 `integrity_check` 留给备份、恢复和诊断。
- CSV 使用“检查 → 映射预览 → 应用草稿”三段流程。增量模式直接拼接全部有效行，
  不允许加入隐式去重、交易指纹或来源字段。
- 规则候选统计历史数据库和当前草稿，重复导入形成的流水会如实增加频次。
- Finder 对话框取消后不得启动 API；恢复候选必须先校验，再 staging、安全备份和
  原子替换。
- 详细 API、数据和交互边界以当前编号文档为准；继续工作前先运行相关测试。

## 验证记录

- Python：49 项通过。
- 插件：8 项通过。
- TypeScript typecheck、production build、compileall 和 `git diff --check` 通过。
- 完整 arm64 bundle、ad-hoc 签名、ZIP 解压和仓库外 sidecar 冒烟通过。
- 同一冒烟协议下，最终冷启动约 1.21 秒；优化前参考值约 8.34 秒。

## 文档整理

- 当前长期文档改为 `docs/00-*.md` 至 `docs/10-*.md` 的阅读顺序。
- 版本更新记录迁入 `docs/logs/release-vN.N.N.md`。
- `AGENTS.md` 只保留当前 handoff 摘要，并指向本日志获取详细实现与验证信息。

## 安装

下载与 CPU 架构匹配的完整 ZIP，例如：

```text
AssetTrack-1.3.0-macos-arm64.zip
```

必须先解压 ZIP，再把完整 `asset-track/` 文件夹放到：

```text
<Vault>/.obsidian/plugins/asset-track/
```

最终至少应包含：

```text
asset-track/
├── main.js
├── manifest.json
├── styles.css
├── versions.json
└── sidecar/
    ├── AssetTrackSidecar
    └── _internal/
```

不能只复制 `main.js`，也不能把未解压的 ZIP 直接留在 `plugins` 目录。

## 首次使用

1. 在 Obsidian 中启用 Asset Track。
2. 打开“设置 → Asset Track”。
3. 选择 Vault 内的 Asset_Track 根目录并点击“使用并初始化”。
4. 数据库固定保存在 `<根目录>/data/accounting_system.db`。

新数据库包含两个账户：默认现金账户、默认理财账户。已有数据库或恢复备份中的
账户保持不变。

## CSV 导入

选择 CSV 后，在映射窗口指定：

- 日期/时间；
- 商品或说明；
- 金额；
- 收支方向；
- 可选的分类和交易状态。

原始收支值需要映射为支出、收入、代付、加仓、提现或忽略。相同表头的映射会在
下次导入时自动预填，但每次仍会展示预览。

导入模式：

- `增量导入（追加全部）`：追加本次全部有效记录，不执行去重；
- `覆盖当前月份`：只替换当前月份的流水草稿。

两种模式都不会立即写数据库；检查草稿后仍需点击“保存月份”。重复导入同一个
文件会产生重复流水，请自行控制账单范围。

## 备份与恢复

- “选择目录并导出”会在 Finder 所选目录生成单个完整 ZIP。
- 恢复通过 Finder 选择 ZIP、格式 2 目录或 schema 8 SQLite。
- 候选会自动执行格式、hash、行数、schema 和 SQLite 完整性校验。
- 正式替换前会创建当前数据库一致性安全备份，失败时保留当前数据。

## 平台限制

当前安装包是 macOS 桌面版 Obsidian 的完整 sidecar 版本。Apple Silicon 与 Intel
需要不同构建；本地 ad-hoc 签名包尚未完成 Developer ID notarization。
