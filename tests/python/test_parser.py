import pytest

from assettrack.domain.parser import inspect_bill, parse_bill, parse_mapped_bill


def test_parse_simple_csv_groups_duplicate_product_and_type():
    content = "商品,收支,金额\n食堂,支出,10\n食堂,支出,15\n工资,收入,\"1,000\"\n"

    df = parse_bill(content.encode("utf-8"), "bill.csv")

    food = df[(df["product"] == "食堂") & (df["type"] == "支出")].iloc[0]
    salary = df[(df["product"] == "工资") & (df["type"] == "收入")].iloc[0]
    assert food["amount"] == 25
    assert salary["amount"] == 1000
    assert food["category"] == ""
    assert food["transaction_date"] == ""


def test_parse_simple_csv_accepts_optional_date_column():
    content = "商品,收支,金额,日期\n午餐,支出,12,2026-01-02\n午餐,支出,8,2026-01-03\n"

    df = parse_bill(content.encode("utf-8"), "bill.csv")

    assert len(df) == 2
    assert df["transaction_date"].tolist() == ["2026-01-02", "2026-01-03"]
    assert df["amount"].tolist() == [12, 8]


def test_parse_simple_csv_keeps_optional_category_column():
    content = "商品,收支,金额,日期,分类\n午餐,支出,12,2026-01-02,餐饮基础\n"

    df = parse_bill(content.encode("utf-8"), "bill.csv")

    assert df.iloc[0]["transaction_date"] == "2026-01-02"
    assert df.iloc[0]["category"] == "餐饮基础"


def test_parse_simple_csv_rejects_invalid_type():
    content = "商品,收支,金额\n测试,转账,10\n"

    with pytest.raises(ValueError, match="收支类型仅支持"):
        parse_bill(content.encode("utf-8"), "bill.csv")


def test_parse_simple_csv_rejects_non_csv_file():
    content = "商品,收支,金额\n测试,支出,10\n"

    with pytest.raises(ValueError, match="只支持整理后的 CSV"):
        parse_bill(content.encode("utf-8"), "bill.xlsx")


def test_inspect_and_map_generic_csv_without_deduplication():
    content = (
        "交易时间,交易对方,交易金额,资金流向,交易状态\n"
        "2026-01-02 09:00,咖啡店,¥12.50,付款,成功\n"
        "2026-01-02 09:00,咖啡店,¥12.50,付款,成功\n"
        "2026-02-01 09:00,跨月记录,20,付款,成功\n"
        "2026-01-03 09:00,失败记录,30,付款,失败\n"
    )
    inspected = inspect_bill(content.encode("utf-8"), "generic.csv")
    assert inspected["row_count"] == 4
    assert inspected["suggested_mapping"]["date_column"] == "交易时间"
    assert inspected["distinct_values"]["资金流向"] == ["付款"]

    frame, stats = parse_mapped_bill(
        content.encode("utf-8"),
        "generic.csv",
        month="2026-01",
        mapping={
            "date_column": "交易时间",
            "product_column": "交易对方",
            "amount_column": "交易金额",
            "type_column": "资金流向",
            "status_column": "交易状态",
            "type_values": {"付款": "支出"},
            "included_statuses": ["成功"],
        },
    )

    assert len(frame) == 2
    assert frame["product"].tolist() == ["咖啡店", "咖啡店"]
    assert frame["amount"].tolist() == [12.5, 12.5]
    assert stats["filtered"]["outside_month"] == 1
    assert stats["filtered"]["status_filtered"] == 1


def test_generic_mapping_can_ignore_direction_values():
    content = (
        "日期,说明,金额,方向\n"
        "2026-01-01,消费,10,支\n"
        "2026-01-02,不计,20,其他\n"
    )
    frame, stats = parse_mapped_bill(
        content.encode("gbk"),
        "generic.csv",
        month="2026-01",
        mapping={
            "date_column": "日期",
            "product_column": "说明",
            "amount_column": "金额",
            "type_column": "方向",
            "type_values": {"支": "支出", "其他": "忽略"},
        },
    )
    assert len(frame) == 1
    assert stats["filtered"]["ignored_type"] == 1
