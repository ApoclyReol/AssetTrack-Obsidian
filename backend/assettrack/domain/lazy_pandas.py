"""Load pandas only when a calculation, validation, import, or backup needs it."""

from __future__ import annotations

import importlib
from typing import Any


class _LazyPandas:
    def __getattr__(self, name: str) -> Any:
        module = importlib.import_module("pandas")
        globals()["pd"] = module
        return getattr(module, name)


pd: Any = _LazyPandas()
