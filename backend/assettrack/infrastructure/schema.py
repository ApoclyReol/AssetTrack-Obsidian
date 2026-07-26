"""Canonical Asset Track schema.

The runtime supports exactly this schema. Historical CSV conversion is an
offline workflow and is intentionally not part of plugin startup.
"""

from __future__ import annotations

import hashlib
import sqlite3

from assettrack.infrastructure.config import (
    CATEGORIES_METADATA,
    category_rainbow_color,
)


CURRENT_SCHEMA_VERSION = 8
REQUIRED_TABLES = (
    "transactions",
    "category_definitions",
    "account_definitions",
    "cash_account_balances",
    "investment_account_balances",
    "fixed_assets",
    "debt_manager",
    "auto_rules",
    "month_status",
)
REQUIRED_COLUMNS = {
    "transactions": {
        "id", "month", "transaction_date", "type", "category_key",
        "category", "product", "amount",
    },
    "category_definitions": {
        "category_key", "name", "transaction_type", "necessity", "pattern",
        "is_big_ticket", "color", "is_active", "sort_order",
    },
    "account_definitions": {
        "account_key", "name", "account_type", "is_active", "sort_order",
    },
    "cash_account_balances": {"month", "account_key", "balance"},
    "investment_account_balances": {
        "month", "account_key", "principal", "market_value", "cash_balance",
    },
    "fixed_assets": {
        "id", "month", "asset_key", "asset_name", "category", "purchase_date",
        "purchase_price", "status", "note",
    },
    "debt_manager": {
        "id", "description", "counterparty", "amount", "start_date",
        "is_paid", "paid_date",
    },
    "auto_rules": {
        "id", "transaction_type", "product", "category_key", "category",
    },
    "month_status": {
        "month", "status", "locked_at", "updated_at",
        "fixed_assets_initialized", "revision",
    },
}


def category_key(name: str) -> str:
    return "cat-" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:16]


def create_current_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE category_definitions (
            category_key TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            transaction_type TEXT NOT NULL CHECK(transaction_type IN ('支出','收入')),
            necessity TEXT NOT NULL CHECK(necessity IN ('必要','可控','不适用')),
            pattern TEXT NOT NULL CHECK(pattern IN ('周期','日常','偶尔','不适用')),
            is_big_ticket INTEGER NOT NULL DEFAULT 0,
            color TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE account_definitions (
            account_key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            account_type TEXT NOT NULL CHECK(account_type IN ('cash','investment')),
            is_active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            UNIQUE(account_type, name)
        );
        CREATE TABLE transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            transaction_date TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('支出','收入','代付','加仓','提现')),
            category_key TEXT,
            category TEXT NOT NULL DEFAULT '',
            product TEXT NOT NULL DEFAULT '',
            amount REAL NOT NULL,
            FOREIGN KEY(category_key) REFERENCES category_definitions(category_key)
        );
        CREATE TABLE cash_account_balances (
            month TEXT NOT NULL,
            account_key TEXT NOT NULL,
            balance REAL NOT NULL DEFAULT 0,
            PRIMARY KEY(month, account_key),
            FOREIGN KEY(account_key) REFERENCES account_definitions(account_key)
        );
        CREATE TABLE investment_account_balances (
            month TEXT NOT NULL,
            account_key TEXT NOT NULL,
            principal REAL NOT NULL DEFAULT 0,
            market_value REAL NOT NULL DEFAULT 0,
            cash_balance REAL NOT NULL DEFAULT 0,
            PRIMARY KEY(month, account_key),
            FOREIGN KEY(account_key) REFERENCES account_definitions(account_key)
        );
        CREATE TABLE fixed_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            asset_name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            purchase_date TEXT,
            purchase_price REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT '在用',
            note TEXT NOT NULL DEFAULT '',
            UNIQUE(month, asset_key)
        );
        CREATE TABLE debt_manager (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL DEFAULT '',
            counterparty TEXT NOT NULL DEFAULT '',
            amount REAL NOT NULL DEFAULT 0,
            start_date TEXT NOT NULL,
            is_paid INTEGER NOT NULL DEFAULT 0,
            paid_date TEXT
        );
        CREATE TABLE auto_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_type TEXT NOT NULL CHECK(transaction_type IN ('支出','收入')),
            product TEXT NOT NULL,
            category_key TEXT NOT NULL,
            category TEXT NOT NULL,
            FOREIGN KEY(category_key) REFERENCES category_definitions(category_key)
        );
        CREATE TABLE month_status (
            month TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'draft',
            locked_at TEXT,
            updated_at TEXT,
            fixed_assets_initialized INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_transactions_month ON transactions(month);
        CREATE INDEX idx_transactions_type ON transactions(type);
        CREATE INDEX idx_transactions_category_key ON transactions(category_key);
        CREATE INDEX idx_transactions_month_date ON transactions(month, transaction_date, id);
        CREATE INDEX idx_cash_balances_month ON cash_account_balances(month);
        CREATE INDEX idx_investment_balances_month ON investment_account_balances(month);
        CREATE INDEX idx_fixed_assets_month ON fixed_assets(month);
        CREATE INDEX idx_debt_start ON debt_manager(start_date);
        CREATE INDEX idx_debt_paid ON debt_manager(is_paid);
        CREATE INDEX idx_auto_rules_type_product ON auto_rules(transaction_type, product);
        """
    )
    for order, (name, metadata) in enumerate(sorted(CATEGORIES_METADATA.items())):
        transaction_type = str(metadata.get("type") or "支出")
        connection.execute(
            """
            INSERT INTO category_definitions
              (category_key, name, transaction_type, necessity, pattern,
               is_big_ticket, color, is_active, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                category_key(name),
                name,
                transaction_type,
                metadata.get("necessity")
                if metadata.get("necessity") in {"必要", "可控"}
                else "不适用",
                metadata.get("pattern")
                if metadata.get("pattern") in {"周期", "日常", "偶尔"}
                else "不适用",
                int(bool(metadata.get("is_big_ticket"))),
                category_rainbow_color(order),
                order,
            ),
        )
    connection.executemany(
        """
        INSERT INTO account_definitions
          (account_key, name, account_type, is_active, sort_order)
        VALUES (?, ?, ?, 1, ?)
        """,
        [
            ("cash-boc", "中国银行", "cash", 0),
            ("cash-ccb", "建设银行", "cash", 1),
            ("cash-alipay", "支付宝", "cash", 2),
            ("cash-wechat", "微信", "cash", 3),
            ("investment-default", "默认理财账户", "investment", 0),
        ],
    )
    connection.execute(f"PRAGMA user_version={CURRENT_SCHEMA_VERSION}")
