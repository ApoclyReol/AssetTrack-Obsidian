import base64
import json
from pathlib import Path

from fastapi.testclient import TestClient

from assettrack.api.app import create_app
from assettrack.infrastructure.sqlite_manager import SqliteManager
from assettrack.infrastructure.runtime_paths import resolve_runtime_paths
from assettrack.domain.calculator import calc_debt_for_month


def _client(tmp_path: Path, *, token: str | None = None, monkeypatch=None):
    if monkeypatch is not None:
        monkeypatch.setenv("ASSET_TRACK_DATA_DIR", str(tmp_path / "runtime"))
    manager = SqliteManager(str(tmp_path / "accounting_system.db"))
    app = create_app(
        manager=manager,
        frontend_dir=tmp_path / "no-web",
        bootstrap_token=token,
        require_bootstrap=token is not None,
    )
    return app, TestClient(app)


def test_obsidian_runtime_keeps_database_and_manual_backups_under_workspace(
    tmp_path, monkeypatch
):
    workspace = tmp_path / "Asset_Track"
    database = workspace / "data" / "accounting_system.db"
    monkeypatch.setenv("ASSET_TRACK_DATA_DIR", str(workspace))
    monkeypatch.setenv("ASSET_TRACK_DB_PATH", str(database))

    paths = resolve_runtime_paths()

    assert paths.db_path == database
    assert paths.data_dir == workspace / "data"
    assert paths.backup_dir == workspace / "backup"
    assert paths.log_dir == workspace / "logs"


def test_sidecar_health_and_month_revision_contract(tmp_path, monkeypatch):
    app, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        assert client.get("/health/live").status_code == 200
        ready = client.get("/health/ready")
        assert ready.json()["status"] == "ready"
        assert "default-src 'self'" in ready.headers["content-security-policy"]
        policy = client.get("/api/v1/months").json()
        assert policy["months"] == []
        assert policy["can_create"] is True
        assert policy["next_target"] == "2026-07"

        response = client.put(
            "/api/v1/months/2026-01/transactions",
            json={
                "expected_revision": 0,
                "rows": [
                    {
                        "client_id": "draft-1",
                        "type": "支出",
                        "category": "餐饮基础",
                        "product": "午餐",
                        "amount": 32,
                    }
                ],
            },
        )
        assert response.status_code == 200
        assert response.json()["revision"] == 1
        row_id = response.json()["rows"][0]["id"]

        conflict = client.put(
            "/api/v1/months/2026-01/transactions",
            json={"expected_revision": 0, "rows": []},
        )
        assert conflict.status_code == 409

        saved = client.get("/api/v1/months/2026-01").json()
        assert saved["revision"] == 1
        assert saved["transactions"][0]["id"] == row_id


def test_bootstrap_reuses_existing_session_and_locked_month_is_v1_editable(tmp_path, monkeypatch):
    app, client = _client(tmp_path, token="secret-bootstrap-token", monkeypatch=monkeypatch)
    with client:
        assert client.get("/api/v1/meta").status_code == 401
        first = client.get(
            "/bootstrap", headers={"X-AssetTrack-Bootstrap": "secret-bootstrap-token"}
        )
        assert first.status_code == 200
        assert client.get("/api/v1/meta").status_code == 200
        second = client.get(
            "/bootstrap", headers={"X-AssetTrack-Bootstrap": "secret-bootstrap-token"}
        )
        assert second.status_code == 200

        unauthenticated = TestClient(app)
        replay = unauthenticated.get(
            "/bootstrap", headers={"X-AssetTrack-Bootstrap": "secret-bootstrap-token"}
        )
        assert replay.status_code == 401

        app.state.repository.db.execute(
            "INSERT INTO month_status "
            "(month,status,fixed_assets_initialized,revision) VALUES (?,?,?,?)",
            ("2026-02", "saved", 1, 0),
        )
        app.state.repository.db.execute(
            "UPDATE month_status SET status='locked', revision=1 "
            "WHERE month='2026-02'"
        )
        saved = client.put(
            "/api/v1/months/2026-02/fixed-assets",
            json={
                "expected_revision": 1,
                "rows": [],
            },
        )
        assert saved.status_code == 200
        assert client.get("/api/v1/months/2026-02").json()["status"] == "saved"


def test_header_session_supports_obsidian_plugin_requests(tmp_path, monkeypatch):
    app, client = _client(tmp_path, token="plugin-bootstrap", monkeypatch=monkeypatch)
    with client:
        created = client.post(
            "/api/v1/session",
            headers={"X-AssetTrack-Bootstrap": "plugin-bootstrap"},
        )
        assert created.status_code == 200
        session = created.json()["session"]
        assert client.get(
            "/api/v1/meta", headers={"X-AssetTrack-Session": session}
        ).status_code == 200
        assert "llm" not in client.get(
            "/api/v1/meta", headers={"X-AssetTrack-Session": session}
        ).json()


def test_fixed_asset_write_preserves_cross_month_identity(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        first = client.put(
            "/api/v1/months/2026-01/fixed-assets",
            json={
                "expected_revision": 0,
                "rows": [
                    {
                        "asset_key": "phone",
                        "asset_name": "手机",
                        "category": "电子设备",
                        "purchase_price": 5000,
                        "status": "在用",
                    }
                ],
            },
        )
        assert first.status_code == 200
        assert first.json()["rows"][0]["asset_key"] == "phone"

        inherited = client.get("/api/v1/months/2026-02").json()
        assert inherited["fixed_assets"][0]["asset_key"] == "phone"
        assert inherited["fixed_assets"][0]["asset_name"] == "手机"


def test_whole_month_save_is_atomic_and_increments_once(tmp_path, monkeypatch):
    app, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        saved = client.put(
            "/api/v1/months/2026-01/workspace",
            json={
                "expected_revision": 0,
                "cash_accounts": [
                    {"account_key": "cash-default", "balance": 1020},
                ],
                "investment_accounts": [{
                    "account_key": "investment-default",
                    "principal": 500,
                    "market_value": 520,
                    "cash_balance": 10,
                }],
                "transactions": [
                    {
                        "client_id": "tx-1",
                        "type": "支出",
                        "category": "餐饮基础",
                        "product": "午餐",
                        "amount": 20.126,
                    }
                ],
                "fixed_assets": [
                    {
                        "client_id": "asset-1",
                        "asset_key": "phone",
                        "asset_name": "手机",
                        "purchase_price": 3000,
                    }
                ],
            },
        )
        assert saved.status_code == 200
        assert saved.json()["revision"] == 1
        assert saved.json()["transactions"][0]["amount"] == 20.13

        failed = client.put(
            "/api/v1/months/2026-01/workspace",
            json={
                "expected_revision": 1,
                "cash_accounts": [{"account_key": "cash-default", "balance": 9999}],
                "investment_accounts": [{
                    "account_key": "investment-default",
                    "principal": 0,
                }],
                "transactions": [
                    {
                        "type": "not-valid",
                        "category": "",
                        "product": "坏数据",
                        "amount": 1,
                    }
                ],
                "fixed_assets": [],
            },
        )
        assert failed.status_code == 422
        unchanged = client.get("/api/v1/months/2026-01").json()
        assert unchanged["revision"] == 1
        assert next(
            row["balance"]
            for row in unchanged["cash_accounts"]
            if row["account_key"] == "cash-default"
        ) == 1020
        assert unchanged["fixed_assets"][0]["asset_key"] == "phone"


def test_live_analysis_and_directory_backup_validate_without_render_bundle(
    tmp_path, monkeypatch
):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        saved = client.put(
            "/api/v1/months/2026-01/workspace",
            json={
                "expected_revision": 0,
                "cash_accounts": [{"account_key": "cash-default", "balance": 1000}],
                "investment_accounts": [{
                    "account_key": "investment-default",
                    "principal": 100,
                }],
                "transactions": [
                    {
                        "type": "收入",
                        "category": "工资收入",
                        "product": "工资",
                        "amount": 8000,
                    },
                    {
                        "type": "支出",
                        "category": "餐饮基础",
                        "product": "午餐|套餐",
                        "amount": 30,
                    },
                ],
                "fixed_assets": [],
            },
        )
        assert saved.status_code == 200
        assert client.get("/api/v1/render-bundle").status_code == 404
        current = client.get("/api/v1/current-asset").json()
        annual = client.get("/api/v1/annual/2026").json()
        monthly = client.get("/api/v1/months/2026-01").json()
        assert current["month"] == "2026-01"
        assert current["total_assets"] == 1100
        assert annual["rolling_rows"][0]["month"] == "2026-01"
        assert annual["rolling_rows"][0]["savings_rate"] == 99.62
        assert "rolling_savings_rows" not in annual
        assert monthly["overview"]["metrics"]["surplus"] == 7970
        assert monthly["overview"]["metrics"]["savings_rate"] == 99.62

        output = tmp_path / "manual-backup"
        exported = client.post("/api/v1/backups/export", json={"path": str(output)})
        assert exported.status_code == 200
        assert (output / "accounting_system.db").exists()
        assert (output / "csv" / "transactions_backup.csv").exists()
        assert (output / "manifest.json").exists()
        assert client.post(
            "/api/v1/backups/validate", json={"path": str(output)}
        ).json()["valid"] is True


def test_annual_route_uses_shared_calculator(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        saved = client.put(
            "/api/v1/months/2026-01/transactions",
            json={
                "expected_revision": 0,
                "rows": [
                    {
                        "type": "支出",
                        "category": "餐饮基础",
                        "product": "午餐",
                        "amount": 32,
                    }
                ],
            },
        )
        assert saved.status_code == 200
        annual = client.get("/api/v1/annual/2026")
        assert annual.status_code == 200
        assert annual.json()["rows"][0]["total_expense"] == 32
        assert annual.json()["rows"][0]["principal"] == 0
        assert annual.json()["rows"][0]["savings_rate"] is None


def test_transaction_dates_are_normalized_and_cross_month_rows_are_blocked(
    tmp_path, monkeypatch
):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        saved = client.put(
            "/api/v1/months/2026-07/transactions",
            json={
                "expected_revision": 0,
                "rows": [{
                    "transaction_date": "2026年7月2日",
                    "type": "支出",
                    "category": "餐饮基础",
                    "product": "午餐",
                    "amount": 20,
                }],
            },
        )
        assert saved.status_code == 200
        assert saved.json()["rows"][0]["transaction_date"] == "2026-07-02"

        blocked = client.put(
            "/api/v1/months/2026-07/transactions",
            json={
                "expected_revision": 1,
                "rows": [{
                    "transaction_date": "2026/08/01",
                    "type": "支出",
                    "category": "餐饮基础",
                    "product": "跨月",
                    "amount": 20,
                }],
            },
        )
        assert blocked.status_code == 422
        assert blocked.json()["detail"]["issues"][0]["field"] == "日期"
        assert client.get("/api/v1/months/2026-07").json()["revision"] == 1


def test_month_overview_exposes_asset_delta_from_shared_calculator(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        january = client.put(
            "/api/v1/months/2026-01/asset-snapshot",
            json={"expected_revision": 0, "boc_balance": 100},
        )
        february = client.put(
            "/api/v1/months/2026-02/asset-snapshot",
            json={"expected_revision": 0, "boc_balance": 130},
        )
        assert january.status_code == 200
        assert february.status_code == 200

        first = client.get("/api/v1/months/2026-01").json()
        second = client.get("/api/v1/months/2026-02").json()
        assert first["overview"]["metrics"]["asset_delta"] is None
        assert second["overview"]["metrics"]["asset_delta"] == 30


def test_explicit_month_creation_is_durable_and_inherits_assets(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        saved = client.put(
            "/api/v1/months/2026-05/fixed-assets",
            json={
                "expected_revision": 0,
                "rows": [{
                    "asset_key": "macbook",
                    "asset_name": "MacBook",
                    "category": "电子设备",
                    "purchase_price": 6000,
                    "status": "在用",
                }],
            },
        )
        assert saved.status_code == 200

        created = client.post("/api/v1/months/2026-06")
        assert created.status_code == 200
        assert created.json()["inherited_fixed_assets"] == 1
        assert created.json()["fixed_assets"][0]["asset_key"] == "macbook"
        assert client.get("/api/v1/months").json()["months"] == ["2026-05", "2026-06"]

        repeated = client.post("/api/v1/months/2026-06")
        assert repeated.status_code == 200
        assert repeated.json()["inherited_fixed_assets"] == 0
        assert len(repeated.json()["fixed_assets"]) == 1


def test_only_one_draft_and_at_most_next_calendar_month_can_be_created(
    tmp_path, monkeypatch
):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        client.put(
            "/api/v1/months/2026-07/transactions",
            json={"expected_revision": 0, "rows": []},
        )
        created = client.post("/api/v1/months/2026-08")
        assert created.status_code == 200
        assert created.json()["status"] == "draft"
        policy = client.get("/api/v1/months").json()
        assert policy["draft_month"] == "2026-08"
        assert policy["can_create"] is False

        blocked = client.post("/api/v1/months/2026-09")
        assert blocked.status_code == 422


def test_unchecking_paid_debt_preserves_paid_date(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        created = client.put(
            "/api/v1/debts",
            json={
                "expected_revision": client.get("/api/v1/debts").json()["revision"],
                "rows": [{
                    "start_date": "2026-01-01",
                    "description": "测试借款",
                    "counterparty": "甲",
                    "amount": 100,
                    "is_paid": True,
                    "paid_date": "2026-02-01",
                }],
            },
        )
        assert created.status_code == 200
        data = client.get("/api/v1/debts").json()
        row = data["rows"][0]
        row["is_paid"] = False
        saved = client.put(
            "/api/v1/debts",
            json={"expected_revision": data["revision"], "rows": [row]},
        )
        assert saved.status_code == 200
        assert client.get("/api/v1/debts").json()["rows"][0]["paid_date"] == "2026-02-01"


def test_rule_suggestions_are_stable_and_exclude_saved_rules(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        for month in ("2026-01", "2026-02"):
            response = client.put(
                f"/api/v1/months/{month}/transactions",
                json={
                    "expected_revision": 0,
                    "rows": [{
                        "type": "支出",
                        "category": "餐饮改善",
                        "product": "固定咖啡店",
                        "amount": 20,
                    }],
                },
            )
            assert response.status_code == 200

        suggestion = client.get("/api/v1/months/2026-02/rule-suggestions")
        assert suggestion.status_code == 200
        assert suggestion.json()["rows"] == [{
            "transaction_type": "支出",
            "product": "固定咖啡店",
            "category": "餐饮改善",
            "occurrences": 2,
            "months_count": 2,
        }]

        rules = client.get("/api/v1/rules").json()
        saved = client.put(
            "/api/v1/rules",
            json={
                "expected_revision": rules["revision"],
                "rows": [{"product": "固定咖啡店", "category": "餐饮改善"}],
            },
        )
        assert saved.status_code == 200
        saved_rule = saved.json()["rows"][0]
        assert saved_rule["occurrences"] == 2
        assert saved_rule["months_count"] == 2
        assert saved_rule["last_month"] == "2026-02"
        assert client.get("/api/v1/months/2026-02/rule-suggestions").json()["rows"] == []


def test_manual_backup_and_debt_date_validation(tmp_path, monkeypatch):
    app, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        assert client.get("/api/v1/settings").status_code == 404

        exported = client.post("/api/v1/backups/export")
        assert exported.status_code == 200
        assert Path(exported.json()["path"]).parent == tmp_path / "runtime" / "backup"
        second_exported = client.post("/api/v1/backups/export")
        assert second_exported.status_code == 200
        assert second_exported.json()["path"] != exported.json()["path"]

        finder_directory = tmp_path / "finder-backups"
        finder_directory.mkdir()
        finder_export = client.post(
            "/api/v1/backups/export", json={"directory": str(finder_directory)}
        )
        assert finder_export.status_code == 200
        finder_path = Path(finder_export.json()["path"])
        assert finder_path.parent == finder_directory
        assert finder_path.name.startswith("asset-track-backup-")
        assert finder_path.suffix == ".zip"
        assert finder_path.is_file()
        assert finder_export.json()["validation"]["valid"] is True

        diagnostics = client.post("/api/v1/diagnostics/export")
        assert diagnostics.status_code == 200
        diagnostic_payload = json.loads(
            Path(diagnostics.json()["path"]).read_text(encoding="utf-8")
        )
        assert diagnostic_payload["schema"]["integrity_check"] == "ok"
        assert diagnostics.json()["payload"] == diagnostic_payload

        selected_path = tmp_path / "chosen" / "my-asset-track"
        custom_export = client.post(
            "/api/v1/backups/export", json={"path": str(selected_path)}
        )
        assert custom_export.status_code == 200
        assert Path(custom_export.json()["path"]) == selected_path
        assert selected_path.exists()
        assert not (selected_path.parent / "transactions_backup.csv").exists()

        app.state.repository.db.execute(
            "INSERT INTO debt_manager "
            "(description, amount, start_date, is_paid, paid_date) VALUES (?,?,?,?,?)",
            ("旧版月份借款", 80, "2025-11", 1, "2025-12"),
        )
        debts = client.get("/api/v1/debts").json()
        assert debts["rows"][0]["start_date"] == "2025-11-01"
        assert debts["rows"][0]["paid_date"] == "2025-12-01"
        invalid = client.put(
            "/api/v1/debts",
            json={
                "expected_revision": debts["revision"],
                "rows": [{
                    "description": "测试借款",
                    "amount": 100,
                    "start_date": "2026-06-02",
                    "is_paid": True,
                    "paid_date": "2026-06-01",
                }],
            },
        )
        assert invalid.status_code == 422
        assert "不能早于" in invalid.json()["detail"]["message"]

        debts = client.get("/api/v1/debts").json()
        legacy_date = client.put(
            "/api/v1/debts",
            json={
                "expected_revision": debts["revision"],
                "rows": [{
                    "description": "斜杠日期借款",
                    "amount": 100,
                    "start_date": "2026/06/02",
                    "is_paid": True,
                    "paid_date": "2026/06/03",
                }],
            },
        )
        assert legacy_date.status_code == 200
        assert legacy_date.json()["rows"][0]["start_date"] == "2026-06-02"
        assert legacy_date.json()["rows"][0]["paid_date"] == "2026-06-03"


def test_product_history_excludes_existing_rules_and_respects_frequency(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        for month, rows in {
            "2026-01": [
                {"type": "支出", "category": "餐饮基础", "product": "咖啡", "amount": 12},
                {"type": "支出", "category": "餐饮改善", "product": "咖啡", "amount": 18},
                {"type": "支出", "category": "订阅服务", "product": "会员", "amount": 20},
            ],
            "2026-02": [
                {"type": "支出", "category": "餐饮基础", "product": "咖啡", "amount": 15},
                {"type": "支出", "category": "订阅服务", "product": "会员", "amount": 20},
            ],
        }.items():
            response = client.put(
                f"/api/v1/months/{month}/transactions",
                json={"expected_revision": 0, "rows": rows},
            )
            assert response.status_code == 200

        rules = client.get("/api/v1/rules").json()
        saved = client.put(
            "/api/v1/rules",
            json={
                "expected_revision": rules["revision"],
                "rows": [{"product": "会员", "category": "订阅服务"}],
            },
        )
        assert saved.status_code == 200

        history = client.get("/api/v1/product-history?min_occurrences=2")
        assert history.status_code == 200
        assert history.json()["rows"] == [{
            "transaction_type": "支出",
            "product": "咖啡",
            "variants": ["咖啡"],
            "category": "餐饮基础",
            "category_confidence": 0.6667,
            "has_category_conflict": True,
            "occurrences": 3,
            "months_count": 2,
            "last_month": "2026-02",
        }]


def test_generic_csv_preview_and_rule_candidates_keep_duplicate_rows(
    tmp_path, monkeypatch
):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    raw = (
        "日期,说明,金额,方向\n"
        "2026-01-02,咖啡,12,付款\n"
        "2026-01-02,咖啡,12,付款\n"
    ).encode("utf-8")
    encoded = base64.b64encode(raw).decode("ascii")
    with client:
        inspected = client.post(
            "/api/v1/months/2026-01/transactions/import-inspect",
            json={"filename": "bill.csv", "content_base64": encoded},
        )
        assert inspected.status_code == 200
        assert inspected.json()["row_count"] == 2

        preview = client.post(
            "/api/v1/months/2026-01/transactions/import-preview",
            json={
                "filename": "bill.csv",
                "content_base64": encoded,
                "mapping": {
                    "date_column": "日期",
                    "product_column": "说明",
                    "amount_column": "金额",
                    "type_column": "方向",
                    "type_values": {"付款": "支出"},
                },
            },
        )
        assert preview.status_code == 200
        rows = preview.json()["rows"]
        assert len(rows) == 2
        assert [row["product"] for row in rows] == ["咖啡", "咖啡"]

        candidates = client.post(
            "/api/v1/months/2026-01/rule-candidates",
            json={"rows": rows, "min_occurrences": 2},
        )
        assert candidates.status_code == 200
        assert candidates.json()["rows"][0]["occurrences"] == 2


def test_rules_are_scoped_by_transaction_type_and_normalized_product(tmp_path, monkeypatch):
    _, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        rules = client.get("/api/v1/rules").json()
        saved = client.put(
            "/api/v1/rules",
            json={
                "expected_revision": rules["revision"],
                "rows": [
                    {"transaction_type": "支出", "product": "会员费", "category": "订阅服务"},
                    {"transaction_type": "收入", "product": "会员费", "category": "临时收入"},
                ],
            },
        )
        assert saved.status_code == 200

        preview = client.post(
            "/api/v1/months/2026-03/transactions/rules-preview",
            json={"rows": [
                {"type": "支出", "category": "异常/未分类", "product": "会员 费", "amount": 20},
                {"type": "收入", "category": "临时收入", "product": "会员-费", "amount": 20},
                {"type": "代付", "category": "", "product": "会员费", "amount": 20},
            ]},
        )
        assert preview.status_code == 200
        rows = preview.json()["proposed_rows"]
        assert [row["category"] for row in rows] == ["订阅服务", "临时收入", ""]

        invalid = client.put(
            "/api/v1/rules",
            json={
                "expected_revision": saved.json()["revision"],
                "rows": [{"transaction_type": "收入", "product": "错误规则", "category": "餐饮基础"}],
            },
        )
        assert invalid.status_code == 422


def test_paid_debt_is_not_a_current_or_repayment_month_balance(tmp_path, monkeypatch):
    app, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        app.state.repository.db.execute(
            "INSERT INTO debt_manager "
            "(description, amount, start_date, is_paid, paid_date) VALUES (?,?,?,?,?)",
            ("已还借款", 500, "2026-01-10", 1, "2026-02-15"),
        )
        app.state.repository.db.execute(
            "INSERT INTO month_status "
            "(month, status, fixed_assets_initialized, revision) VALUES (?,?,?,?)",
            ("2026-02", "saved", 1, 0),
        )

        debts = client.get("/api/v1/debts")
        assert debts.status_code == 200
        assert debts.json()["active_balance"] == 0
        assert client.get("/api/v1/current-asset").json()["debt"] == 0
        assert calc_debt_for_month("2026-01", manager=app.state.repository.db) == 500
        assert calc_debt_for_month("2026-02", manager=app.state.repository.db) == 0


def test_delete_month_removes_only_month_scoped_tables(tmp_path, monkeypatch):
    app, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        created = client.post("/api/v1/months/2026-07")
        assert created.status_code == 200
        saved = client.put(
            "/api/v1/months/2026-07/transactions",
            json={
                "expected_revision": created.json()["revision"],
                "rows": [{
                    "type": "支出",
                    "category": "其他支出",
                    "product": "误添加",
                    "amount": 1,
                }],
            },
        )
        app.state.repository.db.execute(
            "INSERT INTO debt_manager "
            "(description, amount, start_date, is_paid) VALUES (?,?,?,?)",
            ("跨月借款", 100, "2026-01-01", 0),
        )

        deleted = client.request(
            "DELETE",
            "/api/v1/months/2026-07",
            json={
                "expected_revision": saved.json()["revision"],
                "confirm_month": "2026-07",
            },
        )
        assert deleted.status_code == 200
        assert "2026-07" not in deleted.json()["months"]
        for table in (
            "transactions", "cash_account_balances", "investment_account_balances",
            "fixed_assets", "month_status",
        ):
            row = app.state.repository.db.fetch_one(
                f"SELECT COUNT(*) AS count FROM {table} WHERE month = ?",
                ("2026-07",),
            )
            assert row["count"] == 0
        assert app.state.repository.db.fetch_one(
            "SELECT COUNT(*) AS count FROM debt_manager"
        )["count"] == 1


def test_locked_legacy_month_can_be_deleted_in_v1(tmp_path, monkeypatch):
    app, client = _client(tmp_path, monkeypatch=monkeypatch)
    with client:
        created = client.post("/api/v1/months/2026-07").json()
        app.state.repository.db.execute(
            "UPDATE month_status SET status='locked', revision=1 "
            "WHERE month='2026-07'"
        )
        response = client.request(
            "DELETE",
            "/api/v1/months/2026-07",
            json={
                "expected_revision": 1,
                "confirm_month": "2026-07",
            },
        )
        assert created["month"] == "2026-07"
        assert response.status_code == 200
