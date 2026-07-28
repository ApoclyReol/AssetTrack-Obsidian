# 06 开发说明

## 源码边界

```text
backend/                 当前 Python sidecar
src/                     插件与实时界面
tests/plugin/            TypeScript 单元测试
scripts/                 构建、安装、冒烟
tests/python/            Python 与 API 测试
docs/                    长期文档
```

不要在源码目录保存数据库、备份、日志、测试 Vault、node_modules、虚拟环境或
构建产物。

长期文档按 `docs/00-*.md` 至 `docs/10-*.md` 的阅读顺序维护；每次发行的详细
handoff 写入 `docs/logs/release-vN.N.N.md`。重命名文档时必须同步 README、
AGENTS 和所有 Markdown 相对链接。

## 初始化

```bash
UV_CACHE_DIR=/private/tmp/asset-track-uv-cache uv sync
npm ci \
  --cache /private/tmp/asset-track-obsidian-npm-cache
```

## 验证

```bash
.venv/bin/pytest -q
npm run typecheck
npm test
npm run build
PYTHONPYCACHEPREFIX=/private/tmp/asset-track-pyc \
  .venv/bin/python -m compileall -q backend tests/python
git diff --check
```

完整安装包：

```bash
zsh scripts/build_plugin_bundle.sh
zsh scripts/install_to_vault.sh /path/to/test-vault
zsh scripts/smoke_test_plugin.sh /path/to/test-vault
```

测试恢复和写入只能使用隔离 Vault 与复制数据库。
