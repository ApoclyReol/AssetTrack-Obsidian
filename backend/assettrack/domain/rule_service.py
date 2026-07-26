"""Shared normalization and validation helpers for deterministic rules."""

from __future__ import annotations

import unicodedata

import pandas as pd
from loguru import logger

from assettrack.infrastructure.config import CATEGORIES_METADATA


RULE_TRANSACTION_TYPES = ("支出", "收入")


def normalize_product_key(value: object) -> str:
    """Return a conservative key: NFKC, case-folded, without spaces/punctuation."""

    text = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
    return "".join(
        character
        for character in text
        if not character.isspace()
        and not unicodedata.category(character).startswith("P")
    )


def infer_rule_transaction_type(category: object) -> str:
    category_text = str(category or "").strip()
    if category_text == "收入":  # legacy category
        return "收入"
    metadata = CATEGORIES_METADATA.get(category_text, {})
    return "收入" if metadata.get("type") == "收入" else "支出"


def category_matches_transaction_type(category: object, transaction_type: object) -> bool:
    category_text = str(category or "").strip()
    type_text = str(transaction_type or "").strip()
    if category_text == "收入":
        return type_text == "收入"
    return CATEGORIES_METADATA.get(category_text, {}).get("type") == type_text


def apply_auto_rules(df: pd.DataFrame, *, database) -> pd.DataFrame:
    """Apply deterministic type + normalized-product rules to a draft frame."""

    rules = database.fetch_all(
        "SELECT transaction_type, product, category FROM auto_rules"
    )
    mapping = {
        (
            str(rule.get("transaction_type") or "支出").strip(),
            normalize_product_key(rule.get("product")),
        ): rule["category"]
        for rule in rules
        if normalize_product_key(rule.get("product"))
    }
    if not mapping or df.empty:
        return df
    categories = pd.Series(
        [
            mapping.get((str(row_type).strip(), normalize_product_key(product)))
            for row_type, product in zip(df["type"], df["product"])
        ],
        index=df.index,
        dtype="object",
    )
    hits = categories.notna()
    if hits.any():
        df.loc[hits, "category"] = categories[hits]
        logger.info("商品分类规则命中 {} 条", int(hits.sum()))
    return df
