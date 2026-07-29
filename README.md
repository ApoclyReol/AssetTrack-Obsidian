# Asset Track

[English](README.md) | [简体中文](README.zh-CN.md)

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

## Language

Asset Track follows the current app language automatically. Chinese locales
(`zh`, `zh-CN`, `zh-TW`, and other `zh-*` variants) use the Chinese interface;
all other locales use English as the fallback. Restart or reload the plugin after
changing the app language.

Only product interface text and built-in business labels are translated. Names
and content created by the user—including accounts, categories, counterparties,
items, and transaction descriptions—are always displayed exactly as stored.

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

- Current version: 1.1.0; SQLite schema: 9.
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
