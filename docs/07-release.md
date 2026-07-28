# 07 构建与发行

当前版本可直接使用的用户发布文案见
[Release v1.3.0](logs/release-v1.3.0.md)。

## 安装产物

```text
build/obsidian/asset-track/
├── main.js
├── manifest.json
├── versions.json
├── styles.css
└── sidecar/
    ├── AssetTrackSidecar
    └── _internal/
```

当前 arm64 构建约 58 MB，其中绝大部分是 Python、Pandas、NumPy 和 PyInstaller
运行时。不能只发布 `main.js` 或裸 sidecar。

## 构建

```bash
zsh scripts/build_plugin_bundle.sh
```

脚本执行插件测试与 production esbuild、PyInstaller onedir、内部 Mach-O
ad-hoc 签名和结构检查。当前构建适合本地安装；公开分发还需要 Developer ID、
Hardened Runtime、notarization 和 Gatekeeper 干净机器测试。

## 发布方式

当前版本采用完整目录手动安装；如果制作 GitHub Release，应提供包含 sidecar 的
完整 ZIP 或目录，不申请 Obsidian Community Plugins。标准 Community 安装只获取
`main.js`、manifest 和 styles，不能交付当前 sidecar 目录。

安装脚本不是插件运行的必要条件，只是把 Vault 检查、完整复制、保留已有
`data.json` 和临时目录替换自动化。通常应先退出 Obsidian，再在仓库根目录运行：

```bash
zsh scripts/install_to_vault.sh "/path/to/obsidian-vault"
```

脚本要求目标是已有 Obsidian Vault，并将
`build/obsidian/asset-track/` 原子替换到
`<Vault>/.obsidian/plugins/asset-track/`；如果目标插件已有 `data.json`，会保留
该设置文件。运行前应确认已经执行过构建，并在真实 Vault 上自行确认目标路径。

也可以手动复制构建结果。目标插件目录不存在时：

```bash
VAULT="/path/to/obsidian-vault"
BUNDLE="/path/to/AssetTrack-Obsidian/build/obsidian/asset-track"
mkdir -p "$VAULT/.obsidian/plugins/asset-track"
cp -R "$BUNDLE/." "$VAULT/.obsidian/plugins/asset-track/"
```

必须复制整个 `asset-track/` 目录，包括 `sidecar/AssetTrackSidecar` 和
`sidecar/_internal/`，不能只复制 `main.js`。如果目标目录已经存在，建议继续使用
安装脚本，或先在 Obsidian 关闭后手动替换整个目录并保留其中的 `data.json`，避免
旧版本残留文件或丢失插件设置。

去除 Python sidecar 后的标准社区发布流程、缺失条件和官方依据见
[Community Plugins 发布规划](10-community-release-plan.md)。

## 发布前验证

除源码测试外，至少验证：

- 首次选择根目录和初始化；
- 未配置时编辑器门禁；
- 关闭窗口后重开与完全退出重启；
- sidecar 异常退出、重启和父进程退出；
- dirty 导航；
- 手动备份、候选校验、恢复和失败回滚；
- 从仓库外 cwd 启动 bundled sidecar。
