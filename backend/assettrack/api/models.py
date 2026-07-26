from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class APIModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class TransactionRow(APIModel):
    id: int | None = None
    client_id: str | None = None
    transaction_date: str = ""
    type: str = ""
    category_key: str | None = None
    category: str = ""
    product: str = ""
    amount: float = 0.0


class TransactionsSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    rows: list[TransactionRow] = Field(default_factory=list)


class SnapshotSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    boc_balance: float = 0.0
    ccb_balance: float = 0.0
    alipay_balance: float = 0.0
    wechat_balance: float = 0.0


class InvestmentSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    principal: float = 0.0
    market_value: float = 0.0
    cash_balance: float = 0.0


class FixedAssetRow(APIModel):
    id: int | None = None
    client_id: str | None = None
    asset_key: str | None = None
    asset_name: str
    category: str = ""
    purchase_date: str | None = None
    purchase_price: float = Field(default=0.0, ge=0)
    status: str = "在用"
    note: str = ""


class FixedAssetsSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    rows: list[FixedAssetRow] = Field(default_factory=list)


class CashAccountBalanceRow(APIModel):
    account_key: str
    balance: float = Field(default=0.0, ge=0)


class InvestmentAccountBalanceRow(APIModel):
    account_key: str
    principal: float = 0.0
    market_value: float = 0.0
    cash_balance: float = 0.0


class MonthWorkspaceSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    cash_accounts: list[CashAccountBalanceRow] = Field(default_factory=list)
    investment_accounts: list[InvestmentAccountBalanceRow] = Field(
        default_factory=list
    )
    transactions: list[TransactionRow] = Field(default_factory=list)
    fixed_assets: list[FixedAssetRow] = Field(default_factory=list)


class MonthDeleteRequest(APIModel):
    expected_revision: int = Field(ge=0)
    confirm_month: str = Field(min_length=7, max_length=7)


class DebtRow(APIModel):
    id: int | None = None
    description: str = ""
    counterparty: str = ""
    amount: float = 0.0
    start_date: str = ""
    is_paid: bool = False
    paid_date: str | None = None


class DebtsSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    rows: list[DebtRow] = Field(default_factory=list)


class RuleRow(APIModel):
    id: int | None = None
    transaction_type: str = ""
    product: str
    category_key: str | None = None
    category: str


class RulesSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    rows: list[RuleRow] = Field(default_factory=list)


class CategoryDefinitionRow(APIModel):
    category_key: str
    name: str
    transaction_type: str
    necessity: str = "不适用"
    pattern: str = "不适用"
    is_big_ticket: bool = False
    color: str = "#6c5ce7"
    is_active: bool = True
    sort_order: int = 0


class CategoryDefinitionsSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    rows: list[CategoryDefinitionRow] = Field(default_factory=list)


class AccountDefinitionRow(APIModel):
    account_key: str
    name: str
    account_type: str
    is_active: bool = True
    sort_order: int = 0


class AccountDefinitionsSaveRequest(APIModel):
    expected_revision: int = Field(ge=0)
    rows: list[AccountDefinitionRow] = Field(default_factory=list)


class BackupImportRequest(APIModel):
    path: str = Field(min_length=1)


class BackupExportRequest(APIModel):
    path: str | None = Field(default=None, min_length=1)


class TransactionPreviewRequest(APIModel):
    rows: list[TransactionRow] = Field(default_factory=list)
    only_unclassified: bool = False


class CsvImportRequest(APIModel):
    filename: str = "transactions.csv"
    content_base64: str = Field(min_length=1)


class RevisionResponse(APIModel):
    revision: int


class APIError(APIModel):
    detail: str


def model_rows(rows: list[APIModel]) -> list[dict[str, Any]]:
    return [row.model_dump(exclude_none=True) for row in rows]
