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

- Obsidian 插件：1.3.0
- 后端：3.3.0
- SQLite schema：8
- 备份格式：2
- 平台：macOS 桌面版 Obsidian

当前版本将 Python/FastAPI/Pandas 打包为自包含 sidecar，用户不需要安装
Python、Node、uv 或虚拟环境。下一主要版本计划将运行时全部迁移到
TypeScript，详见 [路线图](docs/09-roadmap.md) 和
[Community Plugins 发布规划](docs/10-community-release-plan.md)。

当前 1.3.0 必须安装完整插件目录，不能通过 Obsidian 的标准 Community
Plugins 安装器使用；标准安装器不会带上当前版本需要的 Python sidecar。现阶段
请使用 [发行说明](docs/07-release.md) 中的完整目录安装方式。

## 数据位置

首次打开编辑器前，必须在插件设置中选择或新建一个 Vault 内
`Asset_Track` 根目录。文件夹输入支持 Vault 路径联想。

数据库路径不可编辑，固定为：

```text
<Asset_Track 根目录>/data/accounting_system.db
```

插件不会自动备份。手动备份和恢复位于设置页；恢复前必须先通过格式、hash、
schema 与 SQLite 完整性校验。手动备份会先通过 Finder 选择目标目录，再生成
单个格式 2 ZIP；恢复同样通过 Finder 选择 ZIP、格式 2 目录或 schema 8 SQLite。

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
