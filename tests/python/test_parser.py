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


def test_parse_simple_csv_rejects_invalid_type():
    content = "商品,收支,金额\n测试,转账,10\n"

    with pytest.raises(ValueError, match="收支类型仅支持"):
        parse_bill(content.encode("utf-8"), "bill.csv")


def test_parse_simple_csv_rejects_non_csv_file():
    content = "商品,收支,金额\n测试,支出,10\n"

    with pytest.raises(ValueError, match="只支持整理后的 CSV"):
        parse_bill(content.encode("utf-8"), "bill.xlsx")
