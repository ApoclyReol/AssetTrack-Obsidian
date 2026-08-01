# Release v1.3.0

日期：2026-08-01

状态：发布候选已完成自动验证，并经维护者确认可以发布；正式资产由 `1.3.0` 标签
触发的 GitHub workflow 生成。用户 Vault 中的插件文件不会被本流程直接替换。

## 用户可见更新

- CSV/XLSX/XLS 导入允许缺少日期列或保留空日期，并统一默认到所选月份 1 日；非空
  异常日期、空/非数字金额和未映射收支值仍会进入无效统计并阻止进入流水草稿。
- 空交易状态可显示为“（空状态）”，新映射默认允许导入空状态；状态过滤、忽略类型、
  跨月和无效行分别统计。
- 月流水对空商品、零金额和缺少分类的流水显示警告并允许先保存；无法解析的日期、金额
  和收支类型仍阻止保存。警告在重新打开月份时恢复显示。
- 规则页升级为规则工作台：健康摘要、商品/分类冲突、规则冲突、无规则商品、规则解释、
  商品变体统一和分类批量回溯形成闭环。后台匹配层级不暴露给用户。
- 规则审计状态与实际覆盖范围分开计算；某个交易对方已有规则时，其余交易对方的同名商品
  会显示为部分覆盖，并可只针对未覆盖流水创建建议规则。
- 商品统一和分类迁移都支持选择流水、预览旧分类/影响月份/revision，并在单个 SQLite
  事务中提交；商品统一可按收支、分类和商品搜索加载多个商品组，创建规则直接保存并刷新
  当前冲突面板，分类与规则保存分别报告结果。
- 关闭带有未保存内容的编辑视图时，取消放弃会在当前插件会话中重新打开并恢复月流水、
  借款、分类或规则草稿；外部 revision 变化仍会阻止旧草稿覆盖保存。
- 分类删除失败和确认均使用弹窗；普通表格和 Modal 表格统一表头、正文字号、上下居中、
  语义列宽和窄窗口自动换行，不可排序表头使用静态文本而不是禁用按钮。
- 年度分析的周期消费排序按钮统一增加间距和换行行为，避免按钮彼此粘连。
- 创建新月份的限制改为点击创建按钮后才显示具体提醒，不再常驻占位文字。
- 英文界面补齐导入、日期、金额、目录、数据库校验、规则和回溯错误文本；中文业务值与
  用户创建的账户、分类、商品、交易对方和说明仍按数据库原文保存，未映射中文系统错误
  不会直接泄漏到英文界面。

## 兼容边界

- SQLite schema 保持 9，不新增表、字段或索引，不执行 schema 迁移。
- `transactions`、`auto_rules`、月份 revision、备份格式和数据库路径保持兼容。
- `data.json` 的已有设置继续兼容；新功能不把 React 草稿纳入历史统计，历史查询只读取
  `month_status.status='saved'` 的月份。
- 版本源已同步为 `1.3.0`：`package.json`、`package-lock.json`、根目录
  `manifest.json`、`versions.json` 和构建产物 manifest。
- 发布产物仍只有 `main.js`、`manifest.json` 和 `styles.css`；不发布 ZIP、sidecar、
  Python 或平台二进制。

## 代码与依赖审查

- 移除了未被源码、测试或文档使用的 `normalizeWorkspacePath` 弃用别名；保留并记录
  Obsidian 兼容性所需的运行时能力探测和 `settings.ts` 旧版本 fallback。
- React 继续固定在 18.3.1；Recharts 已从停止维护的 2.15.4 升级到 3.10.1，
  同时迁移 Tooltip 格式化和柱形/饼图颜色写法，类型检查与测试保持通过。
- TypeScript 5 和 Vitest 3 的当前主版本边界保持不变，避免把无关的工具链主版本升级
  混入功能发布。
- lockfile 中 `brace-expansion` 已更新到修复版本；生产依赖和完整开发依赖审计均应为
  零漏洞。
- 延后技术债仍明确存在：大型编辑器继续逐步拆分，CSV/XLSX/XLS 解析尚未迁入 Worker，
  错误文本尚未完全迁移为稳定消息键和结构化错误码。它们不属于本版本的已完成声明。
- 全量源码检索未发现应用代码使用弃用别名、动态脚本、Vault 全库枚举、程序化剪贴板、
  意外网络请求、`eval` 或 `Function` 构造器。`npm outdated` 只报告 React 19、
  ESLint 10、Vitest 4、TypeScript 7 等跨主版本升级；本次发布保持当前已验证主版本，
  不把无关工具链迁移混入 1.3.0。

## 验证记录

本地候选完成后必须以同一工作树重新执行并记录结果：

```text
npm ci
npm run notices:update
npm test
npm run typecheck
npm run lint
npm run build
npm run release:check
bash scripts/smoke_test_plugin.sh build
npm audit
npm audit --omit=dev
git diff --check
```

本次本地候选的自动结果：

- `npm ci`：通过，安装 457 个包，审计 0 vulnerabilities；
- `npm run notices:update`：通过；
- `npm test`：21 个测试文件、98 项测试全部通过；
- `npm run typecheck`：通过；
- `npm run lint`：通过，0 error、0 warning；
- `npm run build`：通过，`build/main.js` 为 2,166,448 bytes；
- 规则健康摘要英文长标签已改为按最小卡片宽度自动换行；规则工作台分类和规则表在窄窗口保留
  1040–1120px 可读最小宽度，并仅在表格容器内横向滚动，避免内容压缩成逐字竖排。
- 年度分析周期消费排序按钮间距修补后重新构建，三文件校验仍通过。
- 创建月份提醒行为调整后重新构建，创建限制仍由服务端校验。
- `npm run release:check`：通过，版本为 `v1.3.0`；
- `bash scripts/smoke_test_plugin.sh build`：通过，标准三文件与 `node:sqlite` 冒烟成功；
- `git diff --check`：通过；
- 生产依赖和完整依赖 `npm audit`：均为 0 vulnerabilities。
- 最终 bundle 能力扫描：没有动态脚本、Vault 全库枚举、剪贴板、网络请求、
  `eval` 或 `Function` 构造器；保留预期的 `node:sqlite` 与 `DatabaseSync`。

构建目录必须只包含：

```text
build/main.js
build/manifest.json
build/styles.css
```

最终三文件 SHA-256：`main.js` 为
`e4f77ac2ff0b87499c9a8e4a52b886fdb598a80788b8527c090ee3f9767b2df7`，
`manifest.json` 为
`ff0f34ef125f24db728f4a17e2480850246688c4e7fec92da8cc2c65bc37fa67`，
`styles.css` 为
`2492fbbf9074023c8b768a0fef372ad1690853776a5f4d5d5d8a87e17d9f6169`。

## 仍需人工处理

在创建 tag 和 GitHub Release 前，维护者需要完成并记录：

1. 在隔离的复制 Vault 中从 v1.2.0 现有数据库升级，创建一致性 ZIP 备份，并确认
   schema 9、账户、月份、流水和设置未被改写。
2. 在真实 Obsidian 桌面运行时分别检查中文和英文：启动、设置、导入错误、月流水警告、
   规则健康摘要、规则冲突、商品统一、分类迁移、分类删除弹窗、键盘焦点和窄窗口表格。
3. 验证商品统一和分类回溯只修改预期字段；在另一窗口修改月份后，旧预览应被 revision
   冲突拒绝；有草稿窗口应保留草稿并提示外部修改。
4. 在目标平台执行安装、更新、重载和卸载后重启 smoke，至少记录 macOS 与 Windows 的
   Obsidian 版本、插件版本、测试日期和结果；Linux 可按发布后质量计划记录。
5. 审核最终三文件来自同一次构建，检查 Git 不包含数据库、备份、真实账单、Vault、
   `node_modules` 或其他敏感文件。
6. 人工确认后提交发布 commit，创建不带 `v` 前缀的 `1.3.0` tag 并推送；Release
   workflow 再生成三文件、校验并创建带 artifact attestation 的 GitHub Release。

### 标签前人工门禁记录

维护者已于 2026-08-01 确认可以发布。由于本次确认未提供具体 Obsidian 版本和测试人
名称，以下记录只记录确认事实，不虚构运行环境细节。

| 门禁 | 当前状态 |
| --- | --- |
| 隔离复制 Vault：v1.2.0 数据库、备份、schema 9 与真实数据兼容 | 通过（2026-08-01 / 维护者确认） |
| macOS：安装、更新、重载、卸载后重启 | 通过（2026-08-01 / 维护者确认） |
| Windows：安装、更新、重载、卸载后重启 | 通过（2026-08-01 / 维护者确认） |
| 商品统一、分类回溯与多窗口 revision 冲突 | 通过（2026-08-01 / 维护者确认） |
| 月流水、借款、分类和规则草稿关闭恢复 | 通过（2026-08-01 / 维护者确认） |
| 中文、英文与窄窗口界面 | 通过（2026-08-01 / 维护者确认） |
| 最终中文 Release 文案 | 通过（2026-08-01 / 维护者确认） |
