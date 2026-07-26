"""Deterministic revision for diagnostics and backup provenance."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from assettrack.infrastructure.sqlite_manager import REQUIRED_TABLES


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if hasattr(value, "item"):
        try:
            return _json_safe(value.item())
        except (TypeError, ValueError):
            pass
    return value


def source_revision(repository) -> str:
    payload: dict[str, Any] = {
        "schema_version": repository.db.validate_schema()["schema_version"],
        "tables": {},
    }
    with repository.db.get_connection() as connection:
        for table in REQUIRED_TABLES:
            columns = [
                str(row["name"])
                for row in connection.execute(f"PRAGMA table_info({table})")
            ]
            order = "id" if "id" in columns else columns[0]
            rows = connection.execute(
                f"SELECT {', '.join(columns)} FROM {table} ORDER BY {order}"
            )
            payload["tables"][table] = [
                [_json_safe(row[column]) for column in columns] for row in rows
            ]
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(encoded).hexdigest()
