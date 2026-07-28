import io
import hashlib
import json
from pathlib import Path
from typing import Any

import pandas as pd
from loguru import logger

SIMPLE_REQUIRED_COLUMNS = {"商品", "收支", "金额"}
OPTIONAL_COLUMNS = {"日期", "分类"}
ALLOWED_TYPES = {"支出", "收入", "代付", "加仓", "提现"}
IGNORED_TYPE = "忽略"

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


def _read_csv(file_bytes: bytes) -> pd.DataFrame:
    content = _decode_csv(file_bytes)
    try:
        return pd.read_csv(io.StringIO(content), sep=None, engine="python")
    except Exception:
        return pd.read_csv(io.StringIO(content))


def _string_value(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def inspect_bill(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """Inspect a CSV without writing data and return mapping-friendly metadata."""

    if Path(filename).suffix.lower() != ".csv":
        raise ValueError("当前导入入口只支持 CSV 文件")
    frame = _clean_columns(_read_csv(file_bytes))
    headers = [str(column) for column in frame.columns]
    if not headers:
        raise ValueError("CSV 没有可识别的表头")
    signature = hashlib.sha256(
        json.dumps(headers, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    sample = [
        {header: _string_value(row.get(header)) for header in headers}
        for row in frame.head(8).to_dict(orient="records")
    ]
    distinct_values: dict[str, list[str]] = {}
    for header in headers:
        values: list[str] = []
        for raw in frame[header].tolist():
            value = _string_value(raw)
            if value and value not in values:
                values.append(value)
            if len(values) >= 30:
                break
        distinct_values[header] = values

    aliases = {
        "date_column": ("日期", "交易时间", "时间", "创建时间", "付款时间"),
        "product_column": (
            "商品", "商品说明", "商品/说明", "商品名称", "交易对方", "备注",
        ),
        "amount_column": ("金额", "金额(元)", "交易金额", "交易金额(元)"),
        "type_column": ("收支", "收/支", "类型", "资金流向"),
        "category_column": ("分类", "交易分类"),
        "status_column": ("交易状态", "状态"),
    }
    suggested: dict[str, str] = {}
    for field, candidates in aliases.items():
        match = next((candidate for candidate in candidates if candidate in headers), "")
        if match:
            suggested[field] = match
    if SIMPLE_REQUIRED_COLUMNS.issubset(headers) and "date_column" not in suggested:
        suggested["date_column"] = "__month_start__"
    return {
        "filename": filename,
        "headers": headers,
        "header_signature": signature,
        "row_count": int(len(frame)),
        "sample_rows": sample,
        "distinct_values": distinct_values,
        "suggested_mapping": suggested,
    }


def parse_mapped_bill(
    file_bytes: bytes,
    filename: str,
    *,
    month: str,
    mapping: dict[str, Any],
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Parse a user-mapped CSV into current-month draft rows without deduplication."""

    if Path(filename).suffix.lower() != ".csv":
        raise ValueError("当前导入入口只支持 CSV 文件")
    frame = _clean_columns(_read_csv(file_bytes))
    required = {
        "date_column": "日期/时间",
        "product_column": "商品或说明",
        "amount_column": "金额",
        "type_column": "收支方向",
    }
    for field, label in required.items():
        selected = str(mapping.get(field) or "").strip()
        if (
            not selected
            or (
                field != "date_column"
                and selected not in frame.columns
            )
            or (
                field == "date_column"
                and selected != "__month_start__"
                and selected not in frame.columns
            )
        ):
            raise ValueError(f"请选择有效的{label}列")

    category_column = str(mapping.get("category_column") or "").strip()
    status_column = str(mapping.get("status_column") or "").strip()
    if category_column and category_column not in frame.columns:
        raise ValueError("选择的分类列不存在")
    if status_column and status_column not in frame.columns:
        raise ValueError("选择的交易状态列不存在")

    type_values = {
        str(key).strip(): str(value or "").strip()
        for key, value in dict(mapping.get("type_values") or {}).items()
    }
    included_statuses = {
        str(value).strip() for value in mapping.get("included_statuses") or []
    }
    rows: list[dict[str, Any]] = []
    examples: dict[str, list[dict[str, Any]]] = {
        "outside_month": [],
        "status_filtered": [],
        "invalid": [],
        "ignored_type": [],
    }
    counts = {key: 0 for key in examples}

    date_column = str(mapping["date_column"])
    product_column = str(mapping["product_column"])
    amount_column = str(mapping["amount_column"])
    type_column = str(mapping["type_column"])

    for source_index, source in frame.iterrows():
        raw_status = _string_value(source.get(status_column)) if status_column else ""
        if status_column and raw_status not in included_statuses:
            counts["status_filtered"] += 1
            if len(examples["status_filtered"]) < 3:
                examples["status_filtered"].append(
                    {"row": int(source_index) + 2, "status": raw_status}
                )
            continue

        raw_type = _string_value(source.get(type_column))
        transaction_type = type_values.get(raw_type, "")
        if transaction_type == IGNORED_TYPE:
            counts["ignored_type"] += 1
            if len(examples["ignored_type"]) < 3:
                examples["ignored_type"].append(
                    {"row": int(source_index) + 2, "value": raw_type}
                )
            continue
        if transaction_type not in ALLOWED_TYPES:
            counts["invalid"] += 1
            if len(examples["invalid"]) < 3:
                examples["invalid"].append(
                    {
                        "row": int(source_index) + 2,
                        "reason": f"收支值“{raw_type}”尚未映射",
                    }
                )
            continue

        raw_date = (
            f"{month}-01"
            if date_column == "__month_start__"
            else _string_value(source.get(date_column))
        )
        try:
            normalized_date = pd.Timestamp(raw_date).date().isoformat()
        except (TypeError, ValueError):
            counts["invalid"] += 1
            if len(examples["invalid"]) < 3:
                examples["invalid"].append(
                    {"row": int(source_index) + 2, "reason": f"日期无法识别：{raw_date}"}
                )
            continue
        if normalized_date[:7] != month:
            counts["outside_month"] += 1
            if len(examples["outside_month"]) < 3:
                examples["outside_month"].append(
                    {"row": int(source_index) + 2, "date": normalized_date}
                )
            continue

        product = _string_value(source.get(product_column))
        amount_text = (
            _string_value(source.get(amount_column))
            .replace("¥", "")
            .replace("￥", "")
            .replace(",", "")
            .replace("元", "")
        )
        amount = pd.to_numeric(pd.Series([amount_text]), errors="coerce").iloc[0]
        if not product or pd.isna(amount) or float(amount) == 0:
            counts["invalid"] += 1
            if len(examples["invalid"]) < 3:
                examples["invalid"].append(
                    {
                        "row": int(source_index) + 2,
                        "reason": "商品为空或金额无法识别",
                    }
                )
            continue

        category = (
            _string_value(source.get(category_column)) if category_column else ""
        )
        if transaction_type in {"代付", "加仓", "提现"}:
            category = ""
        rows.append(
            {
                "transaction_date": normalized_date,
                "product": product,
                "amount": abs(float(amount)),
                "type": transaction_type,
                "category_key": None,
                "category": category,
            }
        )

    result = pd.DataFrame(
        rows,
        columns=[
            "transaction_date", "product", "amount", "type",
            "category_key", "category",
        ],
    )
    return result, {
        "source_rows": int(len(frame)),
        "accepted_rows": int(len(result)),
        "filtered": counts,
        "examples": examples,
    }


def parse_bill(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """读取 3–5 列 CSV，并输出未写库的流水草稿。"""
    suffix = Path(filename).suffix.lower()
    if suffix != ".csv":
        raise ValueError(
            "当前工作流只支持整理后的 CSV 文件，请上传包含“商品、收支、金额”"
            "并可选“日期、分类”列的 CSV"
        )

    df_raw = _read_csv(file_bytes)
    df = _normalize_simple_csv(df_raw)
    logger.info(f"识别到简化 CSV，解析完成: 共 {len(df)} 条记录")
    return df
