# 10 发布后质量与功能路线

## 当前结论

Asset Track 已通过 Community Plugins 审核，用户可以从 Obsidian 社区目录直接
搜索、安装和更新。GitHub Release 三文件手动安装仅作为开发验证或社区目录不可用
时的备用方式：

```text
main.js
manifest.json
styles.css
```

插件不依赖 Python、sidecar、平台原生扩展或 CPU 架构包。macOS 和 Windows
真实 Obsidian smoke 已完成；Linux 验证属于发布后持续质量工作，不再是社区发布
门槛。

## 稳定兼容边界

- `manifest.json` 最低 Obsidian 版本为 1.9.10。
- 运行时探测 Node ≥22.16、`DatabaseSync` 和 `sqlite.backup`；旧桌面安装器只显示
  升级提示，不修改数据。
- `versions.json` 声明当前版本最低兼容 Obsidian 版本。
- 稳定版冻结 schema 9，不包含旧数据库自动迁移路径。
- v1.2.0 的显示设置保存在插件 `data.json`，不改变数据库或备份格式。
- 生产 `main.js` 打包 React、Recharts 和 SheetJS。根目录
  `THIRD_PARTY_NOTICES.md` 由 lockfile、当前插件版本和
  `build/main.js` 自动生成，并由 `release:check` 验证。

## 发布后质量路线

1. 补充 Linux 最新 Obsidian 安装器真实 smoke，并记录 Obsidian、安装器和操作
   系统版本。
2. 在复制 Vault 持续回归 schema 9 备份恢复、数据库切换、锁释放、多 ItemView、
   弹窗焦点和大文件门禁。
3. 在正式产物上采集插件加载耗时和大数据量分析性能，优先处理可复现退化。
4. 保持 Ubuntu、macOS 和 Windows CI 的
   `npm ci → typecheck → lint → test → build → release:check` 全部通过。
5. 每次发布继续只上传标准三文件，并为每个文件生成 artifact attestation。

真实 smoke 状态只允许记录为 `通过（日期/版本/测试人）`、`失败（issue）` 或
`未测试`。记录不得包含真实数据库、账单内容、私有路径或其他敏感信息。

## 功能路线

- **前端边界整理：** 将当前大型编辑器按 feature 拆分，根组件只保留导航、月份、
  数据订阅和未保存保护；月度 reducer 继续是草稿唯一所有者。
- **导入性能：** 在保持单文件 20 MiB 门禁、映射和预览契约不变的前提下，把
  CSV/XLSX/XLS 解析移入 Worker。当前版本只消除了 Base64 副本。
- **错误与国际化：** 用稳定消息键和结构化错误码替代中文全文/正则翻译，业务层
  日志与用户文案分离，为第三种语言保留扩展边界。
- 大数据量分析的分片、缓存和真实 Vault 性能采样；
- 自动化 Electron/Obsidian 三平台 smoke；
- 在不改变 SQLite 事实层前提下扩展支付平台导入模板；
- 评估 SheetJS 延迟加载，以及 Recharts 主版本升级所需的图表回归；
- 移动端仅作为独立长期研究，不纳入当前桌面版承诺。

## 持续发布检查

- tag、`package.json`、`manifest.json` 和 `versions.json` 版本同步；
- `THIRD_PARTY_NOTICES.md` 的依赖版本、许可证和插件版本与 lockfile 一致；
  校验前规范化 CRLF/LF，不把平台相关 bundle 字节数写入受版本控制的声明；
- 标签发布优先交给 Release workflow；工作流必须支持已有 Release 时覆盖上传，
  避免手动 Release 与标签自动发布竞争；
- 项目只使用 `build/` 作为产物目录；构建时清空该目录，根部只保留标准三文件，
  不生成 `dist/`、`out/`、ZIP 或子目录；
- GitHub Release 只包含 `main.js`、`manifest.json` 和 `styles.css`；
- README、长期文档、CHANGELOG、SECURITY 和 release 日志与当前安装方式一致；
- Git 不包含数据库、备份、真实账单、Vault、日志、密钥、依赖或构建缓存。

官方参考：

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [obsidian-releases 社区插件清单](https://github.com/obsidianmd/obsidian-releases)
