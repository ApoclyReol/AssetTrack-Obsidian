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
  "少收入": "Income under-recorded",
  "少支出": "Expense under-recorded",
  "平账": "Reconciled",
  "警告": "Warning",
  "错误": "Error",
  "规则": "Rule",
  "空": "(empty)",
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

function errorFieldLabel(value: string): string {
  return {
    "购买价格": "Purchase price",
    "本金": "Principal",
    "市值": "Market value",
    "流动现金": "Liquid cash",
    "余额": "Balance"
  }[value] ?? businessLabel(value);
}

function englishError(raw: string): string {
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
    "数据库正在恢复，请稍后重试":
      "The database is being restored. Try again shortly.",
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
    "自动规则必须填写商品，并选择分类":
      "An automatic rule requires an item and a category.",
    "自动规则的收支类型只能是支出或收入":
      "An automatic rule type must be Expense or Income.",
    "同一收支类型下不能存在重复或等价交易规则":
      "Duplicate or equivalent rules are not allowed for the same transaction type.",
    "同一收支类型和商品下不能存在重复规则":
      "Duplicate rules are not allowed for the same transaction type and item.",
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
    "日期必须是 YYYY-MM-DD 或 YYYY/MM/DD":
      "Date must use YYYY-MM-DD or YYYY/MM/DD.",
    "金额无法识别": "Amount is not recognizable.",
    "金额必须是有限数字": "Amount must be a finite number.",
    "金额不能为负数": "Amount cannot be negative.",
    "金额为空或无法识别": "Amount is empty or unrecognized.",
    "金额为 0": "Amount is zero.",
    "商品为空": "Item is empty.",
    "补充商品说明，方便后续分类和排查":
      "Add an item description to help with classification and review.",
    "改为纯数字金额": "Enter a numeric amount.",
    "确认这是否是需要保留的占位流水":
      "Confirm whether this placeholder transaction should be kept.",
    "填写正数金额；系统会按流水类型表达收支方向":
      "Enter a non-negative amount; the transaction type expresses its direction.",
    "请选择支出、收入、代付、加仓或提现":
      "Choose Expense, Income, Paid on behalf, Investment contribution, or Investment withdrawal.",
    "特殊类型流水不能设置分类":
      "Special transaction types cannot have a category.",
    "代付、加仓、提现的分类必须为空":
      "Paid on behalf, investment contribution, and investment withdrawal transactions must have an empty category.",
    "API 不完整": "The node:sqlite API is incomplete.",
    "Asset-track 数据目录必须是 Vault 内的相对路径":
      "The Asset Track data directory must be a relative path inside the vault.",
    "Asset-track 数据目录包含无效字符":
      "The Asset Track data directory contains an invalid character.",
    "Asset-track 数据目录不能包含 . 或 ..":
      "The Asset Track data directory cannot contain . or ..",
    "Asset-track 数据路径超出当前 Vault":
      "The Asset Track data path is outside the current vault.",
    "尚未选择 Asset-track 数据目录":
      "No Asset Track data directory has been selected.",
    "新自动规则不能使用停用分类":
      "A new automatic rule cannot use an inactive category.",
    "商品回溯至少选择一个筛选条件后再加载":
      "Choose at least one product-history filter before loading.",
    "请选择至少一条有效历史流水": "Select at least one valid historical transaction.",
    "回溯流水不能重复选择": "A historical transaction cannot be selected more than once.",
    "部分流水不属于已保存月份，回溯未执行":
      "Some transactions are not in saved months, so the backfill was not applied.",
    "目标分类不存在或已停用": "The target category does not exist or is inactive.",
    "目标分类的收支类型与选中流水不一致":
      "The target category type does not match the selected transactions.",
    "回溯更新行数与预览不一致，已回滚":
      "The backfill update count did not match the preview; the transaction was rolled back.",
    "目标商品名称不能为空": "The target item name cannot be empty.",
    "商品名称更新行数与预览不一致，已回滚":
      "The item-name update count did not match the preview; the transaction was rolled back.",
    "请选择备份导出目录": "Choose a backup export directory.",
    "迁移数据库校验失败": "Migrated database validation failed.",
    "所选目录没有有效数据库": "The selected directory does not contain a valid database.",
    "ZIP 目录无效": "The ZIP directory is invalid.",
    "ZIP 文件数量超过安全上限": "The ZIP contains too many files.",
    "ZIP 中央目录无效": "The ZIP central directory is invalid.",
    "ZIP 解压后体积超过安全上限": "The uncompressed ZIP exceeds the safety limit.",
    "ZIP 本地目录无效": "The ZIP local directory is invalid.",
    "SQLite schema 校验失败": "SQLite schema validation failed.",
    "完整备份缺少 accounting_system.db":
      "The complete backup is missing accounting_system.db.",
    "不支持的备份格式版本": "The backup format version is not supported.",
    "manifest 的必需表清单不完整或顺序不匹配":
      "The manifest required-table list is incomplete or out of order.",
    "manifest 的表摘要不完整": "The manifest table summary is incomplete."
  };
  if (exact[raw]) return exact[raw];

  const invalidMonth = /^非法月份：(.+)$/.exec(raw);
  if (invalidMonth) return `Invalid month: ${invalidMonth[1]}`;
  const invalidAssetName = /^第 (\d+) 行的资产名称不能为空$/.exec(raw);
  if (invalidAssetName) return `The asset name in row ${invalidAssetName[1]} cannot be empty.`;
  const nextMonthOrder = /^只能按自然顺序创建下一个月份 (.+)$/.exec(raw);
  if (nextMonthOrder) return `The next month must be created in calendar order: ${nextMonthOrder[1]}.`;
  const maxMonth = /^当前最多只能创建到 (.+)$/.exec(raw);
  if (maxMonth) return `The latest available month is ${maxMonth[1]}.`;
  const futureDebt = /^借款未来 (.+) 已还清，不可修改此月借款。$/.exec(raw);
  if (futureDebt) return `This debt was already paid on ${futureDebt[1]}; it cannot be changed from this month.`;
  const draftMonth = /^请先保存或删除草稿月份 (.+)$/.exec(raw);
  if (draftMonth) return `Save or delete draft month ${draftMonth[1]} first.`;
  const precreateMonth = /^最多只能预建到 (.+)$/.exec(raw);
  if (precreateMonth) return `Months can only be created in advance through ${precreateMonth[1]}.`;
  const singleDraft = /^最多只能有一个草稿月份；请先保存或删除 (.+)$/.exec(raw);
  if (singleDraft) return `Only one draft month is allowed. Save or delete ${singleDraft[1]} first.`;
  const missingMonth = /^(.+) 不存在，无需删除$/.exec(raw);
  if (missingMonth) return `Month ${missingMonth[1]} does not exist, so there is nothing to delete.`;
  const invalidDate = /^无法识别日期：(.+)$/.exec(raw);
  if (invalidDate) return `Unrecognized date: ${invalidDate[1]}`;
  const dateOutsideMonth = /^日期不属于当前月份 (.+)$/.exec(raw);
  if (dateOutsideMonth) return `Date does not belong to the current month ${dateOutsideMonth[1]}.`;
  const invalidType = /^无效收支类型：(.+)$/.exec(raw);
  if (invalidType) {
    const value = invalidType[1] === "空" ? "(empty)" : businessLabel(invalidType[1]);
    return `Invalid transaction type: ${value}`;
  }
  const missingCategory = /^(支出|收入)未选择有效分类$/.exec(raw);
  if (missingCategory) return `${businessLabel(missingCategory[1])} has no valid category selected.`;
  const inactiveCategory = /^请选择一个已启用的(支出|收入)分类$/.exec(raw);
  if (inactiveCategory) return `Choose an active ${businessLabel(inactiveCategory[1])} category.`;
  const mismatchedCategory = /^(支出|收入)使用了不匹配的分类$/.exec(raw);
  if (mismatchedCategory) return `${businessLabel(mismatchedCategory[1])} uses a mismatched category.`;
  const chooseCategory = /^请选择(支出|收入)类分类$/.exec(raw);
  if (chooseCategory) return `Choose an ${businessLabel(chooseCategory[1])} category.`;
  const validColumn = /^请选择有效的(.+)列$/.exec(raw);
  if (validColumn) {
    const label = {
      "日期/时间": "date or time",
      "商品或说明": "item or description",
      "金额": "amount",
      "收支方向": "transaction direction"
    }[validColumn[1]] ?? validColumn[1];
    return `Select a valid ${label} column.`;
  }
  const missingColumn = /^选择的(.+)列不存在$/.exec(raw);
  if (missingColumn) {
    const label = {
      "交易对方": "counterparty",
      "分类": "category",
      "交易状态": "transaction status"
    }[missingColumn[1]] ?? missingColumn[1];
    return `The selected ${label} column does not exist.`;
  }
  const unmappedType = /^收支值“(.*)”尚未映射$/.exec(raw);
  if (unmappedType) return `Transaction value “${unmappedType[1]}” has not been mapped.`;
  const invalidRuleCategory = /^(支出|收入)规则不能使用分类“(.+)”$/.exec(raw);
  if (invalidRuleCategory) {
    return `${businessLabel(invalidRuleCategory[1])} rules cannot use category “${invalidRuleCategory[2]}”.`;
  }
  const categoryReferences = /^分类“(.+)”已有不匹配的历史引用，不能改变收支类型$/.exec(raw);
  if (categoryReferences) {
    return `Category “${categoryReferences[1]}” has incompatible historical references, so its transaction type cannot be changed.`;
  }
  const categoryDeleteReferences =
    /^分类“(.+)”仍有 (\d+) 条历史流水和 (\d+) 条规则引用，不能删除$/.exec(raw);
  if (categoryDeleteReferences) {
    const transactionCount = Number(categoryDeleteReferences[2]);
    const ruleCount = Number(categoryDeleteReferences[3]);
    return `Category “${categoryDeleteReferences[1]}” still has ${
      transactionCount
    } historical transaction${transactionCount === 1 ? "" : "s"} and ${
      ruleCount
    } rule reference${ruleCount === 1 ? "" : "s"}, so it cannot be deleted.`;
  }
  const missingRevision = /^缺少 (.+) 的 revision$/.exec(raw);
  if (missingRevision) return `The revision for ${missingRevision[1]} is missing.`;
  const unresolvedRules = /^选中流水存在未解决的规则冲突(?:（规则 (.+)）)?，请先处理规则$/.exec(raw);
  if (unresolvedRules) {
    return unresolvedRules[1]
      ? `Selected transactions have unresolved rule conflicts (rules ${unresolvedRules[1]}). Resolve the rules first.`
      : "Selected transactions have unresolved rule conflicts. Resolve the rules first.";
  }
  const finite = /^(.+)必须是有限数字$/.exec(raw);
  if (finite) return `${errorFieldLabel(finite[1])} must be a finite number.`;
  const nonNegative = /^(.+)不能为负数$/.exec(raw);
  if (nonNegative) return `${errorFieldLabel(nonNegative[1])} cannot be negative.`;
  const ignoredDirectory = /^已忽略无效数据目录：(.+)$/.exec(raw);
  if (ignoredDirectory) return `Ignored invalid data directory: ${englishError(ignoredDirectory[1])}`;
  const invalidNode = /^Node (.+) 低于 22\.16$/.exec(raw);
  if (invalidNode) return `Node ${invalidNode[1]} is below 22.16.`;
  const sqliteUnavailable = /^当前 Obsidian 桌面运行时不支持 node:sqlite（(.+)）。请下载并安装新版 Obsidian 桌面安装器后重试。$/.exec(raw);
  if (sqliteUnavailable) {
    return `The current Obsidian desktop runtime does not support node:sqlite (${englishError(sqliteUnavailable[1])}). Download and install a newer Obsidian desktop installer, then try again.`;
  }
  const schema = /^仅支持完整 schema (\d+) 数据库；版本=(\d+)，缺少表=(.*?)，缺少字段=(.*?)，缺少索引=(.*?)，缺少外键=(.*?)，外键违规=(.*?)，完整性=(.*)$/.exec(raw);
  if (schema) {
    const schemaValue = (value: string): string => value === "无"
      ? "none"
      : value === "未检查"
        ? "not checked"
        : value;
    return `Only complete schema ${schema[1]} databases are supported; version=${schema[2]}, missing tables=${schemaValue(schema[3])}, missing columns=${schemaValue(schema[4])}, missing indexes=${schemaValue(schema[5])}, missing foreign keys=${schemaValue(schema[6])}, foreign-key violations=${schemaValue(schema[7])}, integrity=${schemaValue(schema[8])}.`;
  }
  const invalidZipPath = /^ZIP 包含非法路径：(.+)$/.exec(raw);
  if (invalidZipPath) return `The ZIP contains an unsafe path: ${invalidZipPath[1]}`;
  const unsupportedCompression = /^ZIP 压缩算法不受支持：(.+)$/.exec(raw);
  if (unsupportedCompression) return `The ZIP compression method is not supported: ${unsupportedCompression[1]}`;
  const zipSizeMismatch = /^ZIP 文件大小不匹配：(.+)$/.exec(raw);
  if (zipSizeMismatch) return `The ZIP file size does not match: ${zipSizeMismatch[1]}`;
  const missingBackupSource = /^备份来源不存在：(.+)$/.exec(raw);
  if (missingBackupSource) return `The backup source does not exist: ${missingBackupSource[1]}`;
  const unsupportedBackupSource = /^不支持的备份来源：(.+)$/.exec(raw);
  if (unsupportedBackupSource) return `The backup source is not supported: ${unsupportedBackupSource[1]}`;
  const unreadableManifest = /^manifest\.json 无法读取：(.+)$/.exec(raw);
  if (unreadableManifest) return `manifest.json could not be read: ${englishError(unreadableManifest[1])}`;
  const fileValidation = /^文件校验失败：(.+)$/.exec(raw);
  if (fileValidation) return `File validation failed: ${fileValidation[1]}`;
  const missingBackupCsv = /^备份缺少 CSV：(.+)$/.exec(raw);
  if (missingBackupCsv) return `The backup is missing CSV file ${missingBackupCsv[1]}.`;
  const csvColumns = /^CSV 字段不匹配：(.+)$/.exec(raw);
  if (csvColumns) return `CSV columns do not match for ${csvColumns[1]}.`;
  const rowCount = /^数据库、CSV 与 manifest 行数不一致：(.+)$/.exec(raw);
  if (rowCount) return `Database, CSV, and manifest row counts differ for ${rowCount[1]}.`;
  const contentDigest = /^数据库与 CSV 内容摘要不一致：(.+)$/.exec(raw);
  if (contentDigest) return `Database and CSV content digests differ for ${contentDigest[1]}.`;
  const combinedMessage = raw.includes("；") ? raw.split("；") : [];
  if (combinedMessage.length > 1) {
    return combinedMessage.map((part) => englishError(part)).join("; ");
  }
  const newLargeItem = /^(.+)：(过去 12 个月未出现的大额商品|出现新的大额商品)$/.exec(raw);
  if (newLargeItem) {
    return `${newLargeItem[1]}: ${
      newLargeItem[2] === "过去 12 个月未出现的大额商品"
        ? "Large item not seen in the previous 12 months."
        : "New large item."
    }`;
  }
  const comparison = /^(.*)（(.+)）$/.exec(raw);
  if (comparison) {
    const details = comparison[2].split("，").map((part) =>
      part.startsWith("上月")
        ? `previous month ${part.slice(2)}`
        : part.startsWith("三月")
          ? `three-month average ${part.slice(2)}`
          : part
    );
    return `${comparison[1]} (${details.join(", ")})`;
  }
  const nestedError = /^Error: (.+)$/.exec(raw);
  if (nestedError) return englishError(nestedError[1]);
  if (/[\u3400-\u9fff]/u.test(raw)) {
    return "Asset Track could not complete this operation.";
  }
  return raw;
}

export function displayError(error: unknown): string {
  const structured = typeof error === "object" && error !== null
    ? error as {
        code?: string;
        params?: Record<string, string | number | boolean | null>;
      }
    : null;
  if (structured?.code === "IMPORT_FILE_TOO_LARGE") {
    const limit = structured.params?.limitMiB ?? 20;
    return t(
      `账单文件不能超过 ${limit} MiB；请拆分后重新导入。`,
      `Statement files cannot exceed ${limit} MiB. Split the file and import it again.`
    );
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (isChinese()) return raw;
  return englishError(raw);
}
