# AssetTrack Obsidian

AssetTrack 是运行在桌面版 Obsidian 中的本地个人财务工具。插件在独立
ItemView 中提供实时分析、流水、借款和规则管理；SQLite 是唯一事实源。

```text
Obsidian ItemView
→ React + Recharts
→ TypeScript Service + Repository
→ SQLite
```

## 当前版本

- Obsidian 插件：1.0.0
- SQLite schema：9
- 平台：macOS、Windows、Linux 桌面版 Obsidian

v1.0.0 直接使用 Obsidian 桌面运行时的 `node:sqlite`。
用户不需要安装 Python、Node、uv、虚拟环境或平台架构包。最低 Obsidian 版本为
1.9.10，并要求使用新版桌面安装器；运行时能力不足时插件不会创建或修改数据库。

## 数据位置

首次打开编辑器前，必须在插件设置中选择或新建一个 Vault 内
`Asset_Track` 根目录。文件夹输入支持 Vault 路径联想。

数据库路径不可编辑，固定为：

```text
<Asset_Track 根目录>/data/accounting_system.db
```

插件不会自动备份。手动备份和恢复位于设置页；恢复前必须通过完整性和内容一致
性校验。手动备份会先选择目标目录并生成一个 ZIP；恢复支持 AssetTrack ZIP 或
SQLite 数据库文件。

## 开发

```bash
npm ci \
  --cache /private/tmp/asset-track-obsidian-npm-cache

npm run typecheck
npm test
npm run build
```

构建完整安装目录：

```bash
zsh scripts/build_plugin_bundle.sh
```

产物位于 `build/obsidian/asset-track/`，只包含 `main.js`、`manifest.json` 和
`styles.css`，不区分 CPU 架构；同时生成可供手动安装的
`build/AssetTrack-1.0.0.zip`。

源码仓库只维护 `src/`、`tests/plugin/`、`scripts/` 和 `docs/` 等 TypeScript
插件开发内容，不保留 Python 后端、sidecar、旧架构构建或真实数据库副本。

## 文档

- [00 文档阅读指南](docs/00-reading-guide.md)
- [01 产品需求](docs/01-product-requirements.md)
- [02 用户指南](docs/02-user-guide.md)
- [03 财务口径](docs/03-financial-model.md)
- [04 架构](docs/04-architecture.md)
- [05 设计系统](docs/05-design-system.md)
- [06 开发说明](docs/06-development.md)
- [07 构建与发行](docs/07-release.md)
- [08 故障排查](docs/08-troubleshooting.md)
- [09 路线图](docs/09-roadmap.md)
- [10 Community Plugins 发布规划](docs/10-community-release-plan.md)
- [版本更新日志](docs/logs/README.md)
