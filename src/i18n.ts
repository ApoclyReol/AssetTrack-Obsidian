import { getLanguage } from "obsidian";

export type AssetTrackLocale = "zh-CN" | "en";

export function localeFromLanguage(language: string): AssetTrackLocale {
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getLocale(): AssetTrackLocale {
  return localeFromLanguage(getLanguage());
}

export function isChinese(): boolean {
  return getLocale() === "zh-CN";
}

export function t(chinese: string, english: string): string {
  return isChinese() ? chinese : english;
}

export function localizedValue(
  value: string,
  translations: Readonly<Record<string, string>>
): string {
  return isChinese() ? value : translations[value] ?? value;
}

export const BUSINESS_VALUE_EN: Readonly<Record<string, string>> = {
  "支出": "Expense",
  "收入": "Income",
  "代付": "Paid on behalf",
  "加仓": "Investment contribution",
  "提现": "Investment withdrawal",
  "忽略": "Ignore",
  "必要": "Essential",
  "可控": "Discretionary",
  "不适用": "Not applicable",
  "周期": "Recurring",
  "日常": "Everyday",
  "偶尔": "Occasional",
  "在用": "In use",
  "闲置": "Idle",
  "已出售": "Sold",
  "已报废": "Retired",
  "草稿": "Draft",
  "已保存": "Saved",
  "多消费少支出": "More consumption than recorded expenses",
  "少消费多支出": "Less consumption than recorded expenses",
  "平账": "Reconciled",
  "日期": "Date",
  "金额": "Amount",
  "分类": "Category",
  "商品": "Item",
  "交易对方": "Counterparty",
  "字段": "Field",
  "无效": "Invalid"
};

export function businessLabel(value: string): string {
  return localizedValue(value, BUSINESS_VALUE_EN);
}

export function displayError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (isChinese()) return raw;
  const exact: Readonly<Record<string, string>> = {
    "请选择 Asset-track 数据目录": "Select an Asset Track data directory.",
    "数据库已在运行；请使用迁移当前库或载入目标库":
      "A database is already open. Migrate the current database or load the target database.",
    "所选目录已有 accounting_system.db，请使用载入数据库":
      "The selected directory already contains accounting_system.db. Use Load database.",
    "所选目录没有 accounting_system.db":
      "The selected directory does not contain accounting_system.db.",
    "当前数据库尚未就绪": "The current database is not ready.",
    "所选目录就是当前数据目录": "The selected directory is already in use.",
    "当前编辑器存在未保存草稿，不能切换数据目录":
      "The editor has unsaved changes, so the data directory cannot be switched.",
    "目标目录已有 accounting_system.db，迁移不会覆盖":
      "The target directory already contains accounting_system.db. Migration will not overwrite it.",
    "目标目录没有可载入的数据库":
      "The target directory does not contain a database that can be loaded.",
    "Asset Track 仅支持桌面文件系统 Vault":
      "Asset Track supports desktop filesystem vaults only.",
    "数据库尚未就绪": "The database is not ready.",
    "保护备份校验失败": "Protection backup validation failed.",
    "尚未选择数据目录": "No data directory has been selected.",
    "当前 Obsidian 桌面运行时无法打开系统文件选择器":
      "The current desktop runtime cannot open the system file picker.",
    "流水质检未通过": "Transaction validation failed.",
    "分类 key 和名称不能为空或重复": "Category keys and names must be present and unique.",
    "分类收支类型只能是收入或支出": "A category type must be Income or Expense.",
    "分类必要性无效": "The category necessity value is invalid.",
    "分类消费频率无效": "The category spending frequency is invalid.",
    "账户 key、名称或类型无效或重复": "Account keys, names, and types must be valid and unique.",
    "已有账户不能改变现金/理财类型": "An existing account cannot switch between cash and investment.",
    "流水 id 不属于当前月份或重复": "A transaction ID is duplicated or does not belong to the current month.",
    "现金账户无效或重复": "A cash account is invalid or duplicated.",
    "理财账户无效或重复": "An investment account is invalid or duplicated.",
    "固定资产 asset_key 重复": "A fixed asset key is duplicated.",
    "自动规则必须填写交易对方或商品，并选择分类":
      "An automatic rule requires a counterparty or item and a category.",
    "自动规则的收支类型只能是支出或收入":
      "An automatic rule type must be Expense or Income.",
    "同一收支类型下不能存在重复或等价交易规则":
      "Duplicate or equivalent rules are not allowed for the same transaction type.",
    "自动规则 id 无效或重复": "An automatic rule ID is invalid or duplicated.",
    "借款发生日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM":
      "A debt start date must be YYYY-MM-DD, YYYY/MM/DD, or YYYY-MM.",
    "借款还清日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM":
      "A debt paid date must be YYYY-MM-DD, YYYY/MM/DD, or YYYY-MM.",
    "已还借款必须填写还清日期": "A paid debt requires a paid date.",
    "借款还清日期不能早于发生日期":
      "A debt paid date cannot be earlier than its start date.",
    "借款 id 无效或重复": "A debt ID is invalid or duplicated.",
    "年份必须是 YYYY": "The year must use YYYY format.",
    "周期项本月未出现，建议确认是否漏记或已取消":
      "This recurring category is missing this month. Check whether it was omitted or canceled.",
    "过去 12 个月未出现的大额商品":
      "Large item not seen in the previous 12 months.",
    "CSV 没有可识别的表头": "The CSV file has no recognizable header row.",
    "工作簿中没有可读取的工作表": "The workbook has no readable worksheet.",
    "工作表没有可识别的表头": "The worksheet has no recognizable header row.",
    "当前导入入口支持 CSV、XLSX 和 XLS 文件":
      "This import flow supports CSV, XLSX, and XLS files.",
    "已忽略非文本数据目录": "A non-text data directory setting was ignored.",
    "已忽略一个无效账单映射配置": "An invalid statement mapping was ignored.",
    "已忽略格式错误的账单映射列表": "A malformed statement mapping list was ignored.",
    "日期为空": "Date is empty.",
    "金额无法识别": "Amount is not recognizable.",
    "金额必须大于 0": "Amount must be greater than zero."
  };
  if (exact[raw]) return exact[raw];
  return raw
    .replace(/^非法月份：/, "Invalid month: ")
    .replace(/^第 (\d+) 行的资产名称不能为空$/, "Fixed asset name is required on row $1.")
    .replace(/^最多只能预建到 /, "Months can only be created through ")
    .replace(/^只能按自然顺序创建下一个月份 /, "The next month must be created in calendar order: ")
    .replace(/^当前最多只能创建到 /, "Months can currently only be created through ")
    .replace(/^最多只能有一个草稿月份；请先保存或删除 /, "Only one draft month is allowed. Save or delete ")
    .replace(/ 不存在，无需删除$/, " does not exist and does not need to be deleted.")
    .replace(/^数据库未载入，原文件未修改：/, "Database not loaded; original files were not changed: ")
    .replace(/^备份失败：/, "Backup failed: ")
    .replace(/^校验失败：/, "Validation failed: ")
    .replace(/^恢复失败：/, "Restore failed: ")
    .replace(/^保存失败：/, "Save failed: ")
    .replace(/^加载失败：/, "Load failed: ")
    .replace(/^导入失败：/, "Import failed: ");
}
