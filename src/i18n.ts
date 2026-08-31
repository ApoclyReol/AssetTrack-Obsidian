import { getLanguage } from "obsidian";
import { AssetTrackError, type AssetTrackErrorParams } from "./application/errors";

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
  "交易对手": "Counterparty",
  "字段": "Field",
  "无效": "Invalid"
};

export function businessLabel(value: string): string {
  return localizedValue(value, BUSINESS_VALUE_EN);
}

function paramText(params: AssetTrackErrorParams, key: string, fallback = "—"): string {
  const value = params[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? fallback;
}

function structuredErrorText(
  code: string,
  params: AssetTrackErrorParams
): { chinese: string; english: string } | null {
  switch (code) {
    case "revision_conflict":
      return {
        chinese: `revision 冲突：草稿基于 ${paramText(params, "expected")}，当前数据库为 ${paramText(params, "actual")}。请重新加载。`,
        english: `Revision conflict: the draft is based on ${paramText(params, "expected")}, but the database is at ${paramText(params, "actual")}. Reload and try again.`
      };
    case "rules.revision_conflict":
      return {
        chinese: `规则 revision 冲突：预览基于 ${paramText(params, "expected_rules_revision")}，当前规则为 ${paramText(params, "actual_rules_revision")}。请重新生成预览。`,
        english: `Rules revision conflict: the preview is based on ${paramText(params, "expected_rules_revision")}, but the current rules are at ${paramText(params, "actual_rules_revision")}. Generate the preview again.`
      };
    case "transaction.category.invalid_selection":
      return {
        chinese: "批量分类只能处理支出、收入或代付流水。",
        english: "Batch category edits only support expense, income, or paid-on-behalf transactions."
      };
    case "transaction.category.mixed_types":
      return {
        chinese: "不能同时修改不同收支类型的流水分类，请分开选择。",
        english: "Transactions with different types cannot have their categories edited together. Select one type at a time."
      };
    case "transaction.category.invalid_target":
      return {
        chinese: "批量分类必须选择启用中的有效分类。",
        english: "Batch category edits require an active category."
      };
    case "transaction.category.mismatched_target":
      return {
        chinese: "批量分类的目标分类必须与所有选中流水的收支类型一致。",
        english: "The target category must match the transaction type of every selected row."
      };
    case "transaction.operation.unsupported":
      return {
        chinese: `不支持的流水操作：${paramText(params, "operation_type")}`,
        english: `Unsupported transaction operation: ${paramText(params, "operation_type")}.`
      };
    case "transaction.selection.invalid":
      return {
        chinese: "流水选择范围包含无效编号。",
        english: "The transaction selection contains an invalid ID."
      };
    case "transaction.selection.duplicate":
      return {
        chinese: "流水选择范围包含重复或空的选择标识。",
        english: "The transaction selection contains duplicate or empty identifiers."
      };
    case "transaction.selection.empty":
      return {
        chinese: "请至少选择一条流水。",
        english: "Select at least one transaction."
      };
    case "transaction.selection.not_found":
      return {
        chinese: "部分选中的流水已不在当前草稿中，请重新选择。",
        english: "Some selected transactions are no longer in the current draft. Select them again."
      };
    case "transaction.conversion.invalid_source":
      return {
        chinese: `只有${paramText(params, "expected")}流水可以执行此转换。`,
        english: `Only ${businessLabel(paramText(params, "expected"))} transactions can be converted this way.`
      };
    case "transaction.validation_failed":
      return {
        chinese: "流水质检未通过，请先处理标记为错误的问题。",
        english: "Transaction validation failed. Resolve the errors before saving."
      };
    case "transaction.id_invalid":
      return {
        chinese: "流水编号无效、重复，或不属于当前月份。",
        english: "A transaction ID is invalid, duplicated, or does not belong to the current month."
      };
    case "fixed_asset.name_required":
      return {
        chinese: `第 ${paramText(params, "row")} 行的资产名称不能为空。`,
        english: `The asset name in row ${paramText(params, "row")} cannot be empty.`
      };
    case "fixed_asset.key_duplicate":
      return {
        chinese: "固定资产标识不能重复。",
        english: "Fixed-asset keys cannot be duplicated."
      };
    case "fixed_asset.id_invalid":
      return {
        chinese: "固定资产编号无效，可能已被删除或不属于当前月份。",
        english: "The fixed-asset ID is invalid or does not belong to the current month."
      };
    case "fixed_asset.identity_conflict":
      return {
        chinese: "固定资产编号与标识不一致，请重新加载后再保存。",
        english: "The fixed-asset ID and key do not match. Reload before saving."
      };
    case "fixed_asset.status_invalid":
      return {
        chinese: `第 ${paramText(params, "row")} 行的固定资产状态无效。`,
        english: `The fixed-asset status in row ${paramText(params, "row")} is invalid.`
      };
    case "fixed_asset.date_invalid":
      return {
        chinese: `第 ${paramText(params, "row")} 行的购置日期无效。`,
        english: `The purchase date in row ${paramText(params, "row")} is invalid.`
      };
    case "history.filter_required":
      return {
        chinese: "商品回溯至少选择一个筛选条件后再加载。",
        english: "Choose at least one product-history filter before loading."
      };
    case "history.date_range_incomplete":
      return {
        chinese: "起止日期需要同时填写。",
        english: "Both start and end dates are required."
      };
    case "history.date_range_invalid":
      return {
        chinese: "起始日期不能晚于结束日期。",
        english: "The start date cannot be later than the end date."
      };
    case "history.selection_required":
      return {
        chinese: "请选择至少一条有效历史流水。",
        english: "Select at least one valid historical transaction."
      };
    case "history.selection_duplicate":
      return {
        chinese: "历史流水不能重复选择。",
        english: "A historical transaction cannot be selected more than once."
      };
    case "history.selection_not_saved":
      return {
        chinese: "部分流水不属于已保存月份，回溯未执行。",
        english: "Some transactions are not in saved months, so the backfill was not applied."
      };
    case "history.category_invalid":
      return {
        chinese: "目标分类不存在或已停用。",
        english: "The target category does not exist or is inactive."
      };
    case "history.category_type_mismatch":
      return {
        chinese: "目标分类的收支类型与选中流水不一致。",
        english: "The target category type does not match the selected transactions."
      };
    case "history.unresolved_rule_conflict":
      return {
        chinese: "选中流水存在未解决的规则冲突，请先处理规则。",
        english: "Selected transactions have unresolved rule conflicts. Resolve the rules first."
      };
    case "history.revision_missing":
      return {
        chinese: `缺少 ${paramText(params, "month")} 的 revision。`,
        english: `The revision for ${paramText(params, "month")} is missing.`
      };
    case "history.update_count_mismatch":
      return {
        chinese: "历史修改的更新行数与预览不一致，已回滚。",
        english: "The history update count did not match the preview; the transaction was rolled back."
      };
    case "history.target_required":
      return {
        chinese: `目标${businessLabel(paramText(params, "field"))}名称不能为空。`,
        english: `The target ${paramText(params, "field")} name cannot be empty.`
      };
    case "analysis.year_invalid":
      return {
        chinese: `年份必须是 YYYY：${paramText(params, "year")}`,
        english: `The year must use YYYY format: ${paramText(params, "year")}.`
      };
    case "amount.invalid_number":
      return {
        chinese: `${errorFieldLabel(paramText(params, "label", "金额"))}必须是有限数字`,
        english: `${errorFieldLabel(paramText(params, "label", "金额"))} must be a finite number.`
      };
    case "amount.negative":
      return {
        chinese: `${errorFieldLabel(paramText(params, "label", "金额"))}不能为负数`,
        english: `${errorFieldLabel(paramText(params, "label", "金额"))} cannot be negative.`
      };
    case "date.invalid_format":
      return {
        chinese: "无法识别日期格式；支持 YYYY-MM-DD、YYYY/MM/DD、MM/DD/YYYY、DD/MM/YYYY 或中文年月日",
        english: "The date format is not recognized. Use YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY, or Chinese date notation."
      };
    case "month.invalid":
      return {
        chinese: `非法月份：${paramText(params, "month")}`,
        english: `Invalid month: ${paramText(params, "month")}.`
      };
    case "month.not_loaded":
      return {
        chinese: "当前月份尚未加载。",
        english: "The current month has not loaded yet."
      };
    case "rules.not_loaded":
      return {
        chinese: "匹配规则尚未加载完成，请稍后再试。",
        english: "Matching rules have not finished loading. Try again shortly."
      };
    case "month.creation_order":
      return {
        chinese: `只能按自然顺序创建下一个月份：${paramText(params, "target")}`,
        english: `The next month must be created in calendar order: ${paramText(params, "target")}.`
      };
    case "month.creation_limit":
      return {
        chinese: `当前最多只能创建到 ${paramText(params, "max")}`,
        english: `The latest available month is ${paramText(params, "max")}.`
      };
    case "month.creation_blocked":
      return {
        chinese: "当前不能创建新月份",
        english: "A new month cannot be created right now."
      };
    case "month.draft_exists":
      return {
        chinese: `最多只能有一个草稿月份；请先保存或删除 ${paramText(params, "month")}`,
        english: `Only one draft month is allowed. Save or delete ${paramText(params, "month")} first.`
      };
    case "month.not_found":
      return {
        chinese: `${paramText(params, "month")} 不存在，无需删除。`,
        english: `Month ${paramText(params, "month")} does not exist, so there is nothing to delete.`
      };
    case "month.locked":
      return {
        chinese: `月份 ${paramText(params, "month")} 已锁定，不能修改或删除。`,
        english: `Month ${paramText(params, "month")} is locked and cannot be changed or deleted.`
      };
    case "month.status_invalid":
      return {
        chinese: `月份 ${paramText(params, "month")} 的状态无效（${paramText(params, "status")}），请先修复数据库。`,
        english: `Month ${paramText(params, "month")} has an invalid status (${paramText(params, "status")}); repair the database first.`
      };
    case "account.definition_invalid":
      return {
        chinese: "账户 key、名称或类型无效或重复。",
        english: "Account keys, names, and types must be valid and unique."
      };
    case "account.type_immutable":
      return {
        chinese: "已有账户不能改变现金/理财类型。",
        english: "An existing account cannot switch between cash and investment."
      };
    case "account.cash_invalid":
      return {
        chinese: "现金账户无效或重复。",
        english: "A cash account is invalid or duplicated."
      };
    case "account.cash_missing":
      return {
        chinese: `保存账户余额时缺少现金账户：${paramText(params, "account_keys")}。请重新加载月份后再保存。`,
        english: `Cash account balances are missing: ${paramText(params, "account_keys")}. Reload the month and save again.`
      };
    case "account.investment_invalid":
      return {
        chinese: "理财账户无效或重复。",
        english: "An investment account is invalid or duplicated."
      };
    case "account.investment_missing":
      return {
        chinese: `保存账户余额时缺少理财账户：${paramText(params, "account_keys")}。请重新加载月份后再保存。`,
        english: `Investment account balances are missing: ${paramText(params, "account_keys")}. Reload the month and save again.`
      };
    case "category.definition_invalid":
      return {
        chinese: "分类 key 和名称不能为空或重复。",
        english: "Category keys and names must be present and unique."
      };
    case "category.type_invalid":
      return {
        chinese: "分类收支类型只能是收入或支出。",
        english: "A category type must be Income or Expense."
      };
    case "category.necessity_invalid":
      return {
        chinese: "分类必要性无效。",
        english: "The category necessity value is invalid."
      };
    case "category.pattern_invalid":
      return {
        chinese: "分类消费频率无效。",
        english: "The category spending frequency is invalid."
      };
    case "category.type_change_referenced":
      return {
        chinese: `分类“${paramText(params, "name")}”已有不匹配的历史引用，不能改变收支类型。`,
        english: `Category “${paramText(params, "name")}” has incompatible historical references, so its transaction type cannot change.`
      };
    case "category.deactivation_referenced":
      return {
        chinese: `分类“${paramText(params, "name")}”仍被 ${paramText(params, "transaction_count", "0")} 条流水和 ${paramText(params, "rule_count", "0")} 条规则使用，不能停用。`,
        english: `Category “${paramText(params, "name")}” is still used by ${paramText(params, "transaction_count", "0")} transactions and ${paramText(params, "rule_count", "0")} rules, so it cannot be deactivated.`
      };
    case "category.delete_referenced":
      return {
        chinese: `分类“${paramText(params, "name")}”仍有 ${paramText(params, "transaction_count", "0")} 条历史流水和 ${paramText(params, "rule_count", "0")} 条规则引用，不能删除。`,
        english: `Category “${paramText(params, "name")}” still has ${paramText(params, "transaction_count", "0")} historical transactions and ${paramText(params, "rule_count", "0")} rule references, so it cannot be deleted.`
      };
    case "rule.definition_invalid":
      return {
        chinese: `第 ${paramText(params, "row")} 条规则无效。`,
        english: `Rule ${paramText(params, "row")} is invalid.`
      };
    case "rule.category_missing":
      return {
        chinese: `第 ${paramText(params, "row")} 条规则的分类不存在。`,
        english: `The category for rule ${paramText(params, "row")} does not exist.`
      };
    case "rule.category_inactive":
      return {
        chinese: "自动规则不能使用停用分类。",
        english: "An automatic rule cannot use an inactive category."
      };
    case "rule.type_invalid":
      return {
        chinese: "自动规则的收支类型只能是支出或收入。",
        english: "An automatic rule type must be Expense or Income."
      };
    case "rule.category_type_mismatch":
      return {
        chinese: `${paramText(params, "transaction_type")}规则不能使用分类“${paramText(params, "category")}”。`,
        english: `${businessLabel(paramText(params, "transaction_type"))} rules cannot use category “${paramText(params, "category")}”.`
      };
    case "rule.id_invalid":
      return {
        chinese: "自动规则 id 无效或重复。",
        english: "An automatic rule ID is invalid or duplicated."
      };
    case "rule.conflict":
    case "rule.impact_conflict":
      return {
        chinese: `规则冲突：${paramText(params, "description", "存在多个同等级规则")}`,
        english: `Rule conflict: ${paramText(params, "description", "multiple rules have the same priority")}.`
      };
    case "rule.rewrite_chain":
    case "rule.impact_rewrite_chain":
      return {
        chinese: `规则重写链冲突：${paramText(params, "reason", "请修改重写字段")}`,
        english: `Rule rewrite-chain conflict: ${paramText(params, "reason", "change the rewrite fields")}.`
      };
    case "rule.impact_invalid":
      return {
        chinese: "规则影响预览失败，请检查规则字段。",
        english: "The rule impact preview failed. Check the rule fields."
      };
    case "rule.impact_category_missing":
      return {
        chinese: "规则影响预览失败：目标分类不存在。",
        english: "The rule impact preview failed because the target category does not exist."
      };
    case "rule.impact_category_type_mismatch":
      return {
        chinese: "规则影响预览失败：目标分类与收支类型不匹配。",
        english: "The rule impact preview failed because the target category type does not match."
      };
    case "rule.impact_category_inactive":
      return {
        chinese: "规则影响预览失败：目标分类已停用。",
        english: "The rule impact preview failed because the target category is inactive."
      };
    case "debt.id_invalid":
      return {
        chinese: "借款 id 无效或重复。",
        english: "A debt ID is invalid or duplicated."
      };
    case "debt.future_locked":
      return {
        chinese: `借款未来 ${paramText(params, "paid_date")} 已还清，不可修改此月借款。`,
        english: `This debt was already paid on ${paramText(params, "paid_date")}; it cannot be changed from this month.`
      };
    case "debt.start_date_invalid":
      return {
        chinese: "借款发生日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM。",
        english: "A debt start date must be YYYY-MM-DD, YYYY/MM/DD, or YYYY-MM."
      };
    case "debt.paid_date_invalid":
      return {
        chinese: "借款还清日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM。",
        english: "A debt paid date must be YYYY-MM-DD, YYYY/MM/DD, or YYYY-MM."
      };
    case "debt.paid_date_required":
      return {
        chinese: "已还借款必须填写还清日期。",
        english: "A paid debt requires a paid date."
      };
    case "debt.paid_date_unexpected":
      return {
        chinese: "未还借款不能填写还清日期。",
        english: "An unpaid debt cannot have a paid date."
      };
    case "debt.paid_date_before_start":
      return {
        chinese: "借款还清日期不能早于发生日期。",
        english: "A debt paid date cannot be earlier than its start date."
      };
    case "operation.logs_section_required":
      return {
        chinese: "操作日志只能随流水区块一起提交。",
        english: "Operation logs can only be submitted with the transaction section."
      };
    case "operation.preview_selection_mismatch":
    case "operation.preview_metadata_mismatch":
    case "operation.preview_ids_mismatch":
    case "operation.preview_counts_changed":
    case "operation.preview_month_mismatch":
    case "operation.preview_row_deleted":
    case "operation.preview_row_missing":
    case "operation.preview_fields_missing":
    case "operation.preview_status_changed":
    case "operation.preview_change_mismatch":
    case "operation.preview_draft_mismatch":
    case "operation.preview_uncategorized_changed":
    case "operation.preview_category_changed":
      return {
        chinese: "流水操作预览已失效，请重新生成后再保存。",
        english: "The transaction operation preview is no longer valid. Generate it again before saving."
      };
    case "backup.directory_required":
      return {
        chinese: "请选择备份导出目录",
        english: "Choose a backup export directory."
      };
    case "backup.schema_invalid":
      return {
        chinese: "SQLite schema 校验失败。",
        english: "SQLite schema validation failed."
      };
    case "backup.zip.directory_invalid":
      return { chinese: "ZIP 目录无效。", english: "The ZIP directory is invalid." };
    case "backup.zip.member_limit":
      return {
        chinese: `ZIP 文件数量超过安全上限（${paramText(params, "limit")}）。`,
        english: `The ZIP contains more than the safety limit of ${paramText(params, "limit")} files.`
      };
    case "backup.zip.central_directory_invalid":
      return { chinese: "ZIP 中央目录无效。", english: "The ZIP central directory is invalid." };
    case "backup.zip.uncompressed_limit":
      return {
        chinese: "ZIP 解压后体积超过安全上限。",
        english: "The uncompressed ZIP exceeds the safety limit."
      };
    case "backup.zip.unsafe_path":
      return {
        chinese: `ZIP 包含非法路径：${paramText(params, "path")}`,
        english: `The ZIP contains an unsafe path: ${paramText(params, "path")}`
      };
    case "backup.zip.local_directory_invalid":
      return { chinese: "ZIP 本地目录无效。", english: "The ZIP local directory is invalid." };
    case "backup.zip.compression_unsupported":
      return {
        chinese: `ZIP 压缩算法不受支持：${paramText(params, "method")}`,
        english: `The ZIP compression method is not supported: ${paramText(params, "method")}`
      };
    case "backup.zip.size_mismatch":
      return {
        chinese: `ZIP 文件大小不匹配：${paramText(params, "path")}`,
        english: `The ZIP file size does not match: ${paramText(params, "path")}`
      };
    case "backup.database_missing":
      return {
        chinese: "完整备份缺少 accounting_system.db。",
        english: "The complete backup is missing accounting_system.db."
      };
    case "backup.source_missing":
      return {
        chinese: `备份来源不存在：${paramText(params, "path")}`,
        english: `The backup source does not exist: ${paramText(params, "path")}`
      };
    case "backup.source_unsupported":
      return {
        chinese: `不支持的备份来源：${paramText(params, "path")}`,
        english: `The backup source is not supported: ${paramText(params, "path")}`
      };
    case "backup.manifest_unreadable":
      return {
        chinese: "manifest.json 无法读取。",
        english: "manifest.json could not be read."
      };
    case "backup.format_unsupported":
      return {
        chinese: `不支持的备份格式版本：${paramText(params, "version")}`,
        english: `The backup format version is not supported: ${paramText(params, "version")}`
      };
    case "backup.manifest_tables_invalid":
      return {
        chinese: "manifest 的必需表清单不完整或顺序不匹配。",
        english: "The manifest required-table list is incomplete or out of order."
      };
    case "backup.manifest_summary_invalid":
      return {
        chinese: "manifest 的表摘要不完整。",
        english: "The manifest table summary is incomplete."
      };
    case "backup.manifest_files_invalid":
      return {
        chinese: "manifest 的文件清单不完整或包含未声明文件。",
        english: "The backup manifest file list is incomplete or contains undeclared files."
      };
    case "backup.file_digest_mismatch":
      return {
        chinese: `文件校验失败：${paramText(params, "filename")}`,
        english: `File validation failed: ${paramText(params, "filename")}`
      };
    case "backup.csv_missing":
      return {
        chinese: `备份缺少 CSV：${paramText(params, "filename")}`,
        english: `The backup is missing CSV file ${paramText(params, "filename")}.`
      };
    case "backup.csv_columns_mismatch":
      return {
        chinese: `CSV 字段不匹配：${paramText(params, "filename")}`,
        english: `CSV columns do not match for ${paramText(params, "filename")}.`
      };
    case "backup.row_count_mismatch":
      return {
        chinese: `数据库、CSV 与 manifest 行数不一致：${paramText(params, "table")}`,
        english: `Database, CSV, and manifest row counts differ for ${paramText(params, "table")}.`
      };
    case "backup.content_digest_mismatch":
      return {
        chinese: `数据库与 CSV 内容摘要不一致：${paramText(params, "table")}`,
        english: `Database and CSV content digests differ for ${paramText(params, "table")}.`
      };
    case "sqlite.runtime_unavailable": {
      const reason = paramText(params, "reason", "unknown runtime error");
      return {
        chinese: `当前 Obsidian 桌面运行时不支持 node:sqlite（${reason}）。请下载并安装新版 Obsidian 桌面安装器后重试。`,
        english: `The current Obsidian desktop runtime does not support node:sqlite (${englishError(reason)}). Download and install a newer Obsidian desktop installer, then try again.`
      };
    }
    case "sqlite.api_incomplete":
      return {
        chinese: "当前 Obsidian 桌面运行时缺少完整的 node:sqlite API。",
        english: "The current Obsidian desktop runtime does not provide the complete node:sqlite API."
      };
    case "sqlite.node_version_unsupported":
      return {
        chinese: `当前 Node.js 版本 ${paramText(params, "node")} 不满足要求（至少 22.16）。`,
        english: `Node.js ${paramText(params, "node")} is not supported; version 22.16 or newer is required.`
      };
    case "database.empty_user_version":
      return {
        chinese: `空数据库的 user_version 必须为 0，当前为 ${paramText(params, "version")}`,
        english: `An empty database must have user_version 0, but it is ${paramText(params, "version")}.`
      };
    case "database.validation_failed":
      return {
        chinese: `SQLite schema 校验失败${paramText(params, "version", "") ? `（版本 ${paramText(params, "version")}）` : ""}`,
        english: `SQLite schema validation failed${paramText(params, "version", "") ? ` (version ${paramText(params, "version")})` : ""}.`
      };
    case "database.snapshot_validation_failed":
      return {
        chinese: "schema 保护备份校验失败。",
        english: "The schema protection snapshot failed validation."
      };
    case "database.restoring":
      return {
        chinese: "数据库正在恢复，请稍后重试",
        english: "The database is being restored. Try again shortly."
      };
    case "database.already_open":
      return {
        chinese: "数据库已在运行；请使用迁移当前库或载入目标库",
        english: "A database is already open. Migrate the current database or load the target database."
      };
    case "database.file_exists_use_load":
      return {
        chinese: "所选目录已有 accounting_system.db，请使用载入数据库",
        english: "The selected directory already contains accounting_system.db. Use Load database."
      };
    case "database.file_missing":
      return {
        chinese: "所选目录没有 accounting_system.db",
        english: "The selected directory does not contain accounting_system.db."
      };
    case "database.not_ready":
      return {
        chinese: "当前数据库尚未就绪",
        english: "The current database is not ready."
      };
    case "database.directory_in_use":
      return {
        chinese: "所选目录就是当前数据目录",
        english: "The selected directory is already in use."
      };
    case "database.unsaved_changes":
      return {
        chinese: "当前编辑器存在未保存草稿，不能切换数据目录",
        english: "The editor has unsaved changes, so the data directory cannot be switched."
      };
    case "database.migration_target_exists":
      return {
        chinese: "目标目录已有 accounting_system.db，迁移不会覆盖",
        english: "The target directory already contains accounting_system.db. Migration will not overwrite it."
      };
    case "database.invalid_database":
      return {
        chinese: "所选目录没有有效数据库",
        english: "The selected directory does not contain a valid database."
      };
    case "database.migration_validation_failed":
      return {
        chinese: "迁移数据库校验失败",
        english: "Migrated database validation failed."
      };
    case "database.migration_blocked":
      return {
        chinese: `数据库迁移已阻止：${paramText(params, "details", "请先处理迁移报告中的问题。")}`,
        english: `Database migration was blocked: ${paramText(params, "details", "resolve the issues in the migration report first.")}`
      };
    case "database.protection_backup_invalid":
      return {
        chinese: "保护备份校验失败",
        english: "Protection backup validation failed."
      };
    case "filesystem.desktop_vault_required":
      return {
        chinese: "Asset Track 仅支持桌面文件系统 Vault",
        english: "Asset Track supports desktop filesystem vaults only."
      };
    case "rules.unsaved_changes":
      return {
        chinese: "当前有未保存的分类或规则修改，请先保存后再直接创建规则。",
        english: "Save the current category or rule changes before creating a rule directly."
      };
    case "rules.duplicate":
      return {
        chinese: "相同收支、匹配范围和条件的规则已经存在。",
        english: "A rule with the same type, scope, and conditions already exists."
      };
    case "import.file_too_large":
    case "IMPORT_FILE_TOO_LARGE": {
      const limit = paramText(params, "limitMiB", "20");
      return {
        chinese: `账单文件不能超过 ${limit} MiB；请拆分后重新导入。`,
        english: `Statement files cannot exceed ${limit} MiB. Split the file and import it again.`
      };
    }
    case "workspace.relative_required":
      return {
        chinese: "Asset-track 数据目录必须是 Vault 内的相对路径",
        english: "The Asset Track data directory must be a relative path inside the vault."
      };
    case "workspace.invalid_character":
      return {
        chinese: "Asset-track 数据目录包含无效字符",
        english: "The Asset Track data directory contains an invalid character."
      };
    case "workspace.dot_segment":
      return {
        chinese: "Asset-track 数据目录不能包含 . 或 ..",
        english: "The Asset Track data directory cannot contain \".\" or \"..\"."
      };
    case "workspace.outside_vault":
      return {
        chinese: "Asset-track 数据路径超出当前 Vault",
        english: "The Asset Track data path is outside the current vault."
      };
    case "workspace.data_directory_required":
      return {
        chinese: "尚未选择 Asset-track 数据目录",
        english: "No Asset Track data directory has been selected."
      };
    case "native.file_picker_unavailable":
      return {
        chinese: "当前 Obsidian 桌面运行时无法打开系统文件选择器",
        english: "The current desktop runtime cannot open the system file picker."
      };
    case "csv.header_missing":
      return {
        chinese: "CSV 没有可识别的表头",
        english: "The CSV file has no recognizable header row."
      };
    case "csv.duplicate_header":
      return {
        chinese: `账单包含重复表头“${paramText(params, "header")}”，请先整理文件后重新导入。`,
        english: `The statement contains the duplicate header “${paramText(params, "header")}`
          + `”. Rename or remove it before importing again.`
      };
    case "csv.worksheet_missing":
      return {
        chinese: "工作簿中没有可读取的工作表",
        english: "The workbook has no readable worksheet."
      };
    case "csv.worksheet_header_missing":
      return {
        chinese: "工作表没有可识别的表头",
        english: "The worksheet has no recognizable header row."
      };
    case "csv.extension_unsupported":
      return {
        chinese: "请选择 CSV、XLSX 或 XLS 格式的账单文件。",
        english: "Choose a CSV, XLSX, or XLS statement file."
      };
    case "csv.mapping_required": {
      const field = csvFieldLabel(paramText(params, "field"));
      return {
        chinese: `请选择有效的${field.chinese}列`,
        english: `Choose a valid ${field.english} column.`
      };
    }
    case "csv.mapping_missing": {
      const field = csvFieldLabel(paramText(params, "field"));
      return {
        chinese: `选择的${field.chinese}列不存在`,
        english: `The selected ${field.english} column does not exist.`
      };
    }
    case "csv.status_selection_required":
      return {
        chinese: "已选择交易状态列，请至少选择一个要导入的状态。",
        english: "A transaction status column is selected; choose at least one status to import."
      };
    case "csv.file_not_selected":
      return {
        chinese: "尚未选择账单文件。",
        english: "No statement file has been selected."
      };
    case "transaction.selection.no_editable_rows":
      return {
        chinese: "当前选择没有可修改的流水。",
        english: "The current selection has no editable transactions."
      };
    case "ai.timeout":
      return {
        chinese: `AI 请求超时（${paramText(params, "timeoutMs")} ms）`,
        english: `The AI request timed out after ${paramText(params, "timeoutMs")} ms.`
      };
    case "ai.http_error":
      return {
        chinese: `AI API 返回 HTTP ${paramText(params, "status")}`,
        english: `The AI API returned HTTP ${paramText(params, "status")}.`
      };
    case "ai.configuration_missing":
      return {
        chinese: "请先在设置中配置 AI API 地址和模型。",
        english: "Configure the AI API endpoint and model in Settings first."
      };
    case "ai.api_key_missing":
      return {
        chinese: "请先在设置中配置 AI API Key。",
        english: "Configure the AI API key in Settings first."
      };
    case "ai.request_in_flight":
      return {
        chinese: "相同的 AI 请求仍在处理中，请稍后再试。",
        english: "The same AI request is still in flight. Try again shortly."
      };
    case "validation_error": {
      const message = paramText(params, "message", "校验失败");
      return {
        chinese: message,
        english: englishError(message)
      };
    }
    default:
      return null;
  }
}

export function errorMessage(
  code: string,
  params: AssetTrackErrorParams = {}
): string {
  const translated = structuredErrorText(code, params);
  if (translated) return isChinese() ? translated.chinese : translated.english;
  return isChinese()
    ? paramText(params, "message", `操作失败：${code}`)
    : "Asset Track could not complete this operation.";
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

function csvFieldLabel(value: string): { chinese: string; english: string } {
  return {
    date_column: { chinese: "日期/时间", english: "date/time" },
    product_column: { chinese: "商品或说明", english: "item or description" },
    amount_column: { chinese: "金额", english: "amount" },
    type_column: { chinese: "收支方向", english: "transaction type" },
    counterparty_column: { chinese: "交易对手", english: "counterparty" },
    category_column: { chinese: "分类", english: "category" },
    status_column: { chinese: "交易状态", english: "transaction status" }
  }[value] ?? { chinese: value, english: value };
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
    "使用 YYYY-MM-DD、YYYY/MM/DD、MM/DD/YYYY、DD/MM/YYYY 或中文年月日":
      "Use YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY, or Chinese date notation.",
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
    "加仓、提现的分类必须为空":
      "Investment contribution and investment withdrawal transactions must have an empty category.",
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
  if (/^批量分类只能处理支出、收入或代付流水。?$/.test(raw)) {
    return "Batch category edits only support expense, income, or paid-on-behalf transactions.";
  }
  if (/^不能同时修改不同收支类型的流水分类，请分开选择。?$/.test(raw)) {
    return "Transactions with different types cannot have their categories edited together. Select one type at a time.";
  }
  if (/^操作目标分类不存在或已停用，请重新生成预览$/.test(raw)) {
    return "The operation target category does not exist or is inactive. Generate the preview again.";
  }
  if (/^操作目标分类与流水收支类型不匹配，请重新生成预览$/.test(raw)) {
    return "The operation target category does not match the transaction type. Generate the preview again.";
  }
  if (/^操作预览的未分类目标已变化，请重新生成预览$/.test(raw)) {
    return "The uncategorized operation target changed. Generate the preview again.";
  }
  if (/^操作预览的目标分类已变化，请重新生成预览$/.test(raw)) {
    return "The operation target category changed. Generate the preview again.";
  }
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
      "交易对手": "counterparty",
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
  if (error instanceof AssetTrackError) {
    return errorMessage(error.code, error.params);
  }
  const structured = typeof error === "object" && error !== null
    ? error as {
        code?: string;
        params?: AssetTrackErrorParams;
      }
    : null;
  if (structured?.code) return errorMessage(structured.code, structured.params);
  const raw = error instanceof Error ? error.message : String(error);
  if (isChinese()) return raw;
  return englishError(raw);
}
