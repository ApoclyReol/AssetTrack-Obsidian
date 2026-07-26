"""Complete, validated backups for the packaged Asset Track app."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import pandas as pd

from assettrack.infrastructure.config import BACKUP_DIR as CONFIG_BACKUP_DIR
from assettrack.infrastructure.sqlite_manager import REQUIRED_TABLES, SqliteManager, db


BACKUP_FORMAT_VERSION = 2
BACKUP_DIR = str(CONFIG_BACKUP_DIR)
MANIFEST_NAME = "manifest.json"
DATABASE_NAME = "accounting_system.db"
MAX_ARCHIVE_MEMBERS = 128
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
BACKUP_CONFIG = [
    {
        "name": "transactions",
        "filename": "transactions_backup.csv",
        "columns": [
            "month", "transaction_date", "type", "category_key",
            "category", "product", "amount",
        ],
    },
    {
        "name": "category_definitions",
        "filename": "category_definitions_backup.csv",
        "columns": [
            "category_key", "name", "transaction_type", "necessity", "pattern",
            "is_big_ticket", "color", "is_active", "sort_order",
        ],
    },
    {
        "name": "account_definitions",
        "filename": "account_definitions_backup.csv",
        "columns": [
            "account_key", "name", "account_type", "is_active", "sort_order",
        ],
    },
    {
        "name": "cash_account_balances",
        "filename": "cash_account_balances_backup.csv",
        "columns": ["month", "account_key", "balance"],
    },
    {
        "name": "investment_account_balances",
        "filename": "investment_account_balances_backup.csv",
        "columns": [
            "month", "account_key", "principal", "market_value", "cash_balance",
        ],
    },
    {
        "name": "fixed_assets",
        "filename": "fixed_assets_backup.csv",
        "columns": [
            "month", "asset_key", "asset_name", "category", "purchase_date",
            "purchase_price", "status", "note",
        ],
    },
    {
        "name": "debt_manager",
        "filename": "debts_backup.csv",
        "columns": [
            "description", "counterparty", "amount", "start_date",
            "is_paid", "paid_date",
        ],
    },
    {
        "name": "auto_rules",
        "filename": "auto_rules_backup.csv",
        "columns": [
            "transaction_type", "product", "category_key", "category",
        ],
    },
    {
        "name": "month_status",
        "filename": "month_status_backup.csv",
        "columns": [
            "month", "status", "locked_at", "updated_at",
            "fixed_assets_initialized", "revision",
        ],
    },
]


class BackupValidationError(ValueError):
    """Raised when a schema 8 backup cannot be trusted."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")


def _config_by_table(
    configs: list[dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    return {
        str(config["name"]): config for config in (configs or BACKUP_CONFIG)
    }


def _copy_sqlite_snapshot(source_path: str | os.PathLike[str], target_path: Path) -> None:
    """Copy a live SQLite database using the Online Backup API."""

    target_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(str(source_path), check_same_thread=False)
    target = sqlite3.connect(str(target_path), check_same_thread=False)
    try:
        source.backup(target)
        target.commit()
    finally:
        target.close()
        source.close()


def _write_table_csv(conn: sqlite3.Connection, config: dict[str, Any], root: Path) -> Path:
    table = str(config["name"])
    columns = [str(column) for column in config["columns"]]
    path = root / str(config["filename"])
    path.parent.mkdir(parents=True, exist_ok=True)

    table_columns = {
        row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    order = " ORDER BY id" if "id" in table_columns else ""
    rows = conn.execute(
        f"SELECT {', '.join(columns)} FROM {table}{order}"
    ).fetchall()
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row[column] for column in columns})
    return path


def _canonical_digest(
    values: list[tuple[Any, ...]],
    *,
    numeric_indexes: set[int] | None = None,
) -> str:
    numeric_indexes = numeric_indexes or set()

    def canonical(value: Any, index: int) -> Any:
        if value is None or value == "":
            return None
        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass
        if index in numeric_indexes:
            try:
                return round(float(value), 12)
            except (TypeError, ValueError):
                return value
        return value

    payload = json.dumps(
        [
            [canonical(value, index) for index, value in enumerate(row)]
            for row in values
        ],
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _numeric_column_indexes(
    conn: sqlite3.Connection, table: str, columns: list[str]
) -> set[int]:
    declared_types = {
        str(row[1]): str(row[2]).upper()
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    numeric_markers = ("INT", "REAL", "FLOA", "DOUB", "NUM", "DEC")
    return {
        index
        for index, column in enumerate(columns)
        if any(marker in declared_types.get(column, "") for marker in numeric_markers)
    }


def _table_digest_from_db(conn: sqlite3.Connection, config: dict[str, Any]) -> str:
    table = str(config["name"])
    columns = [str(column) for column in config["columns"]]
    table_columns = {
        row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    order = " ORDER BY id" if "id" in table_columns else ""
    rows = conn.execute(
        f"SELECT {', '.join(columns)} FROM {table}{order}"
    ).fetchall()
    return _canonical_digest(
        [tuple(row) for row in rows],
        numeric_indexes=_numeric_column_indexes(conn, table, columns),
    )


def _table_digest_from_csv(
    path: Path, config: dict[str, Any], conn: sqlite3.Connection
) -> str:
    # Complete backups must preserve database facts exactly.
    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    columns = [str(column) for column in config["columns"]]
    values = [tuple(row) for row in frame[columns].itertuples(index=False, name=None)]
    return _canonical_digest(
        values,
        numeric_indexes=_numeric_column_indexes(
            conn, str(config["name"]), columns
        ),
    )


def _manifest_for_root(root: Path, db_manager: SqliteManager) -> dict[str, Any]:
    validation = db_manager.validate_schema()
    if not validation["valid"]:
        raise BackupValidationError(
            f"数据库 schema 无效：缺少表 {validation['missing_tables']}，"
            f"integrity={validation['integrity_check']}"
        )

    with sqlite3.connect(str(db_manager.db_path)) as conn:
        table_rows = {
            table: int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in REQUIRED_TABLES
        }

    files: dict[str, dict[str, Any]] = {}
    database_path = root / DATABASE_NAME
    files[DATABASE_NAME] = {
        "size": database_path.stat().st_size,
        "sha256": _sha256(database_path),
    }
    table_manifest: dict[str, dict[str, Any]] = {}
    configs = _config_by_table()
    for table in REQUIRED_TABLES:
        config = configs[table]
        filename = str(config["filename"])
        path = root / filename
        if not path.exists():
            raise BackupValidationError(f"备份缺少 CSV：{filename}")
        files[filename] = {"size": path.stat().st_size, "sha256": _sha256(path)}
        with sqlite3.connect(str(db_manager.db_path)) as conn:
            content_hash = _table_digest_from_db(conn, config)
        table_manifest[table] = {
            "rows": table_rows[table],
            "filename": filename,
            "columns": list(config["columns"]),
            "content_sha256": content_hash,
        }

    return {
        "format_version": BACKUP_FORMAT_VERSION,
        "schema_version": validation["schema_version"],
        "app_version": os.getenv("ASSET_TRACK_APP_VERSION", "3.2.0"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "required_tables": list(REQUIRED_TABLES),
        "tables": table_manifest,
        "files": files,
    }


def export_complete_backup(
    output_path: str | os.PathLike[str] | None = None,
    *,
    source_manager: SqliteManager | None = None,
    copy_raw_csv: bool = True,
) -> Path:
    """Export a consistent SQLite snapshot, all CSVs, and a manifest ZIP."""

    source = source_manager or db
    output = (
        Path(output_path).expanduser().resolve()
        if output_path is not None
        else Path(BACKUP_DIR).expanduser().resolve()
        / f"asset-track-backup-{_timestamp()}.zip"
    )
    destination_dir = output.parent
    destination_dir.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="asset-track-backup-") as temp_dir:
        root = Path(temp_dir)
        snapshot_path = root / DATABASE_NAME
        _copy_sqlite_snapshot(source.db_path, snapshot_path)

        snapshot_manager = SqliteManager(str(snapshot_path))
        snapshot_manager.validate_schema()
        with sqlite3.connect(str(snapshot_path)) as conn:
            conn.row_factory = sqlite3.Row
            for config in BACKUP_CONFIG:
                _write_table_csv(conn, config, root)

        manifest = _manifest_for_root(root, snapshot_manager)
        (root / MANIFEST_NAME).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

        # Keep the nine raw CSV files beside the ZIP for local inspection.
        if copy_raw_csv:
            raw_backup_dir = destination_dir
            for config in BACKUP_CONFIG:
                filename = str(config["filename"])
                shutil.copy2(root / filename, raw_backup_dir / filename)

        temporary_zip = output.with_name(output.name + ".tmp")
        if temporary_zip.exists():
            temporary_zip.unlink()
        with zipfile.ZipFile(
            temporary_zip, "w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            for path in sorted(root.iterdir()):
                archive.write(path, arcname=path.name)
        os.replace(temporary_zip, output)

    return output


def export_directory_backup(
    output_dir: str | os.PathLike[str] | None = None,
    *,
    source_manager: SqliteManager | None = None,
    source_revision: str | None = None,
) -> Path:
    """Export an atomic format-2 directory backup: DB, csv/, and manifest."""

    source = source_manager or db
    output = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else Path(BACKUP_DIR).expanduser().resolve() / _timestamp()
    )
    if output.exists():
        raise BackupValidationError(f"备份目录已存在：{output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = output.with_name(output.name + ".tmp")
    if staging.exists():
        shutil.rmtree(staging)
    csv_dir = staging / "csv"
    try:
        snapshot_path = staging / DATABASE_NAME
        _copy_sqlite_snapshot(source.db_path, snapshot_path)
        snapshot_manager = SqliteManager(str(snapshot_path))
        validation = snapshot_manager.validate_schema()
        if not validation["valid"]:
            raise BackupValidationError("SQLite 快照校验失败")
        with sqlite3.connect(str(snapshot_path)) as conn:
            conn.row_factory = sqlite3.Row
            for config in BACKUP_CONFIG:
                _write_table_csv(conn, config, staging)

        manifest = _manifest_for_root(staging, snapshot_manager)
        csv_dir.mkdir(parents=True)
        table_files: dict[str, dict[str, Any]] = {}
        for table, metadata in manifest["tables"].items():
            filename = str(metadata["filename"])
            path = csv_dir / filename
            shutil.move(str(staging / filename), str(path))
            table_files[f"csv/{filename}"] = {
                "size": path.stat().st_size,
                "sha256": _sha256(path),
            }
            metadata["filename"] = f"csv/{filename}"
        manifest["files"] = {
            DATABASE_NAME: manifest["files"][DATABASE_NAME],
            **table_files,
        }
        manifest["source_revision"] = source_revision
        manifest["backup_version"] = BACKUP_FORMAT_VERSION
        manifest["integrity_check"] = validation["integrity_check"]
        (staging / MANIFEST_NAME).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        os.replace(staging, output)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return output


def _safe_extract(archive: zipfile.ZipFile, target: Path) -> None:
    target_resolved = target.resolve()
    members = archive.infolist()
    if len(members) > MAX_ARCHIVE_MEMBERS:
        raise BackupValidationError("ZIP 文件数量超过安全上限")
    if sum(max(0, member.file_size) for member in members) > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
        raise BackupValidationError("ZIP 解压后体积超过安全上限")
    for member in members:
        member_path = (target / member.filename).resolve()
        if member_path != target_resolved and target_resolved not in member_path.parents:
            raise BackupValidationError(f"ZIP 包含非法路径：{member.filename}")
    archive.extractall(target)


@contextmanager
def _materialize_source(source: str | os.PathLike[str]) -> Iterator[tuple[Path, bool]]:
    """Yield ``(root, temporary)`` for a ZIP, directory, or SQLite file."""

    source_path = Path(source).expanduser().resolve()
    if source_path.is_dir():
        yield source_path, False
        return
    if source_path.suffix.lower() == ".zip":
        temp_dir = tempfile.TemporaryDirectory(prefix="asset-track-restore-")
        root = Path(temp_dir.name)
        try:
            with zipfile.ZipFile(source_path) as archive:
                _safe_extract(archive, root)
            yield root, True
        finally:
            temp_dir.cleanup()
        return
    if source_path.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
        temp_dir = tempfile.TemporaryDirectory(prefix="asset-track-restore-")
        root = Path(temp_dir.name)
        try:
            # A live SQLite database may have committed data in WAL.  Use the
            # Online Backup API even when the user selected a raw .db file.
            _copy_sqlite_snapshot(source_path, root / DATABASE_NAME)
            yield root, True
        finally:
            temp_dir.cleanup()
        return
    raise BackupValidationError(f"不支持的备份来源：{source_path}")


def _validate_csv(
    path: Path,
    config: dict[str, Any],
) -> tuple[int, pd.DataFrame]:
    if not path.exists() or not path.is_file():
        raise BackupValidationError(f"备份缺少 CSV：{path.name}")
    try:
        frame = pd.read_csv(path)
    except Exception as exc:  # pragma: no cover - pandas error text varies
        raise BackupValidationError(f"CSV 无法读取：{path.name}: {exc}") from exc
    expected = list(config["columns"])
    actual = list(frame.columns)
    if actual != expected:
        raise BackupValidationError(
            f"CSV 字段不匹配：{path.name}，期望 {expected}，实际 {actual}"
        )
    return int(len(frame)), frame


def validate_backup_source(source: str | os.PathLike[str]) -> dict[str, Any]:
    """Validate a schema-8 format-2 directory, ZIP, or raw SQLite database."""

    with _materialize_source(source) as (root, _temporary):
        database_path = root / DATABASE_NAME
        has_manifest = (root / MANIFEST_NAME).exists()
        has_database = database_path.exists()
        configs = _config_by_table()
        required_tables = tuple(REQUIRED_TABLES)
        format_version = BACKUP_FORMAT_VERSION

        if has_manifest:
            if not has_database:
                raise BackupValidationError("完整备份缺少 accounting_system.db")
            try:
                manifest = json.loads((root / MANIFEST_NAME).read_text(encoding="utf-8"))
            except Exception as exc:
                raise BackupValidationError(f"manifest.json 无法读取：{exc}") from exc
            format_version = int(manifest.get("format_version", 0) or 0)
            if format_version != BACKUP_FORMAT_VERSION:
                raise BackupValidationError("不支持的备份格式版本")
            if manifest.get("required_tables") != list(required_tables):
                raise BackupValidationError("manifest 的必需表清单不完整或顺序不匹配")
            if set(manifest.get("tables", {})) != set(required_tables):
                raise BackupValidationError("manifest 的表摘要不完整")
            for filename, metadata in manifest.get("files", {}).items():
                path = root / filename
                if not path.exists() or _sha256(path) != metadata.get("sha256"):
                    raise BackupValidationError(f"文件校验失败：{filename}")
            mode = "complete"
        elif has_database:
            manifest = None
            mode = "sqlite"
        else:
            raise BackupValidationError(
                "仅支持格式 2 目录、格式 2 ZIP 或 schema 8 SQLite"
            )

        if has_database:
            with sqlite3.connect(str(database_path)) as conn:
                integrity = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
                actual_tables = {
                    str(row[0])
                    for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
                missing = sorted(set(required_tables) - actual_tables)
                schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            schema = {
                "valid": (
                    integrity == "ok"
                    and not missing
                    and schema_version == 8
                ),
                "integrity_check": integrity,
                "missing_tables": missing,
                "schema_version": schema_version,
            }
            if not schema["valid"]:
                raise BackupValidationError(
                    f"SQLite 校验失败：缺少 {missing}，integrity={integrity}"
                )
        else:
            schema = None

        row_counts: dict[str, int] = {}
        if mode == "complete":
            for table in required_tables:
                configured_filename = str(
                    manifest["tables"][table]["filename"]
                    if mode == "complete" and manifest
                    else configs[table]["filename"]
                )
                row_counts[table], _ = _validate_csv(
                    root / configured_filename,
                    configs[table],
                )

        if mode == "complete":
            with sqlite3.connect(str(database_path)) as conn:
                for table in required_tables:
                    db_count = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
                    if db_count != row_counts[table]:
                        raise BackupValidationError(
                            f"数据库与 CSV 行数不一致：{table}，db={db_count} csv={row_counts[table]}"
                        )
                    manifest_rows = int(manifest["tables"][table]["rows"])
                    if manifest_rows != db_count:
                        raise BackupValidationError(
                            f"manifest 与数据库行数不一致：{table}"
                        )
                    config = configs[table]
                    db_digest = _table_digest_from_db(conn, config)
                    csv_digest = _table_digest_from_csv(
                        root / str(manifest["tables"][table]["filename"]), config, conn
                    )
                    expected_digest = manifest["tables"][table].get("content_sha256")
                    if expected_digest not in {db_digest, csv_digest} or db_digest != csv_digest:
                        raise BackupValidationError(
                            f"数据库与 CSV 内容摘要不一致：{table}"
                        )

        return {
            "valid": True,
            "mode": mode,
            "schema": schema,
            "row_counts": row_counts,
            "manifest": manifest,
            "format_version": format_version,
            "required_tables": list(required_tables),
        }

def import_complete_backup(
    source: str | os.PathLike[str],
    *,
    target_manager: SqliteManager | None = None,
) -> dict[str, Any]:
    """Validate a source, stage it, then atomically replace the live database."""

    target = target_manager or db
    validation = validate_backup_source(source)

    with _materialize_source(source) as (root, _temporary):
        target_path = Path(target.db_path).expanduser().resolve()
        target_path.parent.mkdir(parents=True, exist_ok=True)
        staging_path = target_path.with_name(target_path.name + ".incoming")
        safety_path = target_path.parent / "backup" / f"pre-restore-{_timestamp()}"
        if staging_path.exists():
            staging_path.unlink()

        _copy_sqlite_snapshot(root / DATABASE_NAME, staging_path)
        staging_manager = SqliteManager(str(staging_path))
        staged_validation = staging_manager.validate_schema()
        if not staged_validation["valid"]:
            raise BackupValidationError("schema 8 临时数据库校验失败")

        if target_path.exists():
            export_directory_backup(safety_path, source_manager=target)

        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(target_path) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        os.replace(staging_path, target_path)
        target.init_db()

        return {
            "mode": validation["mode"],
            "row_counts": validation["row_counts"],
            "safety_snapshot": str(safety_path) if safety_path.exists() else None,
        }
