from pathlib import Path

from assettrack.api.repository import APIRepository
from assettrack.infrastructure.sqlite_manager import SqliteManager
from tests.python.fixtures.obsidian_v1_fixture import GOLDEN, populate


def test_synthetic_fixture_matches_golden_results(tmp_path: Path):
    repository = APIRepository(SqliteManager(str(tmp_path / "fixture.db")))
    populate(repository)

    assert repository.get_months() == [
        "2025-12",
        "2026-01",
        "2026-03",
        "2026-04",
    ]
    assert repository.get_month("2025-12")["status"] == "saved"
    assert {
        row["asset_key"] for row in repository.get_month("2026-01")["fixed_assets"]
    } == {"phone-a", "phone-b"}

    annual_2025 = repository.annual_overview("2025")
    annual_2026 = repository.annual_overview("2026")
    rows = {
        row["month"]: row
        for row in [*annual_2025["rows"], *annual_2026["rows"]]
    }
    for month, expected in GOLDEN.items():
        for key, value in expected.items():
            assert rows[month][key] == value

    assert annual_2026["rows"][-1]["month"] == "2026-04"
    assert annual_2026["rows"][-1]["savings_rate"] is None
