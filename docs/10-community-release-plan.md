# 10 Obsidian Community Plugins 发布规划

## 当前结论

v1.0.4 已具备标准 Community Plugin 三文件结构、根目录 MIT LICENSE、依赖声明、
lint、CI 和发布校验：

```text
main.js
manifest.json
styles.css
```

插件不依赖 Python、sidecar、平台原生扩展或 CPU 架构包。macOS 和 Windows
真实 Obsidian smoke 已完成，Linux 仍是提交前发布门槛；未实测的平台不得标记
完成。Community Directory 中的插件 ID `asset-track` 和名称 `Asset Track`
也必须在提交当天再次搜索确认。

## 兼容边界

- `manifest.json` 最低 Obsidian 版本为 1.9.10。
- 运行时探测 Node ≥22.16、`DatabaseSync` 和 `sqlite.backup`；旧桌面安装器只显示
  升级提示，不修改数据。
- `versions.json` 声明 1.0.4 最低兼容 Obsidian 1.9.10。
- 稳定版冻结 schema 9；Community 插件不包含旧数据库自动迁移路径。
- 生产 `main.js` 打包 React、Recharts 和 SheetJS；许可证与 lockfile 边界见根目录
  `THIRD_PARTY_NOTICES.md`。生产文件大小由当前 `release:check` 记录；SheetJS
  当前静态导入，Recharts 2.x 已停止活跃维护。

## 三平台真实 smoke matrix

状态只允许填写 `通过（日期/版本/测试人）`、`失败（issue）` 或 `未测试`。

| 场景 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| 全新安装和启用 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 创建新数据库 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 载入已有 schema 9 数据库 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| CSV 导入 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| XLSX / XLS 导入 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 保护快照、手动 ZIP 与恢复 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 迁移当前库、载入目标库 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 禁用、重启、重新启用与锁释放 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 多 ItemView 与未保存草稿 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 弹出窗口、Escape 与焦点恢复 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 20 MiB 文件门禁和导入失败重试 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 窄窗口和大流水表滚动 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 旧桌面安装器兼容提示且不写库 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |
| 插件加载耗时与主要界面截图 | 通过（2026-07-29 / 1.0.4 / Apocly） | 通过（2026-07-29 / 1.0.4 / Apocly） | 未测试 |

每次记录必须写明 Obsidian 版本、安装器版本、操作系统版本、插件 tag/commit、
测试 Vault 类型和数据库是否为副本。Windows 与 Linux 的多窗口、草稿和兼容提示
允许按表中实际结果记录，但首次 Community 提交前不得省略其余必测项。

## 自动化与人工门槛

- CI 在 Ubuntu、macOS 和 Windows 执行
  `npm ci → typecheck → lint → test → build → release:check`。
- `release:check` 校验 package/manifest/versions、MIT 声明、三发布源文件、
  SheetJS CDN lockfile integrity，并记录生产 `dist/main.js` 字节数。
- 发布前复查 GitHub Release 包含标准 `main.js`、`manifest.json` 和
  `styles.css` 插件文件。
- README、长期文档、CHANGELOG、SECURITY、release 日志与 release 资产一致。
- Git 不包含数据库、备份、真实账单、Vault、日志、密钥、依赖或构建缓存。
- 从正式 v1.0.4 bundle 采集主要功能截图，并记录一次冷启动/插件加载耗时。
- 三平台 smoke 全部完成，Community Directory 名称与 ID 再次确认无冲突。

## GitHub Release 与提交

1. tag、`package.json`、manifest 和 `versions.json` 的 1.0.4 完全一致。
2. Release 上传 `main.js`、`manifest.json` 和 `styles.css`。
3. 用全新 Vault 和已有 schema 9 数据库的复制 Vault从 Release 安装验证。
4. 完成上表并保存脱敏记录后，以 `1.0.4` 提交 Community Plugins。
5. 按官方
   [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
   流程提交仓库和 manifest。
6. 根据审核反馈修正安全披露、兼容性和交互。

官方参考：

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [obsidian-releases 社区插件清单](https://github.com/obsidianmd/obsidian-releases)
