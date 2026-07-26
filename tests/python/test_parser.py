import pytest

from assettrack.domain.parser import parse_bill


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
