"""Runtime paths shared by local development and the bundled Obsidian sidecar."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
APP_NAME = "AssetTrack"


@dataclass(frozen=True)
class RuntimePaths:
    """All writable paths used by one Asset Track runtime."""

    project_root: Path
    data_dir: Path
    db_path: Path
    backup_dir: Path
    log_dir: Path
    is_packaged_layout: bool

    def ensure_directories(self) -> "RuntimePaths":
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        return self


def _default_packaged_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    return Path.home() / ".local" / "share" / APP_NAME


def resolve_runtime_paths(data_dir: str | os.PathLike[str] | None = None) -> RuntimePaths:
    """Resolve paths without touching the filesystem.

    An explicit argument or ``ASSET_TRACK_DATA_DIR`` selects the packaged
    layout. Without either, local API development uses the repository's
    ignored ``.var/`` runtime directory.
    """

    explicit_db = os.getenv("ASSET_TRACK_DB_PATH")
    requested = data_dir or os.getenv("ASSET_TRACK_DATA_DIR")
    if explicit_db:
        db_path = Path(explicit_db).expanduser().resolve()
        workspace_root = (
            Path(requested).expanduser().resolve()
            if requested
            else db_path.parent
        )
        return RuntimePaths(
            project_root=PROJECT_ROOT,
            data_dir=db_path.parent,
            db_path=db_path,
            backup_dir=workspace_root / "backup",
            log_dir=workspace_root / "logs",
            is_packaged_layout=True,
        )
    if requested:
        root = Path(requested).expanduser().resolve()
        return RuntimePaths(
            project_root=PROJECT_ROOT,
            data_dir=root,
            db_path=root / "accounting_system.db",
            backup_dir=root / "backup",
            log_dir=root / "logs",
            is_packaged_layout=True,
        )

    development_root = PROJECT_ROOT / ".var"
    development_data = development_root / "data"
    return RuntimePaths(
        project_root=PROJECT_ROOT,
        data_dir=development_data,
        db_path=development_data / "accounting_system.db",
        backup_dir=development_root / "backup",
        log_dir=development_root / "logs",
        is_packaged_layout=False,
    )


def packaged_runtime_paths() -> RuntimePaths:
    """Return the legacy standalone macOS data path for compatibility."""

    return resolve_runtime_paths(_default_packaged_data_dir())
