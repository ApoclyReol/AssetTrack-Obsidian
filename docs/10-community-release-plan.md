# 10 发布后质量与功能路线

> 文档角色：开发与维护。本文记录社区发布后的质量门禁和演进计划，不是用户操作文档。

## 当前结论

Asset Track 已通过 Community Plugins 审核，用户可以从 Obsidian 社区目录直接
搜索、安装和更新。GitHub Release 三文件手动安装仅作为开发验证或社区目录不可用
时的备用方式：

```text
main.js
manifest.json
styles.css
```

插件不依赖 Python、sidecar、平台原生扩展或 CPU 架构包。v1.7.1 已完成自动化构建、
跨平台 CI、标准三文件发布和 attestation；真实 Obsidian smoke 与复制 Vault 回归
仍按发布日志作为发布后的人工质量门禁持续补充。Linux 验证属于发布后持续质量工作。

## 稳定兼容边界

- `manifest.json` 最低 Obsidian 版本为 1.13.0；安装或更新 v1.7.1 前要求用户先升级
  到当前最新的 1.13.x 桌面版。
- 运行时探测 Node ≥22.16、`DatabaseSync` 和 `sqlite.backup`；旧桌面安装器只显示
  升级提示，不修改数据。
- `versions.json` 声明当前版本最低兼容 Obsidian 版本。
- 稳定版使用 schema 10；schema 9 首次打开时先创建保护备份并执行可回滚迁移，迁移失败
  不覆盖原数据库。schema 9→10 在同一事务中完成。
- 显示设置、AI 地址/模型/超时保存在插件 `data.json`，API Key 使用 SecretStorage；分类描述、通用规则、流水来源、
  理财流水账户和操作日志进入 schema 10 备份，规则工作台的历史统计只读取已保存月份。
- 设置页使用 Obsidian 1.13 `getSettingDefinitions()`；数据目录选择只保留页面草稿，
  成功创建、载入或迁移后才保存路径。插件代码不枚举 Vault 全部文件。
- 生产 `main.js` 打包 React、Recharts 和 SheetJS。根目录
  `THIRD_PARTY_NOTICES.md` 由 lockfile、当前插件版本和
  `build/main.js` 自动生成，并由 `release:check` 验证。

## 发布后质量路线

1. 补充 Linux 最新 Obsidian 安装器真实 smoke，并记录 Obsidian、安装器和操作
   系统版本。
2. 在复制 Vault 持续回归 schema 10 备份恢复、schema 9→10 迁移、数据库切换、锁释放、多 ItemView、
   弹窗焦点和大文件门禁。
3. 在正式产物上采集插件加载耗时和大数据量分析性能，优先处理可复现退化。
4. 保持 Ubuntu、macOS 和 Windows CI 的
   `npm ci → typecheck → lint → test → build → release:check` 全部通过。
5. 每次发布继续只上传标准三文件，并为每个文件生成 artifact attestation。
6. v1.7.1 发布后持续记录复制 Vault 升级、中文/英文界面、商品-分类冲突与回溯事务、商品
   统一、部分覆盖、批量操作日志、AI SecretStorage、月流水借款区块、关闭草稿恢复和分类删除弹窗；不能把这些真实 Obsidian smoke
   结果冒充为自动测试结果。

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
- 继续采集 Recharts 3 的图表回归，并评估 SheetJS 延迟加载机会；
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
- README、长期文档、SECURITY 和 release 日志与当前安装方式一致；
- Git 不包含数据库、备份、真实账单、Vault、日志、密钥、依赖或构建缓存。

官方参考：

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [obsidian-releases 社区插件清单](https://github.com/obsidianmd/obsidian-releases)
