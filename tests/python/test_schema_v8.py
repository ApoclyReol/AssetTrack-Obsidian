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
    )["count"] == 5
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
