# AssetTrack Obsidian

AssetTrack 是运行在桌面版 Obsidian 中的本地个人财务工具，用于记录月度账户、
流水、借款和固定资产，并提供实时分析、账单导入、规则归类与一致性备份。
SQLite 是唯一事实源；无需账户，不联网，也不含遥测。

> [!IMPORTANT]
> AssetTrack 目前尚未发布到 Obsidian Community Plugins，无法在 Obsidian
> 的社区插件市场中搜索或自动安装。请从 GitHub Releases 下载 `1.0.4` 的
> `main.js`、`manifest.json` 和 `styles.css`，按下方说明手动安装。

## 快速开始

1. 在 Vault 的 `.obsidian/plugins/` 下创建 `asset-track/` 目录。
2. 将同一 GitHub Release 的 `main.js`、`manifest.json` 和 `styles.css` 放入
   `asset-track/`；也可以下载 `AssetTrack-1.0.4.zip`，解压其中完整目录。
3. 重启 Obsidian，或刷新“设置 → 第三方插件”，然后启用 **Asset Track**。
4. 在 Obsidian 设置中打开 **Asset Track**。
5. 选择 Vault 内一个专用的“Asset-track 数据目录”。
6. 对空目录点击“创建新数据库”；对已有有效数据库点击“载入数据库”。
7. 从命令面板打开 Asset Track 编辑器，先配置账户与分类，再录入月份数据。
8. 在设置页导出并验证第一份手动 ZIP 备份，然后再导入真实账单。

账单导入支持 CSV、XLSX 和 XLS。导入界面允许映射日期、金额、收支类型、商品、
交易对方和状态字段；解析和规则匹配全部在本机完成。

## 数据与备份

数据库和操作前保护快照固定保存在：

```text
<用户选择的数据目录>/accounting_system.db
<用户选择的数据目录>/backups/
```

迁移当前数据库、切换载入另一数据库和恢复前，插件会在当前 `backups/` 创建保护
快照。设置页导出的手动 ZIP 是供用户长期保管的一致性完整备份，两者用途不同。
插件不会执行定时或联网备份，用户仍需自行保存并定期验证备份。

禁用或卸载插件不会删除数据库、`backups/` 或手动 ZIP。删除插件与删除财务数据是
两个独立操作；删除数据前请先创建并验证可恢复备份。

## 兼容要求

- 当前版本：1.0.4；SQLite schema：9。
- 仅支持 macOS、Windows、Linux 桌面版 Obsidian，不支持移动端。
- 最低 Obsidian 版本为 1.9.10，并要求桌面运行时具备 Node ≥22.16、
  `DatabaseSync` 和 `sqlite.backup`。
- 运行时能力不足时只显示升级提示，不创建或修改数据库。
- 用户无需安装 Python、Node、uv、虚拟环境或平台架构包。

正式社区发布前的三平台真实 Obsidian smoke 状态与测试矩阵见
[Community Plugins 发布规划](docs/10-community-release-plan.md)。界面截图将在该
真实 smoke 中从正式 v1.0.4 三文件产物采集，避免使用与发布版本不一致的示意图。

## 隐私与安全

插件不联网、不含遥测，不启动服务、子进程或监听端口。诊断内容可能包含 Vault
相对数据目录和数据库运行时路径，公开报告前必须脱敏。完整边界见
[SECURITY.md](SECURITY.md)。

## 开发与构建

```bash
npm ci --cache /private/tmp/asset-track-obsidian-npm-cache
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

构建完整安装目录：

```bash
zsh scripts/build_plugin_bundle.sh
```

产物位于 `build/obsidian/asset-track/`，只包含 `main.js`、`manifest.json` 和
`styles.css`；同时生成 `build/AssetTrack-1.0.4.zip`。手动安装时必须先解压完整
`asset-track/` 目录到 `<Vault>/.obsidian/plugins/`，不能把 ZIP 留在插件目录。

## 文档

- [用户指南](docs/02-user-guide.md)
- [财务计算口径](docs/03-financial-model.md)
- [架构](docs/04-architecture.md)
- [开发说明](docs/06-development.md)
- [构建与发行](docs/07-release.md)
- [故障排查](docs/08-troubleshooting.md)
- [Community Plugins 发布规划](docs/10-community-release-plan.md)
- [版本更新日志](docs/logs/README.md)

本项目使用 [MIT License](LICENSE)。直接生产依赖的许可证见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
