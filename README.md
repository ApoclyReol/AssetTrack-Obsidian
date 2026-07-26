# AssetTrack Obsidian

AssetTrack 是运行在 macOS 桌面版 Obsidian 中的本地个人财务工具。插件在独立
ItemView 中提供实时分析、流水、借款和规则管理；SQLite 是唯一事实源。

```text
Obsidian ItemView
→ React + Recharts
→ loopback FastAPI sidecar
→ SQLite
```

## 当前版本

- Obsidian 插件：1.2.0
- 后端：3.2.0
- SQLite schema：8
- 备份格式：2
- 平台：macOS 桌面版 Obsidian

当前版本将 Python/FastAPI/Pandas 打包为自包含 sidecar，用户不需要安装
Python、Node、uv 或虚拟环境。下一主要版本计划将运行时全部迁移到
TypeScript，详见 [路线图](docs/roadmap.md)。

## 数据位置

首次打开编辑器前，必须在插件设置中选择或新建一个 Vault 内
`Asset_Track` 根目录。文件夹输入支持 Vault 路径联想。

数据库路径不可编辑，固定为：

```text
<Asset_Track 根目录>/data/accounting_system.db
```

插件不会自动备份。手动备份和恢复位于设置页；恢复前必须先通过格式、hash、
schema 与 SQLite 完整性校验。默认手动备份位于
`<Asset_Track 根目录>/backup/`。

## 开发

```bash
UV_CACHE_DIR=/private/tmp/asset-track-uv-cache uv sync
npm ci \
  --cache /private/tmp/asset-track-obsidian-npm-cache

.venv/bin/pytest -q
npm run typecheck
npm test
npm run build
```

构建完整安装目录：

```bash
zsh scripts/build_plugin_bundle.sh
```

产物位于 `build/obsidian/asset-track/`，包含 `main.js`、manifest、样式和
PyInstaller onedir sidecar。不能只安装 `main.js` 或裸 sidecar。

## 文档

- [用户指南](docs/user-guide.md)
- [架构](docs/architecture.md)
- [财务口径](docs/financial-model.md)
- [开发说明](docs/development.md)
- [发行说明](docs/release.md)
- [路线图](docs/roadmap.md)
- [故障排查](docs/troubleshooting.md)
