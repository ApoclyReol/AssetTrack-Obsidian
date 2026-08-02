import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type Reducer
} from "react";
import { Notice, type App } from "obsidian";
import {
  EDITOR_MODES,
  type AnalysisMode,
  type EditorMode
} from "../constants";
import type {
  CategoryDefinition,
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  AssetTrackSettings,
  FixedAsset,
  ImportMode,
  MonthCreationPolicy,
  MonthWorkspace,
  Transaction
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { AnalysisView } from "./AnalysisView";
import { RulesEditorV2 } from "./RulesEditor";
export { RulesEditorV2 } from "./RulesEditor";
import {
  createTransactionDraft,
  changeTone,
  reconciliationStatus,
  transactionIndexes,
  TRANSACTION_SECTIONS
} from "./analysisModel";
import { CsvImportDialog } from "./CsvImportDialog";
import {
  MAX_IMPORT_FILE_BYTES,
  prepareCsvImportCommit
} from "./csvImportCommit";
import { roundHalfEven, sum } from "../domain/money";
import { businessLabel, getLocale, t } from "../i18n";
import { configureMoneyFormat, money } from "../domain/moneyFormat";
import { CollectionEditor } from "./CollectionEditor";
import {
  FixedAssetTable,
  TransactionSummaryTable,
  TransactionTable
} from "./TransactionTables";
export { CollectionEditor } from "./CollectionEditor";
import {
  EmptyState,
  IssueList,
  messageFor,
  number,
  OperationState,
  Section,
  type SortState,
  Status,
  transactionAmount,
  clone,
  issueIsBlocking,
  NumberField
} from "./editorPrimitives";
import type {
  EditorDraftSnapshot,
  MonthEditorDraftSnapshot
} from "./editorDraft";

interface Props {
  app: App;
  api: AssetTrackService;
  settings: AssetTrackSettings;
  hostWindow: Window;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
  initialMode: EditorMode;
  initialAnalysisMode: AnalysisMode;
  initialMonth?: string;
  initialDraft?: EditorDraftSnapshot;
  onDirtyChange: (dirty: boolean) => void;
  onDraftSnapshotChange: (snapshot: EditorDraftSnapshot | null) => void;
  onStateChange: (
    mode: EditorMode,
    analysisMode: AnalysisMode,
    month: string
  ) => void;
  notifyDataChanged: () => void;
  subscribeDataChanges: (listener: () => void) => () => void;
  getCsvMapping: (signature: string) => CsvColumnMapping | undefined;
  saveCsvMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}

type DraftAction =
  | { type: "reset"; workspace: MonthWorkspace }
  | { type: "edit"; workspace: MonthWorkspace };

function draftReducer(
  _state: MonthWorkspace | null,
  action: DraftAction
): MonthWorkspace | null {
  return action.workspace;
}

async function readImportFile(file: File): Promise<ArrayBuffer> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new AssetTrackError({
      code: "IMPORT_FILE_TOO_LARGE",
      status: 422,
      params: { limitMiB: 20 }
    });
  }
  return file.arrayBuffer();
}

export function AssetTrackEditorApp({
  app,
  api,
  settings,
  hostWindow,
  confirmAction,
  initialMode,
  initialAnalysisMode,
  initialMonth,
  initialDraft,
  onDirtyChange,
  onDraftSnapshotChange,
  onStateChange,
  notifyDataChanged,
  subscribeDataChanges,
  getCsvMapping,
  saveCsvMapping
}: Props) {
  configureMoneyFormat({
    locale: getLocale(),
    currency: settings.baseCurrency,
    currencyFormat: settings.currencyFormat
  });
  const recoveryDraft = useRef(initialDraft);
  const handleDraftSnapshotChange = useCallback((
    snapshot: EditorDraftSnapshot | null
  ) => {
    recoveryDraft.current = snapshot ?? undefined;
    onDraftSnapshotChange(snapshot);
  }, [onDraftSnapshotChange]);
  const [mode, setMode] = useState<EditorMode>(
    recoveryDraft.current?.kind ?? initialMode
  );
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(initialAnalysisMode);
  const [months, setMonths] = useState<string[]>([]);
  const [monthPolicy, setMonthPolicy] = useState<MonthCreationPolicy | null>(null);
  const [month, setMonth] = useState(
    recoveryDraft.current?.kind === "transactions"
      ? recoveryDraft.current.month
      : initialMonth ?? ""
  );
  const [dirty, setDirty] = useState(Boolean(recoveryDraft.current));
  const [dataVersion, setDataVersion] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [showPreparing, setShowPreparing] = useState(false);
  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setAnalysisMode(initialAnalysisMode), [initialAnalysisMode]);
  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);

  const refreshMonths = useCallback(async () => {
    try {
      const response = await api.months();
      setMonths(response.months);
      setMonthPolicy(response);
      setMonth((current) => current || initialMonth || response.months.at(-1) || "");
    } finally {
      setInitializing(false);
    }
  }, [api, initialMonth]);

  useEffect(() => {
    void refreshMonths().catch((error) => new Notice(messageFor(error)));
  }, [refreshMonths]);
  useEffect(() => {
    if (!initializing) {
      setShowPreparing(false);
      return;
    }
    const timeout = hostWindow.setTimeout(() => setShowPreparing(true), 500);
    return () => hostWindow.clearTimeout(timeout);
  }, [hostWindow, initializing]);
  useEffect(
    () => subscribeDataChanges(() => {
      setDataVersion((value) => value + 1);
      void refreshMonths();
    }),
    [refreshMonths, subscribeDataChanges]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(
    () => onStateChange(mode, analysisMode, month),
    [analysisMode, mode, month, onStateChange]
  );

  const switchMode = async (next: EditorMode): Promise<void> => {
    if (
      dirty
      && !await confirmAction(
        t("放弃未保存草稿？", "Discard unsaved changes?"),
        t("当前草稿尚未保存。放弃更改并切换？", "The current draft has not been saved. Discard the changes and switch?"),
        t("放弃并切换", "Discard and switch")
      )
    ) return;
    setDirty(false);
    handleDraftSnapshotChange(null);
    setMode(next);
  };
  const selectMonth = async (next: string): Promise<void> => {
    if (
      dirty
      && !await confirmAction(
        t("切换月份并放弃草稿？", "Switch months and discard the draft?"),
        t("当前月份草稿尚未保存。放弃更改并切换？", "The current month has unsaved changes. Discard them and switch?"),
        t("放弃并切换", "Discard and switch")
      )
    ) return;
    setDirty(false);
    handleDraftSnapshotChange(null);
    setMonth(next);
  };
  const createNext = async () => {
    if (!monthPolicy?.can_create) {
      throw new Error(monthPolicy?.reason ?? t("当前不能创建新月份", "A new month cannot be created right now."));
    }
    const target = monthPolicy.next_target;
    await api.createMonth(target);
    await refreshMonths();
    setMonth(target);
    setDataVersion((value) => value + 1);
    new Notice(t(`${target} 已创建`, `${target} created`));
  };

  if (initializing) {
    return (
      <div className="asset-track-app asset-track-boot">
        {showPreparing && <span>{t("正在读取 Asset Track 数据…", "Loading Asset Track data…")}</span>}
      </div>
    );
  }

  return (
    <div className="asset-track-app">
      <header className="asset-track-toolbar">
        <div>
          <strong>Asset Track</strong>
        </div>
        <nav>
          {EDITOR_MODES.map((item) => (
            <button
              key={item}
              className={mode === item ? "is-active" : ""}
              onClick={() => void switchMode(item)}
            >
              {{ analysis: t("分析", "Analysis"), transactions: t("流水", "Transactions"), debts: t("借款", "Debts"), rules: t("规则", "Rules") }[item]}
            </button>
          ))}
        </nav>
      </header>
      {mode === "transactions" && (
        <div className="asset-track-month-picker asset-track-period-picker">
          <button
            type="button"
            className="mod-cta asset-track-create-month-button"
            title={t("创建下一个月份", "Create the next month")}
            onClick={() => void createNext().catch((error) => new Notice(messageFor(error)))}
          >
            {monthPolicy?.next_target
              ? t(`创建 ${monthPolicy.next_target}`, `Create ${monthPolicy.next_target}`)
              : t("创建月份", "Create month")}
          </button>
          <select
            value={month}
            onChange={(event) => void selectMonth(event.target.value)}
          >
            {[...months].sort().reverse().map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      )}
      {mode === "analysis" && (
        <AnalysisView
          api={api}
          months={months}
          month={month}
          onMonthChange={setMonth}
          initialMode={analysisMode}
          onModeChange={setAnalysisMode}
          dataVersion={dataVersion}
          reconciliationTolerance={settings.reconciliationTolerance}
        />
      )}
      {mode === "transactions" && month && (
        <MonthEditor
          key={month}
          api={api}
          hostWindow={hostWindow}
          month={month}
          months={months}
          dataVersion={dataVersion}
          reconciliationTolerance={settings.reconciliationTolerance}
          onDeleted={async (next) => {
            await refreshMonths();
            setMonth(next);
            setDataVersion((value) => value + 1);
          }}
          onSaved={async () => {
            await refreshMonths();
            setDataVersion((value) => value + 1);
          }}
          onDirty={setDirty}
          initialDraft={recoveryDraft.current?.kind === "transactions"
            ? recoveryDraft.current
            : undefined}
          onDraftChange={handleDraftSnapshotChange}
          getCsvMapping={getCsvMapping}
          saveCsvMapping={saveCsvMapping}
        />
      )}
      {mode === "transactions" && !month && <EmptyState text={t("尚无月份，请创建第一个月份。", "No months exist yet. Create the first month.")} />}
      {mode === "debts" && (
        <CollectionEditor
          title={t("借款管理", "Debt management")}
          load={() => api.debts()}
          save={(revision, rows) => api.saveDebts(revision, rows)}
          createRow={() => ({
            start_date: new Date().toISOString().slice(0, 10),
            description: "",
            counterparty: "",
            amount: 0,
            is_paid: false,
            paid_date: null
          })}
          columns={[
            ["start_date", t("发生日期", "Start date"), "date"],
            ["description", t("说明", "Description"), "text"],
            ["counterparty", t("对方", "Counterparty"), "text"],
            ["amount", t("金额", "Amount"), "number"],
            ["is_paid", t("已还", "Paid"), "checkbox"],
            ["paid_date", t("还清日期", "Paid date"), "date"]
          ]}
          onDirty={setDirty}
          initialDraft={recoveryDraft.current?.kind === "debts"
            ? recoveryDraft.current
            : undefined}
          onDraftChange={handleDraftSnapshotChange}
          onSaved={() => setDataVersion((value) => value + 1)}
        />
      )}
      {mode === "rules" && (
        <RulesEditorV2
          app={app}
          api={api}
          hostWindow={hostWindow}
          dataVersion={dataVersion}
          onDirty={setDirty}
          initialDraft={recoveryDraft.current?.kind === "rules"
            ? recoveryDraft.current
            : undefined}
          onDraftChange={handleDraftSnapshotChange}
          onSaved={() => setDataVersion((value) => value + 1)}
          onDataChanged={notifyDataChanged}
          confirmAction={confirmAction}
        />
      )}
    </div>
  );
}

function draftMonthMetrics(workspace: MonthWorkspace): {
  income: number;
  expense: number;
  discrepancy: number | null;
} {
  const income = sum(workspace.transactions
    .filter((row) => row.type === "收入")
    .map((row) => Number(row.amount) || 0));
  const allOut = sum(workspace.transactions
    .filter((row) => row.type === "支出")
    .map((row) => Number(row.amount) || 0));
  const daifu = sum(workspace.transactions
    .filter((row) => row.type === "代付")
    .map((row) => Number(row.amount) || 0));
  const expense = roundHalfEven(allOut - daifu);
  const theoretical = workspace.overview.reconciliation?.available
    && workspace.overview.reconciliation.theoretical.previous_cash !== null
    ? workspace.overview.reconciliation.theoretical.previous_cash
      + income
      + (workspace.overview.reconciliation.theoretical.debt_change ?? 0)
      - sum(workspace.cash_accounts.map((row) => Number(row.balance) || 0))
      - sum(workspace.transactions
        .filter((row) => row.type === "加仓")
        .map((row) => Number(row.amount) || 0))
      + sum(workspace.transactions
        .filter((row) => row.type === "提现")
        .map((row) => Number(row.amount) || 0))
    : null;
  return {
    income,
    expense,
    discrepancy: theoretical === null ? null : roundHalfEven(expense - theoretical)
  };
}

function isEmptyMonthDraft(workspace: MonthWorkspace, dirty: boolean): boolean {
  return workspace.status === "draft"
    && !dirty
    && workspace.transactions.length === 0
    && workspace.cash_accounts.every((account) => Number(account.balance) === 0)
    && workspace.investment_accounts.every((account) =>
      Number(account.principal) === 0
      && Number(account.market_value) === 0
      && Number(account.cash_balance) === 0
    );
}

export function MonthEditor({
  api,
  hostWindow,
  month,
  months,
  dataVersion,
  reconciliationTolerance,
  onDeleted,
  onSaved,
  onDirty,
  initialDraft,
  onDraftChange,
  getCsvMapping,
  saveCsvMapping
}: {
  api: AssetTrackService;
  hostWindow: Window;
  month: string;
  months: string[];
  dataVersion: number;
  reconciliationTolerance: number;
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
}) {
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
  const [transactionView, setTransactionView] = useState<"detail" | "summary">("detail");
  const [summarySort, setSummarySort] = useState<SortState>({
    key: "count",
    direction: "desc"
  });
  const [expandedGroup, setExpandedGroup] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);
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
      onDirty(false);
      onDraftChange(null);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
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
    void Promise.all([api.month(month), api.categories()])
      .then(([current, categoryData]) => {
        setCategories(categoryData.rows);
        if (current.revision !== restored.workspace.revision) {
          setState({
            kind: "error",
            message: t(
              "草稿已恢复，但其他窗口已修改当前月份；重新加载前不能覆盖保存。",
              "The draft was restored, but another window changed this month. Reload before saving."
            )
          });
        }
      })
      .catch((error: unknown) => {
        setState({ kind: "error", message: messageFor(error) });
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
      setState({
        kind: "error",
        message: t(
          "其他窗口已修改当前月份；未保存草稿已保留，保存前请先重新加载。",
          "Another window changed this month. The unsaved draft was preserved; reload before saving."
        )
      });
      return;
    }
    void load();
  }, [dataVersion, load, localDirty]);

  const reportDraft = (
    next: MonthWorkspace,
    nextIssues: Array<Record<string, unknown>>
  ) => {
    onDraftChange({
      kind: "transactions",
      month,
      workspace: clone(next),
      categories: clone(categories),
      issues: clone(nextIssues)
    });
  };
  const mark = (next: MonthWorkspace) => {
    dispatchDraft({ type: "edit", workspace: next });
    setIssues([]);
    setLocalDirty(true);
    onDirty(true);
    reportDraft(next, []);
  };
  if (!draft) return <Status state={state} />;
  const monthMetrics = draftMonthMetrics(draft);
  const emptyMonth = isEmptyMonthDraft(draft, localDirty);
  const discrepancyStatus = monthMetrics.discrepancy === null
    ? ""
    : reconciliationStatus(monthMetrics.discrepancy, reconciliationTolerance);

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
    mark({ ...draft, transactions: rows });
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
    mark({ ...draft, fixed_assets: rows });
  };
  const save = async () => {
    setState({ kind: "pending", message: t("检查流水…", "Checking transactions…") });
    try {
      const validation = await api.validateTransactions(month, draft.transactions);
      const found = validation.issues;
      setIssues(found);
      if (localDirty) reportDraft(draft, found);
      const blocking = found.filter(issueIsBlocking);
      if (blocking.length) {
        setState({
          kind: "error",
          message: t(
            `有 ${blocking.length} 项错误必须先修正；未调用保存。`,
            `${blocking.length} errors must be fixed before saving. Nothing was written.`
          )
        });
        return;
      }
      setState({ kind: "pending", message: t("保存整月…", "Saving the month…") });
      const saved = await api.saveMonth(month, {
        expected_revision: draft.revision,
        cash_accounts: draft.cash_accounts,
        investment_accounts: draft.investment_accounts,
        transactions: draft.transactions,
        fixed_assets: draft.fixed_assets
      });
      dispatchDraft({ type: "reset", workspace: clone(saved) });
      const persistedValidation = await api.validateTransactions(month, saved.transactions);
      setIssues(persistedValidation.issues);
      setLocalDirty(false);
      onDirty(false);
      onDraftChange(null);
      skipNextDataVersion.current = true;
      await onSaved();
      setState({
        kind: "success",
        message: persistedValidation.issues.length
          ? t(
              `已保存 revision ${saved.revision}，保留 ${persistedValidation.issues.length} 项警告。`,
              `Saved revision ${saved.revision} with ${persistedValidation.issues.length} warnings.`
            )
          : t(
              `已保存 revision ${saved.revision}。`,
              `Saved revision ${saved.revision}.`
            )
      });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
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
      setState({ kind: "error", message: messageFor(error) });
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
      });
      setIssues(response.issues);
      reportDraft({
        ...draft,
        transactions: prepared.transactions
      }, response.issues);
      setCsvSource(null);
      setState({
        kind: "success",
        message:
          mode === "append"
            ? t(
                `已追加全部 ${response.rows.length} 行到草稿；未执行去重，尚未写库。`,
                `Appended all ${response.rows.length} rows to the draft without deduplication. Nothing has been saved yet.`
              )
            : t(
                `已用 ${response.rows.length} 行覆盖流水草稿，尚未写库。`,
                `Replaced the transaction draft with ${response.rows.length} rows. Nothing has been saved yet.`
              )
      });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
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
      mark({ ...draft, transactions: result.proposed_rows });
      setIssues(result.issues);
      reportDraft({
        ...draft,
        transactions: result.proposed_rows
      }, result.issues);
      setState({ kind: "success", message: t(
        result.issues.length
          ? `规则结果已进入草稿，但有 ${result.issues.length} 条流水保持原分类并显示冲突。`
          : "规则结果已进入草稿，保存后写库。",
        result.issues.length
          ? `${result.issues.length} rows stayed unchanged because their rules conflict.`
          : "Rule results have been applied to the draft and will be written when you save."
      ) });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };

  const deleteMonth = async () => {
    if (!emptyMonth && deleteConfirm !== month) {
      setState({ kind: "error", message: t("确认月份不匹配，未删除。", "The confirmation month did not match. Nothing was deleted.") });
      return;
    }
    setState({ kind: "pending", message: t(`正在删除 ${month}…`, `Deleting ${month}…`) });
    try {
      await api.deleteMonth(month, draft.revision);
      const remaining = months.filter((item) => item !== month).sort();
      const next = remaining.filter((item) => item < month).at(-1) ?? remaining.at(0) ?? "";
      onDirty(false);
      onDraftChange(null);
      await onDeleted(next);
      setShowDeleteConfirm(false);
      setDeleteConfirm("");
      new Notice(t(`${month} 已删除`, `${month} deleted`));
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };
  const requestDelete = () => {
    if (emptyMonth) {
      void deleteMonth();
      return;
    }
    setShowDeleteConfirm((visible) => !visible);
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
      <section className="asset-track-month-header">
        <div>
          <h2>{month}</h2>
          <span>{businessLabel(draft.status)} · revision {draft.revision}</span>
        </div>
        <div className="asset-track-actions">
          <button
            type="button"
            className="mod-cta"
            disabled={state.kind === "pending"}
            onClick={() => csvInputRef.current?.click()}
            title={t(
              "支持 CSV、XLSX、XLS；导入前需要确认字段和收支映射",
              "Supports CSV, XLSX, and XLS. Confirm fields and income/expense mappings before importing."
            )}
          >
            {t("导入账单", "Import statement")}
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(event) => void importCsv(event)}
          />
          <button onClick={() => void applyRules()}>{t("应用规则", "Apply rules")}</button>
          <button onClick={() => void load()}>{t("放弃并重载", "Discard and reload")}</button>
          <button
            className="mod-warning"
            disabled={state.kind === "pending"}
            onClick={requestDelete}
          >
            {t("删除月份", "Delete month")}
          </button>
          <button className="mod-cta" disabled={state.kind === "pending"} onClick={() => void save()}>
            {t("保存月份", "Save month")}
          </button>
        </div>
      </section>
      <section className="asset-track-month-metrics" aria-label={t("本月摘要", "Monthly summary")}>
        <div className={`asset-track-month-metric ${changeTone(monthMetrics.discrepancy) ?? ""}`}>
          <span>{t("对账差额", "Reconciliation difference")}</span>
          <strong>{monthMetrics.discrepancy === null ? t("不可比较", "Unavailable") : money(monthMetrics.discrepancy)}</strong>
          {discrepancyStatus && <small>{businessLabel(discrepancyStatus)}</small>}
        </div>
        <div className="asset-track-month-metric inflow">
          <span>{t("收入", "Income")}</span>
          <strong>{money(monthMetrics.income)}</strong>
        </div>
        <div className="asset-track-month-metric outflow">
          <span>{t("净支出", "Net expense")}</span>
          <strong>{money(monthMetrics.expense)}</strong>
        </div>
      </section>
      {showDeleteConfirm && !emptyMonth && (
        <section className="asset-track-delete-confirm">
          <strong>{t(
            "删除后会清理该月全部数据库事实，且无法在界面中撤销。",
            "Deleting this month removes all of its database records and cannot be undone in the interface."
          )}</strong>
          <label>
            {t(`输入完整月份 ${month}`, `Enter the full month ${month}`)}
            <input
              autoFocus
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value.trim())}
            />
          </label>
          <button
            className="mod-warning"
            disabled={deleteConfirm !== month || state.kind === "pending"}
            onClick={() => void deleteMonth()}
          >
            {t(`确认删除 ${month}`, `Confirm deletion of ${month}`)}
          </button>
          <button onClick={() => {
            setShowDeleteConfirm(false);
            setDeleteConfirm("");
          }}>
            {t("取消", "Cancel")}
          </button>
        </section>
      )}
      <Status state={state} />
      {issues.length > 0 && (
        <IssueList issues={issues} rows={draft.transactions} />
      )}
      <Section title={t("现金账户", "Cash accounts")}>
        <div className="asset-track-fields">
          {draft.cash_accounts.map((account, index) => (
            <NumberField
              key={account.account_key}
              label={account.account ?? account.name ?? account.account_key}
              value={account.balance}
              onChange={(value) =>
                mark({
                  ...draft,
                  cash_accounts: draft.cash_accounts.map((row, item) =>
                    item === index ? { ...row, balance: number(value) } : row
                  )
                })
              }
            />
          ))}
        </div>
      </Section>
      <Section title={t("理财账户", "Investment accounts")}>
        {draft.investment_accounts.map((account, index) => (
          <div className="asset-track-fields asset-track-investment-row" key={account.account_key}>
            <div className="asset-track-account-name">
              <span>{t("账户", "Account")}</span>
              <strong>{account.name ?? account.account_key}</strong>
            </div>
            {(["principal", "market_value", "cash_balance"] as const).map((field) => (
              <NumberField
                key={field}
                label={{
                  principal: t("本金", "Principal"),
                  market_value: t("市值", "Market value"),
                  cash_balance: t("流动现金", "Liquid cash")
                }[field]}
                value={account[field]}
                onChange={(value) =>
                  mark({
                    ...draft,
                    investment_accounts: draft.investment_accounts.map((row, item) =>
                      item === index ? { ...row, [field]: number(value) } : row
                    )
                  })
                }
              />
            ))}
          </div>
        ))}
      </Section>
      <section className="asset-track-view-switcher">
        <strong>{t("流水展示", "Transaction display")}</strong>
        <button
          className={transactionView === "detail" ? "is-active" : ""}
          onClick={() => setTransactionView("detail")}
        >
          {t("逐项", "Individual")}
        </button>
        <button
          className={transactionView === "summary" ? "is-active" : ""}
          onClick={() => setTransactionView("summary")}
        >
          {t("按商品汇总", "Group by item")}
        </button>
        <span>{t(
          "汇总只影响查看，保存时仍保留每笔流水。",
          "Grouping only changes the view. Every transaction is preserved when saved."
        )}</span>
      </section>
      {transactionView === "detail" && TRANSACTION_SECTIONS.map((title) => (
          <TransactionTable
            key={title}
            title={title}
            month={month}
            rows={draft.transactions}
            visibleIndexes={transactionIndexes(draft.transactions, title)}
            categories={categories}
            onUpdate={updateTransaction}
            onDelete={(index) =>
              mark({
                ...draft,
                transactions: draft.transactions.filter((_, item) => item !== index)
              })
            }
            onAdd={() => {
              mark({
                ...draft,
                transactions: [
                  ...draft.transactions,
                  createTransactionDraft(title, month, categories)
                ]
              });
            }}
          />
        ))}
      {transactionView === "summary" && (
        <TransactionSummaryTable
          rows={draft.transactions}
          categories={categories}
          sort={summarySort}
          onSort={setSummarySort}
          expanded={expandedGroup}
          onExpanded={setExpandedGroup}
          onUpdate={updateTransaction}
        />
      )}
      <FixedAssetTable
        rows={draft.fixed_assets}
        onUpdate={updateAsset}
        onDelete={(index) =>
          mark({
            ...draft,
            fixed_assets: draft.fixed_assets.filter((_, item) => item !== index)
          })
        }
        onAdd={() =>
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
          })
        }
      />
    </main>
  );
}
