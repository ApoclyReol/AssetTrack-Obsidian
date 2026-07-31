# Asset Track

[English](README.md) | [简体中文](README.zh-CN.md)

Asset Track 是仅支持桌面版、本地优先的个人财务管理工具。它用于记录月度账户、
流水、借款、理财和固定资产，并提供账单导入、规则归类、分析、对账和经过校验的
本地备份。

SQLite 是唯一事实源。插件不需要账户、不发起网络请求、不包含遥测，并将财务数据
保存在用户于当前 Vault 内明确选择的数据目录中。

Asset Track 已通过 Community Plugins 审核，可以直接从社区目录安装。手动安装
仅作为社区目录不可用时的备用方式。

## 安装

### 社区目录

1. 打开“设置 → 第三方插件 → 浏览”。
2. 搜索 **Asset Track**，进入插件页面并点击“安装”。
3. 启用 Asset Track。

### 手动安装备用方式

1. 从同一个 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 创建 `<Vault>/.obsidian/plugins/asset-track/`。
3. 将下载的三个文件复制到该目录。
4. 重启应用，或重新加载“设置 → 第三方插件”。
5. 启用 Asset Track。

不要安装 GitHub 自动生成的源代码压缩包。上述三个 Release 文件才是完整且受支持
的插件产物。

## 开始使用

1. 打开“设置 → Asset Track”。
2. 在当前 Vault 内选择一个专用数据目录。
3. 空目录选择“创建新数据库”；目录中已有有效 `accounting_system.db` 时选择
   “载入数据库”。
4. 从命令面板或功能区图标打开 Asset Track 编辑器。
5. 配置账户和分类，然后录入或导入每月流水。
6. 导入真实财务数据前，先导出并校验一份手动 ZIP 备份。

账单导入支持 CSV、XLSX 和 XLS 文件。映射窗口可以对应日期、金额、收支类型、
说明、交易对方和交易状态。解析与规则匹配全部在本地完成。

## 语言

Asset Track 自动跟随当前应用语言。`zh`、`zh-CN`、`zh-TW` 及其他 `zh-*`
环境显示中文，其他语言环境统一回退英文。修改应用语言后，请重新加载插件或重启
应用。

插件只翻译产品界面和内置业务标签。用户创建的账户、分类、交易对方、商品和流水
说明始终按数据库原文显示，不会因切换语言而修改。

## 数据与备份

数据库和自动保护快照保存在：

```text
<所选数据目录>/accounting_system.db
<所选数据目录>/backups/
```

迁移数据目录、切换数据库和恢复操作前，插件会创建保护快照。设置页可以导出并校验
完整 ZIP 备份，用于长期保存。Asset Track 不执行定时或在线备份。

禁用或卸载插件不会删除数据库、保护快照或手动备份。

## 隐私与权限

- **直接文件系统访问：** 桌面 SQLite 运行时、事务安全的数据库快照以及 ZIP
  备份和恢复需要此权限。用户输入的路径会被规范化，并且必须解析到当前 Vault 内。
- **Vault 访问：** Asset Track 访问已配置的数据目录，以及用户明确选择用于导入
  或恢复的文件。
- **剪贴板：** Asset Track 不读取或写入系统剪贴板。
- **网络：** Asset Track 不发起网络请求，也不包含遥测。

完整的安全与权限边界见 [SECURITY.md](SECURITY.md)。

## 财务视图与个性化设置

设置页可选择 ISO 4217 基础货币、标准或会计金额格式、平账容差和大额支出阈值。
资产分析区分资金投入资产与市场净资产，年度分析提供最近 12 个有数据月份的只读
周期消费表。

## 兼容性

- 当前版本：1.2.0；SQLite schema：9。
- 仅支持桌面版 macOS、Windows 和 Linux；不支持移动端。
- 最低应用版本：1.9.10。
- 桌面运行时必须提供 Node.js 22.16 或更高版本、`DatabaseSync` 和
  `sqlite.backup`。
- 不需要 Python、单独安装的 Node.js、sidecar 或原生扩展包。

macOS 和 Windows smoke 测试已经通过；Linux 验证保留为发布后质量任务。详情见
[发布后质量与功能路线](docs/10-community-release-plan.md)。

## 开发

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

生产构建输出为完整可安装目录 `build/obsidian/asset-track/`。GitHub Release
直接发布该目录中的 `main.js`、`manifest.json` 和 `styles.css`。

项目文档：

- [用户指南](docs/02-user-guide.md)
- [财务计算口径](docs/03-financial-model.md)
- [架构](docs/04-architecture.md)
- [开发说明](docs/06-development.md)
- [构建与发行](docs/07-release.md)
- [故障排查](docs/08-troubleshooting.md)
- [发布后质量与功能路线](docs/10-community-release-plan.md)
- [发行历史](docs/logs/README.md)

本项目采用 [MIT License](LICENSE)。直接生产依赖的许可证见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
