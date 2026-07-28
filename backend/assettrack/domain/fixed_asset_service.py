"""固定资产月度快照服务。

固定资产是记录性事实，不参与现金、理财、借款或对账计算。
"""

from __future__ import annotations

from datetime import date, datetime
import math
from typing import Any, Dict, Iterable
from uuid import uuid4

from assettrack.domain.lazy_pandas import pd

from assettrack.infrastructure.sqlite_manager import db
from assettrack.domain.month_status import (
    is_fixed_assets_initialized,
    is_month_locked,
    mark_fixed_assets_initialized,
)


FIXED_ASSET_STATUSES = ["在用", "闲置", "已出售", "已报废"]
ACTIVE_FIXED_ASSET_STATUSES = ("在用", "闲置")
FIXED_ASSET_COLUMNS = [
    "month",
    "asset_key",
    "asset_name",
    "category",
    "purchase_date",
    "purchase_price",
    "status",
    "note",
]


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _clean_text(value: Any, default: str = "") -> str:
    if _is_missing(value):
        return default
    return str(value).strip()


def _clean_amount(value: Any) -> float:
    if _is_missing(value) or value == "":
        return 0.0
    amount = float(value)
    if not math.isfinite(amount) or amount < 0:
        raise ValueError("固定资产金额必须是非负有限数字")
    return round(amount, 2)


def _clean_purchase_date(value: Any) -> str | None:
    if _is_missing(value) or value == "":
        return None
    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value).strip() or None


def _clean_status(value: Any) -> str:
    status = _clean_text(value, "在用")
    return status if status in FIXED_ASSET_STATUSES else "在用"


def _clean_asset_key(value: Any) -> str:
    return _clean_text(value) or uuid4().hex


def _row_value(row: Dict[str, Any], name: str, display_name: str) -> Any:
    if name in row:
        return row.get(name)
    return row.get(display_name)


def _normalize_row(row: Dict[str, Any], row_index: int) -> Dict[str, Any]:
    asset_name = _clean_text(_row_value(row, "asset_name", "资产名称"))
    if not asset_name:
        raise ValueError(f"第 {row_index + 1} 行的资产名称不能为空")

    return {
        "asset_key": _clean_asset_key(
            row.get("asset_key", row.get("_asset_key", row.get("资产标识")))
        ),
        "asset_name": asset_name,
        "category": _clean_text(_row_value(row, "category", "类别")),
        "purchase_date": _clean_purchase_date(
            _row_value(row, "purchase_date", "购置日期")
        ),
        "purchase_price": _clean_amount(
            _row_value(row, "purchase_price", "购买价格")
        ),
        "status": _clean_status(_row_value(row, "status", "状态")),
        "note": _clean_text(_row_value(row, "note", "备注")),
    }


def _as_rows(rows: Iterable[Dict[str, Any]] | pd.DataFrame) -> list[Dict[str, Any]]:
    if isinstance(rows, pd.DataFrame):
        return rows.to_dict(orient="records")
    return list(rows)


def _is_deleted(row: Dict[str, Any]) -> bool:
    value = row.get("deleted", row.get("删除", False))
    if _is_missing(value):
        return False
    return bool(value)


def _is_valid_month(month: Any) -> bool:
    if not isinstance(month, str) or len(month) != 7 or month[4] != "-":
        return False
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        return False
    return True


def _previous_month(month: str) -> str | None:
    if not _is_valid_month(month):
        return None
    current = datetime.strptime(month, "%Y-%m")
    if current.month == 1:
        return f"{current.year - 1:04d}-12"
    return f"{current.year:04d}-{current.month - 1:02d}"


def get_fixed_assets(month: str, include_inactive: bool = True) -> list[Dict[str, Any]]:
    """读取某月固定资产快照。"""
    if include_inactive:
        return db.fetch_all(
            "SELECT * FROM fixed_assets WHERE month = ? ORDER BY id",
            (month,),
        )

    placeholders = ", ".join("?" for _ in ACTIVE_FIXED_ASSET_STATUSES)
    return db.fetch_all(
        f"SELECT * FROM fixed_assets WHERE month = ? "
        f"AND status IN ({placeholders}) ORDER BY id",
        (month, *ACTIVE_FIXED_ASSET_STATUSES),
    )


def get_latest_fixed_asset_month() -> str | None:
    """返回最近已初始化的固定资产月份，包括主动清空的月份。"""
    row = db.fetch_one(
        """
        SELECT month FROM (
            SELECT month FROM fixed_assets
            UNION
            SELECT month FROM month_status WHERE fixed_assets_initialized = 1
        )
        ORDER BY month DESC
        LIMIT 1
        """
    )
    return row["month"] if row else None


def ensure_fixed_assets_inherited(month: str) -> int:
    """首次进入月份时复制上月仍持有的固定资产，返回复制行数。"""
    if not _is_valid_month(month) or is_month_locked(month):
        return 0
    if is_fixed_assets_initialized(month):
        return 0

    # 直接导入的 schema 8 数据可能已有资产行但未设置初始化标记。
    existing = db.fetch_one(
        "SELECT 1 AS has_data FROM fixed_assets WHERE month = ? LIMIT 1",
        (month,),
    )
    if existing:
        mark_fixed_assets_initialized(month)
        return 0

    previous_month = _previous_month(month)
    source_rows = []
    if previous_month:
        source_rows = get_fixed_assets(previous_month, include_inactive=False)

    if source_rows:
        insert_sql = """
            INSERT OR IGNORE INTO fixed_assets (
                month, asset_key, asset_name, category, purchase_date,
                purchase_price, status, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = [
            (
                month,
                row["asset_key"],
                row["asset_name"],
                row.get("category", ""),
                row.get("purchase_date"),
                row.get("purchase_price", 0) or 0,
                row.get("status", "在用"),
                row.get("note", "") or "",
            )
            for row in source_rows
        ]
        db.run_transaction([(insert_sql, params)])

    mark_fixed_assets_initialized(month)
    return len(source_rows)


def save_fixed_assets_atomic(
    month: str,
    rows: Iterable[Dict[str, Any]] | pd.DataFrame,
) -> int:
    """事务性替换某月固定资产快照，并标记月份已初始化。"""
    if is_month_locked(month):
        raise PermissionError(f"{month} 已封账，不能修改固定资产")
    if not _is_valid_month(month):
        raise ValueError(f"非法月份：{month}")

    normalized_rows = []
    for index, row in enumerate(_as_rows(rows)):
        if _is_deleted(row):
            continue
        normalized_rows.append(_normalize_row(row, index))

    delete_sql = "DELETE FROM fixed_assets WHERE month = ?"
    insert_sql = """
        INSERT INTO fixed_assets (
            month, asset_key, asset_name, category, purchase_date,
            purchase_price, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """
    operations = [(delete_sql, (month,))]
    if normalized_rows:
        operations.append(
            (
                insert_sql,
                [
                    (
                        month,
                        row["asset_key"],
                        row["asset_name"],
                        row["category"],
                        row["purchase_date"],
                        row["purchase_price"],
                        row["status"],
                        row["note"],
                    )
                    for row in normalized_rows
                ],
            )
        )

    db.run_transaction(operations)
    mark_fixed_assets_initialized(month)
    return len(normalized_rows)
