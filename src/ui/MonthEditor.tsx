import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { Notice, type App } from "obsidian";
import type {
  CsvColumnMapping
} from "../types/csv";
import type {
  CsvRawRow
} from "../types/csv";
import type {
  FixedAsset,
  MonthSection,
  MonthWorkspace
} from "../types/month";
import type {
  AssetTrackSettings
} from "../types/settings";
import type {
  Transaction
} from "../types/transactions";
import type {
  MonthEditorPort,
  RuleWritePort
} from "../services/ports";
import type { SavedRule } from "../types/rules";
import { createTransactionDraft } from "./analysisModel";
import { CsvImportDialog } from "./CsvImportDialog";
import { displayError, t } from "../i18n";
import type {
  EditorDraftSnapshot,
  MonthEditorDraftSnapshot
} from "./editorDraft";
import {
  number,
  type SortState,
  Status,
  messageFor,
  transactionAmount
} from "./editorPrimitives";
import {
  draftMonthMetrics,
  isEmptyMonthDraft,
  type MonthMetrics
} from "./monthEditorModel";
import { MonthEditorHeader } from "./month/MonthEditorHeader";
import { MonthEditorStatusBar } from "./month/MonthEditorStatusBar";
import { MonthEditorAssetsSection } from "./month/MonthEditorAssetsSection";
import { MonthEditorTransactionsSection } from "./month/MonthEditorTransactionsSection";
import { MonthEditorSupplementalSections } from "./month/MonthEditorSupplementalSections";
import { monthWorkflowSummary } from "./monthWorkflow";
import { RuleCreationModal } from "./RuleCreationModal";
import { transactionKey as operationTransactionKey } from "../domain/transactionOperations";
import { resolveRule, ruleCategoryType } from "../domain/rules";
import type { EditorSession } from "./editorSession";
import { useMonthEditorSession } from "./month/useMonthEditorSession";
import { useTransactionOperations } from "./month/useTransactionOperations";
import {
  useCsvImportSession
} from "./month/useCsvImportSession";
import type {
  TransactionGroup
} from "./transactionGrouping";

export interface MonthEditorHandle extends EditorSession {
  requestDelete: () => void;
  openImport: () => void;
  applyRules: () => Promise<void>;
}

export { MONTH_SECTIONS, type MonthMetrics } from "./monthEditorModel";

interface SourceRowPreview {
  filename: string;
  headers: string[];
  row: CsvRawRow;
}

const SOURCE_ROW_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function CsvSourceRowModal({
  preview,
  onClose
}: {
  preview: SourceRowPreview;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(SOURCE_ROW_FOCUSABLE_SELECTOR) ?? []
    );
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = dialogRef.current?.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="asset-track-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="asset-track-modal asset-track-source-row-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-track-source-row-title"
        aria-describedby="asset-track-source-row-description"
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <h2 id="asset-track-source-row-title">{t("原始账单行", "Raw statement row")}</h2>
            <span className="asset-track-modal-subtitle">
              {preview.filename} · {t(`原始第 ${preview.row.row} 行`, `Source row ${preview.row.row}`)}
            </span>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose}>
            {t("关闭", "Close")}
          </button>
        </header>
        <p id="asset-track-source-row-description" className="asset-track-import-intro">
          {t("这是导入时保留的原始单元格内容，用于核对流水映射。它不会修改当前草稿。", "These are the source cells retained during import for checking the mapping. They do not modify the current draft.")}
        </p>
        <div className="asset-track-table-scroll asset-track-source-row-table">
          <table>
            <thead>
              <tr>
                {preview.headers.map((header) => <th key={header} scope="col">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                {preview.headers.map((header, index) => (
                  <td key={header}>
                    {preview.row.values[index]?.trim() || t("（空）", "(empty)")}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <footer>
          <button type="button" onClick={onClose}>{t("关闭", "Close")}</button>
        </footer>
      </section>
    </div>
  );
}

export const MonthEditor = forwardRef<MonthEditorHandle, {
  app?: App;
  api: MonthEditorPort;
  settings?: AssetTrackSettings;
  hostWindow: Window;
  month: string;
  months: string[];
  dataVersion: number;
  reconciliationTolerance: number;
  activeSection?: MonthSection;
  onMetricsChange?: (metrics: MonthMetrics | null) => void;
  onDeleted: (next: string) => Promise<void>;
  onSaved: () => Promise<void>;
  onNavigateSection?: (section: MonthSection) => Promise<void>;
  onNavigateAnalysis?: () => Promise<void>;
  onDataChanged?: () => void;
  initialDraft?: MonthEditorDraftSnapshot;
  onSessionChange: (snapshot: EditorDraftSnapshot | null) => void;
  getCsvMapping: (signature: string) => CsvColumnMapping | undefined;
  saveCsvMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
  clearCsvMapping?: (signature: string) => Promise<void>;
}>(function MonthEditor({
  app,
  api,
  settings,
  hostWindow,
  month,
  months,
  dataVersion,
  reconciliationTolerance,
  activeSection,
  onMetricsChange,
  onDeleted,
  onSaved,
  onNavigateSection,
  onNavigateAnalysis,
  onDataChanged,
  initialDraft,
  onSessionChange,
  getCsvMapping,
  saveCsvMapping,
  clearCsvMapping
}, ref) {
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const session = useMonthEditorSession({
    api,
    month,
    dataVersion,
    activeSection,
    initialDraft,
    onMetricsChange,
    onSessionChange,
    onSaved,
    onReloaded: () => {
      setShowDeleteConfirm(false);
      setDeleteConfirm("");
    }
  });
  const {
    draft,
    categories,
    rules,
    setRules,
    rulesRevision,
    setRulesRevision,
    issues,
    state,
    setState,
    dirtySections,
    dirtySectionsRef,
    pendingOperationLogsRef,
    transactionResetVersion,
    load,
    mark,
    reloadCurrentSection,
    save,
    saveAll,
    discardAll,
    acknowledgeDataChange,
    hasUnsavedChanges,
    getDraftSnapshot
  } = session;
  const operations = useTransactionOperations({
    app,
    api,
    settings,
    hostWindow,
    month,
    draft,
    categories,
    rules,
    rulesRevision,
    setState,
    mark,
    pendingOperationLogsRef,
    transactionResetVersion
  });
  const csv = useCsvImportSession({
    api,
    month,
    activeSection,
    draft,
    setState,
    mark,
    invalidatePendingOperationLogs: operations.invalidatePendingOperationLogs,
    saveCsvMapping
  });
  const [summarySort, setSummarySort] = useState<SortState>({
    key: "count",
    direction: "desc"
  });
  const [expandedGroup, setExpandedGroup] = useState("");
  const [transactionViewMode, setTransactionViewMode] = useState<"detail" | "product" | "counterparty">("detail");
  const [lastSavedAt, setLastSavedAt] = useState<string>();
  const [sourceRowPreview, setSourceRowPreview] = useState<SourceRowPreview | null>(null);
  const actionRef = useRef<MonthEditorHandle>({
    requestDelete: () => undefined,
    openImport: () => undefined,
    applyRules: async () => undefined,
    save: async () => false,
    saveAll: async () => false,
    discard: async () => undefined,
    discardAll: async () => undefined,
    getDraftSnapshot: () => null,
    hasUnsavedChanges: () => false
  });
  useImperativeHandle(ref, () => ({
    requestDelete: () => actionRef.current.requestDelete(),
    openImport: () => actionRef.current.openImport(),
    applyRules: () => actionRef.current.applyRules(),
    save: () => actionRef.current.save(),
    saveAll: () => actionRef.current.saveAll(),
    discard: () => actionRef.current.discard(),
    discardAll: () => actionRef.current.discardAll(),
    getDraftSnapshot: () => actionRef.current.getDraftSnapshot(),
    hasUnsavedChanges: () => actionRef.current.hasUnsavedChanges()
  }), [ref]);

  if (!draft) return <Status state={state} />;
  const monthMetrics = draftMonthMetrics(draft);
  const emptyMonth = isEmptyMonthDraft(draft, dirtySections.length > 0);
  const showAllSections = activeSection === undefined;

  const updatedTransactionRow = (
    row: Transaction,
    field: keyof Transaction,
    value: string
  ): Transaction => {
    const next = {
      ...row,
      [field]: field === "amount" ? transactionAmount(value) : value
    };
    if (field === "type" && ["代付", "加仓", "提现"].includes(value)) {
      if (value !== "代付") {
        next.category = "";
        next.category_key = null;
      }
    }
    if (field === "type" && ["加仓", "提现"].includes(value)) {
      next.account_key = next.account_key
        ?? draft.investment_accounts.find((account) => account.is_active)?.account_key
        ?? draft.investment_accounts[0]?.account_key
        ?? null;
    } else if (field === "type" && !["加仓", "提现"].includes(value)) {
      next.account_key = null;
    }
    if (next.type === "加仓" || next.type === "提现") {
      next.counterparty = next.type;
      next.product = next.account_key ?? next.type;
    }
    if (field === "category_key") {
      next.category =
        categories.find((category) => category.category_key === value)?.name ?? "";
    }
    return next;
  };

  const updateTransaction = (
    index: number,
    field: keyof Transaction,
    value: string
  ) => {
    const rows = draft.transactions.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return updatedTransactionRow(row, field, value);
    });
    operations.protectTransaction(index);
    operations.invalidatePendingOperationLogs();
    mark({ ...draft, transactions: rows }, "transactions");
  };

  const updateTransactionGroup = (
    indexes: readonly number[],
    field: keyof Transaction,
    value: string
  ) => {
    const targetIndexes = new Set(indexes);
    const rows = draft.transactions.map((row, rowIndex) =>
      targetIndexes.has(rowIndex)
        ? updatedTransactionRow(row, field, value)
        : row
    );
    targetIndexes.forEach((index) => operations.protectTransaction(index));
    operations.invalidatePendingOperationLogs();
    mark({ ...draft, transactions: rows }, "transactions");
  };

  const updateAsset = (index: number, field: keyof FixedAsset, value: string) => {
    const rows = draft.fixed_assets.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [field]: field === "purchase_price" ? number(value) : value
          }
        : row
    );
    mark({ ...draft, fixed_assets: rows }, "fixed_assets");
  };

  const updateCashBalance = (index: number, value: number) => {
    mark({
      ...draft,
      cash_accounts: draft.cash_accounts.map((row, item) =>
        item === index ? { ...row, balance: value } : row
      )
    }, "assets");
  };

  const updateInvestment = (
    index: number,
    field: "principal" | "market_value" | "cash_balance",
    value: number
  ) => {
    mark({
      ...draft,
      investment_accounts: draft.investment_accounts.map((row, item) =>
        item === index ? { ...row, [field]: value } : row
      )
    }, "assets");
  };

  const deleteTransaction = (index: number) => {
    operations.invalidatePendingOperationLogs();
    mark({
      ...draft,
      transactions: draft.transactions.filter((_, item) => item !== index)
    }, "transactions");
  };

  const addTransaction = (title: string) => {
    operations.invalidatePendingOperationLogs();
    const transaction = createTransactionDraft(title, month, categories);
    if (title === "加仓" || title === "提现") {
      transaction.account_key = draft.investment_accounts.find((account) => account.is_active)?.account_key
        ?? draft.investment_accounts[0]?.account_key
        ?? null;
      transaction.counterparty = title;
      transaction.product = transaction.account_key ?? title;
    }
    mark({
      ...draft,
      transactions: [
        ...draft.transactions,
        transaction
      ]
    }, "transactions");
  };

  const updateDebts = (rows: MonthWorkspace["debts"]) => {
    mark({ ...draft, debts: rows }, "debts");
  };

  const deleteFixedAsset = (index: number) => {
    mark({
      ...draft,
      fixed_assets: draft.fixed_assets.filter((_, item) => item !== index)
    }, "fixed_assets");
  };

  const addFixedAsset = () => {
    mark({
      ...draft,
      fixed_assets: [
        ...draft.fixed_assets,
        {
          client_id: crypto.randomUUID(),
          asset_key: crypto.randomUUID(),
          asset_name: "",
          category: "",
          purchase_date: null,
          purchase_price: 0,
          status: "在用",
          note: ""
        }
      ]
    }, "fixed_assets");
  };

  const openRuleCreationForRow = (
    row: Transaction,
    rowIndex: number,
    preferredScope?: "product" | "merchant" | "merchant_product"
  ) => {
    if (!app || (row.type !== "支出" && row.type !== "收入" && row.type !== "代付")) return;
    const ruleTransactionType = row.type;
    const category = categories.find((item) => item.category_key === row.category_key
      && item.transaction_type === ruleCategoryType(ruleTransactionType));
    const matchScope = preferredScope
      ?? (row.counterparty?.trim() ? "merchant_product" : "product");
    new RuleCreationModal({
      app,
      categories,
      initial: {
        transaction_type: ruleTransactionType,
        match_scope: matchScope,
        counterparty: matchScope === "product" ? "" : row.counterparty ?? "",
        product: matchScope === "merchant" ? "" : row.product,
        category_key: category?.category_key ?? "",
        category: category?.name ?? row.category
      },
      onConfirm: async (rule) => {
        const shell = await api.ruleWorkspaceShell();
        const nextRules = [...shell.rules, rule].map((item) => ({ ...item }));
        const selectedKey = operationTransactionKey(row, rowIndex);
        const saved = await (api as MonthEditorPort & RuleWritePort).saveRules(shell.rules_revision, nextRules, {
          source_page: "记录/流水",
          operation_type: "create-rule",
          selection: [selectedKey],
          metadata: { rule_id: rule.id ?? null }
        });
        // The rule revision is part of any pending transaction-operation
        // preview. A directly created rule invalidates those previews even
        // though the current draft rows themselves remain usable.
        operations.invalidatePendingOperationLogs();
        acknowledgeDataChange();
        onDataChanged?.();
        setRules(saved.rows as unknown as SavedRule[]);
        setRulesRevision(saved.revision);
        try {
          const updatedShell = await api.ruleWorkspaceShell();
          setRules(updatedShell.rules);
          setRulesRevision(updatedShell.rules_revision);
          new Notice(t("规则已保存；历史流水未自动改写。", "Rule saved; historical transactions were not rewritten."));
        } catch (error) {
          new Notice(t(
            `规则已保存，但规则列表刷新失败：${messageFor(error)}`,
            `Rule saved, but the rule list could not refresh: ${messageFor(error)}`
          ));
        }
      }
    }).open();
  };

  const openRuleCreationForGroup = (group: TransactionGroup) => {
    const rowIndex = group.indexes.find((index) => Boolean(draft.transactions[index]));
    if (rowIndex === undefined) return;
    const row = draft.transactions[rowIndex];
    if (!row) return;
    openRuleCreationForRow(
      row,
      rowIndex,
      group.groupBy === "product" ? "product" : "merchant"
    );
  };

  const saveAndClearImportFeedback = async (): Promise<boolean> => {
    const saved = await save();
    if (saved) {
      csv.clearImportFeedback();
      setLastSavedAt(new Date().toLocaleTimeString());
    }
    return saved;
  };

  const saveAllAndClearImportFeedback = async (): Promise<boolean> => {
    const saved = await saveAll();
    if (saved) {
      csv.clearImportFeedback();
      setLastSavedAt(new Date().toLocaleTimeString());
    }
    return saved;
  };

  const renderRuleControls = ({ row, index }: { row: Transaction; index: number }) => {
    if (row.type !== "支出" && row.type !== "收入" && row.type !== "代付") return null;
    const explanation = resolveRule(row, rules);
    if (explanation.status === "none") {
      return <span className="asset-track-rule-indicator is-no-rule">
        <button className="asset-track-rule-button" type="button" onClick={() => openRuleCreationForRow(row, index)}>{t("新建规则", "New rule")}</button>
      </span>;
    }
    const label = explanation.status === "matched"
      ? t(`规则 #${explanation.selected_rule_id ?? "?"}`, `Rule #${explanation.selected_rule_id ?? "?"}`)
      : t(`冲突 #${explanation.rule_ids.join(",")}`, `Conflict #${explanation.rule_ids.join(",")}`);
    return <span className={`asset-track-rule-indicator is-${explanation.status}`}>
      <button
        type="button"
        className="asset-track-rule-button"
        title={displayError(explanation.reason)}
        aria-label={label}
        onClick={(event) => event.preventDefault()}
      >{label}</button>
    </span>;
  };

  const deleteMonth = async () => {
    if (!emptyMonth && deleteConfirm !== month) {
      const message = t("确认月份不匹配，未删除。", "The confirmation month did not match. Nothing was deleted.");
      new Notice(message);
      setState({ kind: "error", message });
      return;
    }
    setState({ kind: "pending", message: t(`正在删除 ${month}…`, `Deleting ${month}…`) });
    try {
      await api.deleteMonth(month, draft.revision);
      const remaining = months.filter((item) => item !== month).sort();
      const next = remaining.filter((item) => item < month).at(-1) ?? remaining.at(0) ?? "";
      onSessionChange(null);
      dirtySectionsRef.current = [];
      await onDeleted(next);
      setShowDeleteConfirm(false);
      setDeleteConfirm("");
      new Notice(t(`${month} 已删除`, `${month} deleted`));
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  };

  const requestDelete = () => {
    if (emptyMonth) {
      void deleteMonth();
      return;
    }
    setShowDeleteConfirm((visible) => !visible);
  };

  actionRef.current = {
    requestDelete,
    openImport: csv.openImport,
    applyRules: operations.applyRules,
    save: saveAndClearImportFeedback,
    saveAll: saveAllAndClearImportFeedback,
    discard: reloadCurrentSection,
    discardAll,
    getDraftSnapshot,
    hasUnsavedChanges
  };

  const workflow = monthWorkflowSummary(
    draft,
    issues,
    dirtySections,
    reconciliationTolerance
  );
  const goToNextStep = async (): Promise<void> => {
    if (workflow.status === "completed") {
      await onNavigateAnalysis?.();
      return;
    }
    if (workflow.nextSection === "transactions") {
      if (workflow.status === "not-started") {
        csv.openImport();
      } else if (activeSection === undefined || activeSection === "transactions") {
        setTransactionViewMode("detail");
      } else {
        await onNavigateSection?.("transactions");
      }
      return;
    }
    if (workflow.nextSection) await onNavigateSection?.(workflow.nextSection);
  };

  return (
    <main className="asset-track-editor">
      {csv.csvSource && (
        <CsvImportDialog
          hostWindow={hostWindow}
          inspection={csv.csvSource.inspection}
          savedMapping={getCsvMapping(
            csv.csvSource.inspection.header_signature
          )}
          onCancel={csv.cancelImport}
          onHeaderRowChange={csv.selectCsvStructure}
          onPreview={csv.previewMappedCsv}
          onApply={csv.applyCsvPreview}
          onClearSavedMapping={clearCsvMapping}
        />
      )}
      {sourceRowPreview && (
        <CsvSourceRowModal
          preview={sourceRowPreview}
          onClose={() => setSourceRowPreview(null)}
        />
      )}
      <input
        ref={csv.csvInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => void csv.importCsv(event)}
      />
      <MonthEditorHeader
        activeSection={activeSection}
        draft={draft}
        month={month}
        state={state}
        dirtySections={dirtySections}
        monthMetrics={monthMetrics}
        reconciliationTolerance={reconciliationTolerance}
        businessTab={operations.businessTab}
        hasSelectedTransactions={operations.selectedTransactionKeys.size > 0}
        emptyMonth={emptyMonth}
        deleteConfirm={deleteConfirm}
        showDeleteConfirm={showDeleteConfirm}
        onOpenImport={csv.openImport}
        onBusinessTabChange={operations.changeBusinessTab}
        onApplyRules={operations.applyRules}
        onReload={reloadCurrentSection}
        onSave={async () => { await saveAndClearImportFeedback(); }}
        onLoad={load}
        onRequestDelete={requestDelete}
        onDelete={deleteMonth}
        onDeleteConfirmChange={setDeleteConfirm}
        onCancelDelete={() => {
          setShowDeleteConfirm(false);
          setDeleteConfirm("");
        }}
      />
      <MonthEditorStatusBar
        state={state}
        workflow={workflow}
        issues={issues}
        feedback={csv.importFeedback}
        lastSavedAt={lastSavedAt}
        activeSection={activeSection}
        onNextStep={goToNextStep}
        onRetryImport={csv.openImport}
        onSaveImport={saveAndClearImportFeedback}
        onDismissImport={csv.clearImportFeedback}
        onViewTransactions={onNavigateSection
          ? () => { void onNavigateSection("transactions"); }
          : undefined}
      />
      {(showAllSections || activeSection === "assets") && <MonthEditorAssetsSection
        draft={draft}
        onCashBalanceChange={updateCashBalance}
        onInvestmentChange={updateInvestment}
      />}
      {(showAllSections || activeSection === "transactions") && <MonthEditorTransactionsSection
        month={month}
        draft={draft}
        categories={categories}
        issues={issues}
        rules={rules}
        summarySort={summarySort}
        expandedGroup={expandedGroup}
        onSummarySort={setSummarySort}
        onExpandedGroupChange={setExpandedGroup}
        onUpdate={updateTransaction}
        onUpdateGroup={updateTransactionGroup}
        onDelete={deleteTransaction}
        onAdd={addTransaction}
        sourceRows={csv.lastImportedSource?.rows}
        onViewSourceRow={(row, sourceRow) => {
          const source = csv.lastImportedSource;
          if (!source) return;
          setSourceRowPreview({
            filename: source.filename,
            headers: source.headers,
            row: sourceRow
          });
        }}
        businessTab={operations.businessTab}
        onBusinessTabChange={operations.changeBusinessTab}
        showBusinessTabs={activeSection !== "transactions"}
        viewMode={transactionViewMode}
        onViewModeChange={setTransactionViewMode}
        selectedTransactionKeys={operations.selectedTransactionKeys}
        onSelectedTransactionKeysChange={operations.onSelectedTransactionKeysChange}
        onCreateRule={openRuleCreationForGroup}
        renderBatchActions={({ businessTab: currentTab, selectedTransactionKeys: keys }) => <>
          {(currentTab === "outgoing" || currentTab === "incoming") && <button
            type="button"
            disabled={state.kind === "pending" || keys.size === 0}
            onClick={() => void operations.executeAiClassification(currentTab, keys)}
          >{t("AI 分类建议", "AI classification suggestions")}</button>}
          {(currentTab === "outgoing" || currentTab === "incoming") && <>
            <button
              type="button"
              disabled={state.kind === "pending" || keys.size === 0}
              onClick={() => operations.openBatchEdit(
                "bulk-edit-counterparty",
                currentTab,
                keys,
                (row) => row.type === "支出" || row.type === "收入" || row.type === "代付"
              )}
            >{t("修改交易对手", "Edit counterparty")}</button>
            <button
              type="button"
              disabled={state.kind === "pending" || keys.size === 0}
              onClick={() => operations.openBatchEdit(
                "bulk-edit-product",
                currentTab,
                keys,
                (row) => row.type === "支出" || row.type === "收入" || row.type === "代付"
              )}
            >{t("修改商品", "Edit item")}</button>
            <button
              type="button"
              disabled={state.kind === "pending" || keys.size === 0}
              onClick={() => operations.openBatchEdit(
                "bulk-edit-category",
                currentTab,
                keys,
                (row) => row.type === "支出" || row.type === "收入" || row.type === "代付"
              )}
            >{t("修改分类", "Edit category")}</button>
          </>}
          {currentTab === "incoming" && <>
            <button
              type="button"
              disabled={state.kind === "pending" || keys.size === 0}
              onClick={() => void operations.executeSelectedOperation(
                "income-to-daifu",
                currentTab,
                keys,
                (row) => row.type === "收入"
              )}
            >{t("收入转代付", "Income to paid on behalf")}</button>
            <button
              type="button"
              disabled={state.kind === "pending" || keys.size === 0}
              onClick={() => void operations.executeSelectedOperation(
                "daifu-to-income",
                currentTab,
                keys,
                (row) => row.type === "代付"
              )}
            >{t("代付转收入", "Paid on behalf to income")}</button>
          </>}
        </>}
        renderRuleControls={renderRuleControls}
        renderTransactionActions={({ row, transactionKey, businessTab: currentTab }) => {
          if (transactionKey === null) return null;
          if (currentTab === "incoming" && row.type === "收入") {
            return <button
              type="button"
              disabled={state.kind === "pending"}
              onClick={() => void operations.executeSelectedOperation(
                "income-to-daifu",
                currentTab,
                new Set([transactionKey]),
                (candidate) => candidate.type === "收入"
              )}
            >{t("转为代付", "Convert to paid on behalf")}</button>;
          }
          if (currentTab === "incoming" && row.type === "代付") {
            return <button
              type="button"
              disabled={state.kind === "pending"}
              onClick={() => void operations.executeSelectedOperation(
                "daifu-to-income",
                currentTab,
                new Set([transactionKey]),
                (candidate) => candidate.type === "代付"
              )}
            >{t("转为收入", "Convert to income")}</button>;
          }
          return null;
        }}
      />}
      {(showAllSections || activeSection === "debts" || activeSection === "fixed_assets") && <MonthEditorSupplementalSections
        month={month}
        activeSection={activeSection === "debts" || activeSection === "fixed_assets" ? activeSection : undefined}
        debts={draft.debts}
        fixedAssets={draft.fixed_assets}
        onDebtsChange={updateDebts}
        onBlocked={(message) => new Notice(message)}
        onFixedAssetUpdate={updateAsset}
        onFixedAssetDelete={deleteFixedAsset}
        onFixedAssetAdd={addFixedAsset}
      />}
    </main>
  );
});
