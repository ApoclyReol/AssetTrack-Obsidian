# Contributing

AssetTrack 处理本地个人财务数据。修改前先阅读 `AGENTS.md`，检查实时 schema、
数据路径和测试；不要使用正式数据库进行可写测试。

## 代码边界

- 当前 Python 是计算和 SQLite 权威，React 不复制公式。
- 新功能必须包含后端校验、明确反馈和失败时保留草稿。
- 不提交数据库、备份、日志、Vault、依赖、虚拟环境或构建产物。
- 下一主要版本去 Python 的工作必须使用现有 golden tests 逐层替换。

## 验证

```bash
uv sync
npm ci
.venv/bin/pytest -q
npm run typecheck
npm test
npm run build
PYTHONPYCACHEPREFIX=/private/tmp/asset-track-pyc \
  .venv/bin/python -m compileall -q backend tests
git diff --check
zsh scripts/build_plugin_bundle.sh
```

用户可见功能同步 README、用户指南和 CHANGELOG；公式同步财务口径；路径、
备份和运行边界同步架构与发行文档。
