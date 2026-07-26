import sqlite3
from pathlib import Path
from typing import List, Dict, Any, Optional
from contextlib import contextmanager
from loguru import logger

from assettrack.infrastructure.config import DB_PATH
from assettrack.infrastructure.schema import (
    CURRENT_SCHEMA_VERSION,
    REQUIRED_COLUMNS,
    REQUIRED_TABLES,
    create_current_schema,
)


class SqliteManager:
    """个人自动化记账系统的同步 SQLite 数据库管理器。"""

    def __init__(self, db_path: str = str(DB_PATH)):
        self.db_path = db_path

    @contextmanager
    def get_connection(self):
        from pathlib import Path

        Path(self.db_path).expanduser().resolve().parent.mkdir(
            parents=True, exist_ok=True
        )
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
        finally:
            conn.close()

    def init_db(self):
        """Create a new schema-8 database or validate an existing one."""
        with self.get_connection() as connection:
            tables = {
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
            if not tables:
                connection.execute("BEGIN IMMEDIATE")
                try:
                    create_current_schema(connection)
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
            else:
                version = int(
                    connection.execute("PRAGMA user_version").fetchone()[0] or 0
                )
                missing = sorted(set(REQUIRED_TABLES) - tables)
                if version != CURRENT_SCHEMA_VERSION or missing:
                    raise RuntimeError(
                        "仅支持最新 schema 8 数据库；"
                        f"当前版本={version}，缺少表={missing}。"
                        "请清除测试数据库或导入离线转换后的格式 2 备份。"
                    )

        validation = self.validate_schema()
        if not validation["valid"]:
            raise RuntimeError(f"数据库 schema 8 校验失败：{validation}")
        logger.info(f"数据库 schema 8 已就绪: {self.db_path}")

    def get_schema_version(self) -> int:
        with self.get_connection() as conn:
            row = conn.execute("PRAGMA user_version").fetchone()
            return int(row[0] or 0)

    def validate_schema(self) -> dict[str, object]:
        """Validate required tables and return their columns/version.

        This is intentionally read-only so backup validation can run against
        a staged database before it can affect the live database.
        """

        with self.get_connection() as conn:
            table_rows = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
            tables = {row[0] for row in table_rows}
            missing = [name for name in REQUIRED_TABLES if name not in tables]
            columns: dict[str, list[str]] = {}
            for table in REQUIRED_TABLES:
                if table not in tables:
                    continue
                columns[table] = [
                    row[1] for row in conn.execute(
                        f"PRAGMA table_info({table})"
                    ).fetchall()
                ]
            integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
            version = int(conn.execute("PRAGMA user_version").fetchone()[0] or 0)
            missing_columns = {
                table: sorted(REQUIRED_COLUMNS[table] - set(table_columns))
                for table, table_columns in columns.items()
                if REQUIRED_COLUMNS[table] - set(table_columns)
            }

        return {
            "valid": (
                not missing
                and not missing_columns
                and integrity == "ok"
                and version == CURRENT_SCHEMA_VERSION
            ),
            "missing_tables": missing,
            "missing_columns": missing_columns,
            "tables": sorted(tables),
            "columns": columns,
            "integrity_check": integrity,
            "schema_version": version,
        }

    # ================= CRUD 方法 =================

    def execute(self, sql: str, params: tuple = ()) -> int:
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            conn.commit()
            return cursor.lastrowid

    def execute_many(self, sql: str, params: list) -> int:
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.executemany(sql, params)
            conn.commit()
            return cursor.rowcount

    def fetch_all(self, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    def fetch_one(self, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            row = cursor.fetchone()
            return dict(row) if row else None

    def run_transaction(self, operations: List[tuple]):
        """
        执行事务性操作
        operations: [(sql, params), (sql, params), ...]
        """
        with self.get_connection() as conn:
            try:
                cursor = conn.cursor()
                for sql, params in operations:
                    if isinstance(params, list):
                        cursor.executemany(sql, params)
                    else:
                        cursor.execute(sql, params)
                conn.commit()
            except Exception as e:
                conn.rollback()
                logger.error(f"事务执行失败，已回滚: {e}")
                raise e


db = SqliteManager()

if __name__ == "__main__":
    db.init_db()
