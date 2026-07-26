from datetime import datetime
from typing import Dict

from assettrack.infrastructure.sqlite_manager import db

STATUS_DRAFT = "draft"
STATUS_SAVED = "saved"
STATUS_LOCKED = "locked"

STATUS_LABELS = {
    STATUS_DRAFT: "草稿",
    STATUS_SAVED: "已保存",
    STATUS_LOCKED: "已封账",
}


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_month_status(month: str) -> str:
    row = db.fetch_one("SELECT status FROM month_status WHERE month = ?", (month,))
    if row and row.get("status") in STATUS_LABELS:
        return row["status"]

    has_data = None
    for table in (
        "transactions",
        "cash_account_balances",
        "investment_account_balances",
        "fixed_assets",
    ):
        has_data = db.fetch_one(
            f"SELECT 1 AS has_data FROM {table} WHERE month = ? LIMIT 1",
            (month,),
        )
        if has_data:
            break
    return STATUS_SAVED if has_data else STATUS_DRAFT


def get_month_status_map(months: list[str]) -> Dict[str, str]:
    if not months:
        return {}
    placeholders = ", ".join(["?"] * len(months))
    rows = db.fetch_all(
        f"SELECT month, status FROM month_status WHERE month IN ({placeholders})",
        tuple(months),
    )
    explicit = {
        row["month"]: row["status"]
        for row in rows
        if row.get("status") in STATUS_LABELS
    }
    return {month: explicit.get(month, get_month_status(month)) for month in months}


def is_month_locked(month: str) -> bool:
    return get_month_status(month) == STATUS_LOCKED


def is_fixed_assets_initialized(month: str) -> bool:
    """判断某月是否已经完成固定资产快照初始化。"""
    row = db.fetch_one(
        "SELECT fixed_assets_initialized FROM month_status WHERE month = ?",
        (month,),
    )
    if row and row.get("fixed_assets_initialized"):
        return True

    # 固定资产行本身也证明该月已经完成过初始化。
    return bool(
        db.fetch_one(
            "SELECT 1 AS has_data FROM fixed_assets WHERE month = ? LIMIT 1",
            (month,),
        )
    )


def mark_fixed_assets_initialized(month: str) -> None:
    """记录固定资产快照已初始化，同时将月份标记为已保存。"""
    if is_month_locked(month):
        return
    db.execute(
        """
        INSERT INTO month_status (
            month, status, fixed_assets_initialized, updated_at
        )
        VALUES (?, ?, 1, ?)
        ON CONFLICT(month) DO UPDATE SET
            status = excluded.status,
            fixed_assets_initialized = 1,
            updated_at = excluded.updated_at
        """,
        (month, STATUS_SAVED, _now()),
    )


def mark_month_saved(month: str) -> None:
    if is_month_locked(month):
        return
    db.execute(
        """
        INSERT INTO month_status (month, status, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(month) DO UPDATE SET
            status = excluded.status,
            updated_at = excluded.updated_at
        """,
        (month, STATUS_SAVED, _now()),
    )


def lock_month(month: str) -> None:
    now = _now()
    db.execute(
        """
        INSERT INTO month_status (month, status, locked_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(month) DO UPDATE SET
            status = excluded.status,
            locked_at = excluded.locked_at,
            updated_at = excluded.updated_at
        """,
        (month, STATUS_LOCKED, now, now),
    )


def unlock_month(month: str) -> None:
    db.execute(
        """
        INSERT INTO month_status (month, status, locked_at, updated_at)
        VALUES (?, ?, NULL, ?)
        ON CONFLICT(month) DO UPDATE SET
            status = excluded.status,
            locked_at = NULL,
            updated_at = excluded.updated_at
        """,
        (month, STATUS_SAVED, _now()),
    )
