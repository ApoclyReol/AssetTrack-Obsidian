# Asset Track

[简体中文](README.zh-CN.md)

> **Import your bills once a month. Understand where your money went, what changed in your assets, and whether the picture is complete.**

Asset Track is a private, local personal finance tool for monthly settlement. It turns bills
exported from payment platforms into one organized financial record, then helps you review
spending, assets, loans, investments, and data gaps.

You do not need to record every purchase as it happens. Asset Track is built for a short,
focused monthly review: import what already exists, resolve the few things that need your
judgment, check the result, and move on.

## Why Asset Track

- **Once a month:** replace continuous manual entry with a focused monthly routine.
- **One financial record:** different bill formats are organized into one local SQLite source of truth.
- **Checkable results:** asset changes and transaction data help reveal missing or inconsistent records.
- **Completely private:** no account, no network requests, no telemetry, and no cloud classification.

The guiding idea is simple: the system handles repetitive organization; you keep the final say.

## How it works

```text
Export your bills
        ↓
Import and map the fields
        ↓
Resolve exceptions and categories
        ↓
Update month-end assets, loans, and investments
        ↓
Reconcile and review the result
```

## Who it is for

Asset Track is a good fit if you:

- mostly pay through services such as WeChat, Alipay, or bank cards;
- do not want to maintain a daily bookkeeping habit;
- are willing to spend a little time organizing bills once a month;
- care about private ownership of financial data;
- want to understand asset changes, not only see spending charts.

## What it covers

- CSV, XLSX, and XLS bill import with reusable field mappings;
- monthly transactions, accounts, loans, investments, and fixed assets;
- category and product rules for repeated cleanup;
- conflict and missing-category review;
- monthly and annual spending and asset analysis;
- reconciliation between transactions and asset changes;
- local backup, restore, and data-directory migration.

## Installation

1. Install **Asset Track** from **Settings → Community plugins → Browse**.

If the community directory is unavailable, download only `main.js`, `manifest.json`, and
`styles.css` from the same GitHub Release and place them in
`<Vault>/.obsidian/plugins/asset-track/`.

## Getting started

1. Open **Settings → Asset Track** and choose a dedicated folder inside the current vault.
2. Create a new database in an empty folder, or load an existing one.
3. Open the editor from the command palette or ribbon.
4. Import this month’s bills, review the exceptions, update month-end assets, and save the month.

## Data and privacy

Your financial data stays in the folder you choose inside your vault. Asset Track does not
require an account, upload bills, contact a server, or track financial behavior. Backups and
restores are initiated by you, and disabling or uninstalling the plugin does not delete your
database or backups.

## Compatibility

- Desktop Obsidian only: macOS, Windows, and Linux.
- Version 1.4.0 requires Obsidian 1.13.0 or later. Update to the latest available 1.13.x desktop release before installing or updating.
- The plugin does not require Python, a separate Node.js installation, or a sidecar.

## Read more

- [User guide](docs/02-user-guide.md)
- [Product philosophy and design principles](docs/12-product-philosophy.md)
- [Privacy and data trust model](docs/14-data-trust-model.md)

Developer and maintainer documentation is indexed in the
[documentation reading guide](docs/00-reading-guide.md). Release and build procedures are in
the [release guide](docs/07-release.md).
