import sqlite3

import pytest

from assettrack.infrastructure.sqlite_manager import SqliteManager


def test_new_database_is_created_directly_as_schema8(tmp_path):
    manager = SqliteManager(str(tmp_path / "accounting_system.db"))
    manager.init_db()

    validation = manager.validate_schema()
    assert validation["valid"] is True
    assert validation["schema_version"] == 8
    assert "asset_snapshots" not in validation["tables"]
    assert "investments" not in validation["tables"]
    assert "current_value" not in validation["columns"]["fixed_assets"]
    assert manager.fetch_one(
        "SELECT COUNT(*) AS count FROM account_definitions"
    )["count"] == 2
    assert {
        row["name"]
        for row in manager.fetch_all(
            "SELECT name FROM account_definitions ORDER BY sort_order"
        )
    } == {"默认现金账户", "默认理财账户"}
    colors = [
        row["color"]
        for row in manager.fetch_all(
            "SELECT color FROM category_definitions ORDER BY sort_order"
        )
    ]
    assert len(set(colors[: min(10, len(colors))])) == min(10, len(colors))


def test_existing_non_schema8_database_is_rejected_without_mutation(tmp_path):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE transactions "
            "(id INTEGER PRIMARY KEY, month TEXT, type TEXT, amount REAL)"
        )
        connection.execute("INSERT INTO transactions VALUES (1,'2026-01','支出',12.5)")
        connection.execute("PRAGMA user_version=4")
        connection.commit()

    manager = SqliteManager(str(path))
    with pytest.raises(RuntimeError, match="仅支持最新 schema 8"):
        manager.init_db()

    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 4
        assert connection.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1
        assert {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        } == {"transactions"}


def test_empty_account_definitions_are_repaired_without_touching_existing_accounts(
    tmp_path,
):
    manager = SqliteManager(str(tmp_path / "accounts.db"))
    manager.init_db()
    manager.execute("DELETE FROM account_definitions")
    manager.init_db()
    assert manager.fetch_one(
        "SELECT COUNT(*) AS count FROM account_definitions"
    )["count"] == 2

    manager.execute(
        "INSERT INTO account_definitions "
        "(account_key,name,account_type,is_active,sort_order) VALUES (?,?,?,?,?)",
        ("cash-user", "自定义现金", "cash", 1, 9),
    )
    manager.init_db()
    assert manager.fetch_one(
        "SELECT name FROM account_definitions WHERE account_key='cash-user'"
    )["name"] == "自定义现金"
