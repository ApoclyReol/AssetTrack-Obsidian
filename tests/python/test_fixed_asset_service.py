import sqlite3

import pandas as pd
import pytest

from assettrack.infrastructure.sqlite_manager import SqliteManager
from assettrack.domain import calculator, fixed_asset_service, month_status
from assettrack.domain.fixed_asset_service import (
    ensure_fixed_assets_inherited,
    get_fixed_assets,
    get_latest_fixed_asset_month,
    save_fixed_assets_atomic,
)


@pytest.fixture
def test_db(tmp_path, monkeypatch):
    manager = SqliteManager(str(tmp_path / "accounting_system.db"))
    manager.init_db()
    monkeypatch.setattr(fixed_asset_service, "db", manager)
    monkeypatch.setattr(month_status, "db", manager)
    return manager


def _asset(name, key, status="在用", value=1000):
    return {
        "asset_key": key,
        "asset_name": name,
        "category": "电子设备",
        "purchase_date": "2026-01-01",
        "purchase_price": value,
        "status": status,
        "note": "测试资产",
    }


def test_inheritance_copies_only_active_assets_and_is_idempotent(test_db):
    save_fixed_assets_atomic(
        "2026-01",
        [
            _asset("手机", "phone", "在用", 5000),
            _asset("旧手机", "old-phone", "闲置", 800),
            _asset("旧电脑", "old-computer", "已出售", 3000),
            _asset("坏耳机", "headset", "已报废", 100),
        ],
    )

    assert ensure_fixed_assets_inherited("2026-02") == 2
    assert ensure_fixed_assets_inherited("2026-02") == 0

    rows = get_fixed_assets("2026-02")
    assert [row["asset_name"] for row in rows] == ["手机", "旧手机"]
    assert {row["asset_key"] for row in rows} == {"phone", "old-phone"}


def test_current_month_changes_do_not_modify_history_and_empty_snapshot_stays_empty(test_db):
    save_fixed_assets_atomic("2026-01", [_asset("手机", "phone", value=5000)])
    ensure_fixed_assets_inherited("2026-02")

    updated = pd.DataFrame([_asset("新手机", "new-phone", value=3500)])
    save_fixed_assets_atomic("2026-02", updated)

    assert get_fixed_assets("2026-01")[0]["asset_name"] == "手机"
    assert get_fixed_assets("2026-02")[0]["asset_name"] == "新手机"

    save_fixed_assets_atomic("2026-02", [])
    assert ensure_fixed_assets_inherited("2026-02") == 0
    assert get_fixed_assets("2026-02") == []


def test_locked_month_rejects_fixed_asset_changes(test_db):
    save_fixed_assets_atomic("2026-01", [_asset("手机", "phone")])
    month_status.lock_month("2026-01")

    with pytest.raises(PermissionError):
        save_fixed_assets_atomic("2026-01", [])

    assert get_fixed_assets("2026-01")[0]["asset_name"] == "手机"


def test_latest_month_includes_an_intentionally_empty_snapshot(test_db):
    save_fixed_assets_atomic("2026-01", [_asset("手机", "phone")])
    ensure_fixed_assets_inherited("2026-02")
    save_fixed_assets_atomic("2026-02", [])

    assert get_latest_fixed_asset_month() == "2026-02"


def test_fixed_asset_month_is_available_to_month_navigation(test_db, monkeypatch):
    monkeypatch.setattr(calculator, "db", test_db)
    save_fixed_assets_atomic("2026-01", [_asset("手机", "phone")])

    assert calculator.get_all_months() == ["2026-01"]


def test_non_schema8_month_status_is_rejected(tmp_path):
    db_path = tmp_path / "legacy.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE month_status (
                month VARCHAR(16) PRIMARY KEY,
                status VARCHAR(16) NOT NULL DEFAULT 'draft',
                locked_at TEXT,
                updated_at TEXT
            )
            """
        )
        conn.commit()

    manager = SqliteManager(str(db_path))
    with pytest.raises(RuntimeError, match="仅支持最新 schema 8"):
        manager.init_db()
