# Contributing

AssetTrack 处理本地个人财务数据。修改前先阅读 `AGENTS.md`，检查实时 schema、
数据路径和测试；不要使用正式数据库进行可写测试。

## 代码边界

- TypeScript Domain、Repository 和 Service 是唯一生产实现；不要重新引入
  Python、HTTP API、sidecar 或平台原生扩展。
- SQLite schema 9 是当前唯一开发 schema。财务公式、revision、事务、备份与
  恢复边界必须由 TypeScript 测试保护。
- 新功能必须包含 Repository 校验、明确反馈和失败时保留草稿。
- 不提交数据库、备份、日志、Vault、依赖、虚拟环境或构建产物。

## 验证

```bash
npm ci
npm run typecheck
npm test
npm run build
git diff --check
zsh scripts/build_plugin_bundle.sh
```

用户可见功能同步 README、用户指南和 CHANGELOG；公式同步财务口径；路径、
备份和运行边界同步架构与发行文档。
