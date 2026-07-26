import os

from assettrack.infrastructure.runtime_paths import PROJECT_ROOT, resolve_runtime_paths

# 默认保持仓库开发布局；Obsidian 插件通过环境变量注入所选 Vault 路径。
RUNTIME_PATHS = resolve_runtime_paths()
DATA_DIR = RUNTIME_PATHS.data_dir
DB_PATH = RUNTIME_PATHS.db_path
BACKUP_DIR = RUNTIME_PATHS.backup_dir


def _load_local_env() -> None:
    """从项目根目录的 .env 读取本地变量；已存在的环境变量优先。"""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip().strip('"').strip("'")
        os.environ[key] = value


_load_local_env()


# ================= 分类标签 2.0 (带元数据) =================

CATEGORIES_METADATA = {
    # --- 支出类 ---
    "居住固定": {"type": "支出", "necessity": "必要", "pattern": "周期"},
    "订阅服务": {"type": "支出", "necessity": "必要", "pattern": "周期"},
    "餐饮基础": {"type": "支出", "necessity": "必要", "pattern": "日常"},
    "餐饮改善": {"type": "支出", "necessity": "可控", "pattern": "日常"},
    "交通通勤": {"type": "支出", "necessity": "必要", "pattern": "日常"},
    "日常必需": {"type": "支出", "necessity": "必要", "pattern": "日常"},
    "生活品质": {"type": "支出", "necessity": "可控", "pattern": "偶尔"},
    "大件大额": {"type": "支出", "necessity": "可控", "pattern": "偶尔", "is_big_ticket": True},
    "社交娱乐": {"type": "支出", "necessity": "可控", "pattern": "偶尔"},
    "学习发展": {"type": "支出", "necessity": "必要", "pattern": "偶尔"},
    "其他支出": {"type": "支出", "necessity": "可控", "pattern": "偶尔"},

    # --- 收入类 ---
    "工资收入": {"type": "收入", "necessity": "-", "pattern": "-"},
    "奖金利息": {"type": "收入", "necessity": "-", "pattern": "-"},
    "临时收入": {"type": "收入", "necessity": "-", "pattern": "-"},

    # --- 特殊类 ---
    "异常/未分类": {"type": "支出", "necessity": "-", "pattern": "-"},
}

# 导出简单的分类列表，供 UI 使用
CATEGORIES = list(CATEGORIES_METADATA.keys())
EXPENSE_CATEGORIES = [k for k, v in CATEGORIES_METADATA.items() if v["type"] == "支出"]
INCOME_CATEGORIES = [k for k, v in CATEGORIES_METADATA.items() if v["type"] == "收入"]

# 分类图表使用稳定的彩虹色序列。颜色由 sort_order 决定，分类重命名不会改变颜色。
CATEGORY_RAINBOW_COLORS = (
    "#e53935",
    "#f4511e",
    "#fb8c00",
    "#fdd835",
    "#c0ca33",
    "#7cb342",
    "#43a047",
    "#00897b",
    "#00acc1",
    "#039be5",
    "#1e88e5",
    "#3949ab",
    "#5e35b1",
    "#8e24aa",
    "#d81b60",
)


def category_rainbow_color(sort_order: int) -> str:
    return CATEGORY_RAINBOW_COLORS[
        max(0, int(sort_order)) % len(CATEGORY_RAINBOW_COLORS)
    ]
