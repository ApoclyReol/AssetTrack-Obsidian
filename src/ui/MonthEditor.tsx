import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type Reducer
} from "react";
import { Notice } from "obsidian";
import type {
  CategoryDefinition,
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  FixedAsset,
  ImportMode,
  MonthSection,
  MonthSectionSaveRequest,
  MonthWorkspace,
  Transaction
} from "../types";
import type { AssetTrackService } from "../services/AssetTrackService";
import { createTransactionDraft } from "./analysisModel";
import { CsvImportDialog } from "./CsvImportDialog";
import { prepareCsvImportCommit } from "./csvImportCommit";
import { t } from "../i18n";
import type { MonthEditorDraftSnapshot, EditorDraftSnapshot } from "./editorDraft";
import {
  messageFor,
  number,
  OperationState,
  type SortState,
  Status,
  clone,
  issueIsBlocking,
  IssueList,
  transactionAmount
} from "./editorPrimitives";
import {
  draftMonthMetrics,
  draftReducer,
  isEmptyMonthDraft,
  MONTH_SECTIONS,
  readImportFile,
  type DraftAction,
  type MonthMetrics
} from "./monthEditorModel";
import { MonthEditorHeader } from "./month/MonthEditorHeader";
import { MonthEditorAssetsSection } from "./month/MonthEditorAssetsSection";
import { MonthEditorTransactionsSection } from "./month/MonthEditorTransactionsSection";
import { MonthEditorSupplementalSections } from "./month/MonthEditorSupplementalSections";

export interface MonthEditorHandle {
  requestDelete: () => void;
  openImport: () => void;
  applyRules: () => Promise<void>;
  reload: () => Promise<void>;
  save: () => Promise<void>;
  isSectionDirty: () => boolean;
  hasUnsavedChanges: () => boolean;
}

export { MONTH_SECTIONS, type MonthMetrics } from "./monthEditorModel";

export const MonthEditor = forwardRef<MonthEditorHandle, {
  api: AssetTrackService;
  hostWindow: Window;
  month: string;
  months: string[];
  dataVersion: number;
  reconciliationTolerance: number;
  activeSection?: MonthSection;
  onMetricsChange?: (metrics: MonthMetrics | null) => void;
  onDeleted: (next: string) => Promise<void>;
  onSaved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  initialDraft?: MonthEditorDraftSnapshot;
  onDraftChange: (snapshot: EditorDraftSnapshot | null) => void;
  getCsvMapping: (signature: string) => CsvColumnMapping | undefined;
  saveCsvMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}>(function MonthEditor({
  api,
  hostWindow,
  month,
  months,
  dataVersion,
  reconciliationTolerance,
  activeSection,
  onMetricsChange,
  onDeleted,
  onSaved,
  onDirty,
  initialDraft,
  onDraftChange,
  getCsvMapping,
  saveCsvMapping
}, ref) {
  const [draft, dispatchDraft] = useReducer<
    Reducer<MonthWorkspace | null, DraftAction>
  >(draftReducer, initialDraft ? clone(initialDraft.workspace) : null);
  const [categories, setCategories] = useState<CategoryDefinition[]>(
    initialDraft ? clone(initialDraft.categories) : []
  );
  const [issues, setIssues] = useState<Array<Record<string, unknown>>>(
    initialDraft ? clone(initialDraft.issues) : []
  );
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const [localDirty, setLocalDirty] = useState(Boolean(initialDraft));
  const [dirtySections, setDirtySections] = useState<MonthSection[]>(
    initialDraft?.dirty_sections
      ? [...new Set(initialDraft.dirty_sections)]
      : initialDraft
        ? [...MONTH_SECTIONS]
        : []
  );
  const dirtySectionsRef = useRef<MonthSection[]>(
    initialDraft?.dirty_sections
      ? [...new Set(initialDraft.dirty_sections)]
      : initialDraft
        ? [...MONTH_SECTIONS]
        : []
  );
  const localDirtyRef = useRef(Boolean(initialDraft));
  const [transactionView, setTransactionView] = useState<"detail" | "summary">("detail");
  const [summarySort, setSummarySort] = useState<SortState>({
    key: "count",
    direction: "desc"
  });
  const [expandedGroup, setExpandedGroup] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);
  const actionRef = useRef<MonthEditorHandle>({
    requestDelete: () => undefined,
    openImport: () => undefined,
    applyRules: async () => undefined,
    reload: async () => undefined,
    save: async () => undefined,
    isSectionDirty: () => false,
    hasUnsavedChanges: () => false
  });
  useImperativeHandle(ref, () => ({
    requestDelete: () => actionRef.current.requestDelete(),
    openImport: () => actionRef.current.openImport(),
    applyRules: () => actionRef.current.applyRules(),
    reload: () => actionRef.current.reload(),
    save: () => actionRef.current.save(),
    isSectionDirty: () => actionRef.current.isSectionDirty(),
    hasUnsavedChanges: () => actionRef.current.hasUnsavedChanges()
  }), [ref]);
  const lastDataVersion = useRef(dataVersion);
  const skipNextDataVersion = useRef(false);
  const restoredDraft = useRef(
    initialDraft ? clone(initialDraft) : null
  );
  const [csvSource, setCsvSource] = useState<{
    filename: string;
    content: ArrayBuffer;
    inspection: CsvInspection;
  } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "pending", message: t("加载月份…", "Loading month…") });
    try {
      const [data, categoryData] = await Promise.all([api.month(month), api.categories()]);
      const validation = await api.validateTransactions(month, data.transactions);
      dispatchDraft({ type: "reset", workspace: clone(data) });
      setCategories(categoryData.rows);
      setIssues(validation.issues);
      setLocalDirty(false);
      setDirtySections([]);
      localDirtyRef.current = false;
      dirtySectionsRef.current = [];
      onDirty(false);
      onDraftChange(null);
      setState({ kind: "idle" });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [api, month, onDirty, onDraftChange]);
  useEffect(() => {
    const restored = restoredDraft.current;
    if (!restored) {
      void load();
      return;
    }
    restoredDraft.current = null;
    onDirty(true);
    onDraftChange(restored);
    setState({
      kind: "success",
      message: t("未保存月份草稿已恢复。", "The unsaved month draft was restored.")
    });
    new Notice(t("未保存月份草稿已恢复。", "The unsaved month draft was restored."));
    void Promise.all([api.month(month), api.categories()])
      .then(([current, categoryData]) => {
        setCategories(categoryData.rows);
        if (current.revision !== restored.workspace.revision) {
          const message = t(
            "草稿已恢复，但其他窗口已修改当前月份；重新加载前不能覆盖保存。",
            "The draft was restored, but another window changed this month. Reload before saving."
          );
          setState({ kind: "error", message });
          new Notice(message);
        }
      })
      .catch((error: unknown) => {
        const message = messageFor(error);
        new Notice(message);
        setState({ kind: "error", message });
      });
  }, [api, load, month, onDirty, onDraftChange]);
  useEffect(() => {
    if (lastDataVersion.current === dataVersion) return;
    lastDataVersion.current = dataVersion;
    if (skipNextDataVersion.current) {
      skipNextDataVersion.current = false;
      return;
    }
    if (localDirty) {
      const message = t(
        "其他窗口已修改当前月份；未保存草稿已保留，保存前请先重新加载。",
        "Another window changed this month. The unsaved draft was preserved; reload before saving."
      );
      setState({ kind: "error", message });
      new Notice(message);
      return;
    }
    void load();
  }, [dataVersion, load, localDirty]);

  useEffect(() => {
    onMetricsChange?.(draft ? draftMonthMetrics(draft) : null);
  }, [draft, onMetricsChange]);

  const reportDraft = (
    next: MonthWorkspace,
    nextIssues: Array<Record<string, unknown>>,
    nextDirtySections = dirtySections
  ) => {
    onDraftChange({
      kind: "transactions",
      month,
      workspace: clone(next),
      categories: clone(categories),
      issues: clone(nextIssues),
      active_section: activeSection,
      dirty_sections: [...nextDirtySections]
    });
  };
  const mark = (
    next: MonthWorkspace,
    section: MonthSection,
    nextIssues: Array<Record<string, unknown>> = section === "transactions" ? [] : issues
  ) => {
    const nextDirtySections = [...new Set([...dirtySections, section])];
    dispatchDraft({ type: "edit", workspace: next });
    if (section === "transactions") setIssues(nextIssues);
    else setIssues(issues);
    setDirtySections(nextDirtySections);
    setLocalDirty(true);
    dirtySectionsRef.current = nextDirtySections;
    localDirtyRef.current = true;
    onDirty(true);
    reportDraft(next, nextIssues, nextDirtySections);
  };

  const reloadCurrentSection = useCallback(async () => {
    if (!draft || !activeSection) {
      await load();
      return;
    }
    setState({ kind: "pending", message: t("重载当前区块…", "Reloading this section…") });
    try {
      const current = await api.month(month);
      const nextDirtySections = dirtySections.filter((item) => item !== activeSection);
      const preserveRevision = nextDirtySections.length > 0;
      const next: MonthWorkspace = {
        ...draft,
        revision: preserveRevision ? draft.revision : current.revision,
        status: current.status,
        debt_revision: preserveRevision ? draft.debt_revision : current.debt_revision,
        computed: current.computed,
        overview: current.overview
      };
      let nextIssues = issues;
      if (activeSection === "assets") {
        next.cash_accounts = current.cash_accounts;
        next.investment_accounts = current.investment_accounts;
      } else if (activeSection === "transactions") {
        next.transactions = current.transactions;
        const categoryData = await api.categories();
        setCategories(categoryData.rows);
        const validation = await api.validateTransactions(month, current.transactions);
        nextIssues = validation.issues;
      } else if (activeSection === "debts") {
        next.debts = current.debts;
      } else {
        next.fixed_assets = current.fixed_assets;
      }
      dispatchDraft({ type: "reset", workspace: clone(next) });
      setIssues(nextIssues);
      setDirtySections(nextDirtySections);
      setLocalDirty(nextDirtySections.length > 0);
      dirtySectionsRef.current = nextDirtySections;
      localDirtyRef.current = nextDirtySections.length > 0;
      onDirty(nextDirtySections.length > 0);
      if (nextDirtySections.length > 0) {
        reportDraft(next, nextIssues, nextDirtySections);
      } else {
        onDraftChange(null);
      }
      setShowDeleteConfirm(false);
      setDeleteConfirm("");
      setState({ kind: "success", message: t("当前区块已重载。", "This section was reloaded.") });
      new Notice(t("当前区块已重载。", "This section was reloaded."));
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [activeSection, api, draft, dirtySections, issues, load, month, onDirty, onDraftChange]);

  if (!draft) return <Status state={state} />;
  const monthMetrics = draftMonthMetrics(draft);
  const emptyMonth = isEmptyMonthDraft(draft, localDirty);
  const showAllSections = activeSection === undefined;

  const updateTransaction = (
    index: number,
    field: keyof Transaction,
    value: string
  ) => {
    const rows = draft.transactions.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = {
        ...row,
        [field]: field === "amount" ? transactionAmount(value) : value
      };
      if (field === "type" && ["代付", "加仓", "提现"].includes(value)) {
        next.category = "";
        next.category_key = null;
      }
      if (field === "category_key") {
        next.category =
          categories.find((category) => category.category_key === value)?.name ?? "";
      }
      return next;
    });
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
    mark({
      ...draft,
      transactions: draft.transactions.filter((_, item) => item !== index)
    }, "transactions");
  };
  const addTransaction = (title: string) => {
    mark({
      ...draft,
      transactions: [
        ...draft.transactions,
        createTransactionDraft(title, month, categories)
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
  const saveWholeMonth = async () => {
    setState({ kind: "pending", message: t("检查流水…", "Checking transactions…") });
    try {
      const validation = await api.validateTransactions(month, draft.transactions);
      const found = validation.issues;
      setIssues(found);
      if (localDirty) reportDraft(draft, found, dirtySections);
      const blocking = found.filter(issueIsBlocking);
      if (blocking.length) {
        const message = t(
          `有 ${blocking.length} 项错误必须先修正；未调用保存。`,
          `${blocking.length} errors must be fixed before saving. Nothing was written.`
        );
        new Notice(message);
        setState({ kind: "error", message });
        return;
      }
      setState({ kind: "pending", message: t("保存整月…", "Saving the month…") });
      const saved = await api.saveMonth(month, {
        expected_revision: draft.revision,
        cash_accounts: draft.cash_accounts,
        investment_accounts: draft.investment_accounts,
        transactions: draft.transactions,
        fixed_assets: draft.fixed_assets,
        debt_revision: draft.debt_revision,
        debts: draft.debts
      });
      dispatchDraft({ type: "reset", workspace: clone(saved) });
      const persistedValidation = await api.validateTransactions(month, saved.transactions);
      setIssues(persistedValidation.issues);
      setDirtySections([]);
      setLocalDirty(false);
      dirtySectionsRef.current = [];
      localDirtyRef.current = false;
      onDirty(false);
      onDraftChange(null);
      skipNextDataVersion.current = true;
      await onSaved();
      const message = persistedValidation.issues.length
        ? t(
            `已保存 revision ${saved.revision}，保留 ${persistedValidation.issues.length} 项警告。`,
            `Saved revision ${saved.revision} with ${persistedValidation.issues.length} warnings.`
          )
        : t(
            `已保存 revision ${saved.revision}。`,
            `Saved revision ${saved.revision}.`
          );
      new Notice(message);
      setState({ kind: "success", message });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  };

  const saveSection = async (section: MonthSection) => {
    if (!dirtySections.includes(section)) {
      new Notice(t("当前区块没有未保存修改。", "This section has no unsaved changes."));
      setState({ kind: "idle" });
      return;
    }
    setState({
      kind: "pending",
      message: t("检查当前区块…", "Checking this section…")
    });
    try {
      let request: MonthSectionSaveRequest;
      if (section === "assets") {
        request = {
          expected_revision: draft.revision,
          section,
          cash_accounts: draft.cash_accounts,
          investment_accounts: draft.investment_accounts
        };
      } else if (section === "transactions") {
        const validation = await api.validateTransactions(month, draft.transactions);
        setIssues(validation.issues);
        if (localDirty) reportDraft(draft, validation.issues, dirtySections);
        const blocking = validation.issues.filter(issueIsBlocking);
        if (blocking.length) {
          const message = t(
            `有 ${blocking.length} 项错误必须先修正；未调用保存。`,
            `${blocking.length} errors must be fixed before saving. Nothing was written.`
          );
          new Notice(message);
          setState({ kind: "error", message });
          return;
        }
        request = {
          expected_revision: draft.revision,
          section,
          transactions: draft.transactions
        };
      } else if (section === "debts") {
        request = {
          expected_revision: draft.revision,
          section,
          debt_revision: draft.debt_revision,
          debts: draft.debts
        };
      } else {
        request = {
          expected_revision: draft.revision,
          section,
          fixed_assets: draft.fixed_assets
        };
      }
      setState({ kind: "pending", message: t("保存当前区块…", "Saving this section…") });
      const saved = await api.saveMonthSection(month, request);
      const next: MonthWorkspace = {
        ...draft,
        revision: saved.revision,
        status: saved.status,
        debt_revision: saved.debt_revision,
        computed: saved.computed,
        overview: saved.overview,
        ...(section === "assets" ? {
          cash_accounts: saved.cash_accounts,
          investment_accounts: saved.investment_accounts
        } : {}),
        ...(section === "transactions" ? { transactions: saved.transactions } : {}),
        ...(section === "debts" ? { debts: saved.debts } : {}),
        ...(section === "fixed_assets" ? { fixed_assets: saved.fixed_assets } : {})
      };
      const nextDirtySections = dirtySections.filter((item) => item !== section);
      const persistedValidation = section === "transactions"
        ? await api.validateTransactions(month, saved.transactions)
        : null;
      dispatchDraft({ type: "reset", workspace: clone(next) });
      if (persistedValidation) setIssues(persistedValidation.issues);
      setDirtySections(nextDirtySections);
      setLocalDirty(nextDirtySections.length > 0);
      dirtySectionsRef.current = nextDirtySections;
      localDirtyRef.current = nextDirtySections.length > 0;
      onDirty(nextDirtySections.length > 0);
      if (nextDirtySections.length > 0) {
        reportDraft(next, persistedValidation?.issues ?? issues, nextDirtySections);
      } else {
        onDraftChange(null);
      }
      skipNextDataVersion.current = true;
      await onSaved();
      const message = t(
        `${section === "assets" ? "资产" : section === "transactions" ? "流水" : section === "debts" ? "借款" : "固定资产"}已保存，revision ${saved.revision}。`,
        `The ${section.replace("_", " ")} section was saved at revision ${saved.revision}.`
      );
      new Notice(message);
      setState({ kind: "success", message });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  };

  const save = async () => {
    if (activeSection) {
      await saveSection(activeSection);
    } else {
      await saveWholeMonth();
    }
  };

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setState({ kind: "pending", message: t("解析账单…", "Parsing statement…") });
    try {
      const content = await readImportFile(file);
      const inspection = await api.inspectCsv(
        month,
        file.name,
        content
      );
      setCsvSource({ filename: file.name, content, inspection });
      setState({ kind: "idle" });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  };
  const applyCsvPreview = async (
    response: CsvImportPreview,
    mode: ImportMode,
    mapping: CsvColumnMapping
  ) => {
    if (!csvSource) return;
    setState({ kind: "pending", message: t("正在准备导入草稿…", "Preparing the import draft…") });
    try {
      const prepared = await prepareCsvImportCommit({
        currentTransactions: draft.transactions,
        importedTransactions: response.rows,
        mode,
        headerSignature: csvSource.inspection.header_signature,
        mapping,
        saveMapping: saveCsvMapping
      });
      mark({
        ...draft,
        transactions: prepared.transactions
      }, "transactions", response.issues);
      setCsvSource(null);
      const message = mode === "append"
        ? t(
            `已追加全部 ${response.rows.length} 行到草稿；未执行去重，尚未写库。`,
            `Appended all ${response.rows.length} rows to the draft without deduplication. Nothing has been saved yet.`
          )
        : t(
            `已用 ${response.rows.length} 行覆盖流水草稿，尚未写库。`,
            `Replaced the transaction draft with ${response.rows.length} rows. Nothing has been saved yet.`
          );
      new Notice(message);
      setState({ kind: "success", message });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
      throw error;
    }
  };

  const applyRules = async () => {
    setState({ kind: "pending", message: t("应用自动规则…", "Applying automatic rules…") });
    try {
      const result = await api.applyRules(month, draft.transactions);
      if (result.base_revision !== draft.revision) {
        throw new Error(t(
          "规则预览期间 revision 已变化，请重新加载",
          "The revision changed while previewing rules. Reload and try again."
        ));
      }
      mark({ ...draft, transactions: result.proposed_rows }, "transactions", result.issues);
      const message = t(
        result.issues.length
          ? `规则结果已进入草稿，但有 ${result.issues.length} 条流水保持原分类并显示冲突。`
          : "规则结果已进入草稿，保存后写库。",
        result.issues.length
          ? `${result.issues.length} rows stayed unchanged because their rules conflict.`
          : "Rule results have been applied to the draft and will be written when you save."
      );
      new Notice(message);
      setState({ kind: "success", message });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
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
      onDirty(false);
      onDraftChange(null);
      localDirtyRef.current = false;
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
  const isSectionDirty = () => Boolean(activeSection && dirtySectionsRef.current.includes(activeSection));
  const hasUnsavedChanges = () => localDirtyRef.current;
  actionRef.current = {
    requestDelete,
    openImport: () => csvInputRef.current?.click(),
    applyRules,
    reload: reloadCurrentSection,
    save,
    isSectionDirty,
    hasUnsavedChanges
  };

  return (
    <main className="asset-track-editor">
      {csvSource && (
        <CsvImportDialog
          hostWindow={hostWindow}
          inspection={csvSource.inspection}
          savedMapping={getCsvMapping(
            csvSource.inspection.header_signature
          )}
          onCancel={() => setCsvSource(null)}
          onPreview={(mapping) =>
            api.previewMappedCsv(
              month,
              csvSource.filename,
              csvSource.content,
              mapping
            )
          }
          onApply={applyCsvPreview}
        />
      )}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => void importCsv(event)}
      />
      <MonthEditorHeader
        activeSection={activeSection}
        draft={draft}
        month={month}
        state={state}
        dirtySections={dirtySections}
        monthMetrics={monthMetrics}
        reconciliationTolerance={reconciliationTolerance}
        emptyMonth={emptyMonth}
        deleteConfirm={deleteConfirm}
        showDeleteConfirm={showDeleteConfirm}
        onOpenImport={() => csvInputRef.current?.click()}
        onApplyRules={applyRules}
        onReload={reloadCurrentSection}
        onSave={save}
        onLoad={load}
        onRequestDelete={requestDelete}
        onDelete={deleteMonth}
        onDeleteConfirmChange={setDeleteConfirm}
        onCancelDelete={() => {
          setShowDeleteConfirm(false);
          setDeleteConfirm("");
        }}
      />
      <span className="asset-track-sr-only" role="status" aria-live="polite">
        {state.kind === "error" ? state.message : ""}
      </span>
      {issues.length > 0 && (
        <IssueList issues={issues} rows={draft.transactions} />
      )}
      {(showAllSections || activeSection === "assets") && <MonthEditorAssetsSection
        draft={draft}
        onCashBalanceChange={updateCashBalance}
        onInvestmentChange={updateInvestment}
      />}
      {(showAllSections || activeSection === "transactions") && <MonthEditorTransactionsSection
        month={month}
        draft={draft}
        categories={categories}
        transactionView={transactionView}
        summarySort={summarySort}
        expandedGroup={expandedGroup}
        onTransactionViewChange={setTransactionView}
        onSummarySort={setSummarySort}
        onExpandedGroupChange={setExpandedGroup}
        onUpdate={updateTransaction}
        onDelete={deleteTransaction}
        onAdd={addTransaction}
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
