import pandas as pd

from assettrack.domain.validators import has_blocking_issues, validate_transactions


CATEGORIES = [
    {
        "category_key": "food",
        "name": "餐饮基础",
        "transaction_type": "支出",
        "is_active": True,
    },
    {
        "category_key": "salary",
        "name": "工资收入",
        "transaction_type": "收入",
        "is_active": True,
    },
]


def test_validate_transactions_blocks_all_invalid_rows():
    df = pd.DataFrame([
        {
            "transaction_date": "2026-01-01",
            "product": "",
            "type": "支出",
            "category_key": "food",
            "category": "餐饮基础",
            "amount": 10,
        },
        {
            "transaction_date": "2026-02-01",
            "product": "工资",
            "type": "收入",
            "category_key": "food",
            "category": "餐饮基础",
            "amount": 1000,
        },
        {
            "transaction_date": "2026-01-03",
            "product": "零金额",
            "type": "支出",
            "category_key": "food",
            "category": "餐饮基础",
            "amount": 0,
        },
    ])

    issues = validate_transactions(df, month="2026-01", categories=CATEGORIES)

    assert has_blocking_issues(issues)
    assert any(issue["field"] == "商品" for issue in issues)
    assert any("日期不属于" in issue["issue"] for issue in issues)
    assert any("不匹配" in issue["issue"] for issue in issues)
    assert any("金额必须大于 0" in issue["issue"] for issue in issues)
    assert all("row_index" in issue for issue in issues)


def test_validate_transactions_allows_special_type_without_category():
    df = pd.DataFrame([
        {
            "transaction_date": "2026-01-01",
            "product": "基金",
            "type": "加仓",
            "category_key": None,
            "category": "",
            "amount": 1000,
        },
        {
            "transaction_date": "2026-01-02",
            "product": "朋友回款",
            "type": "代付",
            "category_key": None,
            "category": "",
            "amount": 200,
        },
    ])

    assert validate_transactions(
        df, month="2026-01", categories=CATEGORIES
    ) == []
