# 07 构建与发行

当前发布文案见 [Release v1.1.0](logs/release-v1.1.0.md)。

## 安装产物

GitHub Release 直接上传 `main.js`、`manifest.json` 和 `styles.css`。三个文件
组成统一桌面插件，不包含 sidecar、Python、平台二进制或架构目录。

## 构建与验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

构建产物为完整的 `build/obsidian/asset-track/`，其中只包含 `main.js`、
`manifest.json` 和 `styles.css`。发布 workflow 直接上传该目录中的标准三文件。

## 本地安装

正常用户应从 Community Plugins 目录直接安装。以下手动流程仅用于开发验证或社区
目录不可用时的备用安装。

退出 Obsidian 后，在 `<Vault>/.obsidian/plugins/asset-track/` 中放入同一
Release 的 `main.js`、`manifest.json` 和 `styles.css`。更新时保留已有
`data.json`，然后重新启动 Obsidian。

## GitHub Release

- tag 与 manifest 版本完全一致，即 `1.1.0`；
- 推送版本 tag 后由 `.github/workflows/release.yml` 重新执行完整验证和生产构建；
- 只上传 `main.js`、`manifest.json` 和 `styles.css`，不上传插件 ZIP；
- 对标准三文件生成 GitHub artifact attestations；
- 仓库根目录保留 `versions.json`，声明各版本最低兼容 Obsidian 版本；
- 首次正式版先使用复制 Vault，真实数据测试前创建并校验 ZIP 备份；
- 发布后的质量验证和功能演进见
  [发布后质量与功能路线](10-community-release-plan.md)。

## 发布前验证

- 新安装、schema 9 直接打开、未配置门禁和根目录切换；
- dirty 导航、多 ItemView、禁用/启用和 Obsidian 重启；
- CSV/XLSX/XLS 映射、增量不去重、覆盖草稿、规则和账户；
- ZIP/SQLite 恢复、恢复前安全快照和失败回滚；
- macOS、Windows 发布验证，以及持续补充的 Linux 最新安装器真实 smoke；
- 关闭插件后数据库连接和文件锁释放。
