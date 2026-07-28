# 10 Obsidian Community Plugins 发布规划

## 当前结论

截至 2026-07-28，AssetTrack 1.3.0 **暂不具备标准 Community Plugins 安装条件**。
当前插件的 `main.js` 会从同一插件目录启动
`sidecar/AssetTrackSidecar`；完整安装目录还包含 PyInstaller 的 `_internal/`
运行时。当前可交付产物必须是完整的：

```text
build/obsidian/asset-track/
├── main.js
├── manifest.json
├── versions.json
├── styles.css
└── sidecar/...
```

官方社区安装流程只从 GitHub Release 获取 `main.js`、`manifest.json` 和可选的
`styles.css`。因此，按当前代码和官方安装机制对照，直接提交 1.3.0 会漏掉
sidecar，不能作为可用插件安装。当前版本应继续使用完整目录安装；不要把裸
`main.js` 当作可运行发布包。

## 目标版本

下一主要版本的发布目标是 TypeScript-only 插件：

1. 保留 schema 8、格式 2 备份和现有 Python golden tests 作为行为基线。
2. 逐层把 API、计算、校验、SQLite 和备份恢复迁移到 Obsidian 桌面运行时。
3. 只读分析、预览和写入按边界逐步替换；新旧实现不能长期维护两套财务公式。
4. 完成对照测试后删除 FastAPI、Pandas、NumPy、PyInstaller 和 sidecar 生命周期。
5. 在干净 Vault、Apple Silicon 和 Intel 构建上完成安装、升级、数据迁移和恢复
   验证后，再进入社区提交。

## 提交前门槛

### 架构和运行

- 安装目录不再依赖 Python、sidecar 或其他随插件目录携带的原生可执行文件。
- 现有公式、质检、revision、事务、备份验证和失败回滚通过迁移前后的对照测试。
- 未配置数据目录时仍不创建数据库；真实 Vault 数据不进入仓库或构建产物。
- 新鲜安装、升级安装、禁用/启用、Obsidian 重启和异常恢复均通过手工冒烟测试。

### 仓库和发行资料

- 根目录补充作者确认的 `LICENSE`（当前仓库仍缺少该文件，不能擅自替作者选择
  许可协议）。
- README、用户指南、架构、发行说明、路线图、CHANGELOG 和 SECURITY 保持一致。
- `manifest.json` 的 ID、版本、描述、作者和最低 Obsidian 版本经过最终核对；ID
  必须唯一，且不能包含 `obsidian`。
- 公共仓库只保留源码、测试、文档和可复现配置；检查提交不含数据库、备份、真实
  CSV、Vault、日志、密钥、依赖目录或构建缓存。
- 说明本地数据边界、权限范围、网络行为、无遥测策略和已知安全风险；插件安全
  页面会特别关注文件访问、网络访问和安装程序等能力。

### GitHub Release

- 先运行完整测试和生产构建，并确认最终 `manifest.json` 版本为 `x.y.z`。
- 创建公开 GitHub Release，tag 必须与 manifest 版本完全一致，例如 `1.3.0`。
- 在该 Release 上传标准社区安装所需的 `main.js`、`manifest.json` 和
  `styles.css`；不要把尚未移除 sidecar 的旧 bundle 当作标准社区资产。
- 用全新测试 Vault 从 Release 安装并验证启用、升级和卸载行为。

## 提交流程

1. 完成“去 Python”迁移和上述门槛审查。
2. 更新版本号、`versions.json`、README、CHANGELOG、LICENSE 和安全说明。
3. 创建与 manifest 版本一致的 GitHub Release，并上传三个标准发行资产。
4. 按官方 [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
   流程，在 `community.obsidian.md` 的插件提交区选择新插件，填写 GitHub 仓库和
   manifest 信息。
5. 根据审核反馈补充 README、安全披露、兼容性或交互修正；审核通过后，后续版本
   继续以匹配 manifest 的 GitHub Release 发布。

官方参考：

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Plugin quality checklist](https://docs.obsidian.md/oo/plugin)
- [obsidian-releases 社区插件清单](https://github.com/obsidianmd/obsidian-releases)
