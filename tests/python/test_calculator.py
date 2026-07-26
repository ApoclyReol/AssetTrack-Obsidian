import math

import pandas as pd

from assettrack.domain import calculator
from assettrack.domain.calculator import (
    analyze_monthly_anomalies,
    build_annual_df,
    calc_monthly,
    explain_reconciliation,
)


def test_calc_monthly_uses_net_expense_after_daifu():
    df = pd.DataFrame([
        {"product": "食堂", "type": "支出", "category": "餐饮基础", "amount": 80},
        {"product": "帮朋友买票", "type": "支出", "category": "社交娱乐", "amount": 200},
        {"product": "朋友回款", "type": "代付", "category": "", "amount": 200},
        {"product": "工资", "type": "收入", "category": "工资收入", "amount": 1000},
        {"product": "基金", "type": "加仓", "category": "", "amount": 300},
        {"product": "赎回", "type": "提现", "category": "", "amount": 50},
    ])

    result = calc_monthly(df)

    assert result["all_out"] == 280
    assert result["total_daifu"] == 200
    assert result["total_expense"] == 80
    assert result["total_income"] == 1000
    assert result["total_deposit"] == 300
    assert result["total_withdraw"] == 50
    assert result["structure"]["necessary"] == 80
    assert result["structure"]["controlled"] == 200
    assert result["structure"]["daily"] == 80
    assert result["structure"]["occasional"] == 200


def test_original_app_monthly_savings_rate_regression(monkeypatch):
    """2026-01 must remain a negative single-month rate, not a rolling aggregate."""
    transactions = pd.DataFrame([
        {"product": "收入", "type": "收入", "category": "工资收入", "amount": 2700},
        {"product": "消费", "type": "支出", "category": "餐饮基础", "amount": 5603},
        {"product": "代付", "type": "代付", "category": "", "amount": 155},
    ])
    monthly = calc_monthly(transactions)
    monkeypatch.setattr(calculator, "calc_debt_for_month", lambda _month: 0)
    annual = build_annual_df(
        ["2026-01"],
        {"2026-01": {"cash_total": 0}},
        {"2026-01": {"principal": 0, "market_value": 0, "cash_balance": 0}},
        {"2026-01": monthly},
    )

    assert monthly["total_income"] == 2700
    assert monthly["total_expense"] == 5448
    assert annual.iloc[0]["savings_rate"] == -101.78


def test_build_annual_df_calculates_only_continuous_months(monkeypatch):
    debts = {"2026-01": 0, "2026-02": 100, "2026-04": 100}
    monkeypatch.setattr(calculator, "calc_debt_for_month", lambda month: debts[month])

    months = ["2026-01", "2026-02", "2026-04"]
    snap_data = {
        "2026-01": {"boc_balance": 1000, "ccb_balance": 0, "alipay_balance": 0, "wechat_balance": 0},
        "2026-02": {"boc_balance": 1300, "ccb_balance": 0, "alipay_balance": 0, "wechat_balance": 0},
        "2026-04": {"boc_balance": 900, "ccb_balance": 0, "alipay_balance": 0, "wechat_balance": 0},
    }
    inv_data = {
        "2026-01": {"principal": 0, "market_value": 0, "cash_balance": 0},
        "2026-02": {"principal": 200, "market_value": 200, "cash_balance": 0},
        "2026-04": {"principal": 200, "market_value": 200, "cash_balance": 0},
    }
    tx_monthly = {
        "2026-01": {"total_income": 0, "total_expense": 0, "total_deposit": 0, "total_withdraw": 0},
        "2026-02": {"total_income": 1000, "total_expense": 600, "total_deposit": 200, "total_withdraw": 0},
        "2026-04": {"total_income": 0, "total_expense": 0, "total_deposit": 0, "total_withdraw": 0},
    }

    df = build_annual_df(months, snap_data, inv_data, tx_monthly)
    feb = df[df["month"] == "2026-02"].iloc[0]
    jan = df[df["month"] == "2026-01"].iloc[0]
    apr = df[df["month"] == "2026-04"].iloc[0]

    assert feb["debt_change"] == 100
    assert feb["principal"] == 200
    assert feb["total_assets"] == 1400
    assert feb["theoretical_expense"] == 600
    assert feb["discrepancy"] == 0
    assert feb["savings_rate"] == 40
    assert math.isnan(jan["savings_rate"])
    assert math.isnan(apr["theoretical_expense"])
    assert math.isnan(apr["discrepancy"])


def test_reconciliation_explanation_direction():
    positive = explain_reconciliation(200)
    negative = explain_reconciliation(-200)

    assert positive["level"] == "error"
    assert "实际流水偏高" in positive["summary"]
    assert "漏记收入" in " ".join(positive["causes"])
    assert "资产推导偏高" in negative["summary"]
    assert "漏记消费" in " ".join(negative["causes"])


def test_reconciliation_explanation_ignores_small_difference():
    explanation = explain_reconciliation(10.01)

    assert explanation["title"] == "差额可忽略"
    assert "方向" not in explanation["summary"]
    assert explanation["causes"] == []
    assert explanation["suggestions"] == []


def test_analyze_monthly_anomalies_compares_with_history(monkeypatch):
    history_rows = []
    for month in ["2026-01", "2026-02", "2026-03"]:
        history_rows.extend([
            {"month": month, "type": "支出", "category": "餐饮改善", "product": "外卖", "amount": 500},
            {"month": month, "type": "支出", "category": "生活品质", "product": "衣物", "amount": 1000},
            {"month": month, "type": "支出", "category": "居住固定", "product": "房租", "amount": 2000},
        ])
    monkeypatch.setattr(calculator.db, "fetch_all", lambda *args, **kwargs: history_rows)

    current = pd.DataFrame([
        {"type": "支出", "category": "餐饮改善", "product": "外卖", "amount": 1200},
        {"type": "支出", "category": "生活品质", "product": "衣物", "amount": 200},
        {"type": "支出", "category": "大件大额", "product": "新电脑", "amount": 6000},
    ])

    result = analyze_monthly_anomalies(current_tx_df=current, month="2026-04")
    changes = result["category_changes"]

    food_change = changes[(changes["对比口径"] == "较近3月均值") & (changes["分类"] == "餐饮改善")].iloc[0]
    quality_change = changes[(changes["对比口径"] == "较近3月均值") & (changes["分类"] == "生活品质")].iloc[0]
    assert food_change["增减方向"] == "增加"
    assert food_change["增减金额"] == 700
    assert quality_change["增减方向"] == "减少"
    assert quality_change["增减金额"] == -800
    assert "新电脑" in result["new_big_items"]["商品"].tolist()
    assert "居住固定" in result["missing_periodic"]["分类"].tolist()
    assert "周期项" in result["missing_periodic"]["判断"].iloc[0]
