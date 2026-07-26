import json
import zipfile

import pytest

from assettrack.infrastructure.sqlite_manager import SqliteManager
from assettrack.infrastructure.backup import backup_bundle
from assettrack.infrastructure.backup.backup_bundle import (
    BackupValidationError,
    export_complete_backup,
    import_complete_backup,
    validate_backup_source,
)


def _manager(path):
    manager = SqliteManager(str(path))
    manager.init_db()
    return manager


def test_complete_backup_contains_all_tables_and_round_trips(tmp_path, monkeypatch):
    source = _manager(tmp_path / "source.db")
    target = _manager(tmp_path / "target.db")
    monkeypatch.setattr(backup_bundle, "BACKUP_DIR", str(tmp_path / "backup"))

    source.execute(
        "INSERT INTO transactions "
        "(month, transaction_date, type, category, product, amount) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("2026-01", "2026-01-01", "支出", "餐饮基础", "午餐", 32.5),
    )
    source.execute(
        "INSERT INTO transactions "
        "(month, transaction_date, type, category, product, amount) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("2025-12", "2025-12-01", "代付", "", "旧版空分类流水", 223.5),
    )
    source.execute(
        "INSERT INTO fixed_assets (month, asset_key, asset_name, category, status) "
        "VALUES (?, ?, ?, ?, ?)",
        ("2026-01", "phone", "手机", "电子设备", "在用"),
    )
    source.execute(
        "INSERT INTO month_status "
        "(month, status, fixed_assets_initialized, revision) VALUES (?, ?, ?, ?)",
        ("2026-01", "saved", 1, 4),
    )

    archive = export_complete_backup(
        tmp_path / "asset-track-backup.zip", source_manager=source
    )
    result = validate_backup_source(archive)

    assert result["valid"] is True
    assert result["mode"] == "complete"
    assert result["row_counts"]["transactions"] == 2
    assert result["row_counts"]["fixed_assets"] == 1

    with zipfile.ZipFile(archive) as handle:
        names = set(handle.namelist())
        assert "accounting_system.db" in names
        assert "manifest.json" in names
        assert len([name for name in names if name.endswith("_backup.csv")]) == 9
        manifest = json.loads(handle.read("manifest.json"))
        assert manifest["format_version"] == 2
        assert manifest["schema_version"] == 8
        assert manifest["tables"]["month_status"]["rows"] == 1

    restored = import_complete_backup(archive, target_manager=target)
    assert restored["mode"] == "complete"
    assert target.fetch_one(
        "SELECT product, amount FROM transactions WHERE month = ?", ("2026-01",)
    ) == {"product": "午餐", "amount": 32.5}
    assert target.fetch_one(
        "SELECT category FROM transactions WHERE month = ?", ("2025-12",)
    )["category"] == ""
    assert target.fetch_one(
        "SELECT asset_key FROM fixed_assets WHERE month = ?", ("2026-01",)
    )["asset_key"] == "phone"
    assert target.fetch_one(
        "SELECT revision FROM month_status WHERE month = ?", ("2026-01",)
    )["revision"] == 4


def test_invalid_bundle_is_rejected_before_target_changes(tmp_path, monkeypatch):
    source = _manager(tmp_path / "source.db")
    target = _manager(tmp_path / "target.db")
    monkeypatch.setattr(backup_bundle, "BACKUP_DIR", str(tmp_path / "backup"))
    target.execute(
        "INSERT INTO transactions "
        "(month, transaction_date, type, category, product, amount) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("2026-02", "2026-02-01", "支出", "餐饮基础", "原始数据", 10),
    )
    archive = export_complete_backup(
        tmp_path / "asset-track-backup.zip", source_manager=source
    )

    broken = tmp_path / "broken.zip"
    with zipfile.ZipFile(archive) as original, zipfile.ZipFile(
        broken, "w", compression=zipfile.ZIP_DEFLATED
    ) as replacement:
        for info in original.infolist():
            if info.filename == "fixed_assets_backup.csv":
                continue
            replacement.writestr(info, original.read(info.filename))

    with pytest.raises(BackupValidationError):
        import_complete_backup(broken, target_manager=target)

    assert target.fetch_one(
        "SELECT product FROM transactions WHERE month = ?", ("2026-02",)
    )["product"] == "原始数据"


def test_old_csv_directory_is_rejected_by_runtime_restore(tmp_path):
    old = tmp_path / "old-seven-csv"
    old.mkdir()
    (old / "transactions_backup.csv").write_text(
        "month,type,category,product,amount\n2026-01,支出,餐饮基础,午餐,12\n",
        encoding="utf-8",
    )

    with pytest.raises(
        BackupValidationError,
        match="仅支持格式 2",
    ):
        validate_backup_source(old)
