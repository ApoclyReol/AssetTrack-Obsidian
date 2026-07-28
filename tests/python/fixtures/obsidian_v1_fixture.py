"""Synthetic Obsidian V1 fixture; contains no user-derived records."""

from assettrack.api.repository import APIRepository


GOLDEN = {
    "2025-12": {
        "total_income": 5000.0,
        "total_expense": 900.0,
        "total_assets": 1200.0,
        "theoretical_expense": None,
    },
    "2026-01": {
        "total_income": 6000.0,
        "total_expense": 1500.0,
        "total_assets": 1550.0,
        "theoretical_expense": 5750.0,
        "discrepancy": -4250.0,
        "savings_rate": 75.0,
    },
    "2026-03": {
        "total_income": 0.0,
        "total_expense": 100.0,
        "theoretical_expense": None,
        "savings_rate": None,
    },
}


def populate(repository: APIRepository) -> None:
    repository.initialize()
    with repository.db.get_connection() as connection:
        connection.execute(
            "DELETE FROM account_definitions WHERE account_key='cash-default'"
        )
        connection.executemany(
            """
            INSERT INTO account_definitions
              (account_key, name, account_type, is_active, sort_order)
            VALUES (?, ?, 'cash', 1, ?)
            """,
            [
                ("cash-boc", "中国银行", 0),
                ("cash-ccb", "建设银行", 1),
                ("cash-alipay", "支付宝", 2),
                ("cash-wechat", "微信", 3),
            ],
        )
        connection.commit()
    repository.save_month_workspace(
        "2025-12",
        0,
        [
            {"account_key": "cash-boc", "balance": 600},
            {"account_key": "cash-ccb", "balance": 200},
            {"account_key": "cash-alipay", "balance": 150},
            {"account_key": "cash-wechat", "balance": 50},
        ],
        [{"account_key": "investment-default", "principal": 200, "market_value": 220, "cash_balance": 10}],
        [
            {"transaction_date": "2025-12-01", "type": "收入", "category": "工资收入", "product": "工资", "amount": 5000},
            {"transaction_date": "2025-12-02", "type": "支出", "category": "居住固定", "product": "房租", "amount": 1000},
            {"transaction_date": "2025-12-03", "type": "代付", "category": "", "product": "代买", "amount": 100},
            {"transaction_date": "2025-12-04", "type": "加仓", "category": "", "product": "理财转入", "amount": 200},
            {"transaction_date": "2025-12-05", "type": "提现", "category": "", "product": "理财转出", "amount": 50},
        ],
        [
            {
                "asset_key": "phone-a",
                "asset_name": "手机",
                "category": "电子设备",
                "purchase_price": 5000,
                "status": "在用",
            },
            {
                "asset_key": "phone-b",
                "asset_name": "手机",
                "category": "电子设备",
                "purchase_price": 3000,
                "status": "闲置",
            },
        ],
    )
    repository.db.execute(
        "UPDATE month_status SET status='locked' WHERE month='2025-12'"
    )
    repository.save_month_workspace(
        "2026-01",
        0,
        [
            {"account_key": "cash-boc", "balance": 800},
            {"account_key": "cash-ccb", "balance": 250},
            {"account_key": "cash-alipay", "balance": 250},
            {"account_key": "cash-wechat", "balance": 100},
        ],
        [{"account_key": "investment-default", "principal": 300, "market_value": 330, "cash_balance": 20}],
        [
            {"transaction_date": "2026-01-01", "type": "收入", "category": "工资收入", "product": "工资", "amount": 6000},
            {"transaction_date": "2026-01-02", "type": "支出", "category": "餐饮基础", "product": "餐饮", "amount": 1500},
        ],
        repository.get_month("2026-01")["fixed_assets"],
    )
    repository.db.execute(
        "INSERT INTO debt_manager "
        "(description, counterparty, amount, start_date, is_paid, paid_date) "
        "VALUES ('信用借款', '银行', 200, '2026-01-01', 0, NULL)"
    )
    repository.db.execute(
        "INSERT INTO debt_manager "
        "(description, counterparty, amount, start_date, is_paid, paid_date) "
        "VALUES ('朋友欠款', '朋友', -50, '2026-01-01', 0, NULL)"
    )
    repository.save_month_workspace(
        "2026-03",
        0,
        [{"account_key": "cash-boc", "balance": 1200}],
        [{"account_key": "investment-default", "principal": 300, "market_value": 310, "cash_balance": 0}],
        [
            {"transaction_date": "2026-03-01", "type": "支出", "category": "交通通勤", "product": "交通", "amount": 100},
        ],
        [],
    )
    repository.create_month("2026-04")
