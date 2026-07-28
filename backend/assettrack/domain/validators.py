from __future__ import annotations

from typing import Any

from assettrack.domain.lazy_pandas import pd

WARNING = "警告"


def _is_blank(value: Any) -> bool:
    if pd.isna(value):
        return True
    return str(value).strip() == ""


def _issue_context(row: pd.Series | None = None) -> dict[str, str]:
    if row is None:
        return {"type": "-", "product": "-"}
    tx_type = str(row.get("type", "") or "").strip() or "-"
    product = str(row.get("product", "") or "").strip() or "(空商品)"
    return {"type": tx_type, "product": product}


def validate_transactions(
    df: pd.DataFrame,
    *,
    month: str | None = None,
    categories: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Validate normalized transaction rows before persistence."""
    issues: list[dict[str, Any]] = []
    if df.empty:
        return issues

    required_columns = {"transaction_date", "product", "type", "amount"}
    missing_columns = sorted(required_columns - set(df.columns))
    for col in missing_columns:
        issues.append({
            "severity": WARNING,
            "type": "-",
            "product": "-",
            "field": col,
            "issue": "缺少必要字段",
            "suggestion": "请检查流水表结构或重新导入 CSV",
        })
    if missing_columns:
        return issues

    valid_types = {"支出", "收入", "代付", "加仓", "提现"}
    category_by_key = {
        str(row.get("category_key") or ""): row for row in (categories or [])
    }
    category_by_name = {
        str(row.get("name") or ""): row for row in (categories or [])
    }

    for idx, row in df.iterrows():
        context = _issue_context(row)
        row_context = {"row_index": int(idx)}
        tx_type = str(row.get("type", "") or "").strip()
        transaction_date = str(row.get("transaction_date", "") or "").strip()
        category_key = (
            ""
            if _is_blank(row.get("category_key"))
            else str(row.get("category_key")).strip()
        )
        category = (
            ""
            if _is_blank(row.get("category"))
            else str(row.get("category")).strip()
        )

        if not transaction_date:
            issues.append({
                "severity": WARNING,
                **row_context,
                **context,
                "field": "日期",
                "issue": "日期为空",
                "suggestion": "填写当前月份内的消费日期",
            })
        else:
            try:
                normalized_date = pd.Timestamp(transaction_date).date().isoformat()
            except (TypeError, ValueError):
                normalized_date = ""
                issues.append({
                    "severity": WARNING,
                    **row_context,
                    **context,
                    "field": "日期",
                    "issue": f"无法识别日期：{transaction_date}",
                    "suggestion": "使用 YYYY-MM-DD、YYYY/MM/DD 或中文年月日",
                })
            if normalized_date and month and normalized_date[:7] != month:
                issues.append({
                    "severity": WARNING,
                    **row_context,
                    **context,
                    "field": "日期",
                    "issue": f"日期不属于当前月份 {month}",
                    "suggestion": "修改日期后再保存；系统不会自动移动跨月流水",
                })

        if _is_blank(row.get("product")):
            issues.append({
                "severity": WARNING,
                **row_context,
                **context,
                "field": "商品",
                "issue": "商品为空",
                "suggestion": "补充商品说明，方便后续分类和排查",
            })

        amount = pd.to_numeric(pd.Series([row.get("amount")]), errors="coerce").iloc[0]
        if pd.isna(amount):
            issues.append({
                "severity": WARNING,
                **row_context,
                **context,
                "field": "金额",
                "issue": "金额无法识别",
                "suggestion": "改为纯数字金额",
            })
        elif float(amount) <= 0:
            issues.append({
                "severity": WARNING,
                **row_context,
                **context,
                "field": "金额",
                "issue": "金额必须大于 0",
                "suggestion": "删除无效行或填写真实金额",
            })

        if tx_type not in valid_types:
            issues.append({
                "severity": WARNING,
                **row_context,
                **context,
                "field": "收支",
                "issue": f"无效收支类型：{tx_type or '空'}",
                "suggestion": "请选择支出、收入、代付、加仓或提现",
            })
            continue

        if tx_type in {"支出", "收入"}:
            definition = category_by_key.get(category_key) or category_by_name.get(category)
            if not definition:
                issues.append({
                    "severity": WARNING,
                    **row_context,
                    **context,
                    "field": "分类",
                    "issue": f"{tx_type}未选择有效分类",
                    "suggestion": f"请选择一个已启用的{tx_type}分类",
                })
            elif str(definition.get("transaction_type")) != tx_type:
                issues.append({
                    "severity": WARNING,
                    **row_context,
                    **context,
                    "field": "分类",
                    "issue": f"{tx_type}使用了不匹配的分类",
                    "suggestion": f"请选择{tx_type}类分类",
                })
        elif category or category_key:
            issues.append({
                "severity": WARNING,
                **row_context,
                **context,
                "field": "分类",
                "issue": "特殊类型流水不能设置分类",
                "suggestion": "代付、加仓、提现的分类必须为空",
            })

    return issues


def has_blocking_issues(issues: list[dict[str, Any]]) -> bool:
    return bool(issues)
