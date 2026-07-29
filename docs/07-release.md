# 07 构建与发行

当前发布文案见 [Release v1.0.2](logs/release-v1.0.2.md)。

## 安装产物

```text
build/obsidian/asset-track/
├── main.js
├── manifest.json
└── styles.css
```

三个文件组成统一桌面插件，不包含 sidecar、Python、平台二进制或架构目录。
构建同时生成 `build/AssetTrack-1.0.2.zip`，ZIP 内只有一个 `asset-track/`
顶层目录及上述三个文件。

## 构建与验证

```bash
zsh scripts/build_plugin_bundle.sh
zsh scripts/smoke_test_plugin.sh build/obsidian/asset-track
```

脚本执行 npm clean install、typecheck、lint、插件测试、production esbuild、
版本和依赖锁校验及三文件结构审计，并拒绝包含旧 sidecar/loopback 标识的产物。
脚本同时输出生产 `main.js` 的字节数。

## 本地安装

退出 Obsidian 后运行：

```bash
zsh scripts/install_to_vault.sh "/path/to/obsidian-vault"
```

脚本把构建目录原子替换到
`<Vault>/.obsidian/plugins/asset-track/`，并保留已有 `data.json`。也可以手动复制
完整 `asset-track/` 目录。ZIP 必须先解压，不能直接留在 `plugins` 目录。

## GitHub Release

- tag 与 manifest 版本完全一致，即 `1.0.2`；
- 上传 `main.js`、`manifest.json` 和 `styles.css`；
- 仓库根目录保留 `versions.json`，声明各版本最低兼容 Obsidian 版本；
- 首次正式版先使用复制 Vault，真实数据测试前创建并校验 ZIP 备份；
- Community Plugins 稳定提交门槛见
  [发布规划](10-community-release-plan.md)。

## 发布前验证

- 新安装、schema 9 直接打开、未配置门禁和根目录切换；
- dirty 导航、多 ItemView、禁用/启用和 Obsidian 重启；
- CSV/XLSX/XLS 映射、增量不去重、覆盖草稿、规则和账户；
- ZIP/SQLite 恢复、恢复前安全快照和失败回滚；
- macOS、Windows、Linux 最新安装器真实 smoke；
- 关闭插件后数据库连接和文件锁释放。
