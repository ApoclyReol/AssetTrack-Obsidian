# 10 Obsidian Community Plugins 发布规划

## 当前结论

v1.0.0 已满足标准 Community Plugin 的运行时和三文件结构要求：

```text
main.js
manifest.json
styles.css
```

插件不依赖 Python、sidecar、平台原生扩展或 CPU 架构包。提交前仍需完成三平台
真实 Obsidian smoke 和作者 LICENSE。

## 兼容边界

- `manifest.json` 最低 Obsidian 版本为 1.9.10。
- 运行时继续探测 Node ≥22.16、`DatabaseSync` 和 `sqlite.backup`；旧安装器只显示
  升级提示，不修改数据。
- `versions.json` 声明 1.0.0 最低兼容 Obsidian 1.9.10。
- 稳定版冻结 schema 9；正式数据升级在发布前使用离线工具完成并单独校验。
- Community 插件运行时不包含旧数据库自动迁移路径。

## 提交前门槛

- macOS、Windows、Linux 最新安装器验证安装、启用、升级、禁用和卸载。
- 多窗口、revision、月份整体事务、备份恢复、回滚和锁释放通过。
- README、文档、CHANGELOG、SECURITY 和 release 资产一致。
- 添加作者确认的 LICENSE。
- Git 不包含数据库、备份、真实 CSV、Vault、日志、密钥、依赖或构建缓存。
- 说明本地文件访问、无网络服务、无遥测和桌面限定。

## GitHub Release 与提交

1. tag 与 manifest 版本完全一致。
2. Release 上传 `main.js`、`manifest.json` 和 `styles.css`。
3. 用全新 Vault 和完成离线迁移的复制 Vault 从 Release 安装验证。
4. 验证完成后以 `1.0.0` 提交 Community Plugins。
5. 按官方
   [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
   流程提交仓库和 manifest。
6. 根据审核反馈修正安全披露、兼容性和交互。

官方参考：

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [obsidian-releases 社区插件清单](https://github.com/obsidianmd/obsidian-releases)
