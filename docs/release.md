# 构建与发行

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

当前版本采用 GitHub Release 完整 ZIP 或手动复制目录，不申请 Obsidian
Community Plugins。标准 Community 安装只获取 main.js、manifest 和 styles，
不能交付当前 sidecar 目录。

## 发布前验证

除源码测试外，至少验证：

- 首次选择根目录和初始化；
- 未配置时编辑器门禁；
- 关闭窗口后重开与完全退出重启；
- sidecar 异常退出、重启和父进程退出；
- dirty 导航；
- 手动备份、候选校验、恢复和失败回滚；
- 从仓库外 cwd 启动 bundled sidecar。
