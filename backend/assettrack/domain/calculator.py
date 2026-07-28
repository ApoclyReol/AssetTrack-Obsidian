from __future__ import annotations

from typing import Dict, Any, Optional, List
from assettrack.domain.lazy_pandas import pd
from loguru import logger

from assettrack.infrastructure.sqlite_manager import db
from assettrack.infrastructure.config import CATEGORIES_METADATA

# 现金类资产字段
CASH_FIELDS = ["boc_balance", "ccb_balance", "alipay_balance", "wechat_balance"]

# 历史兼容：旧分类在报表层映射到当前分类体系，避免结构分析失真
LEGACY_CATEGORY_ALIASES = {
    "基本饮食": "餐饮基础",
    "升级饮食": "餐饮改善",
    "生活品质提升": "生活品质",
}

def _sum_cash(snap: dict) -> float:
    if not snap:
        return 0.0
    if "cash_total" in snap:
        return float(snap.get("cash_total", 0) or 0)
    return sum(snap.get(f, 0) or 0 for f in CASH_FIELDS)


def _month_end(month: str) -> str:
    """返回月份最后一天 YYYY-MM-DD"""
    from calendar import monthrange
    y, m = int(month[:4]), int(month[5:7])
    _, last_day = monthrange(y, m)
    return f"{y}-{m:02d}-{last_day:02d}"


def _month_start(month: str) -> str:
    """返回月份第一天 YYYY-MM-DD"""
    return f"{month[:7]}-01"


def _is_valid_month(month: Any) -> bool:
    """校验月份字符串是否为 YYYY-MM。"""
    if not isinstance(month, str):
        return False
    if len(month) != 7 or month[4] != "-":
        return False
    return month[:4].isdigit() and month[5:7].isdigit()


def _normalize_category_for_reporting(category: Any) -> str:
    """将历史分类映射到当前报表分类，数据库中的原始事实不做修改。"""
    cat = str(category or "").strip()
    return LEGACY_CATEGORY_ALIASES.get(cat, cat)


def explain_reconciliation(discrepancy: Any, tolerance: float = 100.0) -> Dict[str, Any]:
    """根据对账差额方向生成排查解释。"""
    if pd.isna(discrepancy):
        return {
            "level": "info",
            "title": "暂无连续月份基准",
            "summary": "首月或断月时不计算理论净支出和对账差额。",
            "causes": [],
            "suggestions": ["补齐上月现金快照后再进行跨月对账。"],
        }

    diff = float(discrepancy)
    abs_diff = abs(diff)
    if abs_diff < 0.01:
        return {
            "level": "success",
            "title": "账目完全对齐",
            "summary": "实际净支出与资产推导出的理论净支出一致。",
            "causes": [],
            "suggestions": [],
        }

    if abs_diff <= tolerance:
        return {
            "level": "success",
            "title": "差额可忽略",
            "summary": f"当前差额为 ¥{diff:,.2f}，在 ¥{tolerance:,.0f} 以内。",
            "causes": [],
            "suggestions": [],
        }
    else:
        level = "error"
        title = "存在需要排查的对账差额"

    if diff > 0:
        causes = [
            "流水记录的净支出高于资产变动推导值。",
            "可能存在漏记收入、现金快照偏低、支出重复记录，或代付抵扣没有正确标记。",
        ]
        suggestions = [
            "优先检查本月大额支出是否重复导入。",
            "检查收入、退款、红包、转账回款是否漏记为收入或代付。",
            "复核月底现金快照是否少填了账户余额。",
        ]
    else:
        causes = [
            "资产变动推导出的理论净支出高于流水记录。",
            "可能存在漏记消费、现金快照偏高、加仓/提现类型错误，或代付被错误抵扣。",
        ]
        suggestions = [
            "优先检查是否有现金消费、自动扣款或小额多笔消费漏记。",
            "检查加仓、提现是否被误标为普通支出或收入。",
            "复核月底现金快照是否多填了账户余额。",
        ]

    return {
        "level": level,
        "title": title,
        "summary": f"当前差额为 ¥{diff:,.2f}，方向为{'实际流水偏高' if diff > 0 else '资产推导偏高'}。",
        "causes": causes,
        "suggestions": suggestions,
    }


def _previous_months(month: str, count: int) -> List[str]:
    """返回给定月份之前的 count 个 YYYY-MM。"""
    end = pd.Period(month, freq="M")
    return [(end - i).strftime("%Y-%m") for i in range(count, 0, -1)]


def analyze_monthly_anomalies(
    month: str,
    current_tx_df: pd.DataFrame,
    windows: tuple[int, ...] = (1, 3),
    large_threshold: float = 1000.0,
    manager=None,
    category_metadata: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, pd.DataFrame]:
    """比较当前月与上月/近 3 月均值，生成历史分类差异。"""
    columns = {
        "category_changes": ["对比口径", "分类", "本月金额", "历史基准", "增减方向", "增减金额", "增减比例"],
        "new_big_items": ["商品", "分类", "金额", "判断"],
        "missing_periodic": ["对比口径", "分类", "历史出现月数", "历史基准", "判断"],
    }
    empty_result = {key: pd.DataFrame(columns=value) for key, value in columns.items()}
    if current_tx_df.empty or not _is_valid_month(month):
        return empty_result

    max_window = max(windows)
    product_lookback = 12
    history_months = _previous_months(month, max(max_window, product_lookback))
    database = manager or db
    history_rows = database.fetch_all(
        "SELECT month, type, category, product, amount FROM transactions "
        "WHERE month >= ? AND month < ? ORDER BY month, id",
        (history_months[0], month),
    )
    history_df = pd.DataFrame(history_rows) if history_rows else pd.DataFrame(
        columns=["month", "type", "category", "product", "amount"]
    )

    cur_expense = current_tx_df[current_tx_df["type"] == "支出"].copy()
    if cur_expense.empty and history_df.empty:
        return empty_result

    cur_expense["report_category"] = cur_expense["category"].fillna("").astype(str)
    cur_cat = cur_expense.groupby("report_category")["amount"].sum()

    if not history_df.empty:
        history_df = history_df[history_df["type"] == "支出"].copy()
        history_df["report_category"] = history_df["category"].fillna("").astype(str)

    change_rows = []
    periodic_missing_rows = []

    periodic_categories = {
        category for category, meta in (category_metadata or CATEGORIES_METADATA).items()
        if meta.get("type") == "支出" and meta.get("pattern") == "周期"
    }

    for window in windows:
        months = _previous_months(month, window)
        hist_window = history_df[history_df["month"].isin(months)].copy() if not history_df.empty else history_df
        if hist_window.empty:
            continue
        label = "较上月" if window == 1 else f"较近{window}月均值"

        monthly_cat = (
            hist_window
            .groupby(["month", "report_category"])["amount"]
            .sum()
            .unstack(fill_value=0)
            .reindex(months, fill_value=0)
        )
        hist_avg = monthly_cat.mean()
        categories = sorted(set(hist_avg.index) | set(cur_cat.index))

        for category in categories:
            current = float(cur_cat.get(category, 0) or 0)
            avg = float(hist_avg.get(category, 0) or 0)
            delta = current - avg
            ratio = delta / avg if avg > 0 else None
            if abs(delta) < 0.01 and current <= 0 and avg <= 0:
                continue
            change_rows.append({
                "对比口径": label,
                "分类": category,
                "本月金额": round(current, 2),
                "历史基准": round(avg, 2),
                "增减方向": "增加" if delta > 0 else "减少" if delta < 0 else "持平",
                "增减金额": round(delta, 2),
                "增减比例": "新增" if avg <= 0 and current > 0 else f"{ratio * 100:.1f}%" if ratio is not None else "0.0%",
            })

        periodic_monthly = monthly_cat[[c for c in monthly_cat.columns if c in periodic_categories]] if not monthly_cat.empty else pd.DataFrame()
        for category in periodic_monthly.columns:
            current = float(cur_cat.get(category, 0) or 0)
            appeared_months = int((periodic_monthly[category] > 0).sum())
            avg = float(periodic_monthly[category].mean())
            min_appearances = 1 if window == 1 else 2
            if current <= 0 and appeared_months >= min_appearances and avg > 0:
                periodic_missing_rows.append({
                    "对比口径": label,
                    "分类": category,
                    "历史出现月数": appeared_months,
                    "历史基准": round(avg, 2),
                    "判断": "周期项本月未出现，建议确认是否漏记或已取消",
                })

    history_products = set()
    if not history_df.empty:
        history_products = set(history_df["product"].fillna("").astype(str).str.strip())
    new_big_rows = []
    product_summary = (
        cur_expense
        .groupby(["product", "report_category"], as_index=False)["amount"]
        .sum()
        .sort_values("amount", ascending=False)
    )
    for _, row in product_summary.iterrows():
        product = str(row["product"] or "").strip()
        amount = float(row["amount"] or 0)
        if product and amount >= large_threshold and product not in history_products:
            new_big_rows.append({
                "商品": product,
                "分类": row["report_category"],
                "金额": round(amount, 2),
                "判断": f"过去 {product_lookback} 个月未出现的大额商品",
            })

    result = {
        "category_changes": pd.DataFrame(change_rows, columns=columns["category_changes"]),
        "new_big_items": pd.DataFrame(new_big_rows, columns=columns["new_big_items"]),
        "missing_periodic": pd.DataFrame(periodic_missing_rows, columns=columns["missing_periodic"]),
    }
    if not result["category_changes"].empty:
        result["category_changes"] = (
            result["category_changes"]
            .assign(_abs_delta=lambda df: df["增减金额"].abs())
            .sort_values(["对比口径", "_abs_delta"], ascending=[True, False])
            .drop(columns=["_abs_delta"])
            .reset_index(drop=True)
        )
    if not result["new_big_items"].empty:
        result["new_big_items"] = result["new_big_items"].sort_values("金额", ascending=False).reset_index(drop=True)
    return result


# ==================== 月度微观视图 ====================

def calc_monthly(
    tx_df: pd.DataFrame,
    category_metadata: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """从 transactions DataFrame 计算月度汇总"""
    if tx_df.empty:
        return {
            "category_summary": {}, "total_expense": 0, "total_income": 0,
            "total_deposit": 0, "total_withdraw": 0, "total_daifu": 0,
            "structure": {
                "necessary": 0, "controlled": 0,
                "periodic": 0, "daily": 0, "occasional": 0
            },
            "big_tickets": []
        }

    # 各分类合计 (仅统计类型为“支出”的)
    expense_mask = tx_df["type"] == "支出"
    expense_df = tx_df[expense_mask].copy()
    expense_df["report_category"] = expense_df["category"].fillna("").astype(str)
    cat_sum = expense_df.groupby("report_category")["amount"].sum().to_dict()

    # 核心对账指标
    all_out = float(tx_df[tx_df["type"] == "支出"]["amount"].sum())
    total_daifu = float(tx_df[tx_df["type"] == "代付"]["amount"].sum())

    # 用户定义：净支出 = 全部支出 - 代付
    total_expense = all_out - total_daifu

    total_income = float(tx_df[tx_df["type"] == "收入"]["amount"].sum())
    total_deposit = float(tx_df[tx_df["type"] == "加仓"]["amount"].sum())
    total_withdraw = float(tx_df[tx_df["type"] == "提现"]["amount"].sum())

    # --- 结构化分析 ---
    structure = {
        "necessary": 0.0,
        "controlled": 0.0,
        "periodic": 0.0,
        "daily": 0.0,
        "occasional": 0.0,
    }
    big_tickets = []

    metadata = category_metadata or CATEGORIES_METADATA
    for _, row in tx_df[expense_mask].iterrows():
        cat = str(row["category"] or "").strip()
        meta = metadata.get(cat, {})
        amt = float(row["amount"])

        # 统计大件
        if meta.get("is_big_ticket") or amt >= 1000:
            big_tickets.append({
                "product": row["product"], "amount": amt, "category": cat
            })

        # 归类支付形态与必要性
        pattern = meta.get("pattern", "偶尔")
        ness = meta.get("necessity", "必要")

        if ness == "必要":
            structure["necessary"] += amt
        elif ness == "可控":
            structure["controlled"] += amt

        if pattern == "周期":
            structure["periodic"] += amt
        elif pattern == "日常":
            structure["daily"] += amt
        elif pattern == "偶尔":
            structure["occasional"] += amt

    # 排序大件 (按金额倒序)
    big_tickets = sorted(big_tickets, key=lambda x: x["amount"], reverse=True)

    return {
        "category_summary": {k: round(v, 2) for k, v in cat_sum.items()},
        "all_out": round(all_out, 2),        # 全部支出
        "total_daifu": round(total_daifu, 2),
        "total_expense": round(total_expense, 2), # 净支出
        "total_income": round(total_income, 2),
        "total_deposit": round(total_deposit, 2),
        "total_withdraw": round(total_withdraw, 2),
        "structure": {k: round(v, 2) for k, v in structure.items()},
        "big_tickets": big_tickets
    }


# ==================== 借款管理 ====================

def get_active_debts(month: str, manager=None) -> List[Dict[str, Any]]:
    """
    查询某月月末仍未结清的所有借条。
    时间窗口：start_date <= 月末 且 (is_paid=0 或 paid_date > 月末)
    """
    month_end = _month_end(month)
    database = manager or db
    return database.fetch_all(
        "SELECT * FROM debt_manager "
        "WHERE REPLACE(start_date, '/', '-') <= ? "
        "AND (is_paid = 0 OR REPLACE(paid_date, '/', '-') > ?) "
        "ORDER BY start_date",
        (month_end, month_end),
    )


def calc_debt_for_month(month: str, manager=None) -> float:
    """计算某月的 debt_balance（SUM of active debts, 正=我欠, 负=欠我）"""
    active = get_active_debts(month, manager=manager)
    if not active:
        return 0.0
    return round(sum(d["amount"] for d in active), 2)


def get_all_debts() -> List[Dict[str, Any]]:
    """获取所有借款记录"""
    return db.fetch_all("SELECT * FROM debt_manager ORDER BY is_paid, start_date DESC")


def get_all_months() -> List[str]:
    """从数据库获取所有有数据的月份，返回排序后的列表"""
    months: set[str] = set()
    for table in (
        "cash_account_balances",
        "investment_account_balances",
        "transactions",
        "fixed_assets",
    ):
        rows = db.fetch_all(f"SELECT DISTINCT month FROM {table}")
        months |= {r["month"] for r in rows}
    rows = db.fetch_all("SELECT month FROM month_status")
    months |= {r["month"] for r in rows}
    valid_months = sorted(m for m in months if _is_valid_month(m))
    invalid_months = sorted(str(m) for m in months if not _is_valid_month(m))
    if invalid_months:
        logger.warning(f"已忽略非法月份值: {invalid_months}")
    return valid_months


def get_next_month(month: str) -> str:
    """给定 YYYY-MM，返回下一个月"""
    if not month or not _is_valid_month(month):
        from datetime import datetime
        return datetime.now().strftime("%Y-%m")
    y, m = int(month[:4]), int(month[5:7])
    if m == 12:
        return f"{y + 1}-01"
    return f"{y}-{m + 1:02d}"


def add_debt(description: str, counterparty: str, amount: float,
             start_date: str) -> int:
    """添加一笔新借款"""
    return db.execute(
        "INSERT INTO debt_manager (description, counterparty, amount, start_date) "
        "VALUES (?, ?, ?, ?)",
        (description, counterparty, amount, start_date),
    )


def update_debt(debt_id: int, **kwargs) -> None:
    """更新借款记录"""
    allowed = {"description", "counterparty", "amount", "start_date",
               "is_paid", "paid_date"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    params = tuple(fields.values()) + (debt_id,)
    db.execute(f"UPDATE debt_manager SET {set_clause} WHERE id = ?", params)


def delete_debt(debt_id: int) -> None:
    """删除借款记录"""
    db.execute("DELETE FROM debt_manager WHERE id = ?", (debt_id,))


# ==================== 年度宏观视图 ====================

def build_annual_df(
    months: List[str],
    snap_data: Dict[str, dict],
    inv_data: Dict[str, dict],
    tx_monthly: Dict[str, dict],
    manager=None,
) -> pd.DataFrame:
    """
    从三张表的数据构建年度 DataFrame，使用 shift(1) 做跨月递推。
    借条余额从 debt_manager 动态查询（时间窗口判定）。

    参数:
        months:     月份列表 ['2026-01', '2026-02', ...]
        snap_data:  {month: asset_snapshot_dict}
        inv_data:   {month: investment_dict}
        tx_monthly: {month: calc_monthly() result}
    """
    rows = []
    for m in months:
        snap = snap_data.get(m, {})
        inv = inv_data.get(m, {})
        tx = tx_monthly.get(m, {})

        cash = _sum_cash(snap)
        inv_position = (inv.get("market_value", 0) or 0) + (inv.get("cash_balance", 0) or 0)
        # 从 debt_manager 动态查询该月生效的借条总额
        # Keep the legacy call shape when no repository is injected. This also
        # preserves compatibility with callers/tests that monkeypatch the
        # original one-argument helper.
        debt = calc_debt_for_month(m) if manager is None else calc_debt_for_month(m, manager=manager)
        # 总资产 = 现金 - debt + principal
        # debt 正=我欠别人(负债), 负=别人欠我(资产)
        total_assets = cash - debt + (inv.get("principal", 0) or 0)

        principal = inv.get("principal", 0) or 0
        inv_profit = inv_position - principal
        inv_roi = (inv_profit / principal * 100) if principal > 0 else 0.0
        # 仓位 = 持仓市值 / (持仓市值 + 流动资金)
        inv_weight = ((inv.get("market_value", 0) or 0) / inv_position * 100) if inv_position > 0 else 0.0

        struct = tx.get("structure", {})

        rows.append({
            "month": m,
            "cash": round(cash, 2),
            "debt": round(debt, 2),
            "principal": round(principal, 2),
            "inv_position": round(inv_position, 2),
            "total_assets": round(total_assets, 2),
            "inv_profit": round(inv_profit, 2),
            "inv_roi": round(inv_roi, 2),
            "inv_weight": round(inv_weight, 2),
            "total_income": tx.get("total_income", 0),
            "total_expense": tx.get("total_expense", 0), # 这里的 total_expense 已经是 (支出 - 代付) 了
            "total_deposit": tx.get("total_deposit", 0),
            "total_withdraw": tx.get("total_withdraw", 0),
            "all_out": tx.get("all_out", 0),
            "total_daifu": tx.get("total_daifu", 0),
            # 结构化字段
            "necessary": struct.get("necessary", 0),
            "controlled": struct.get("controlled", 0),
            "periodic": struct.get("periodic", 0),
            "daily": struct.get("daily", 0),
            "occasional": struct.get("occasional", 0),
        })

    df = pd.DataFrame(rows)

    if df.empty:
        return df

    # 收入不大于 0 时，储蓄率没有可解释的分母，保留为空而不是误显示为 0%。
    df["savings_rate"] = (
        (df["total_income"] - df["total_expense"])
        / df["total_income"]
        * 100
    ).where(df["total_income"] > 0)

    # --- 改进：确保跨月递推的逻辑严密性 ---
    # 只有当上一行确实是当前行的“前一个月”时，计算 delta 才有效
    df["prev_month_valid"] = (pd.to_datetime(df["month"]) - pd.to_timedelta(1, unit="D")).dt.strftime("%Y-%m") == df["month"].shift(1)

    # 跨月递推 (仅在连续月份时计算，否则设为 NaN)
    df["cash_delta"] = (df["cash"] - df["cash"].shift(1)).where(df["prev_month_valid"])
    df["asset_delta"] = (df["total_assets"] - df["total_assets"].shift(1)).where(df["prev_month_valid"])
    df["inv_profit_delta"] = (df["inv_profit"] - df["inv_profit"].shift(1)).where(df["prev_month_valid"])

    # 终极对账（基于 debt_manager 的借款变动）
    df["debt_change"] = (df["debt"] - df["debt"].shift(1)).where(df["prev_month_valid"])

    # 理论净流出计算：只有连续月份才有理论值
    df["theoretical_expense"] = (
        df["cash"].shift(1) + df["total_income"] + df["debt_change"] - df["cash"]
        - df["total_deposit"] + df["total_withdraw"]
    ).where(df["prev_month_valid"])

    # 少算差额
    df["discrepancy"] = (df["total_expense"] - df["theoretical_expense"]).where(df["prev_month_valid"])

    return df.round(2)


# ==================== 从数据库读取历史数据 ====================

def load_history(month_or_year: str) -> tuple:
    """
    加载历史数据。
    - 如果传入 YYYY (4位): 加载该自然年的所有数据。
    - 如果传入 YYYY-MM (7位): 加载以此月为终点的过去 13 个月数据（含上月用于对账）。
    返回 (months, snap_data, inv_data, tx_monthly)
    """
    from datetime import datetime
    from dateutil.relativedelta import relativedelta

    if len(month_or_year) == 4:
        # --- 自然年模式 ---
        year = month_or_year
        start_month = f"{year}-01"
        end_month = f"{year}-12"
        # 跨年对账需要上一年 12 月
        prev_year_dec = f"{int(year)-1}-12"

        snapshots = db.fetch_all(
            "SELECT month, SUM(balance) AS cash_total "
            "FROM cash_account_balances "
            "WHERE (month >= ? AND month <= ?) OR month = ? "
            "GROUP BY month ORDER BY month",
            (start_month, end_month, prev_year_dec)
        )
        investments = db.fetch_all(
            "SELECT month, SUM(principal) AS principal, "
            "SUM(market_value) AS market_value, "
            "SUM(cash_balance) AS cash_balance "
            "FROM investment_account_balances "
            "WHERE (month >= ? AND month <= ?) OR month = ? "
            "GROUP BY month ORDER BY month",
            (start_month, end_month, prev_year_dec)
        )
        transactions = db.fetch_all(
            "SELECT * FROM transactions WHERE month >= ? AND month <= ? ORDER BY month, id",
            (prev_year_dec, end_month)
        )
    else:
        # --- 滚动 12 个月模式 ---
        try:
            end_dt = datetime.strptime(month_or_year, "%Y-%m")
        except (ValueError, TypeError):
            end_dt = datetime.now()

        start_dt = end_dt - relativedelta(months=12)
        start_month = start_dt.strftime("%Y-%m")
        end_month = end_dt.strftime("%Y-%m")

        snapshots = db.fetch_all(
            "SELECT month, SUM(balance) AS cash_total "
            "FROM cash_account_balances "
            "WHERE month >= ? AND month <= ? "
            "GROUP BY month ORDER BY month",
            (start_month, end_month)
        )
        investments = db.fetch_all(
            "SELECT month, SUM(principal) AS principal, "
            "SUM(market_value) AS market_value, "
            "SUM(cash_balance) AS cash_balance "
            "FROM investment_account_balances "
            "WHERE month >= ? AND month <= ? "
            "GROUP BY month ORDER BY month",
            (start_month, end_month)
        )
        transactions = db.fetch_all(
            "SELECT * FROM transactions WHERE month >= ? AND month <= ? ORDER BY month, id",
            (start_month, end_month)
        )

    snap_data = {s["month"]: s for s in snapshots}
    inv_data = {i["month"]: i for i in investments}
    tx_df = pd.DataFrame(transactions) if transactions else pd.DataFrame()

    tx_monthly = {}
    if not tx_df.empty:
        for m, group in tx_df.groupby("month"):
            tx_monthly[m] = calc_monthly(group.drop(columns=["month"]))

    months = sorted(set(list(snap_data.keys()) + list(tx_monthly.keys())))
    return months, snap_data, inv_data, tx_monthly
