# Release v1.9.1

> 状态：已推送，尚未创建版本 tag 或 GitHub Release。

Asset Track 1.9.1 是 v1.9.0 的维护补丁，修复设置同步、数据目录迁移和分析阈值更新，
并补充发布 bundle 冒烟、类型约束和回归测试。schema 11、数据库路径、备份格式和最低
Obsidian 版本不变。

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:perf`
- `npm run build`
- `npm run notices:update`
- `npm run release:check`
- `bash scripts/smoke_test_plugin.sh build`
