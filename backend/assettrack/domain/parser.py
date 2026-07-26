import io
from pathlib import Path

import pandas as pd
from loguru import logger

SIMPLE_REQUIRED_COLUMNS = {"商品", "收支", "金额"}
OPTIONAL_COLUMNS = {"日期", "分类"}
ALLOWED_TYPES = {"支出", "收入", "代付", "加仓", "提现"}

TYPE_MAP = {
    "支出": "支出",
    "收入": "收入",
    "代付": "代付",
    "加仓": "加仓",
    "提现": "提现",
}


def _clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    """清理表头空白和尾部空列。"""
    cleaned = df.copy()
    cleaned.columns = [str(col).strip().replace("\ufeff", "") for col in cleaned.columns]
    cleaned = cleaned.loc[:, ~cleaned.columns.str.startswith("Unnamed:")]
    return cleaned


def _normalize_simple_csv(df: pd.DataFrame) -> pd.DataFrame:
    """用户手工整理的 3–5 列 CSV：必需商品、收支、金额，可选日期、分类。"""
    df = _clean_columns(df)
    normalized_columns = {
        "商品/说明": "商品",
        "商品说明": "商品",
        "类型": "收支",
        "收/支": "收支",
    }
    df = df.rename(columns={k: v for k, v in normalized_columns.items() if k in df.columns})
    missing = SIMPLE_REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"简化 CSV 缺少必要列: {', '.join(sorted(missing))}")

    product_series = df["商品"].fillna("").astype(str).str.strip()
    amount_series = pd.to_numeric(
        df["金额"].astype(str)
        .str.replace("¥", "", regex=False)
        .str.replace(",", "", regex=False)
        .str.strip(),
        errors="coerce",
    )
    active_mask = product_series.ne("") | amount_series.notna()
    invalid_amount_mask = active_mask & amount_series.isna()
    if invalid_amount_mask.any():
        bad_rows = [str(i + 2) for i in df.index[invalid_amount_mask].tolist()]
        raise ValueError(f"简化 CSV 金额无法识别，问题行: {', '.join(bad_rows)}")

    df = df[active_mask].copy()
    product_series = product_series[active_mask]
    amount_series = amount_series[active_mask]

    result = pd.DataFrame(index=df.index)
    result["product"] = product_series
    result["amount"] = amount_series.abs()
    raw_type_series = df["收支"].fillna("").astype(str).str.strip()
    invalid_type_mask = ~raw_type_series.isin(ALLOWED_TYPES)
    if invalid_type_mask.any():
        bad_values = sorted(set(raw_type_series[invalid_type_mask].tolist()))
        bad_rows = [str(i + 2) for i in df.index[invalid_type_mask].tolist()]
        raise ValueError(
            f"简化 CSV 收支类型仅支持 {', '.join(sorted(ALLOWED_TYPES))}；"
            f"发现无效类型 {bad_values}，问题行: {', '.join(bad_rows)}"
        )
    result["type"] = raw_type_series.map(TYPE_MAP)
    result["transaction_date"] = (
        df["日期"].fillna("").astype(str).str.strip()
        if "日期" in df.columns
        else ""
    )
    result["category"] = (
        df["分类"].fillna("").astype(str).str.strip()
        if "分类" in df.columns
        else ""
    )
    result["category_key"] = None
    result = result.reset_index(drop=True)

    if not (OPTIONAL_COLUMNS & set(df.columns)):
        return (
            result.groupby(["product", "type"], as_index=False, sort=False)
            .agg(amount=("amount", "sum"))
            .assign(
                transaction_date="",
                category="",
                category_key=None,
            )
            [[
                "transaction_date", "product", "amount", "type",
                "category_key", "category",
            ]]
        )
    return result[[
        "transaction_date", "product", "amount", "type",
        "category_key", "category",
    ]]


def _decode_csv(file_bytes: bytes) -> str:
    """尝试 UTF-8 和 GBK 编码解码 CSV。"""
    for enc in ("utf-8-sig", "gbk", "gb2312", "utf-8"):
        try:
            return file_bytes.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return file_bytes.decode("utf-8", errors="replace")


def parse_bill(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """读取 3–5 列 CSV，并输出未写库的流水草稿。"""
    suffix = Path(filename).suffix.lower()
    if suffix != ".csv":
        raise ValueError(
            "当前工作流只支持整理后的 CSV 文件，请上传包含“商品、收支、金额”"
            "并可选“日期、分类”列的 CSV"
        )

    content = _decode_csv(file_bytes)
    df_raw = pd.read_csv(io.StringIO(content))
    df = _normalize_simple_csv(df_raw)
    logger.info(f"识别到简化 CSV，解析完成: 共 {len(df)} 条记录")
    return df
