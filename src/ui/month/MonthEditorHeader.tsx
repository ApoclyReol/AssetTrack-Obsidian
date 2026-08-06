import type {
  MonthSection,
  MonthWorkspace
} from "../../types/month";
import type {
  TransactionBusinessTab
} from "../../types/operations";
import { businessLabel, t } from "../../i18n";
import { money } from "../../domain/moneyFormat";
import { type MonthMetrics } from "../monthEditorModel";
import { reconciliationStatus, reconciliationTone } from "../analysisModel";
import { debtSummary } from "../MonthDebtSection";
import type { OperationState } from "../editorPrimitives";
import { TRANSACTION_BUSINESS_TABS } from "./MonthEditorTransactionsSection";

interface MonthEditorHeaderProps {
  activeSection?: MonthSection;
  draft: MonthWorkspace;
  month: string;
  state: OperationState;
  dirtySections: MonthSection[];
  monthMetrics: MonthMetrics;
  reconciliationTolerance: number;
  businessTab: TransactionBusinessTab;
  hasSelectedTransactions?: boolean;
  emptyMonth: boolean;
  deleteConfirm: string;
  showDeleteConfirm: boolean;
  onOpenImport: () => void;
  onBusinessTabChange: (tab: TransactionBusinessTab) => void;
  onApplyRules: () => Promise<void>;
  onReload: () => Promise<void>;
  onSave: () => Promise<void>;
  onLoad: () => Promise<void>;
  onRequestDelete: () => void;
  onDelete: () => Promise<void>;
  onDeleteConfirmChange: (value: string) => void;
  onCancelDelete: () => void;
}

function activeSectionTitle(
  section: MonthSection,
  draft: MonthWorkspace
): string {
  if (section === "fixed_assets") {
    return t(
      `固定资产（${draft.fixed_assets.length} 项）`,
      `Fixed assets (${draft.fixed_assets.length})`
    );
  }
  if (section === "debts") return t("借款", "Debts");
  return section === "assets"
    ? t("资产账户", "Asset accounts")
    : t("流水", "Transactions");
}

function importButton(
  onOpenImport: () => void,
  disabled: boolean
) {
  return (
    <button
      type="button"
      className="mod-cta"
      disabled={disabled}
      onClick={onOpenImport}
      title={t(
        "支持 CSV、XLSX、XLS；导入前需要确认字段和收支映射",
        "Supports CSV, XLSX, and XLS. Confirm fields and income/expense mappings before importing."
      )}
    >
      {t("导入账单", "Import statement")}
    </button>
  );
}

export function MonthEditorHeader({
  activeSection,
  draft,
  month,
  state,
  dirtySections,
  monthMetrics,
  reconciliationTolerance,
  businessTab,
  hasSelectedTransactions = false,
  emptyMonth,
  deleteConfirm,
  showDeleteConfirm,
  onOpenImport,
  onBusinessTabChange,
  onApplyRules,
  onReload,
  onSave,
  onLoad,
  onRequestDelete,
  onDelete,
  onDeleteConfirmChange,
  onCancelDelete
}: MonthEditorHeaderProps) {
  const discrepancyStatus = monthMetrics.discrepancy === null
    ? ""
    : reconciliationStatus(monthMetrics.discrepancy, reconciliationTolerance);
  const showAllSections = activeSection === undefined;

  return (
    <>
      {activeSection && (
        <section className="asset-track-month-header asset-track-page-heading">
          <div className="asset-track-page-heading-content">
            <div className="asset-track-page-heading-main">
              <h2>{activeSectionTitle(activeSection, draft)}</h2>
              {activeSection === "transactions" && <div
                className="asset-track-transaction-business-tabs"
                role="tablist"
                aria-label={t("流水业务类型", "Transaction business type")}
              >
                {TRANSACTION_BUSINESS_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    className={businessTab === tab.value ? "is-active" : ""}
                    aria-selected={businessTab === tab.value}
                    onClick={() => onBusinessTabChange(tab.value)}
                  >
                    {t(tab.label, tab.englishLabel)}
                  </button>
                ))}
              </div>}
            </div>
            {activeSection === "debts" && <span>{(() => {
              const summary = debtSummary(draft.debts);
              return t(
                `本月相关 ${draft.debts.length} 笔 · 本月未还 ${money(summary.openAmount)} · 本月还清 ${summary.paidCount} 笔`,
                `${draft.debts.length} related debts · Unpaid this month ${money(summary.openAmount)} · ${summary.paidCount} paid this month`
              );
            })()}</span>}
            {activeSection === "fixed_assets" && <span>{t(
              "固定资产不计入总资产、对账和消费计算。",
              "Fixed assets are excluded from total assets, reconciliation, and spending calculations."
            )}</span>}
          </div>
          <div className="asset-track-page-actions">
            {activeSection === "transactions" && <>
              {importButton(onOpenImport, state.kind === "pending")}
              {businessTab !== "investment" && <button
                type="button"
                disabled={state.kind === "pending" || hasSelectedTransactions}
                title={hasSelectedTransactions
                  ? t("当前已有选中流水，请先取消选择后再应用全部规则。", "Selected rows are active. Clear the selection before applying all rules.")
                  : undefined}
                onClick={() => void onApplyRules()}
              >
                {t("应用规则", "Apply rules")}
              </button>}
            </>}
            <button
              type="button"
              disabled={state.kind === "pending"}
              onClick={() => void onReload()}
            >
              {t("放弃并重载", "Discard and reload")}
            </button>
            <button
              type="button"
              className="mod-cta"
              disabled={state.kind === "pending" || !dirtySections.includes(activeSection)}
              onClick={() => void onSave()}
            >
              {{
                assets: t("保存资产", "Save assets"),
                transactions: t("保存流水", "Save transactions"),
                debts: t("保存借款", "Save debts"),
                fixed_assets: t("保存固定资产", "Save fixed assets")
              }[activeSection]}
            </button>
          </div>
        </section>
      )}

      {showAllSections && <section className="asset-track-month-header">
        <div>
          <h2>{month}</h2>
          <span>{businessLabel(draft.status)} · revision {draft.revision}</span>
        </div>
        <div className="asset-track-actions">
          {importButton(onOpenImport, state.kind === "pending")}
          {businessTab !== "investment" && <button
            type="button"
            disabled={state.kind === "pending" || hasSelectedTransactions}
            title={hasSelectedTransactions
              ? t("当前已有选中流水，请先取消选择后再应用全部规则。", "Selected rows are active. Clear the selection before applying all rules.")
              : undefined}
            onClick={() => void onApplyRules()}
          >
            {t("应用规则", "Apply rules")}
          </button>}
          <button
            type="button"
            disabled={state.kind === "pending"}
            onClick={() => void onLoad()}
          >
            {t("放弃并重载", "Discard and reload")}
          </button>
          <button
            type="button"
            className="mod-warning"
            disabled={state.kind === "pending"}
            onClick={onRequestDelete}
          >
            {t("删除月份", "Delete month")}
          </button>
          <button
            type="button"
            className="mod-cta"
            disabled={state.kind === "pending"}
            onClick={() => void onSave()}
          >
            {t("保存月份", "Save month")}
          </button>
        </div>
      </section>}

      {showAllSections && <section
        className="asset-track-month-metrics"
        aria-label={t("本月摘要", "Monthly summary")}
      >
        <div className={`asset-track-month-metric ${reconciliationTone(
          monthMetrics.discrepancy,
          reconciliationTolerance
        ) ?? ""}`}>
          <span>{t("对账差额", "Reconciliation difference")}</span>
          <strong>
            {monthMetrics.discrepancy === null
              ? t("不可比较", "Unavailable")
              : money(monthMetrics.discrepancy)}
            {discrepancyStatus && <small className="asset-track-month-metric-suffix">
              （{businessLabel(discrepancyStatus)}）
            </small>}
          </strong>
        </div>
        <div className="asset-track-month-metric inflow">
          <span>{t("收入", "Income")}</span>
          <strong>{money(monthMetrics.income)}</strong>
        </div>
        <div className="asset-track-month-metric outflow">
          <span>{t("净支出", "Net expense")}</span>
          <strong>{money(monthMetrics.expense)}</strong>
        </div>
      </section>}

      {showDeleteConfirm && !emptyMonth && <section className="asset-track-delete-confirm">
        <strong>{t(
          "删除后会清理该月全部数据库事实，且无法在界面中撤销。",
          "Deleting this month removes all of its database records and cannot be undone in the interface."
        )}</strong>
        <label>
          {t(`输入完整月份 ${month}`, `Enter the full month ${month}`)}
          <input
            autoFocus
            value={deleteConfirm}
            onChange={(event) => onDeleteConfirmChange(event.target.value.trim())}
          />
        </label>
        <button
          type="button"
          className="mod-warning"
          disabled={deleteConfirm !== month || state.kind === "pending"}
          onClick={() => void onDelete()}
        >
          {t(`确认删除 ${month}`, `Confirm deletion of ${month}`)}
        </button>
        <button type="button" onClick={onCancelDelete}>
          {t("取消", "Cancel")}
        </button>
      </section>}
    </>
  );
}
