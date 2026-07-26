"""Database-facing API operations with transaction and revision checks."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Iterable

import pandas as pd

from assettrack.infrastructure.sqlite_manager import SqliteManager, db
from assettrack.infrastructure.config import category_rainbow_color
from assettrack.domain.calculator import (
    analyze_monthly_anomalies,
    build_annual_df,
    calc_monthly,
    explain_reconciliation,
)
from assettrack.domain.fixed_asset_service import (
    ACTIVE_FIXED_ASSET_STATUSES,
    FIXED_ASSET_STATUSES,
    _normalize_row as normalize_fixed_asset,
)
from assettrack.domain.month_status import STATUS_DRAFT, STATUS_LOCKED, STATUS_SAVED
from assettrack.domain.rule_service import (
    RULE_TRANSACTION_TYPES,
    normalize_product_key,
)
from assettrack.domain.validators import has_blocking_issues, validate_transactions


class RevisionConflictError(RuntimeError):
    def __init__(self, expected: int, actual: int):
        super().__init__(f"revision conflict: expected {expected}, actual {actual}")
        self.expected = expected
        self.actual = actual


class MonthLockedError(PermissionError):
    pass


class RepositoryValidationError(ValueError):
    def __init__(self, message: str, *, issues: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.issues = issues or []


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _number(value: Any, *, non_negative: bool = False) -> float:
    try:
        result = float(value or 0)
    except (TypeError, ValueError) as exc:
        raise RepositoryValidationError("金额必须是数字") from exc
    if not math.isfinite(result):
        raise RepositoryValidationError("金额必须是有限数字")
    if non_negative and result < 0:
        raise RepositoryValidationError("金额不能为负数")
    return round(result, 2)


def _text(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip()


def _month_valid(month: str) -> bool:
    try:
        datetime.strptime(month, "%Y-%m")
        return len(month) == 7
    except (TypeError, ValueError):
        return False


def _next_month(month: str) -> str:
    current = datetime.strptime(month, "%Y-%m")
    if current.month == 12:
        return f"{current.year + 1:04d}-01"
    return f"{current.year:04d}-{current.month + 1:02d}"


def _normalize_date(value: Any) -> str:
    """Normalize browser/legacy date values to the database ISO format."""
    raw = _text(value).strip()
    if "T" in raw:
        raw = raw.split("T", 1)[0]
    elif " " in raw:
        raw = raw.split(" ", 1)[0]
    raw = (
        raw.replace("年", "-")
        .replace("月", "-")
        .replace("日", "")
        .replace("/", "-")
        .replace(".", "-")
    )
    raw = re.sub(r"-+", "-", raw).strip("-")
    if len(raw) == 7:
        raw = f"{raw}-01"
    try:
        return datetime.strptime(raw, "%Y-%m-%d").strftime("%Y-%m-%d")
    except (TypeError, ValueError) as exc:
        raise RepositoryValidationError("日期必须是 YYYY-MM-DD 或 YYYY/MM/DD") from exc


def _content_revision(rows: Iterable[dict[str, Any]]) -> int:
    """Stable positive revision for global collections without a month row."""
    payload = json.dumps(list(rows), ensure_ascii=False, sort_keys=True, default=str)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def _clean_value(value: Any) -> Any:
    """Convert pandas/numpy scalar values into strict JSON-safe values."""
    if value is None:
        return None
    try:
        missing = pd.isna(value)
        if isinstance(missing, bool) and missing:
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:
            value = value.item()
        except (TypeError, ValueError):
            pass
    return value


def _frame_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    return [
        {str(key): _clean_value(value) for key, value in row.items()}
        for row in frame.to_dict(orient="records")
    ]


class APIRepository:
    def __init__(self, manager: SqliteManager | None = None):
        self.db = manager or db

    def initialize(self) -> dict[str, Any]:
        self.db.init_db()
        validation = self.db.validate_schema()
        if not validation["valid"]:
            raise RuntimeError(f"数据库 schema 无效：{validation}")
        return validation

    def _month_row(self, connection, month: str) -> dict[str, Any] | None:
        row = connection.execute(
            "SELECT * FROM month_status WHERE month = ?", (month,)
        ).fetchone()
        return dict(row) if row else None

    def _check_month_write(self, connection, month: str, expected_revision: int) -> int:
        if not _month_valid(month):
            raise RepositoryValidationError(f"非法月份：{month}")
        row = self._month_row(connection, month)
        actual = int(row["revision"]) if row else 0
        if actual != expected_revision:
            raise RevisionConflictError(expected_revision, actual)
        return actual

    def _touch_month(
        self, connection, month: str, revision: int, *, fixed_initialized: int | None = None
    ) -> int:
        current = self._month_row(connection, month)
        initialized = (
            int(current.get("fixed_assets_initialized", 0))
            if current
            else 0
        )
        if fixed_initialized is not None:
            initialized = int(fixed_initialized)
        new_revision = revision + 1
        connection.execute(
            """
            INSERT INTO month_status (
                month, status, updated_at, fixed_assets_initialized, revision
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(month) DO UPDATE SET
                status = excluded.status,
                updated_at = excluded.updated_at,
                fixed_assets_initialized = excluded.fixed_assets_initialized,
                revision = excluded.revision
            """,
            (month, STATUS_SAVED, _now(), initialized, new_revision),
        )
        return new_revision

    def get_months(self) -> list[str]:
        tables = (
            "cash_account_balances",
            "investment_account_balances",
            "transactions",
            "fixed_assets",
        )
        months: set[str] = set()
        for table in tables:
            rows = self.db.fetch_all(f"SELECT DISTINCT month FROM {table}")
            months.update(str(row["month"]) for row in rows if row.get("month"))
        rows = self.db.fetch_all("SELECT month FROM month_status")
        months.update(str(row["month"]) for row in rows if row.get("month"))
        return sorted(month for month in months if _month_valid(month))

    def month_creation_policy(self) -> dict[str, Any]:
        months = self.get_months()
        drafts = [
            str(row["month"])
            for row in self.db.fetch_all(
                "SELECT month FROM month_status WHERE status=? ORDER BY month",
                (STATUS_DRAFT,),
            )
            if _month_valid(str(row.get("month") or ""))
        ]
        current_month = datetime.now().strftime("%Y-%m")
        max_creatable_month = _next_month(current_month)
        next_target = _next_month(months[-1]) if months else current_month
        can_create = not drafts and next_target <= max_creatable_month
        reason = None
        if drafts:
            reason = f"请先保存或删除草稿月份 {drafts[0]}"
        elif next_target > max_creatable_month:
            reason = f"最多只能预建到 {max_creatable_month}"
        return {
            "months": months,
            "draft_month": drafts[0] if drafts else None,
            "next_target": next_target,
            "max_creatable_month": max_creatable_month,
            "can_create": can_create,
            "reason": reason,
        }

    def create_month(self, month: str) -> dict[str, Any]:
        """Create a durable draft month, then initialize fixed assets once."""
        if not _month_valid(month):
            raise RepositoryValidationError(f"非法月份：{month}")
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = self._month_row(connection, month)
            if existing:
                connection.commit()
                result = self.get_month(month)
                result["inherited_fixed_assets"] = 0
                return result
            latest_row = connection.execute(
                """
                SELECT MAX(month) AS month FROM (
                    SELECT month FROM month_status
                    UNION ALL SELECT month FROM cash_account_balances
                    UNION ALL SELECT month FROM investment_account_balances
                    UNION ALL SELECT month FROM transactions
                    UNION ALL SELECT month FROM fixed_assets
                )
                """
            ).fetchone()
            latest = str(latest_row["month"] or "") if latest_row else ""
            target = _next_month(latest) if _month_valid(latest) else datetime.now().strftime("%Y-%m")
            max_month = _next_month(datetime.now().strftime("%Y-%m"))
            if month != target:
                raise RepositoryValidationError(
                    f"只能按自然顺序创建下一个月份 {target}"
                )
            if month > max_month:
                raise RepositoryValidationError(
                    f"当前最多只能创建到 {max_month}"
                )
            draft = connection.execute(
                "SELECT month FROM month_status WHERE status=? LIMIT 1",
                (STATUS_DRAFT,),
            ).fetchone()
            if draft:
                raise RepositoryValidationError(
                    f"最多只能有一个草稿月份；请先保存或删除 {draft['month']}"
                )
            connection.execute(
                """
                INSERT INTO month_status (
                    month, status, fixed_assets_initialized, updated_at, revision
                ) VALUES (?, ?, 0, ?, 0)
                ON CONFLICT(month) DO NOTHING
                """,
                (month, STATUS_DRAFT, _now()),
            )
            connection.commit()
        inherited = self.ensure_fixed_assets_inherited(month)
        result = self.get_month(month)
        result["inherited_fixed_assets"] = inherited
        return result

    def delete_month(
        self, month: str, expected_revision: int, confirm_month: str
    ) -> dict[str, Any]:
        """Delete only month-scoped facts after an explicit revision-safe confirmation."""
        if not _month_valid(month) or confirm_month != month:
            raise RepositoryValidationError("删除月份确认值与当前月份不一致")
        tables = (
            "transactions",
            "cash_account_balances",
            "investment_account_balances",
            "fixed_assets",
        )
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = self._month_row(connection, month)
            actual = int(row["revision"]) if row else 0
            if actual != expected_revision:
                raise RevisionConflictError(expected_revision, actual)
            exists = bool(row)
            for table in tables:
                if connection.execute(
                    f"SELECT 1 FROM {table} WHERE month = ? LIMIT 1", (month,)
                ).fetchone():
                    exists = True
            if not exists:
                raise RepositoryValidationError(f"{month} 不存在，无需删除")
            deleted_rows: dict[str, int] = {}
            for table in tables:
                cursor = connection.execute(f"DELETE FROM {table} WHERE month = ?", (month,))
                deleted_rows[table] = max(0, int(cursor.rowcount))
            cursor = connection.execute("DELETE FROM month_status WHERE month = ?", (month,))
            deleted_rows["month_status"] = max(0, int(cursor.rowcount))
            connection.commit()
        return {
            "deleted": True,
            "month": month,
            "deleted_rows": deleted_rows,
            "months": self.get_months(),
        }

    def rule_suggestions(self, month: str) -> list[dict[str, Any]]:
        """Suggest stable mappings used in this month; never writes rules."""
        if not _month_valid(month):
            raise RepositoryValidationError(f"非法月份：{month}")
        current_rows = self.db.fetch_all(
            "SELECT type, product FROM transactions "
            "WHERE month = ? AND type IN ('支出', '收入') AND TRIM(product) <> ''",
            (month,),
        )
        current_keys = {
            (str(row["type"]), normalize_product_key(row["product"]))
            for row in current_rows
            if normalize_product_key(row.get("product"))
        }
        if not current_keys:
            return []
        existing_rules = {
            (str(row["transaction_type"]), normalize_product_key(row["product"]))
            for row in self.db.fetch_all(
                "SELECT transaction_type, product FROM auto_rules"
            )
        }
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for row in self.db.fetch_all(
            "SELECT month, type, category, product FROM transactions "
            "WHERE type IN ('支出', '收入') AND TRIM(COALESCE(product, '')) <> ''"
        ):
            key = (str(row["type"]), normalize_product_key(row["product"]))
            if key in current_keys:
                grouped[key].append(row)

        suggestions = []
        category_metadata = self._category_metadata()
        for key, group in grouped.items():
            transaction_type, _ = key
            categories = [
                _text(row.get("category"))
                for row in group
            ]
            categories = [
                category for category in categories
                if category != "异常/未分类"
                and category_metadata.get(category, {}).get("type") == transaction_type
            ]
            if len(group) < 2 or len(set(categories)) != 1 or key in existing_rules:
                continue
            products = Counter(str(row["product"]).strip() for row in group)
            suggestions.append({
                "transaction_type": transaction_type,
                "product": products.most_common(1)[0][0],
                "category": categories[0],
                "occurrences": len(group),
                "months_count": len({str(row["month"]) for row in group}),
            })
        return sorted(
            suggestions,
            key=lambda row: (-row["occurrences"], row["transaction_type"], row["product"]),
        )

    def prepare_import_preview(
        self, month: str, rows: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if not _month_valid(month):
            raise RepositoryValidationError(f"非法月份：{month}")
        definitions = self.category_definitions()["rows"]
        category_by_name = {
            str(row["name"]): row for row in definitions
        }
        prepared: list[dict[str, Any]] = []
        for index, source in enumerate(rows):
            row = dict(source)
            raw_date = _text(row.get("transaction_date"))
            row["transaction_date"] = _normalize_date(
                raw_date or f"{month}-01"
            )
            category = _text(row.get("category"))
            definition = category_by_name.get(category)
            row["category_key"] = (
                str(definition["category_key"]) if definition else None
            )
            if row.get("type") in {"代付", "加仓", "提现"}:
                row["category"] = ""
                row["category_key"] = None
            row["client_id"] = f"import:{index}"
            prepared.append(row)
        issues = validate_transactions(
            pd.DataFrame(prepared), month=month, categories=definitions
        )
        return {
            "month": month,
            "rows": prepared,
            "issues": issues,
            "type_summary": dict(Counter(str(row.get("type") or "") for row in prepared)),
            "modes": ["append", "replace"],
        }

    def get_revision(self, month: str) -> int:
        row = self.db.fetch_one(
            "SELECT revision FROM month_status WHERE month = ?", (month,)
        )
        return int(row["revision"]) if row else 0

    def get_month_status(self, month: str) -> str:
        row = self.db.fetch_one(
            "SELECT status FROM month_status WHERE month = ?", (month,)
        )
        if row and row.get("status") == STATUS_LOCKED:
            return STATUS_SAVED
        if row and row.get("status") in {STATUS_DRAFT, STATUS_SAVED}:
            return str(row["status"])
        for table in (
            "transactions",
            "cash_account_balances",
            "investment_account_balances",
            "fixed_assets",
        ):
            if self.db.fetch_one(
                f"SELECT 1 AS present FROM {table} WHERE month = ? LIMIT 1", (month,)
            ):
                return STATUS_SAVED
        return STATUS_DRAFT

    def _history_bundle(self) -> tuple[list[str], dict[str, dict], dict[str, dict], dict[str, dict]]:
        """Load all historical facts and calculate monthly transaction results.

        The frontend receives these derived values from the Python service so
        that the React client never becomes a second financial-calculation
        authority.
        """
        snapshots = self.db.fetch_all(
            "SELECT month, SUM(balance) AS cash_total "
            "FROM cash_account_balances GROUP BY month ORDER BY month"
        )
        investments = self.db.fetch_all(
            "SELECT month, SUM(principal) AS principal, "
            "SUM(market_value) AS market_value, SUM(cash_balance) AS cash_balance "
            "FROM investment_account_balances GROUP BY month ORDER BY month"
        )
        transactions = self.db.fetch_all(
            "SELECT * FROM transactions ORDER BY month, id"
        )
        snap_data = {str(row["month"]): row for row in snapshots if row.get("month")}
        inv_data = {str(row["month"]): row for row in investments if row.get("month")}
        tx_frame = pd.DataFrame(transactions)
        tx_monthly: dict[str, dict] = {}
        if not tx_frame.empty:
            for history_month, group in tx_frame.groupby("month"):
                tx_monthly[str(history_month)] = calc_monthly(
                    group.drop(columns=["id", "month"], errors="ignore"),
                    self._category_metadata(),
                )
        return self.get_months(), snap_data, inv_data, tx_monthly

    def _category_metadata(self) -> dict[str, dict[str, Any]]:
        return {
            str(row["name"]): {
                "necessity": row["necessity"],
                "pattern": row["pattern"],
                "is_big_ticket": bool(row["is_big_ticket"]),
                "type": row["transaction_type"],
                "category_key": row["category_key"],
            }
            for row in self.db.fetch_all("SELECT * FROM category_definitions")
        }

    def _cash_accounts(
        self, month: str, cash_total: float
    ) -> list[dict[str, Any]]:
        accounts = self.db.fetch_all(
            """
            SELECT d.account_key, d.name AS account, d.is_active, d.sort_order,
                   COALESCE(b.balance, 0) AS balance
            FROM account_definitions d
            LEFT JOIN cash_account_balances b
              ON b.account_key=d.account_key AND b.month=?
            WHERE d.account_type='cash' AND (d.is_active=1 OR b.account_key IS NOT NULL)
            ORDER BY d.sort_order, d.name
            """,
            (month,),
        )
        return [
            {
                **row,
                "balance": round(float(row.get("balance", 0) or 0), 2),
                "share_percent": round(
                    float(row.get("balance", 0) or 0) / cash_total * 100, 1
                ) if cash_total > 0 else 0.0,
            }
            for row in accounts
        ]

    def _annual_cost_audit(
        self,
        year: str,
        annual_df: pd.DataFrame,
        transaction_rows: list[dict[str, Any]],
        tx_monthly: dict[str, dict],
    ) -> dict[str, Any]:
        """Recreate the legacy annual living-cost audit as API data."""
        category_metadata = self._category_metadata()
        columns = ["month", "type", "category", "product", "amount"]
        tx_frame = pd.DataFrame(transaction_rows, columns=columns)
        if tx_frame.empty:
            expense = pd.DataFrame(columns=columns)
        else:
            expense = tx_frame[
                (tx_frame["month"].astype(str).str.startswith(year))
                & (tx_frame["type"] == "支出")
            ].copy()
        if not expense.empty:
            expense["category"] = expense["category"].fillna("").astype(str)
            expense["amount"] = pd.to_numeric(
                expense["amount"], errors="coerce"
            ).fillna(0.0)
            expense["necessity"] = expense["category"].map(
                lambda category: category_metadata.get(category, {}).get(
                    "necessity", "必要"
                )
            )
            expense["pattern"] = expense["category"].map(
                lambda category: category_metadata.get(category, {}).get(
                    "pattern", "偶尔"
                )
            )

        months_count = max(1, int(annual_df["month"].nunique()))
        total_expense = float(expense["amount"].sum()) if not expense.empty else 0.0
        necessary_total = (
            float(expense.loc[expense["necessity"] == "必要", "amount"].sum())
            if not expense.empty else 0.0
        )
        controlled_total = (
            float(expense.loc[expense["necessity"] == "可控", "amount"].sum())
            if not expense.empty else 0.0
        )
        necessary_monthly = necessary_total / months_count

        category_rows: list[dict[str, Any]] = []
        if not expense.empty:
            grouped = (
                expense.groupby(["category", "necessity", "pattern"], as_index=False)[
                    "amount"
                ]
                .sum()
                .sort_values("amount", ascending=False)
            )
            category_rows = [
                {
                    "category": str(row["category"]),
                    "necessity": str(row["necessity"]),
                    "pattern": str(row["pattern"]),
                    "total": round(float(row["amount"]), 2),
                    "monthly_average": round(float(row["amount"]) / months_count, 2),
                    "share_percent": round(
                        float(row["amount"]) / total_expense * 100, 1
                    ) if total_expense > 0 else 0.0,
                }
                for _, row in grouped.iterrows()
            ]

        pattern_rows: list[dict[str, Any]] = []
        if not expense.empty:
            pattern_order = {"周期": 0, "日常": 1, "偶尔": 2}
            grouped = (
                expense[expense["pattern"].isin(pattern_order)]
                .groupby("pattern", as_index=False)["amount"]
                .sum()
            )
            grouped["_order"] = grouped["pattern"].map(pattern_order)
            grouped = grouped.sort_values("_order")
            pattern_rows = [
                {
                    "pattern": str(row["pattern"]),
                    "total": round(float(row["amount"]), 2),
                    "monthly_average": round(float(row["amount"]) / months_count, 2),
                    "share_percent": round(
                        float(row["amount"]) / total_expense * 100, 1
                    ) if total_expense > 0 else 0.0,
                }
                for _, row in grouped.iterrows()
            ]

        def product_summary(category: str, divisor: int) -> list[dict[str, Any]]:
            if expense.empty:
                return []
            selected = expense[expense["category"] == category]
            if selected.empty:
                return []
            grouped = (
                selected.groupby("product", as_index=False)["amount"]
                .sum()
                .sort_values("amount", ascending=False)
                .head(10)
            )
            return [
                {
                    "product": str(row["product"] or ""),
                    "total": round(float(row["amount"]), 2),
                    "monthly_average": round(float(row["amount"]) / divisor, 2),
                }
                for _, row in grouped.iterrows()
            ]

        big_tickets: list[dict[str, Any]] = []
        for history_month, monthly in tx_monthly.items():
            if str(history_month).startswith(year):
                for item in monthly.get("big_tickets", []):
                    big_tickets.append(
                        {
                            "month": str(history_month),
                            "product": str(item.get("product", "") or ""),
                            "category": str(item.get("category", "") or ""),
                            "amount": round(float(item.get("amount", 0) or 0), 2),
                        }
                    )
        big_tickets.sort(key=lambda item: item["amount"], reverse=True)

        latest_assets = (
            float(annual_df.iloc[-1].get("total_assets", 0) or 0)
            if not annual_df.empty
            else 0.0
        )
        average_net_expense = total_expense / months_count
        return {
            "months_count": months_count,
            "total_expense": round(total_expense, 2),
            "necessary_total": round(necessary_total, 2),
            "controlled_total": round(controlled_total, 2),
            "controlled_percent": round(
                controlled_total / total_expense * 100, 1
            ) if total_expense > 0 else 0.0,
            "necessary_monthly": round(necessary_monthly, 2),
            "asset_support_months": (
                round(latest_assets / average_net_expense, 1)
                if average_net_expense > 0
                else None
            ),
            "categories": category_rows,
            "patterns": pattern_rows,
            "big_tickets": big_tickets,
            "subscriptions": product_summary("订阅服务", 12),
            "daily_essentials": product_summary("日常必需", months_count),
        }

    def annual_overview(self, year: str) -> dict[str, Any]:
        months, snap_data, inv_data, tx_monthly = self._history_bundle()
        all_transactions = self.db.fetch_all(
            "SELECT month, type, category, product, amount "
            "FROM transactions ORDER BY month, id"
        )
        full_df = build_annual_df(
            months, snap_data, inv_data, tx_monthly, manager=self.db
        )
        annual_df = full_df[
            full_df["month"].astype(str).str.startswith(year)
        ].copy() if not full_df.empty else pd.DataFrame()
        if annual_df.empty:
            return {
                "year": year,
                "months": [],
                "rows": [],
                "metrics": {},
                "latest": None,
                "rolling_rows": [],
                "all_trend_rows": [],
                "cost_audit": {},
            }

        latest = annual_df.iloc[-1]
        latest_month = str(latest["month"])
        rolling_start = str(pd.Period(latest_month, freq="M") - 11)
        rolling_df = full_df[
            (full_df["month"].astype(str) >= rolling_start)
            & (full_df["month"].astype(str) <= latest_month)
        ].copy()
        total_income = float(annual_df["total_income"].sum())
        total_expense = float(annual_df["total_expense"].sum())
        savings = total_income - total_expense
        latest_clean = {
            str(key): _clean_value(value) for key, value in latest.to_dict().items()
        }
        return {
            "year": year,
            "months": [str(value) for value in annual_df["month"].tolist()],
            "rows": _frame_records(annual_df),
            "metrics": {
                "total_income": round(total_income, 2),
                "total_expense": round(total_expense, 2),
                "savings": round(savings, 2),
                "savings_rate": round(savings / total_income * 100, 1)
                if total_income > 0 else 0.0,
            },
            "latest": latest_clean,
            "rolling_rows": _frame_records(rolling_df),
            "all_trend_rows": _frame_records(full_df),
            "cost_audit": self._annual_cost_audit(
                year,
                annual_df,
                all_transactions,
                tx_monthly,
            ),
        }

    def month_overview(self, month: str) -> dict[str, Any]:
        months, snap_data, inv_data, tx_monthly = self._history_bundle()
        if month not in months:
            months = sorted(set(months + [month]))
        full_df = build_annual_df(
            months, snap_data, inv_data, tx_monthly, manager=self.db
        )
        row_frame = full_df[full_df["month"] == month] if not full_df.empty else pd.DataFrame()
        if row_frame.empty:
            return {"available": False}

        row = row_frame.iloc[0]
        tx_rows = self.db.fetch_all(
            "SELECT type, category, product, amount FROM transactions "
            "WHERE month = ? ORDER BY id", (month,)
        )
        tx_frame = pd.DataFrame(
            tx_rows, columns=["type", "category", "product", "amount"]
        )
        tx_result = tx_monthly.get(month, calc_monthly(tx_frame))
        snapshot = snap_data.get(month, {})
        cash_total = round(float(snapshot.get("cash_total", 0) or 0), 2)
        investment = inv_data.get(month, {})
        principal = float(investment.get("principal", 0) or 0)
        market_value = float(investment.get("market_value", 0) or 0)
        cash_balance = float(investment.get("cash_balance", 0) or 0)
        investment_position = market_value + cash_balance
        investment_profit = investment_position - principal

        has_previous = not pd.isna(row.get("theoretical_expense"))
        previous_row = None
        row_index = int(row_frame.index[0])
        if row_index > 0:
            previous_row = full_df.iloc[row_index - 1]
        explanation = explain_reconciliation(row.get("discrepancy"))
        anomalies = analyze_monthly_anomalies(
            month,
            tx_frame,
            manager=self.db,
            category_metadata=self._category_metadata(),
        )
        structure = tx_result.get("structure", {})
        necessary = float(structure.get("necessary", 0) or 0)
        controlled = float(structure.get("controlled", 0) or 0)
        structure_total = necessary + controlled
        previous_month = self._previous_month(month)
        previous_categories = tx_monthly.get(previous_month or "", {}).get(
            "category_summary", {}
        )
        current_categories = tx_result.get("category_summary", {})
        comparison_rows = [
            {
                "category": category,
                "current": round(float(current_categories.get(category, 0) or 0), 2),
                "previous": round(float(previous_categories.get(category, 0) or 0), 2),
                "delta": round(
                    float(current_categories.get(category, 0) or 0)
                    - float(previous_categories.get(category, 0) or 0),
                    2,
                ),
            }
            for category in sorted(set(current_categories) | set(previous_categories))
        ]
        total_income = float(row.get("total_income", 0) or 0)
        total_expense = float(row.get("total_expense", 0) or 0)
        surplus = total_income - total_expense

        return {
            "available": True,
            "metrics": {
                "asset_delta": None
                if pd.isna(row.get("asset_delta"))
                else round(float(row.get("asset_delta", 0) or 0), 2),
                "total_income": round(total_income, 2),
                "total_expense": round(total_expense, 2),
                "surplus": round(surplus, 2),
                "savings_rate": (
                    round(surplus / total_income * 100, 2)
                    if total_income > 0
                    else None
                ),
                "total_assets": round(float(row.get("total_assets", 0) or 0), 2),
            },
            "cash_accounts": self._cash_accounts(month, cash_total),
            "cash_total": cash_total,
            "investment": {
                "principal": round(principal, 2),
                "market_value": round(market_value, 2),
                "cash_balance": round(cash_balance, 2),
                "position": round(investment_position, 2),
                "profit": round(investment_profit, 2),
                "roi_percent": round(investment_profit / principal * 100, 1)
                if principal > 0 else 0.0,
            },
            "reconciliation": {
                "available": has_previous,
                "actual": {
                    "all_out": round(float(tx_result.get("all_out", 0) or 0), 2),
                    "daifu": round(float(tx_result.get("total_daifu", 0) or 0), 2),
                    "net_expense": round(float(tx_result.get("total_expense", 0) or 0), 2),
                },
                "theoretical": {
                    "previous_cash": round(float(previous_row.get("cash", 0) or 0), 2)
                    if previous_row is not None else None,
                    "income": round(float(row.get("total_income", 0) or 0), 2),
                    "debt_change": round(float(row.get("debt_change", 0) or 0), 2)
                    if has_previous else None,
                    "cash": round(float(row.get("cash", 0) or 0), 2),
                    "deposit": round(float(row.get("total_deposit", 0) or 0), 2),
                    "withdraw": round(float(row.get("total_withdraw", 0) or 0), 2),
                    "net_expense": _clean_value(row.get("theoretical_expense")),
                },
                "discrepancy": _clean_value(row.get("discrepancy")),
                "explanation": explanation,
            },
            "anomalies": {
                key: _frame_records(value) for key, value in anomalies.items()
            },
            "structure": {
                "necessary": round(necessary, 2),
                "controlled": round(controlled, 2),
                "controlled_percent": round(controlled / structure_total * 100, 1)
                if structure_total > 0 else 0.0,
                "leverage": round(controlled / necessary, 2)
                if necessary > 0 else 0.0,
                "periodic": round(float(structure.get("periodic", 0) or 0), 2),
                "daily": round(float(structure.get("daily", 0) or 0), 2),
                "occasional": round(float(structure.get("occasional", 0) or 0), 2),
                "necessary_categories": [
                    category for category, metadata in self._category_metadata().items()
                    if metadata.get("type") == "支出"
                    and metadata.get("necessity") == "必要"
                ],
                "controlled_categories": [
                    category for category, metadata in self._category_metadata().items()
                    if metadata.get("type") == "支出"
                    and metadata.get("necessity") == "可控"
                ],
            },
            "category_summary": [
                {
                    "category": str(category),
                    "amount": round(float(amount or 0), 2),
                }
                for category, amount in sorted(
                    tx_result.get("category_summary", {}).items(),
                    key=lambda item: item[1],
                    reverse=True,
                )
                if float(amount or 0) > 0
            ],
            "category_comparison": {
                "available": bool(previous_month and previous_month in tx_monthly),
                "previous_month": previous_month,
                "rows": comparison_rows,
            },
            "big_tickets": [
                {
                    "product": str(item.get("product", "") or ""),
                    "category": str(item.get("category", "") or ""),
                    "amount": round(float(item.get("amount", 0) or 0), 2),
                }
                for item in tx_result.get("big_tickets", [])
            ],
        }

    def _previous_month(self, month: str) -> str | None:
        if not _month_valid(month):
            return None
        current = datetime.strptime(month, "%Y-%m")
        if current.month == 1:
            return f"{current.year - 1:04d}-12"
        return f"{current.year:04d}-{current.month - 1:02d}"

    def ensure_fixed_assets_inherited(self, month: str) -> int:
        """Idempotently initialize one month's fixed-asset snapshot."""
        if not _month_valid(month):
            return 0
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = self._month_row(connection, month)
            if current and current.get("fixed_assets_initialized"):
                connection.commit()
                return 0
            if current and current.get("status") == STATUS_LOCKED:
                connection.commit()
                return 0
            existing = connection.execute(
                "SELECT 1 FROM fixed_assets WHERE month = ? LIMIT 1", (month,)
            ).fetchone()
            if existing:
                connection.execute(
                    """
                    INSERT INTO month_status (
                        month, status, fixed_assets_initialized, updated_at, revision
                    ) VALUES (?, ?, 1, ?, 0)
                    ON CONFLICT(month) DO UPDATE SET
                        fixed_assets_initialized = 1,
                        updated_at = excluded.updated_at
                    """,
                    (
                        month,
                        str(current.get("status") or STATUS_DRAFT)
                        if current
                        else STATUS_DRAFT,
                        _now(),
                    ),
                )
                connection.commit()
                return 0

            previous = self._previous_month(month)
            source_rows = []
            if previous:
                source_rows = connection.execute(
                    "SELECT * FROM fixed_assets WHERE month = ? AND status IN (?,?) ORDER BY id",
                    (previous, *ACTIVE_FIXED_ASSET_STATUSES),
                ).fetchall()
            for row in source_rows:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO fixed_assets (
                        month, asset_key, asset_name, category, purchase_date,
                        purchase_price, status, note
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        month,
                        row["asset_key"],
                        row["asset_name"],
                        row["category"] or "",
                        row["purchase_date"],
                        row["purchase_price"] or 0,
                        row["status"] or "在用",
                        row["note"] or "",
                    ),
                )
            connection.execute(
                """
                INSERT INTO month_status (
                    month, status, fixed_assets_initialized, updated_at, revision
                ) VALUES (?, ?, 1, ?, 0)
                ON CONFLICT(month) DO UPDATE SET
                    fixed_assets_initialized = 1,
                    updated_at = excluded.updated_at
                """,
                (
                    month,
                    str(current.get("status") or STATUS_DRAFT)
                    if current
                    else STATUS_DRAFT,
                    _now(),
                ),
            )
            connection.commit()
            return len(source_rows)

    def get_month(self, month: str) -> dict[str, Any]:
        self.ensure_fixed_assets_inherited(month)
        transactions = self.db.fetch_all(
            "SELECT id, month, transaction_date, type, category_key, "
            "category, product, amount "
            "FROM transactions WHERE month = ? ORDER BY id", (month,)
        )
        cash_accounts = self._cash_accounts(
            month,
            sum(
                float(row.get("balance", 0) or 0)
                for row in self.db.fetch_all(
                    "SELECT balance FROM cash_account_balances WHERE month=?", (month,)
                )
            ),
        )
        investment_accounts = self.db.fetch_all(
            """
            SELECT d.account_key, d.name, d.is_active, d.sort_order,
                   COALESCE(b.principal, 0) AS principal,
                   COALESCE(b.market_value, 0) AS market_value,
                   COALESCE(b.cash_balance, 0) AS cash_balance
            FROM account_definitions d
            LEFT JOIN investment_account_balances b
              ON b.account_key=d.account_key AND b.month=?
            WHERE d.account_type='investment'
              AND (d.is_active=1 OR b.account_key IS NOT NULL)
            ORDER BY d.sort_order, d.name
            """,
            (month,),
        )
        fixed_assets = self.db.fetch_all(
            "SELECT * FROM fixed_assets WHERE month = ? ORDER BY id", (month,)
        )
        tx_frame = pd.DataFrame(transactions)
        if not tx_frame.empty:
            tx_frame = tx_frame.drop(columns=["id", "month"], errors="ignore")
        computed = calc_monthly(tx_frame, self._category_metadata())
        return {
            "month": month,
            "revision": self.get_revision(month),
            "status": self.get_month_status(month),
            "transactions": transactions,
            "cash_accounts": cash_accounts,
            "investment_accounts": investment_accounts,
            "fixed_assets": fixed_assets,
            "computed": computed,
            "overview": self.month_overview(month),
        }

    def _save_transaction_rows(
        self,
        connection,
        month: str,
        rows: list[dict[str, Any]],
        expected_revision: int,
        *,
        touch_month: bool = True,
    ) -> tuple[list[dict[str, Any]], int]:
        revision = self._check_month_write(connection, month, expected_revision)
        category_rows = [
            dict(row)
            for row in connection.execute(
                "SELECT * FROM category_definitions ORDER BY sort_order, name"
            ).fetchall()
        ]
        category_by_key = {
            str(row["category_key"]): row for row in category_rows
        }
        category_by_name = {
            str(row["name"]): row for row in category_rows
        }
        normalized_rows: list[dict[str, Any]] = []
        for row in rows:
            normalized = dict(row)
            normalized["transaction_date"] = _normalize_date(
                row.get("transaction_date") or f"{month}-01"
            )
            normalized["type"] = _text(row.get("type"))
            normalized["product"] = _text(row.get("product"))
            normalized["amount"] = _number(row.get("amount", 0))
            category_key = _text(row.get("category_key"))
            if normalized["type"] in {"代付", "加仓", "提现"}:
                category_key = ""
                normalized["category"] = ""
            else:
                definition = category_by_key.get(category_key) or category_by_name.get(
                    _text(row.get("category"))
                )
                category_key = (
                    str(definition["category_key"]) if definition else category_key
                )
                normalized["category"] = str(definition["name"]) if definition else ""
            normalized["category_key"] = category_key or None
            normalized_rows.append(normalized)
        issues = validate_transactions(
            pd.DataFrame(normalized_rows),
            month=month,
            categories=category_rows,
        )
        if has_blocking_issues(issues):
            raise RepositoryValidationError(
                "流水质检未通过", issues=issues
            )

        existing_ids = {
            int(row["id"])
            for row in connection.execute(
                "SELECT id FROM transactions WHERE month = ?", (month,)
            ).fetchall()
        }
        submitted_ids: set[int] = set()
        for row in normalized_rows:
            row_id = row.get("id")
            if row_id is not None:
                try:
                    row_id = int(row_id)
                except (TypeError, ValueError) as exc:
                    raise RepositoryValidationError("流水 id 无效") from exc
                if row_id not in existing_ids or row_id in submitted_ids:
                    raise RepositoryValidationError("流水 id 不属于当前月份或重复")
                submitted_ids.add(row_id)
            values = (
                row["transaction_date"],
                _text(row.get("type")),
                row.get("category_key"),
                _text(row.get("category")),
                _text(row.get("product")),
                row["amount"],
            )
            if row_id is None:
                cursor = connection.execute(
                    "INSERT INTO transactions "
                    "(month, transaction_date, type, category_key, category, product, amount) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (month, *values),
                )
                row["id"] = int(cursor.lastrowid)
            else:
                connection.execute(
                    "UPDATE transactions SET transaction_date=?, type=?, category_key=?, "
                    "category=?, product=?, amount=? "
                    "WHERE id=? AND month=?",
                    (*values, row_id, month),
                )
        for removed_id in existing_ids - submitted_ids:
            connection.execute("DELETE FROM transactions WHERE id = ?", (removed_id,))
        new_revision = (
            self._touch_month(connection, month, revision)
            if touch_month
            else revision
        )
        canonical = [
            dict(row)
            for row in connection.execute(
                "SELECT id, month, transaction_date, type, category_key, "
                "category, product, amount "
                "FROM transactions WHERE month = ? ORDER BY id", (month,)
            ).fetchall()
        ]
        return canonical, new_revision

    def save_transactions(
        self, month: str, expected_revision: int, rows: list[dict[str, Any]]
    ) -> dict[str, Any]:
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            canonical, revision = self._save_transaction_rows(
                connection, month, rows, expected_revision
            )
            connection.commit()
        return {"month": month, "revision": revision, "rows": canonical}

    def _save_single_month_table(
        self,
        month: str,
        expected_revision: int,
        table: str,
        columns: tuple[str, ...],
        values: tuple[Any, ...],
    ) -> dict[str, Any]:
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            revision = self._check_month_write(connection, month, expected_revision)
            placeholders = ", ".join("?" for _ in columns)
            updates = ", ".join(f"{column}=excluded.{column}" for column in columns[1:])
            connection.execute(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders}) "
                f"ON CONFLICT(month) DO UPDATE SET {updates}",
                values,
            )
            new_revision = self._touch_month(connection, month, revision)
            connection.commit()
        return {"month": month, "revision": new_revision}

    def save_asset_snapshot(self, month: str, expected_revision: int, values: dict[str, Any]):
        mapping = {
            "cash-boc": "boc_balance",
            "cash-ccb": "ccb_balance",
            "cash-alipay": "alipay_balance",
            "cash-wechat": "wechat_balance",
        }
        current = self.get_month(month)
        return self.save_month_workspace(
            month,
            expected_revision,
            [
                {"account_key": key, "balance": values.get(field, 0)}
                for key, field in mapping.items()
            ],
            current["investment_accounts"],
            current["transactions"],
            current["fixed_assets"],
        )

    def save_investment(self, month: str, expected_revision: int, values: dict[str, Any]):
        current = self.get_month(month)
        return self.save_month_workspace(
            month,
            expected_revision,
            current["cash_accounts"],
            [{"account_key": "investment-default", **values}],
            current["transactions"],
            current["fixed_assets"],
        )

    def save_fixed_assets(
        self, month: str, expected_revision: int, rows: list[dict[str, Any]]
    ) -> dict[str, Any]:
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            revision = self._check_month_write(connection, month, expected_revision)
            existing = {
                str(row["asset_key"]): int(row["id"])
                for row in connection.execute(
                    "SELECT id, asset_key FROM fixed_assets WHERE month = ?", (month,)
                ).fetchall()
            }
            submitted: set[str] = set()
            normalized: list[dict[str, Any]] = []
            for index, row in enumerate(rows):
                normalized_row = normalize_fixed_asset(row, index)
                key = normalized_row["asset_key"]
                if key in submitted:
                    raise RepositoryValidationError("固定资产 asset_key 重复")
                submitted.add(key)
                normalized.append(normalized_row)
                values = (
                    month,
                    key,
                    normalized_row["asset_name"],
                    normalized_row["category"],
                    normalized_row["purchase_date"],
                    normalized_row["purchase_price"],
                    normalized_row["status"],
                    normalized_row["note"],
                )
                if key in existing:
                    connection.execute(
                        "UPDATE fixed_assets SET asset_name=?, category=?, purchase_date=?, "
                        "purchase_price=?, status=?, note=? "
                        "WHERE id=? AND month=?",
                        values[2:] + (existing[key], month),
                    )
                else:
                    connection.execute(
                        "INSERT INTO fixed_assets "
                        "(month, asset_key, asset_name, category, purchase_date, "
                        "purchase_price, status, note) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        values,
                    )
            for key, row_id in existing.items():
                if key not in submitted:
                    connection.execute("DELETE FROM fixed_assets WHERE id = ?", (row_id,))
            new_revision = self._touch_month(
                connection, month, revision, fixed_initialized=1
            )
            canonical = [
                dict(row)
                for row in connection.execute(
                    "SELECT * FROM fixed_assets WHERE month = ? ORDER BY id", (month,)
                ).fetchall()
            ]
            connection.commit()
        return {"month": month, "revision": new_revision, "rows": canonical}

    def save_month_workspace(
        self,
        month: str,
        expected_revision: int,
        cash_accounts: list[dict[str, Any]],
        investment_accounts: list[dict[str, Any]],
        transactions: list[dict[str, Any]],
        fixed_assets: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Replace every month-scoped fact in one revision-safe transaction."""

        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            revision = self._check_month_write(connection, month, expected_revision)

            definitions = {
                str(row["account_key"]): str(row["account_type"])
                for row in connection.execute(
                    "SELECT account_key, account_type FROM account_definitions"
                ).fetchall()
            }
            connection.execute(
                "DELETE FROM cash_account_balances WHERE month=?", (month,)
            )
            seen_accounts: set[str] = set()
            for row in cash_accounts:
                key = _text(row.get("account_key"))
                if definitions.get(key) != "cash" or key in seen_accounts:
                    raise RepositoryValidationError("现金账户无效或重复")
                seen_accounts.add(key)
                connection.execute(
                    "INSERT INTO cash_account_balances(month, account_key, balance) "
                    "VALUES (?, ?, ?)",
                    (month, key, _number(row.get("balance"), non_negative=True)),
                )

            connection.execute(
                "DELETE FROM investment_account_balances WHERE month=?", (month,)
            )
            seen_accounts.clear()
            for row in investment_accounts:
                key = _text(row.get("account_key"))
                if definitions.get(key) != "investment" or key in seen_accounts:
                    raise RepositoryValidationError("理财账户无效或重复")
                seen_accounts.add(key)
                connection.execute(
                    "INSERT INTO investment_account_balances "
                    "(month, account_key, principal, market_value, cash_balance) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        month,
                        key,
                        _number(row.get("principal"), non_negative=True),
                        _number(row.get("market_value"), non_negative=True),
                        _number(row.get("cash_balance"), non_negative=True),
                    ),
                )

            # Reuse the exact transaction validation/update implementation while
            # keeping the whole workspace inside this one SQL transaction.
            _, transaction_revision = self._save_transaction_rows(
                connection,
                month,
                transactions,
                revision,
                touch_month=False,
            )

            existing_assets = {
                str(row["asset_key"]): int(row["id"])
                for row in connection.execute(
                    "SELECT id, asset_key FROM fixed_assets WHERE month = ?", (month,)
                ).fetchall()
            }
            submitted_assets: set[str] = set()
            for index, row in enumerate(fixed_assets):
                normalized = normalize_fixed_asset(row, index)
                key = normalized["asset_key"]
                if key in submitted_assets:
                    raise RepositoryValidationError("固定资产 asset_key 重复")
                submitted_assets.add(key)
                values = (
                    month,
                    key,
                    normalized["asset_name"],
                    normalized["category"],
                    normalized["purchase_date"],
                    normalized["purchase_price"],
                    normalized["status"],
                    normalized["note"],
                )
                if key in existing_assets:
                    connection.execute(
                        "UPDATE fixed_assets SET asset_name=?, category=?, purchase_date=?, "
                        "purchase_price=?, status=?, note=? "
                        "WHERE id=? AND month=?",
                        values[2:] + (existing_assets[key], month),
                    )
                else:
                    connection.execute(
                        "INSERT INTO fixed_assets "
                        "(month, asset_key, asset_name, category, purchase_date, "
                        "purchase_price, status, note) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        values,
                    )
            for key, row_id in existing_assets.items():
                if key not in submitted_assets:
                    connection.execute("DELETE FROM fixed_assets WHERE id = ?", (row_id,))

            new_revision = self._touch_month(
                connection, month, transaction_revision, fixed_initialized=1
            )
            connection.commit()

        result = self.get_month(month)
        result["revision"] = new_revision
        return result

    def lock_month(self, month: str) -> dict[str, Any]:
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = self._month_row(connection, month)
            revision = int(row["revision"]) if row else 0
            connection.execute(
                """
                INSERT INTO month_status (month, status, locked_at, updated_at, revision)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(month) DO UPDATE SET
                    status=excluded.status, locked_at=excluded.locked_at,
                    updated_at=excluded.updated_at, revision=excluded.revision
                """,
                (month, STATUS_LOCKED, _now(), _now(), revision + 1),
            )
            connection.commit()
        return {"month": month, "revision": revision + 1, "status": STATUS_LOCKED}

    def unlock_month(self, month: str) -> dict[str, Any]:
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = self._month_row(connection, month)
            revision = int(row["revision"]) if row else 0
            connection.execute(
                """
                INSERT INTO month_status (month, status, locked_at, updated_at, revision)
                VALUES (?, ?, NULL, ?, ?)
                ON CONFLICT(month) DO UPDATE SET
                    status=excluded.status, locked_at=NULL,
                    updated_at=excluded.updated_at, revision=excluded.revision
                """,
                (month, STATUS_SAVED, _now(), revision + 1),
            )
            connection.commit()
        return {"month": month, "revision": revision + 1, "status": STATUS_SAVED}

    def category_definitions(self) -> dict[str, Any]:
        rows = self.db.fetch_all(
            """
            SELECT d.*,
                   COUNT(DISTINCT t.id) AS transaction_count,
                   COUNT(DISTINCT r.id) AS rule_count,
                   COUNT(DISTINCT t.month) AS months_count,
                   GROUP_CONCAT(DISTINCT t.month) AS impact_months
            FROM category_definitions d
            LEFT JOIN transactions t ON t.category_key=d.category_key
            LEFT JOIN auto_rules r ON r.category_key=d.category_key
            GROUP BY d.category_key
            ORDER BY d.sort_order, d.name
            """
        )
        for row in rows:
            row["impact_months"] = sorted(
                value for value in str(row.get("impact_months") or "").split(",") if value
            )
        return {"revision": _content_revision(rows), "rows": rows}

    def save_category_definitions(
        self, expected_revision: int, rows: list[dict[str, Any]]
    ) -> dict[str, Any]:
        current = self.category_definitions()
        if expected_revision != current["revision"]:
            raise RevisionConflictError(expected_revision, current["revision"])
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = {
                str(row["category_key"]): dict(row)
                for row in connection.execute(
                    "SELECT * FROM category_definitions"
                ).fetchall()
            }
            submitted: set[str] = set()
            names: set[str] = set()
            for index, row in enumerate(rows):
                key = _text(row.get("category_key"))
                name = _text(row.get("name"))
                transaction_type = _text(row.get("transaction_type"))
                necessity = _text(row.get("necessity")) or "不适用"
                pattern = _text(row.get("pattern")) or "不适用"
                if not key or not name or key in submitted or name in names:
                    raise RepositoryValidationError("分类 key 和名称不能为空或重复")
                if transaction_type not in {"收入", "支出"}:
                    raise RepositoryValidationError("分类收支类型只能是收入或支出")
                if necessity not in {"必要", "可控", "不适用"}:
                    raise RepositoryValidationError("分类必要性无效")
                if pattern not in {"周期", "日常", "偶尔", "不适用"}:
                    raise RepositoryValidationError("分类消费频率无效")
                submitted.add(key)
                names.add(name)
                old = existing.get(key)
                if old and old["transaction_type"] != transaction_type:
                    conflicting = connection.execute(
                        "SELECT 1 FROM transactions WHERE category_key=? "
                        "AND type IN ('支出','收入') AND type<>? "
                        "UNION ALL SELECT 1 FROM auto_rules "
                        "WHERE category_key=? AND transaction_type<>? LIMIT 1",
                        (key, transaction_type, key, transaction_type),
                    ).fetchone()
                    if conflicting:
                        raise RepositoryValidationError(
                            f"分类“{old['name']}”已有不匹配的历史引用，不能改变收支类型"
                        )
                connection.execute(
                    """
                    INSERT INTO category_definitions
                    (category_key, name, transaction_type, necessity, pattern,
                     is_big_ticket, color, is_active, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(category_key) DO UPDATE SET
                      name=excluded.name,
                      transaction_type=excluded.transaction_type,
                      necessity=excluded.necessity,
                      pattern=excluded.pattern,
                      is_big_ticket=excluded.is_big_ticket,
                      color=excluded.color,
                      is_active=excluded.is_active,
                      sort_order=excluded.sort_order
                    """,
                    (
                        key,
                        name,
                        transaction_type,
                        necessity,
                        pattern,
                        int(bool(row.get("is_big_ticket"))),
                        _text(row.get("color")) or category_rainbow_color(index),
                        int(bool(row.get("is_active", True))),
                        int(row.get("sort_order", index)),
                    ),
                )
                if old and old["name"] != name:
                    connection.execute(
                        "UPDATE transactions SET category=? WHERE category_key=?",
                        (name, key),
                    )
                    connection.execute(
                        "UPDATE auto_rules SET category=? WHERE category_key=?",
                        (name, key),
                    )
            for key in set(existing) - submitted:
                usage = connection.execute(
                    "SELECT (SELECT COUNT(*) FROM transactions WHERE category_key=?) + "
                    "(SELECT COUNT(*) FROM auto_rules WHERE category_key=?)",
                    (key, key),
                ).fetchone()[0]
                if usage:
                    connection.execute(
                        "UPDATE category_definitions SET is_active=0 WHERE category_key=?",
                        (key,),
                    )
                else:
                    connection.execute(
                        "DELETE FROM category_definitions WHERE category_key=?", (key,)
                    )
            connection.commit()
        return self.category_definitions()

    def account_definitions(self) -> dict[str, Any]:
        rows = self.db.fetch_all(
            """
            SELECT d.*,
              CASE WHEN d.account_type='cash'
                THEN (SELECT COUNT(*) FROM cash_account_balances b
                      WHERE b.account_key=d.account_key)
                ELSE (SELECT COUNT(*) FROM investment_account_balances b
                      WHERE b.account_key=d.account_key)
              END AS usage_count,
              CASE WHEN d.account_type='cash'
                THEN (SELECT GROUP_CONCAT(DISTINCT month)
                      FROM cash_account_balances b WHERE b.account_key=d.account_key)
                ELSE (SELECT GROUP_CONCAT(DISTINCT month)
                      FROM investment_account_balances b WHERE b.account_key=d.account_key)
              END AS impact_months
            FROM account_definitions d
            ORDER BY d.account_type, d.sort_order, d.name
            """
        )
        for row in rows:
            row["impact_months"] = sorted(
                value for value in str(row.get("impact_months") or "").split(",") if value
            )
        return {"revision": _content_revision(rows), "rows": rows}

    def save_account_definitions(
        self, expected_revision: int, rows: list[dict[str, Any]]
    ) -> dict[str, Any]:
        current = self.account_definitions()
        if expected_revision != current["revision"]:
            raise RevisionConflictError(expected_revision, current["revision"])
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = {
                str(row["account_key"]): dict(row)
                for row in connection.execute("SELECT * FROM account_definitions")
            }
            submitted: set[str] = set()
            names: set[tuple[str, str]] = set()
            for index, row in enumerate(rows):
                key = _text(row.get("account_key"))
                name = _text(row.get("name"))
                account_type = _text(row.get("account_type"))
                identity = (account_type, name)
                if (
                    not key
                    or not name
                    or key in submitted
                    or identity in names
                    or account_type not in {"cash", "investment"}
                ):
                    raise RepositoryValidationError("账户 key、名称或类型无效或重复")
                if key in existing and existing[key]["account_type"] != account_type:
                    raise RepositoryValidationError("已有账户不能改变现金/理财类型")
                submitted.add(key)
                names.add(identity)
                connection.execute(
                    """
                    INSERT INTO account_definitions
                      (account_key, name, account_type, is_active, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(account_key) DO UPDATE SET
                      name=excluded.name,
                      is_active=excluded.is_active,
                      sort_order=excluded.sort_order
                    """,
                    (
                        key,
                        name,
                        account_type,
                        int(bool(row.get("is_active", True))),
                        int(row.get("sort_order", index)),
                    ),
                )
            for key, definition in existing.items():
                if key in submitted:
                    continue
                balance_table = (
                    "cash_account_balances"
                    if definition["account_type"] == "cash"
                    else "investment_account_balances"
                )
                used = connection.execute(
                    f"SELECT 1 FROM {balance_table} WHERE account_key=? LIMIT 1", (key,)
                ).fetchone()
                if used:
                    connection.execute(
                        "UPDATE account_definitions SET is_active=0 WHERE account_key=?",
                        (key,),
                    )
                else:
                    connection.execute(
                        "DELETE FROM account_definitions WHERE account_key=?", (key,)
                    )
            connection.commit()
        return self.account_definitions()

    def debts(self) -> dict[str, Any]:
        rows = self.db.fetch_all("SELECT * FROM debt_manager ORDER BY is_paid, start_date DESC")
        for row in rows:
            if _text(row.get("start_date")):
                try:
                    row["start_date"] = _normalize_date(row["start_date"])
                except RepositoryValidationError:
                    pass
            if _text(row.get("paid_date")):
                try:
                    row["paid_date"] = _normalize_date(row["paid_date"])
                except RepositoryValidationError:
                    pass
        today = datetime.now().strftime("%Y-%m-%d")
        active_balance = sum(
            float(row.get("amount", 0) or 0)
            for row in rows
            if not bool(row.get("is_paid"))
            and str(row.get("start_date", "")) <= today
        )
        return {
            "revision": _content_revision(rows),
            "rows": rows,
            "as_of_month": today[:7],
            "active_balance": round(active_balance, 2),
        }

    def save_debts(self, expected_revision: int, rows: list[dict[str, Any]]) -> dict[str, Any]:
        current = self.debts()
        if expected_revision != current["revision"]:
            raise RevisionConflictError(expected_revision, current["revision"])
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = {
                int(row["id"]): row
                for row in connection.execute("SELECT * FROM debt_manager").fetchall()
            }
            submitted: set[int] = set()
            for row in rows:
                row_id = row.get("id")
                try:
                    start_date = _normalize_date(row.get("start_date"))
                except RepositoryValidationError as exc:
                    raise RepositoryValidationError(
                        "借款发生日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM"
                    ) from exc
                is_paid = bool(row.get("is_paid", False))
                try:
                    paid_date = (
                        _normalize_date(row.get("paid_date"))
                        if _text(row.get("paid_date"))
                        else ""
                    )
                except RepositoryValidationError as exc:
                    raise RepositoryValidationError(
                        "借款还清日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM"
                    ) from exc
                if is_paid and not paid_date:
                    raise RepositoryValidationError("已还借款必须填写还清日期")
                if paid_date and paid_date < start_date:
                    raise RepositoryValidationError("借款还清日期不能早于发生日期")
                values = (
                    _text(row.get("description")),
                    _text(row.get("counterparty")),
                    _number(row.get("amount", 0)),
                    start_date,
                    int(is_paid),
                    paid_date or None,
                )
                if row_id is None:
                    connection.execute(
                        "INSERT INTO debt_manager "
                        "(description, counterparty, amount, start_date, is_paid, paid_date) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        values,
                    )
                else:
                    row_id = int(row_id)
                    if row_id not in existing or row_id in submitted:
                        raise RepositoryValidationError("借款 id 无效或重复")
                    submitted.add(row_id)
                    connection.execute(
                        "UPDATE debt_manager SET description=?, counterparty=?, amount=?, "
                        "start_date=?, is_paid=?, paid_date=? WHERE id=?",
                        values + (row_id,),
                    )
            for row_id in set(existing) - submitted:
                connection.execute("DELETE FROM debt_manager WHERE id = ?", (row_id,))
            connection.commit()
        return self.debts()

    def rules(self) -> dict[str, Any]:
        rows = self.db.fetch_all("SELECT * FROM auto_rules ORDER BY id")
        revision = _content_revision(rows)
        usage: dict[tuple[str, str], dict[str, Any]] = defaultdict(
            lambda: {"occurrences": 0, "months": set(), "last_month": ""}
        )
        for transaction in self.db.fetch_all(
            "SELECT month, type, product FROM transactions "
            "WHERE type IN ('支出', '收入') AND TRIM(COALESCE(product, '')) <> ''"
        ):
            key = (
                str(transaction["type"]),
                normalize_product_key(transaction["product"]),
            )
            stats = usage[key]
            stats["occurrences"] += 1
            stats["months"].add(str(transaction["month"]))
            stats["last_month"] = max(
                str(stats["last_month"]), str(transaction["month"])
            )
        enriched = []
        for row in rows:
            stats = usage.get(
                (str(row["transaction_type"]), normalize_product_key(row["product"]))
            )
            enriched.append({
                **row,
                "occurrences": int(stats["occurrences"]) if stats else 0,
                "months_count": len(stats["months"]) if stats else 0,
                "last_month": str(stats["last_month"]) if stats else "",
            })
        return {"revision": revision, "rows": enriched}

    def save_rules(self, expected_revision: int, rows: list[dict[str, Any]]) -> dict[str, Any]:
        current = self.rules()
        if expected_revision != current["revision"]:
            raise RevisionConflictError(expected_revision, current["revision"])
        with self.db.get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            categories = {
                str(row["category_key"]): dict(row)
                for row in connection.execute(
                    "SELECT * FROM category_definitions WHERE is_active=1"
                ).fetchall()
            }
            categories_by_name = {
                str(row["name"]): row for row in categories.values()
            }
            existing = {
                int(row["id"]): row
                for row in connection.execute("SELECT * FROM auto_rules").fetchall()
            }
            submitted: set[int] = set()
            rule_keys: set[tuple[str, str]] = set()
            for row in rows:
                product = _text(row.get("product"))
                category_key = _text(row.get("category_key"))
                definition = categories.get(category_key) or categories_by_name.get(
                    _text(row.get("category"))
                )
                category_key = (
                    str(definition["category_key"]) if definition else category_key
                )
                category = str(definition["name"]) if definition else ""
                transaction_type = _text(row.get("transaction_type"))
                if not product or not definition:
                    raise RepositoryValidationError("自动规则的商品和分类不能为空")
                if not transaction_type:
                    transaction_type = str(definition["transaction_type"])
                if transaction_type not in RULE_TRANSACTION_TYPES:
                    raise RepositoryValidationError("自动规则的收支类型只能是支出或收入")
                if str(definition["transaction_type"]) != transaction_type:
                    raise RepositoryValidationError(
                        f"{transaction_type}规则不能使用分类“{category}”"
                    )
                rule_key = (transaction_type, normalize_product_key(product))
                if rule_key in rule_keys:
                    raise RepositoryValidationError("同一收支类型下不能存在重复或等价商品规则")
                rule_keys.add(rule_key)
                row_id = row.get("id")
                if row_id is None:
                    connection.execute(
                        "INSERT INTO auto_rules "
                        "(transaction_type, product, category_key, category) "
                        "VALUES (?, ?, ?, ?)",
                        (transaction_type, product, category_key, category),
                    )
                else:
                    row_id = int(row_id)
                    if row_id not in existing or row_id in submitted:
                        raise RepositoryValidationError("自动规则 id 无效或重复")
                    submitted.add(row_id)
                    connection.execute(
                        "UPDATE auto_rules SET transaction_type=?, product=?, "
                        "category_key=?, category=? WHERE id=?",
                        (transaction_type, product, category_key, category, row_id),
                    )
            for row_id in set(existing) - submitted:
                connection.execute("DELETE FROM auto_rules WHERE id = ?", (row_id,))
            connection.commit()
        return self.rules()

    def product_history(self, min_occurrences: int = 5) -> list[dict[str, Any]]:
        """Return type-safe frequent products grouped by conservative name keys."""
        threshold = max(0, min(int(min_occurrences), 10_000))
        existing = {
            (str(row["transaction_type"]), normalize_product_key(row["product"]))
            for row in self.db.fetch_all(
                "SELECT transaction_type, product FROM auto_rules"
            )
        }
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for row in self.db.fetch_all(
            "SELECT month, type, category, product FROM transactions "
            "WHERE type IN ('支出', '收入') AND TRIM(COALESCE(product, '')) <> ''"
        ):
            key = (str(row["type"]), normalize_product_key(row["product"]))
            if key[1]:
                grouped[key].append(row)

        result = []
        category_metadata = self._category_metadata()
        for key, group in grouped.items():
            if len(group) <= threshold or key in existing:
                continue
            transaction_type, _ = key
            variants = Counter(str(row["product"]).strip() for row in group)
            category_counts = Counter()
            for row in group:
                category = _text(row.get("category"))
                if category == "收入":
                    category = "临时收入"
                if category_metadata.get(category, {}).get("type") == transaction_type:
                    category_counts[category] += 1
            if not category_counts:
                continue
            category, category_count = category_counts.most_common(1)[0]
            result.append({
                "transaction_type": transaction_type,
                "product": variants.most_common(1)[0][0],
                "variants": [name for name, _count in variants.most_common()],
                "category": category,
                "category_confidence": round(category_count / len(group), 4),
                "has_category_conflict": len(category_counts) > 1,
                "occurrences": len(group),
                "months_count": len({str(row["month"]) for row in group}),
                "last_month": max(str(row["month"]) for row in group),
            })
        return sorted(
            result,
            key=lambda row: (-row["occurrences"], row["last_month"], row["product"]),
        )

    def current_asset(self) -> dict[str, Any]:
        months = self.get_months()
        latest = months[-1] if months else None
        if not latest:
            return {"month": None, "total_assets": 0.0, "fixed_assets": []}
        debts = self.db.fetch_all(
            "SELECT * FROM debt_manager WHERE REPLACE(start_date, '/', '-') <= ? AND "
            "(is_paid = 0 OR REPLACE(paid_date, '/', '-') > ?)",
            (f"{latest}-31", f"{latest}-31"),
        )
        cash_row = self.db.fetch_one(
            "SELECT COALESCE(SUM(balance), 0) AS total "
            "FROM cash_account_balances WHERE month=?",
            (latest,),
        ) or {}
        investment_row = self.db.fetch_one(
            "SELECT COALESCE(SUM(principal), 0) AS principal "
            "FROM investment_account_balances WHERE month=?",
            (latest,),
        ) or {}
        cash = float(cash_row.get("total", 0) or 0)
        debt = sum(float(row.get("amount", 0) or 0) for row in debts)
        principal = float(investment_row.get("principal", 0) or 0)
        fixed_assets = self.db.fetch_all(
            "SELECT * FROM fixed_assets WHERE month = ? AND status IN (?,?) ORDER BY id",
            (latest, *ACTIVE_FIXED_ASSET_STATUSES),
        )
        return {
            "month": latest,
            "cash": round(cash, 2),
            "debt": round(debt, 2),
            "principal": round(principal, 2),
            "total_assets": round(cash - debt + principal, 2),
            "fixed_assets": fixed_assets,
            "fixed_assets_note": "固定资产记录不计入总资产",
        }
