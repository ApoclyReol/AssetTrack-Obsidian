# Asset Track

Asset Track is a desktop-only, local-first personal finance tracker. It records
monthly accounts, transactions, loans, investments, and fixed assets, and provides
bill imports, rule-based categorization, analytics, reconciliation, and verified
local backups.

SQLite is the single source of truth. The plugin requires no account, makes no
network requests, includes no telemetry, and keeps financial data in a directory
the user explicitly selects inside the vault.

> [!IMPORTANT]
> Asset Track is not yet available in the Community Plugins directory. Until it is
> accepted, install the three files from the matching GitHub release manually.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the same GitHub
   release.
2. Create `<Vault>/.obsidian/plugins/asset-track/`.
3. Copy the three downloaded files into that directory.
4. Restart the app, or reload **Settings → Community plugins**.
5. Enable **Asset Track**.

Do not install the source archive generated automatically by GitHub. The three
release files above are the complete supported plugin bundle.

## Getting started

1. Open **Settings → Asset Track**.
2. Select a dedicated data directory inside the current vault.
3. Choose **Create new database** for an empty directory, or **Load database** if
   the directory already contains a valid `accounting_system.db`.
4. Open the Asset Track editor from the command palette or ribbon.
5. Configure accounts and categories, then enter or import monthly transactions.
6. Export and verify a manual ZIP backup before importing real financial data.

Bill import supports CSV, XLSX, and XLS files. The mapping dialog can map date,
amount, income/expense type, description, counterparty, and transaction status.
Parsing and rule matching happen locally.

## Data and backups

The database and automatic protection snapshots are stored at:

```text
<selected data directory>/accounting_system.db
<selected data directory>/backups/
```

The plugin creates a protection snapshot before directory migration, database
switching, and restore operations. A manual ZIP backup can be exported and
validated from Settings for long-term storage. Asset Track does not perform
scheduled or online backups.

Disabling or uninstalling the plugin does not delete its database, protection
snapshots, or manual backups.

## Privacy and permissions

- **Direct filesystem access:** Required for the desktop SQLite runtime,
  transaction-safe database snapshots, and ZIP backup and restore. User-entered
  paths are normalized and must resolve inside the current vault.
- **Vault access:** Asset Track accesses only its configured data directory and
  files explicitly selected for import or restore. It does not enumerate all files
  in the vault.
- **Clipboard:** Asset Track does not read from or write to the system clipboard.
- **Network:** Asset Track makes no network requests and includes no telemetry.

See [SECURITY.md](SECURITY.md) for the complete security and disclosure boundary.

## Compatibility

- Current version: 1.0.5; SQLite schema: 9.
- Desktop only: macOS, Windows, and Linux; mobile is not supported.
- Minimum app version: 1.9.10.
- The desktop runtime must provide Node.js 22.16 or later, `DatabaseSync`, and
  `sqlite.backup`.
- Python, a separate Node.js installation, sidecars, and native extension packages
  are not required.

macOS and Windows smoke tests have passed. Linux testing remains a release gate;
see the [Community Plugins release plan](docs/10-community-release-plan.md).

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

The production build is written to `dist/main.js`. GitHub releases contain only
that file renamed to `main.js`, plus `manifest.json` and `styles.css`.

Project documentation:

- [User guide](docs/02-user-guide.md)
- [Financial model](docs/03-financial-model.md)
- [Architecture](docs/04-architecture.md)
- [Development guide](docs/06-development.md)
- [Release guide](docs/07-release.md)
- [Troubleshooting](docs/08-troubleshooting.md)
- [Community Plugins release plan](docs/10-community-release-plan.md)
- [Release history](docs/logs/README.md)

## 中文说明

Asset Track 是桌面版、本地优先的个人财务工具，用于记录月度账户、流水、借款、
理财和固定资产，并提供账单导入、规则归类、实时分析、对账和一致性备份。插件
不联网、不含遥测，SQLite 是唯一事实源。

### 安装

1. 从同一 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 Vault 的 `.obsidian/plugins/` 下创建 `asset-track/` 目录。
3. 将三个文件放入该目录，重启应用并在“设置 → 第三方插件”中启用。

### 开始使用

1. 打开“设置 → Asset Track”，选择 Vault 内的专用数据目录。
2. 空目录选择“创建新数据库”；已有有效数据库选择“载入数据库”。
3. 从命令面板或侧边栏打开编辑器，配置账户与分类后录入或导入数据。
4. 导入真实账单前，先从设置页导出并验证一份手动 ZIP 备份。

数据库固定保存为 `<数据目录>/accounting_system.db`，保护快照位于
`<数据目录>/backups/`。禁用或卸载插件不会删除这些数据。

本项目使用 [MIT License](LICENSE)。直接生产依赖的许可证见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
