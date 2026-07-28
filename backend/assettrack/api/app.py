"""Same-origin FastAPI application for the macOS client and local dev."""

from __future__ import annotations

import hmac
import base64
import json
import os
import secrets
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from starlette.exceptions import HTTPException as StarletteHTTPException

from assettrack.api.models import (
    BackupExportRequest,
    BackupImportRequest,
    AccountDefinitionsSaveRequest,
    CategoryDefinitionsSaveRequest,
    CsvImportRequest,
    CsvMappedImportRequest,
    DebtsSaveRequest,
    FixedAssetsSaveRequest,
    InvestmentSaveRequest,
    MonthWorkspaceSaveRequest,
    MonthDeleteRequest,
    RuleCandidatesRequest,
    RulesSaveRequest,
    SnapshotSaveRequest,
    TransactionPreviewRequest,
    TransactionsSaveRequest,
    model_rows,
)
from assettrack.api.repository import (
    APIRepository,
    MonthLockedError,
    RepositoryValidationError,
    RevisionConflictError,
)
from assettrack.infrastructure.runtime_paths import resolve_runtime_paths
from assettrack.infrastructure.sqlite_manager import SqliteManager
from assettrack.domain.data_revision import source_revision


PROTOCOL_VERSION = 2
SESSION_COOKIE = "assettrack_session"
BOOTSTRAP_HEADER = "X-AssetTrack-Bootstrap"
FIXED_ASSET_CATEGORIES = ["电子设备", "家用电器", "家具", "交通工具", "摄影器材", "其他"]


class SPAStaticFiles(StaticFiles):
    """Serve index.html for browser-side React routes."""

    async def get_response(self, path: str, scope):  # type: ignore[no-untyped-def]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def _default_frontend_dir() -> Path:
    configured = os.getenv("ASSET_TRACK_FRONTEND_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3] / "frontend" / "dist"


def create_app(
    *,
    manager: SqliteManager | None = None,
    frontend_dir: str | os.PathLike[str] | None = None,
    bootstrap_token: str | None = None,
    require_bootstrap: bool | None = None,
    ready_callback=None,
) -> FastAPI:
    """Create one isolated API instance.

    ``manager`` and ``frontend_dir`` are injectable for API contract tests. In
    the packaged sidecar they resolve to the standard Application Support
    directory and the read-only React bundle.
    """
    repository = APIRepository(manager)
    frontend = Path(frontend_dir).expanduser().resolve() if frontend_dir else _default_frontend_dir()
    token = bootstrap_token or os.getenv("ASSET_TRACK_BOOTSTRAP_TOKEN", "")
    auth_enabled = (
        require_bootstrap
        if require_bootstrap is not None
        else bool(token or os.getenv("ASSET_TRACK_REQUIRE_BOOTSTRAP"))
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        paths = resolve_runtime_paths()
        paths.ensure_directories()
        schema = repository.initialize()
        if frontend.exists() and not (frontend / "index.html").exists():
            raise RuntimeError(f"React 静态资源缺少 index.html：{frontend}")
        app.state.schema = schema
        app.state.ready = True
        if ready_callback:
            ready_callback()
        try:
            yield
        finally:
            app.state.ready = False

    app = FastAPI(
        title="Asset Track API",
        version=os.getenv("ASSET_TRACK_APP_VERSION", "3.3.0"),
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.repository = repository
    app.state.ready = False
    app.state.auth_enabled = auth_enabled
    app.state.bootstrap_token = token
    app.state.bootstrap_used = False
    app.state.session_token = ""
    app.state.frontend_dir = frontend

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
            "form-action 'self'; img-src 'self' data:; font-src 'self' data:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    def require_session(request: Request) -> None:
        if not app.state.auth_enabled:
            return
        session = request.headers.get(
            "X-AssetTrack-Session", request.cookies.get(SESSION_COOKIE, "")
        )
        if not session or not hmac.compare_digest(session, app.state.session_token):
            raise HTTPException(status_code=401, detail="需要先完成应用启动握手")

    def error_response(exc: Exception) -> HTTPException:
        if isinstance(exc, RevisionConflictError):
            return HTTPException(
                status_code=409,
                detail={"message": "数据已被其他窗口修改", "expected": exc.expected, "actual": exc.actual},
            )
        if isinstance(exc, MonthLockedError):
            return HTTPException(status_code=423, detail=str(exc))
        if isinstance(exc, RepositoryValidationError):
            return HTTPException(
                status_code=422,
                detail={
                    "message": str(exc),
                    "issues": exc.issues,
                },
            )
        if isinstance(exc, ValueError):
            return HTTPException(status_code=422, detail=str(exc))
        return HTTPException(status_code=500, detail="服务器内部错误")

    @app.get("/health/live")
    def health_live() -> dict[str, Any]:
        return {"status": "live", "protocol_version": PROTOCOL_VERSION}

    @app.get("/health/ready")
    def health_ready() -> dict[str, Any]:
        if not app.state.ready:
            raise HTTPException(status_code=503, detail="sidecar 尚未准备好")
        return {
            "status": "ready",
            "protocol_version": PROTOCOL_VERSION,
            "schema_version": app.state.schema["schema_version"],
        }

    def bootstrap(request: Request):
        if not app.state.ready:
            raise HTTPException(status_code=503, detail="sidecar 尚未准备好")
        if not app.state.auth_enabled:
            return RedirectResponse(url="/", status_code=307)
        existing_session = request.cookies.get(SESSION_COOKIE, "")
        if (
            app.state.bootstrap_used
            and existing_session
            and hmac.compare_digest(existing_session, app.state.session_token)
        ):
            return RedirectResponse(url="/", status_code=303)
        supplied = request.headers.get(BOOTSTRAP_HEADER, "")
        expected = app.state.bootstrap_token
        if (
            app.state.bootstrap_used
            or not expected
            or not supplied
            or not hmac.compare_digest(supplied, expected)
        ):
            raise HTTPException(status_code=401, detail="启动握手令牌无效或已使用")
        app.state.bootstrap_used = True
        app.state.session_token = secrets.token_urlsafe(32)
        response = RedirectResponse(url="/", status_code=303)
        # Secure is opt-in because the production transport is a loopback HTTP
        # origin. Hardened deployments can set ASSET_TRACK_SECURE_COOKIE=1.
        response.set_cookie(
            SESSION_COOKIE,
            app.state.session_token,
            httponly=True,
            samesite="strict",
            secure=os.getenv("ASSET_TRACK_SECURE_COOKIE", "0") == "1",
            path="/",
        )
        return response

    app.add_api_route("/bootstrap", bootstrap, methods=["GET"])
    app.add_api_route("/api/v1/bootstrap", bootstrap, methods=["GET"])

    @app.post("/api/v1/session")
    def create_session(request: Request) -> dict[str, str]:
        supplied = request.headers.get(BOOTSTRAP_HEADER, "")
        expected = app.state.bootstrap_token
        if (
            app.state.bootstrap_used
            or not expected
            or not supplied
            or not hmac.compare_digest(supplied, expected)
        ):
            raise HTTPException(status_code=401, detail="启动握手令牌无效或已使用")
        app.state.bootstrap_used = True
        app.state.session_token = secrets.token_urlsafe(32)
        return {"session": app.state.session_token}

    @app.post("/internal/shutdown")
    def internal_shutdown(request: Request) -> dict[str, str]:
        supplied = request.headers.get("X-AssetTrack-Bootstrap", "")
        if not token or not supplied or not hmac.compare_digest(supplied, token):
            raise HTTPException(status_code=401, detail="内部关闭令牌无效")
        server = getattr(app.state, "server", None)
        if server is not None:
            server.should_exit = True
        return {"status": "stopping"}

    @app.get("/api/v1/meta", dependencies=[Depends(require_session)])
    def meta() -> dict[str, Any]:
        definitions = repository.category_definitions()["rows"]
        return {
            "protocol_version": PROTOCOL_VERSION,
            "app_version": os.getenv("ASSET_TRACK_APP_VERSION", "3.3.0"),
            "categories": [
                row["name"] for row in definitions if bool(row["is_active"])
            ],
            "category_metadata": {
                row["name"]: row for row in definitions
            },
            "fixed_asset_statuses": ["在用", "闲置", "已出售", "已报废"],
            "fixed_asset_categories": FIXED_ASSET_CATEGORIES,
            "source_revision": source_revision(repository),
        }

    @app.get("/api/v1/months", dependencies=[Depends(require_session)])
    def months() -> dict[str, Any]:
        return repository.month_creation_policy()

    @app.post("/api/v1/months/{month}", dependencies=[Depends(require_session)])
    def create_month(month: str) -> dict[str, Any]:
        try:
            return repository.create_month(month)
        except Exception as exc:
            raise error_response(exc) from exc

    @app.get("/api/v1/months/{month}", dependencies=[Depends(require_session)])
    def month(month: str) -> dict[str, Any]:
        try:
            return repository.get_month(month)
        except Exception as exc:
            raise error_response(exc) from exc

    @app.delete("/api/v1/months/{month}", dependencies=[Depends(require_session)])
    def delete_month(month: str, payload: MonthDeleteRequest) -> dict[str, Any]:
        try:
            return repository.delete_month(
                month, payload.expected_revision, payload.confirm_month
            )
        except Exception as exc:
            raise error_response(exc) from exc

    @app.get("/api/v1/current-asset", dependencies=[Depends(require_session)])
    def current_asset() -> dict[str, Any]:
        return repository.current_asset()

    @app.get("/api/v1/annual/{year}", dependencies=[Depends(require_session)])
    def annual(year: str) -> dict[str, Any]:
        if len(year) != 4 or not year.isdigit():
            raise HTTPException(status_code=422, detail="年度格式应为 YYYY")
        return repository.annual_overview(year)

    @app.put("/api/v1/months/{month}/transactions", dependencies=[Depends(require_session)])
    def save_transactions(month: str, payload: TransactionsSaveRequest) -> dict[str, Any]:
        try:
            return repository.save_transactions(month, payload.expected_revision, model_rows(payload.rows))
        except Exception as exc:
            raise error_response(exc) from exc

    @app.put("/api/v1/months/{month}/asset-snapshot", dependencies=[Depends(require_session)])
    def save_snapshot(month: str, payload: SnapshotSaveRequest) -> dict[str, Any]:
        try:
            return repository.save_asset_snapshot(month, payload.expected_revision, payload.model_dump())
        except Exception as exc:
            raise error_response(exc) from exc

    @app.put("/api/v1/months/{month}/investment", dependencies=[Depends(require_session)])
    def save_investment(month: str, payload: InvestmentSaveRequest) -> dict[str, Any]:
        try:
            return repository.save_investment(month, payload.expected_revision, payload.model_dump())
        except Exception as exc:
            raise error_response(exc) from exc

    @app.put("/api/v1/months/{month}/fixed-assets", dependencies=[Depends(require_session)])
    def save_fixed_assets(month: str, payload: FixedAssetsSaveRequest) -> dict[str, Any]:
        try:
            return repository.save_fixed_assets(month, payload.expected_revision, model_rows(payload.rows))
        except Exception as exc:
            raise error_response(exc) from exc

    @app.put("/api/v1/months/{month}/workspace", dependencies=[Depends(require_session)])
    def save_month_workspace(
        month: str, payload: MonthWorkspaceSaveRequest
    ) -> dict[str, Any]:
        try:
            return repository.save_month_workspace(
                month,
                payload.expected_revision,
                model_rows(payload.cash_accounts),
                model_rows(payload.investment_accounts),
                model_rows(payload.transactions),
                model_rows(payload.fixed_assets),
            )
        except Exception as exc:
            raise error_response(exc) from exc

    @app.get("/api/v1/debts", dependencies=[Depends(require_session)])
    def debts() -> dict[str, Any]:
        return repository.debts()

    @app.put("/api/v1/debts", dependencies=[Depends(require_session)])
    def save_debts(payload: DebtsSaveRequest) -> dict[str, Any]:
        try:
            return repository.save_debts(payload.expected_revision, model_rows(payload.rows))
        except Exception as exc:
            raise error_response(exc) from exc

    @app.get("/api/v1/rules", dependencies=[Depends(require_session)])
    def rules() -> dict[str, Any]:
        return repository.rules()

    @app.put("/api/v1/rules", dependencies=[Depends(require_session)])
    def save_rules(payload: RulesSaveRequest) -> dict[str, Any]:
        try:
            return repository.save_rules(payload.expected_revision, model_rows(payload.rows))
        except Exception as exc:
            raise error_response(exc) from exc

    @app.get("/api/v1/category-definitions", dependencies=[Depends(require_session)])
    def category_definitions() -> dict[str, Any]:
        return repository.category_definitions()

    @app.put("/api/v1/category-definitions", dependencies=[Depends(require_session)])
    def save_category_definitions(
        payload: CategoryDefinitionsSaveRequest,
    ) -> dict[str, Any]:
        try:
            return repository.save_category_definitions(
                payload.expected_revision, model_rows(payload.rows)
            )
        except Exception as exc:
            raise error_response(exc) from exc

    @app.get("/api/v1/account-definitions", dependencies=[Depends(require_session)])
    def account_definitions() -> dict[str, Any]:
        return repository.account_definitions()

    @app.put("/api/v1/account-definitions", dependencies=[Depends(require_session)])
    def save_account_definitions(
        payload: AccountDefinitionsSaveRequest,
    ) -> dict[str, Any]:
        try:
            return repository.save_account_definitions(
                payload.expected_revision, model_rows(payload.rows)
            )
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post("/api/v1/months/{month}/transactions/import-file-preview", dependencies=[Depends(require_session)])
    async def import_preview(month: str, file: UploadFile = File(...)) -> dict[str, Any]:
        try:
            from assettrack.domain.parser import parse_bill

            frame = parse_bill(await file.read(), file.filename or "transactions.csv")
            rows = frame.to_dict(orient="records")
            return repository.prepare_import_preview(month, rows)
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post(
        "/api/v1/months/{month}/transactions/import-json",
        dependencies=[Depends(require_session)],
    )
    def import_json_preview(month: str, payload: CsvImportRequest) -> dict[str, Any]:
        try:
            from assettrack.domain.parser import parse_bill

            raw = base64.b64decode(payload.content_base64, validate=True)
            frame = parse_bill(raw, payload.filename)
            rows = frame.to_dict(orient="records")
            return repository.prepare_import_preview(month, rows)
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post(
        "/api/v1/months/{month}/transactions/import-inspect",
        dependencies=[Depends(require_session)],
    )
    def inspect_csv_import(month: str, payload: CsvImportRequest) -> dict[str, Any]:
        try:
            from assettrack.domain.parser import inspect_bill

            raw = base64.b64decode(payload.content_base64, validate=True)
            return {"month": month, **inspect_bill(raw, payload.filename)}
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post(
        "/api/v1/months/{month}/transactions/import-preview",
        dependencies=[Depends(require_session)],
    )
    def mapped_csv_import(
        month: str, payload: CsvMappedImportRequest
    ) -> dict[str, Any]:
        try:
            from assettrack.domain.parser import parse_mapped_bill

            raw = base64.b64decode(payload.content_base64, validate=True)
            frame, import_stats = parse_mapped_bill(
                raw,
                payload.filename,
                month=month,
                mapping=payload.mapping.model_dump(),
            )
            result = repository.prepare_import_preview(
                month, frame.to_dict(orient="records")
            )
            return {**result, "import_stats": import_stats}
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post("/api/v1/months/{month}/transactions/rules-preview", dependencies=[Depends(require_session)])
    def rules_preview(month: str, payload: TransactionPreviewRequest) -> dict[str, Any]:
        import pandas as pd
        from assettrack.domain.rule_service import apply_auto_rules

        frame = pd.DataFrame(model_rows(payload.rows))
        if frame.empty:
            return {"month": month, "base_revision": repository.get_revision(month), "proposed_rows": [], "changes": [], "warnings": []}
        before = frame.copy()
        proposed = apply_auto_rules(frame.copy(), database=repository.db)
        changes = []
        for index in proposed.index:
            if before.at[index, "category"] != proposed.at[index, "category"]:
                changes.append({"index": int(index), "category": proposed.at[index, "category"]})
        return {
            "month": month,
            "base_revision": repository.get_revision(month),
            "proposed_rows": proposed.to_dict(orient="records"),
            "changes": changes,
            "warnings": [],
        }

    @app.post("/api/v1/months/{month}/transactions/validate", dependencies=[Depends(require_session)])
    def validate_transaction_rows(month: str, payload: TransactionPreviewRequest) -> dict[str, Any]:
        import pandas as pd
        from assettrack.domain.validators import validate_transactions

        frame = pd.DataFrame(model_rows(payload.rows))
        return {
            "month": month,
            "issues": validate_transactions(
                frame,
                month=month,
                categories=repository.category_definitions()["rows"],
            ),
        }

    @app.get("/api/v1/months/{month}/rule-suggestions", dependencies=[Depends(require_session)])
    def rule_suggestions(month: str) -> dict[str, Any]:
        try:
            return {"month": month, "rows": repository.rule_suggestions(month)}
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post(
        "/api/v1/months/{month}/rule-candidates",
        dependencies=[Depends(require_session)],
    )
    def rule_candidates(
        month: str, payload: RuleCandidatesRequest
    ) -> dict[str, Any]:
        try:
            return repository.rule_candidates(
                month,
                model_rows(payload.rows),
                min_occurrences=payload.min_occurrences,
            )
        except Exception as exc:
            raise error_response(exc) from exc

    @app.get("/api/v1/product-history", dependencies=[Depends(require_session)])
    def product_history(min_occurrences: int = 5) -> dict[str, Any]:
        try:
            return {
                "min_occurrences": min_occurrences,
                "rows": repository.product_history(min_occurrences),
            }
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post("/api/v1/backups/export", dependencies=[Depends(require_session)])
    def export_backup(request: BackupExportRequest | None = None) -> dict[str, Any]:
        try:
            from assettrack.infrastructure.backup.backup_bundle import (
                export_complete_backup,
                export_directory_backup,
                validate_backup_source,
            )

            paths = resolve_runtime_paths().ensure_directories()
            custom_path = request.path if request else None
            custom_directory = request.directory if request else None
            if custom_directory:
                output = (
                    Path(custom_directory).expanduser().resolve()
                    / f"asset-track-backup-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.zip"
                )
                path = export_complete_backup(
                    output,
                    source_manager=repository.db,
                    copy_raw_csv=False,
                )
            elif custom_path:
                output = Path(custom_path).expanduser().resolve()
                if output.suffix.lower() == ".zip":
                    path = export_complete_backup(
                        output,
                        source_manager=repository.db,
                        copy_raw_csv=False,
                    )
                else:
                    path = export_directory_backup(
                        output,
                        source_manager=repository.db,
                        source_revision=source_revision(repository),
                    )
            else:
                output = (
                    paths.backup_dir
                    / f"asset-track-backup-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.zip"
                )
                path = export_complete_backup(
                    output,
                    source_manager=repository.db,
                    copy_raw_csv=False,
                )
            return {"path": str(path), "validation": validate_backup_source(path)}
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post("/api/v1/backups/import", dependencies=[Depends(require_session)])
    def import_backup(source: BackupImportRequest) -> dict[str, Any]:
        path = source.path
        try:
            from assettrack.infrastructure.backup.backup_bundle import (
                import_complete_backup,
            )

            return import_complete_backup(path, target_manager=repository.db)
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post("/api/v1/backups/validate", dependencies=[Depends(require_session)])
    def validate_backup(source: BackupImportRequest) -> dict[str, Any]:
        try:
            from assettrack.infrastructure.backup.backup_bundle import (
                validate_backup_source,
            )

            return validate_backup_source(source.path)
        except Exception as exc:
            raise error_response(exc) from exc

    @app.post("/api/v1/diagnostics/export", dependencies=[Depends(require_session)])
    def export_diagnostics() -> dict[str, Any]:
        paths = resolve_runtime_paths().ensure_directories()
        output = paths.log_dir / f"asset-track-diagnostics-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        schema = repository.db.validate_schema(full=True)
        payload = {
            "created_at": datetime.now().isoformat(),
            "app_version": os.getenv("ASSET_TRACK_APP_VERSION", "3.3.0"),
            "protocol_version": PROTOCOL_VERSION,
            "schema": schema,
            "data_dir": str(paths.data_dir),
            "source_revision": source_revision(repository),
        }
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"path": str(output), "payload": payload}

    @app.get("/api/v1/runtime-status", dependencies=[Depends(require_session)])
    def runtime_status() -> dict[str, Any]:
        paths = resolve_runtime_paths()
        return {
            "ready": app.state.ready,
            "data_dir": str(paths.data_dir),
            "db_path": str(paths.db_path),
            "backup_dir": str(paths.backup_dir),
            "schema_version": app.state.schema["schema_version"] if app.state.ready else None,
        }

    if frontend.exists():
        app.mount("/", SPAStaticFiles(directory=str(frontend), html=True), name="frontend")
    else:
        @app.get("/", response_class=HTMLResponse)
        def development_hello() -> str:
            return "<html><body><h1>Asset Track API</h1><p>React build not found.</p></body></html>"

    return app
