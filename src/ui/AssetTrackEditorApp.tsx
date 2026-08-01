import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  Fragment,
  type ChangeEvent,
  type Reducer,
  type ReactNode
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
  HistoricalProductStat,
  ImportMode,
  MonthCreationPolicy,
  RuleConflictGroup,
  MonthWorkspace,
  ProductHistoryQuery,
  RuleHealthSummary,
  RuleWorkspaceAnalytics,
  RuleWorkspaceShell,
  RuleWorkspace,
  SavedRule,
  Transaction
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { AnalysisView } from "./AnalysisView";
import {
  createTransactionDraft,
  changeTone,
  reconciliationStatus,
  transactionBlockNumber,
  transactionBlockNumbers,
  transactionIndexes,
  TRANSACTION_SECTIONS
} from "./analysisModel";
import { CsvImportDialog } from "./CsvImportDialog";
import {
  groupTransactions,
  normalizeProduct,
  type TransactionGroup
} from "./transactionGrouping";
import {
  MAX_IMPORT_FILE_BYTES,
  prepareCsvImportCommit
} from "./csvImportCommit";
import { scalarText } from "../domain/text";
import { roundHalfEven, sum } from "../domain/money";
import { CATEGORY_COLORS } from "../domain/categoryColors";
import {
  calculateVirtualRowRange,
  virtualSpacerBlocks
} from "./virtualRows";
import { businessLabel, displayError, getLocale, t } from "../i18n";
import { configureMoneyFormat, money } from "../domain/moneyFormat";
import {
  HistoryBackfillContent,
  ProductRenameModal,
  RuleCreationModal,
  RuleHistoryModal
} from "./RuleHistoryModal";
import { alertAction } from "./ConfirmModal";
import { ActionTableHeader, StaticTableHeader } from "./TablePrimitives";
import type {
  DebtEditorDraftSnapshot,
  EditorDraftSnapshot,
  MonthEditorDraftSnapshot,
  RulesEditorDraftSnapshot
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

type OperationState =
  | { kind: "idle"; message?: string }
  | { kind: "pending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type SortState = { key: string; direction: "asc" | "desc" } | null;

const CATEGORY_RAINBOW = CATEGORY_COLORS;

function issueIsBlocking(issue: Record<string, unknown>): boolean {
  return issue.blocking === true || issue.severity === "错误";
}

function messageFor(error: unknown): string {
  if (error instanceof AssetTrackError && error.status === 409) {
    const detail = error.detail as { expected?: number; actual?: number };
    return t(
      `revision 冲突：草稿基于 ${detail.expected ?? "—"}，当前数据库为 ${detail.actual ?? "—"}。请重新加载。`,
      `Revision conflict: the draft is based on ${detail.expected ?? "—"}, but the database is at ${detail.actual ?? "—"}. Reload and try again.`
    );
  }
  return displayError(error);
}

function number(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function transactionAmount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return "" as unknown as number;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : "" as unknown as number;
}

function clone<T>(data: T): T {
  return structuredClone(data);
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

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left ?? 0) - Number(right ?? 0);
  }
  return scalarText(left).localeCompare(scalarText(right), getLocale(), {
    numeric: true,
    sensitivity: "base"
  });
}

function sortRows<T>(
  rows: T[],
  sort: SortState,
  value: (row: T, key: string) => unknown
): Array<{ row: T; originalIndex: number }> {
  const indexed = rows.map((row, originalIndex) => ({ row, originalIndex }));
  if (!sort) return indexed;
  return indexed.sort((left, right) => {
    const compared = compareValues(
      value(left.row, sort.key),
      value(right.row, sort.key)
    );
    return sort.direction === "asc" ? compared : -compared;
  });
}

function toggleSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

function SortButton({
  label,
  field,
  sort,
  onSort
}: {
  label: string;
  field: string;
  sort: SortState;
  onSort: (next: SortState) => void;
}) {
  const mark =
    sort?.key === field ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
  const active = sort?.key === field;
  return (
    <button
      type="button"
      className="asset-track-sort"
      aria-label={t(
        `${label}排序${active ? `，当前${sort.direction === "asc" ? "升序" : "降序"}` : ""}`,
        `Sort by ${label}${active ? `, currently ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}`
      )}
      aria-pressed={active}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      onClick={() => onSort(toggleSort(sort, field))}
    >
      {label}
      {mark}
    </button>
  );
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
          <span>{t("SQLite 事实 · TypeScript 计算 · 实时分析", "SQLite source of truth · TypeScript calculations · Live analytics")}</span>
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
          <button
            title={t("创建下一个月份", "Create the next month")}
            onClick={() => void createNext().catch((error) => new Notice(messageFor(error)))}
          >
            {monthPolicy?.next_target
              ? t(`创建 ${monthPolicy.next_target}`, `Create ${monthPolicy.next_target}`)
              : t("创建月份", "Create month")}
          </button>
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
    if (deleteConfirm !== month) {
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
            onClick={() => setShowDeleteConfirm((visible) => !visible)}
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
      {showDeleteConfirm && (
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

function TransactionTable({
  title,
  rows,
  visibleIndexes,
  categories,
  onUpdate,
  onDelete,
  onAdd
}: {
  title: string;
  month: string;
  rows: Transaction[];
  visibleIndexes: number[];
  categories: CategoryDefinition[];
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  const displayTitle = businessLabel(title);
  const [sort, setSort] = useState<SortState>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 600
  });
  const sorted = useMemo(
    () =>
      sortRows(visibleIndexes, sort, (index, key) => rows[index][key as keyof Transaction]),
    [rows, sort, visibleIndexes]
  );
  const blockNumbers = useMemo(
    () => transactionBlockNumbers(rows),
    [rows]
  );
  const range = calculateVirtualRowRange(
    sorted.length,
    viewport.scrollTop,
    viewport.height
  );
  const visibleRows = sorted.slice(range.start, range.end);
  return (
    <Section title={t(
      `${title}（${visibleIndexes.length} 行）`,
      `${displayTitle} (${visibleIndexes.length} rows)`
    )}>
      <div
        className="asset-track-virtual-table"
        role="table"
        aria-rowcount={sorted.length + 1}
        onScroll={(event) => {
          setViewport({
            scrollTop: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight
          });
        }}
      >
        <div className="asset-track-grid asset-track-grid-head">
          <span>{t("行号", "Row")}</span>
          {[
            ["transaction_date", t("日期", "Date")],
            ["counterparty", t("交易对方", "Counterparty")],
            ["category", t("分类", "Category")],
            ["product", t("商品", "Item")],
            ["amount", t("金额", "Amount")]
          ].map(([field, label]) => (
            <SortButton key={field} field={field} label={label} sort={sort} onSort={setSort} />
          ))}
          <span />
        </div>
        <div className="asset-track-virtual-body">
          {virtualSpacerBlocks(range.start).map((block) => (
            <div
              className={`asset-track-virtual-spacer is-${block}`}
              aria-hidden="true"
              key={`top-${block}`}
            />
          ))}
          {visibleRows.map(({ row: originalIndex }, visibleIndex) => {
              const row = rows[originalIndex];
              const blockNumber = blockNumbers[originalIndex];
              const special = ["代付", "加仓", "提现"].includes(row.type);
              const options = categories.filter(
                (category) =>
                  category.transaction_type === row.type &&
                  (category.is_active || category.category_key === row.category_key)
              );
              return (
                <div
                  className="asset-track-grid"
                  key={row.id ?? row.client_id ?? originalIndex}
                  role="row"
                  aria-rowindex={range.start + visibleIndex + 2}
                >
                  <span className="asset-track-row-number">
                    {blockNumber}
                  </span>
                  <input
                    aria-label={t(`${title}第 ${blockNumber} 行日期`, `${displayTitle} row ${blockNumber} date`)}
                    value={row.transaction_date}
                    onChange={(event) => onUpdate(originalIndex, "transaction_date", event.target.value)}
                  />
                  <input
                    aria-label={t(`${title}第 ${blockNumber} 行交易对方`, `${displayTitle} row ${blockNumber} counterparty`)}
                    value={row.counterparty ?? ""}
                    placeholder={t("交易对方", "Counterparty")}
                    onChange={(event) =>
                      onUpdate(originalIndex, "counterparty", event.target.value)
                    }
                  />
                  <select
                    aria-label={t(`${title}第 ${blockNumber} 行分类`, `${displayTitle} row ${blockNumber} category`)}
                    disabled={special}
                    value={row.category_key ?? ""}
                    onChange={(event) => onUpdate(originalIndex, "category_key", event.target.value)}
                  >
                    <option value="">{t("请选择", "Select")}</option>
                    {options.map((category) => (
                      <option key={category.category_key} value={category.category_key}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={t(`${title}第 ${blockNumber} 行商品`, `${displayTitle} row ${blockNumber} item`)}
                    value={row.product}
                    onChange={(event) => onUpdate(originalIndex, "product", event.target.value)}
                  />
                  <input
                    aria-label={t(`${title}第 ${blockNumber} 行金额`, `${displayTitle} row ${blockNumber} amount`)}
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={(event) => onUpdate(originalIndex, "amount", event.target.value)}
                  />
                  <button
                    aria-label={t(`删除${title}第 ${blockNumber} 行`, `Delete ${displayTitle} row ${blockNumber}`)}
                    onClick={() => onDelete(originalIndex)}
                  >
                    {t("删除", "Delete")}
                  </button>
                </div>
              );
            })}
          {virtualSpacerBlocks(sorted.length - range.end).map((block) => (
            <div
              className={`asset-track-virtual-spacer is-${block}`}
              aria-hidden="true"
              key={`bottom-${block}`}
            />
          ))}
        </div>
      </div>
      <button onClick={onAdd}>{t(`新增${title}流水`, `Add ${displayTitle} transaction`)}</button>
    </Section>
  );
}

function TransactionSummaryTable({
  rows,
  categories,
  sort,
  onSort,
  expanded,
  onExpanded,
  onUpdate
}: {
  rows: Transaction[];
  categories: CategoryDefinition[];
  sort: SortState;
  onSort: (sort: SortState) => void;
  expanded: string;
  onExpanded: (key: string) => void;
  onUpdate: (
    index: number,
    field: keyof Transaction,
    value: string
  ) => void;
}) {
  const groups = sortRows(groupTransactions(rows), sort, (group, key) =>
    group[key as keyof TransactionGroup]
  );
  return (
    <Section title={t("商品汇总", "Item summary")}>
      <div className="asset-track-table-scroll">
        <table className="asset-track-summary-table">
          <thead>
            <tr>
              <StaticTableHeader label={t("收支", "Type")} className="asset-track-type-column" />
              <th scope="col"><SortButton label={t("商品", "Item")} field="product" sort={sort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-count-column"><SortButton label={t("出现次数", "Occurrences")} field="count" sort={sort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-amount-column"><SortButton label={t("总金额", "Total amount")} field="amount" sort={sort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-date-column"><SortButton label={t("最近日期", "Latest date")} field="lastDate" sort={sort} onSort={onSort} /></th>
              <StaticTableHeader label={t("分类", "Category")} />
              <ActionTableHeader />
            </tr>
          </thead>
          <tbody>
            {groups.map(({ row: group }) => (
              <Fragment key={group.key}>
                <tr>
                  <td className="asset-track-type-cell">{businessLabel(group.type)}</td>
                  <td title={group.variants.join("、")}>{group.product}</td>
                  <td className="asset-track-count-cell">{group.count}</td>
                  <td className="asset-track-amount-cell">{money(
                    group.amount,
                    group.type as "收入" | "支出" | "代付" | "加仓" | "提现"
                  )}</td>
                  <td className="asset-track-date-cell">
                    {group.firstDate === group.lastDate
                      ? group.lastDate
                      : `${group.firstDate} ～ ${group.lastDate}`}
                  </td>
                  <td>
                    {group.categories.length === 0
                      ? t("未分类", "Uncategorized")
                      : group.categories.length === 1
                        ? group.categories[0]
                        : t(
                            `${group.categories.length} 个分类（有冲突）`,
                            `${group.categories.length} categories (conflict)`
                          )}
                  </td>
                  <td className="asset-track-actions-cell">
                    <button onClick={() =>
                      onExpanded(expanded === group.key ? "" : group.key)
                    }>
                      {expanded === group.key
                        ? t("收起", "Collapse")
                        : t("展开逐项", "Expand items")}
                    </button>
                  </td>
                </tr>
                {expanded === group.key && (
                  <tr key={`${group.key}:expanded`}>
                    <td colSpan={7}>
                      <div className="asset-track-summary-details">
                        {group.indexes.map((index) => {
                          const item = rows[index];
                          const available = categories.filter(
                            (category) =>
                              category.is_active
                              && category.transaction_type === item.type
                          );
                          return (
                            <div key={item.id ?? item.client_id ?? index}>
                              <input
                                type="date"
                                value={item.transaction_date}
                                onChange={(event) =>
                                  onUpdate(index, "transaction_date", event.target.value)
                                }
                              />
                              <input
                                value={item.counterparty ?? ""}
                                placeholder={t("交易对方", "Counterparty")}
                                onChange={(event) =>
                                  onUpdate(index, "counterparty", event.target.value)
                                }
                              />
                              <input
                                value={item.product}
                                onChange={(event) =>
                                  onUpdate(index, "product", event.target.value)
                                }
                              />
                              <input
                                type="number"
                                value={item.amount}
                                onChange={(event) =>
                                  onUpdate(index, "amount", event.target.value)
                                }
                              />
                              {["支出", "收入"].includes(item.type) ? (
                                <select
                                  value={item.category_key ?? ""}
                                  onChange={(event) =>
                                    onUpdate(index, "category_key", event.target.value)
                                  }
                                >
                                  <option value="">{t("请选择分类", "Select category")}</option>
                                  {available.map((category) => (
                                    <option
                                      key={category.category_key}
                                      value={category.category_key}
                                    >
                                      {category.name}
                                    </option>
                                  ))}
                                </select>
                              ) : <span>{t("无需分类", "No category required")}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function FixedAssetTable({
  rows,
  onUpdate,
  onDelete,
  onAdd
}: {
  rows: FixedAsset[];
  onUpdate: (index: number, field: keyof FixedAsset, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const sorted = sortRows(rows, sort, (row, key) => row[key as keyof FixedAsset]);
  return (
    <Section title={t(`固定资产（${rows.length} 项）`, `Fixed assets (${rows.length})`)}>
      <div className="asset-track-table-scroll">
        <table className="asset-track-fixed-assets-table">
          <thead>
            <tr>
              {[
                ["asset_name", t("名称", "Name")],
                ["category", t("类别", "Category")],
                ["purchase_date", t("购置日", "Purchase date")],
                ["purchase_price", t("购买价", "Purchase price")],
                ["status", t("状态", "Status")],
                ["note", t("备注", "Notes")]
              ].map(([field, label]) => (
                <th
                  key={field}
                  scope="col"
                  className={field === "purchase_date"
                    ? "asset-track-date-column"
                    : field === "purchase_price"
                      ? "asset-track-amount-column"
                      : field === "status"
                        ? "asset-track-status-column"
                        : undefined}
                >
                  <SortButton field={field} label={label} sort={sort} onSort={setSort} />
                </th>
              ))}
              <ActionTableHeader />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, originalIndex }) => (
              <tr key={row.id ?? row.asset_key ?? row.client_id ?? originalIndex}>
                {(["asset_name", "category", "purchase_date", "purchase_price"] as const).map((field) => (
                  <td
                    key={field}
                    className={field === "purchase_date"
                      ? "asset-track-date-cell"
                      : field === "purchase_price"
                        ? "asset-track-amount-cell"
                        : undefined}
                  >
                    <input
                      type={
                        field === "purchase_price"
                          ? "number"
                          : field === "purchase_date"
                            ? "date"
                            : "text"
                      }
                      value={String(row[field] ?? "")}
                      onChange={(event) => onUpdate(originalIndex, field, event.target.value)}
                    />
                  </td>
                ))}
                <td className="asset-track-status-cell">
                  <select
                    value={row.status}
                    onChange={(event) => onUpdate(originalIndex, "status", event.target.value)}
                  >
                    {["在用", "闲置", "已出售", "已报废"].map((value) => (
                      <option key={value} value={value}>{businessLabel(value)}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={row.note}
                    onChange={(event) => onUpdate(originalIndex, "note", event.target.value)}
                  />
                </td>
                <td className="asset-track-actions-cell">
                  <button onClick={() => onDelete(originalIndex)}>{t("删除", "Delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={onAdd}>{t("新增资产", "Add asset")}</button>
    </Section>
  );
}

type ColumnType = "text" | "number" | "date" | "checkbox" | "readonly";

export function CollectionEditor({
  title,
  load,
  save,
  createRow,
  columns,
  onDirty,
  initialDraft,
  onDraftChange,
  onSaved
}: {
  title: string;
  load: () => Promise<{ revision: number; rows: Array<Record<string, unknown>> }>;
  save: (revision: number, rows: Array<Record<string, unknown>>) => Promise<unknown>;
  createRow: () => Record<string, unknown>;
  columns: Array<[string, string, ColumnType]>;
  onDirty: (dirty: boolean) => void;
  initialDraft?: DebtEditorDraftSnapshot;
  onDraftChange: (snapshot: EditorDraftSnapshot | null) => void;
  onSaved: () => void;
}) {
  const [revision, setRevision] = useState(initialDraft?.revision ?? 0);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>(
    initialDraft ? clone(initialDraft.rows) : []
  );
  const [sort, setSort] = useState<SortState>(null);
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const loadRef = useRef(load);
  const saveRef = useRef(save);
  const restoredDraft = useRef(
    initialDraft ? clone(initialDraft) : null
  );
  loadRef.current = load;
  saveRef.current = save;
  const reload = useCallback(async () => {
    setState({ kind: "pending", message: t("加载…", "Loading…") });
    try {
      const result = await loadRef.current();
      setRevision(result.revision);
      setRows(result.rows);
      onDirty(false);
      onDraftChange(null);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [onDirty, onDraftChange]);
  useEffect(() => {
    const restored = restoredDraft.current;
    if (!restored) {
      void reload();
      return;
    }
    restoredDraft.current = null;
    onDirty(true);
    onDraftChange(restored);
    setState({
      kind: "success",
      message: t("未保存借款草稿已恢复。", "The unsaved debt draft was restored.")
    });
    void loadRef.current()
      .then((current) => {
        if (current.revision !== restored.revision) {
          setState({
            kind: "error",
            message: t(
              "草稿已恢复，但其他窗口已修改借款；重新加载前不能覆盖保存。",
              "The draft was restored, but another window changed debts. Reload before saving."
            )
          });
        }
      })
      .catch((error: unknown) => {
        setState({ kind: "error", message: messageFor(error) });
      });
  }, [onDirty, onDraftChange, reload]);
  const markRows = (nextRows: Array<Record<string, unknown>>) => {
    setRows(nextRows);
    onDirty(true);
    onDraftChange({
      kind: "debts",
      revision,
      rows: clone(nextRows)
    });
  };
  const update = (index: number, key: string, value: unknown) => {
    markRows(rows.map((row, item) =>
      item === index ? { ...row, [key]: value } : row
    ));
  };
  const commit = async () => {
    setState({ kind: "pending", message: t("保存…", "Saving…") });
    try {
      await saveRef.current(revision, rows);
      await reload();
      onSaved();
      setState({ kind: "success", message: t("已保存。", "Saved.") });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };
  const sorted = sortRows(rows, sort, (row, key) => row[key]);
  return (
    <main className="asset-track-editor">
      <section className="asset-track-month-header">
        <div>
          <h2>{title}</h2>
          <span>revision {revision}</span>
        </div>
        <div className="asset-track-actions">
          <button
            onClick={() => {
              markRows([...rows, createRow()]);
            }}
          >
            {t("新增", "Add")}
          </button>
          <button onClick={() => void reload()}>{t("放弃并重载", "Discard and reload")}</button>
          <button className="mod-cta" onClick={() => void commit()}>
            {t("整体保存", "Save all")}
          </button>
        </div>
      </section>
      <Status state={state} />
      <div className="asset-track-table-scroll">
        <table className="asset-track-collection-table">
          <thead>
            <tr>
              {columns.map(([field, label, type]) => (
                <th key={field} scope="col" className={type === "checkbox" ? "asset-track-checkbox-heading" : undefined}>
                  <SortButton field={field} label={label} sort={sort} onSort={setSort} />
                </th>
              ))}
              <ActionTableHeader />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, originalIndex }) => (
              <tr key={scalarText(row.id ?? originalIndex)}>
                {columns.map(([key, , type]) => (
                  <td key={key} className={type === "checkbox" ? "asset-track-checkbox-cell" : undefined}>
                    {type === "readonly" ? (
                      scalarText(row[key])
                    ) : type === "checkbox" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(row[key])}
                        onChange={(event) => update(originalIndex, key, event.target.checked)}
                      />
                    ) : (
                      <input
                        type={type}
                        value={scalarText(row[key])}
                        onChange={(event) =>
                          update(
                            originalIndex,
                            key,
                            type === "number" ? number(event.target.value) : event.target.value
                          )
                        }
                      />
                    )}
                  </td>
                ))}
                <td className="asset-track-actions-cell">
                  <button
                    onClick={() => {
                      markRows(
                        rows.filter((_, item) => item !== originalIndex)
                      );
                    }}
                  >
                    {t("删除", "Delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

type HealthFilter = "all" | "conflict" | "rule-conflict" | "duplicate" | "inactive" | "uncategorized" | "no-rule" | "mismatch";
type ConflictView = "product" | "rule";

const EMPTY_RULE_HEALTH_SUMMARY: RuleHealthSummary = {
  product_conflicts: 0,
  rule_conflicts: 0,
  duplicate_rules: 0,
  inactive_category_transactions: 0,
  uncategorized_transactions: 0,
  stable_products_without_rule: 0
};

function ruleConflictKindLabel(kind: RuleConflictGroup["kind"]): string {
  return {
    duplicate: t("重复规则", "Duplicate rules"),
    "same-condition": t("同条件不同分类", "Same conditions, different categories"),
    overlap: t("条件重叠", "Overlapping conditions")
  }[kind];
}

function ruleConflictDescription(kind: RuleConflictGroup["kind"]): string {
  return {
    duplicate: t("规则条件和分类完全相同。", "The rule conditions and category are identical."),
    "same-condition": t("规则条件相同，但目标分类不同。", "The rule conditions are identical but target different categories."),
    overlap: t("规则条件重叠，且目标分类不同。", "The rule conditions overlap but target different categories.")
  }[kind];
}

function RuleConflictPanel({
  groups,
  rules,
  categories,
  localDirty,
  onUpdateRule,
  onDeleteRule
}: {
  groups: RuleConflictGroup[];
  rules: SavedRule[];
  categories: CategoryDefinition[];
  localDirty: boolean;
  onUpdateRule: (id: number, patch: Partial<SavedRule>) => void;
  onDeleteRule: (id: number) => void;
}) {
  const currentRules = new Map(
    rules.flatMap((rule) => rule.id === undefined ? [] : [[Number(rule.id), rule] as const])
  );
  return <div className="asset-track-rule-conflict-panel">
    <p>{t("规则冲突不会自动选择第一条。请编辑条件或分类，保存后重新检查。", "Rule conflicts never choose the first match automatically. Edit the conditions or category, save, and check again.")}</p>
    {localDirty && <p role="status">{t("当前存在未保存规则修改，冲突统计将在保存后刷新。", "Unsaved rule changes exist. Conflict analysis refreshes after saving.")}</p>}
    {!groups.length ? <EmptyState text={t("暂无规则冲突。", "No rule conflicts.")} /> : <div className="asset-track-rule-conflict-list">
      {groups.map((group) => <article className="asset-track-rule-conflict-card" key={group.conflict_key}>
        <header>
          <div>
            <strong>{ruleConflictKindLabel(group.kind)}</strong>
            <p>{ruleConflictDescription(group.kind)}</p>
          </div>
          <span>{t(`${group.affected_transaction_count} 条流水 · ${group.affected_months.length} 个月份`, `${group.affected_transaction_count} transactions · ${group.affected_months.length} months`)}</span>
        </header>
        <div className="asset-track-rule-conflict-rules">
          {group.rule_ids.map((id) => {
            const rule = currentRules.get(id);
            if (!rule) return null;
            const options = categories.filter((category) =>
              category.is_active && category.transaction_type === rule.transaction_type
            );
            return <div className="asset-track-rule-conflict-rule" key={id}>
              <select value={rule.transaction_type} aria-label={t(`规则 ${id} 收支`, `Rule ${id} type`)} onChange={(event) => onUpdateRule(id, {
                transaction_type: event.target.value as SavedRule["transaction_type"],
                category_key: "",
                category: ""
              })}>
                <option value="支出">{businessLabel("支出")}</option>
                <option value="收入">{businessLabel("收入")}</option>
              </select>
              <input value={rule.counterparty} placeholder={t("交易对方", "Counterparty")} aria-label={t(`规则 ${id} 交易对方`, `Rule ${id} counterparty`)} onChange={(event) => onUpdateRule(id, { counterparty: event.target.value })} />
              <input value={rule.product} placeholder={t("商品", "Item")} aria-label={t(`规则 ${id} 商品`, `Rule ${id} item`)} onChange={(event) => onUpdateRule(id, { product: event.target.value })} />
              <select value={rule.category_key} aria-label={t(`规则 ${id} 分类`, `Rule ${id} category`)} onChange={(event) => {
                const category = categories.find((item) => item.category_key === event.target.value);
                onUpdateRule(id, { category_key: event.target.value, category: category?.name ?? "" });
              }}>
                <option value="">{t("请选择分类", "Choose category")}</option>
                {options.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
              </select>
              <button type="button" onClick={() => onDeleteRule(id)}>{t("删除规则", "Delete rule")}</button>
            </div>;
          })}
        </div>
      </article>)}
    </div>}
  </div>;
}

export function RulesEditorV2({
  app,
  api,
  hostWindow,
  dataVersion,
  onDirty,
  initialDraft,
  onDraftChange,
  onSaved,
  onDataChanged,
  confirmAction
}: {
  app: App;
  api: AssetTrackService;
  hostWindow: Window;
  dataVersion: number;
  onDirty: (dirty: boolean) => void;
  initialDraft?: RulesEditorDraftSnapshot;
  onDraftChange: (snapshot: EditorDraftSnapshot | null) => void;
  onSaved: () => void;
  onDataChanged: () => void;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
}) {
  const [workspace, setWorkspace] = useState<RuleWorkspace | null>(
    initialDraft ? clone(initialDraft.workspace) : null
  );
  const [analyticsReady, setAnalyticsReady] = useState(
    initialDraft?.analytics_ready ?? false
  );
  const [categorySort, setCategorySort] = useState<SortState>(null);
  const [ruleSort, setRuleSort] = useState<SortState>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [conflictView, setConflictView] = useState<ConflictView>("product");
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [historyPanelQuery, setHistoryPanelQuery] = useState<ProductHistoryQuery | undefined>();
  const [historyPanelKey, setHistoryPanelKey] = useState(0);
  const [categoryDirty, setCategoryDirty] = useState(
    initialDraft?.category_dirty ?? false
  );
  const [ruleDirty, setRuleDirty] = useState(
    initialDraft?.rule_dirty ?? false
  );
  const [categoryState, setCategoryState] = useState<OperationState>({ kind: "idle" });
  const [ruleState, setRuleState] = useState<OperationState>({ kind: "idle" });
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const lastDataVersion = useRef(dataVersion);
  const localDirtyRef = useRef(Boolean(
    initialDraft?.category_dirty || initialDraft?.rule_dirty
  ));
  const categoryDirtyRef = useRef(initialDraft?.category_dirty ?? false);
  const ruleDirtyRef = useRef(initialDraft?.rule_dirty ?? false);
  const restoredDraft = useRef(
    initialDraft ? clone(initialDraft) : null
  );
  const skipNextDataVersion = useRef(false);
  const analyticsTimer = useRef<number | null>(null);
  const rulesSectionRef = useRef<HTMLElement | null>(null);

  const applyAnalytics = useCallback((analytics: RuleWorkspaceAnalytics) => {
    setWorkspace((current) => {
      if (!current) return current;
      if (!localDirtyRef.current) {
        return {
          ...current,
          categories_revision: analytics.categories_revision,
          rules_revision: analytics.rules_revision,
          categories: analytics.categories,
          rules: analytics.rules,
          recommendations: analytics.recommendations,
          rule_conflicts: analytics.rule_conflicts,
          summary: analytics.summary
        };
      }
      const remoteCategories = new Map(
        analytics.categories.map((category) => [category.category_key, category])
      );
      const remoteRules = new Map(
        analytics.rules.map((rule) => [Number(rule.id ?? 0), rule])
      );
      return {
        ...current,
        categories: current.categories.map((category) => {
          const remote = remoteCategories.get(category.category_key);
          return remote
            ? {
              ...category,
              transaction_count: remote.transaction_count,
              rule_count: remote.rule_count,
              impact_months: remote.impact_months,
              conflict_product_count: remote.conflict_product_count
            }
            : category;
        }),
        rules: current.rules.map((rule) => {
          const remote = remoteRules.get(Number(rule.id ?? 0));
          return remote
            ? {
              ...rule,
              rule_status: remote.rule_status,
              duplicate_rule_ids: remote.duplicate_rule_ids,
              conflict_rule_ids: remote.conflict_rule_ids,
              occurrences: remote.occurrences,
              months_count: remote.months_count,
              last_month: remote.last_month,
              match_level: remote.match_level
            }
            : rule;
        }),
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      };
    });
    setAnalyticsReady(true);
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const analytics = await api.ruleWorkspaceAnalytics();
      applyAnalytics(analytics);
      setState((current) => current.kind === "error"
        ? current
        : { kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [api, applyAnalytics]);

  const handleHistorySaved = useCallback(() => {
    setHistoryPanelKey((value) => value + 1);
    void loadAnalytics();
    onSaved();
  }, [loadAnalytics, onSaved]);

  const load = useCallback(async () => {
    setState({ kind: "pending", message: t("加载规则工作台…", "Loading the rules workspace…") });
    try {
      const shell: RuleWorkspaceShell = await api.ruleWorkspaceShell();
      setWorkspace({
        ...shell,
        recommendations: [],
        historical_products: [],
        rule_conflicts: [],
        summary: EMPTY_RULE_HEALTH_SUMMARY
      });
      setAnalyticsReady(false);
      setCategoryDirty(false);
      setRuleDirty(false);
      localDirtyRef.current = false;
      categoryDirtyRef.current = false;
      ruleDirtyRef.current = false;
      onDirty(false);
      setState({ kind: "idle" });
      if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
      analyticsTimer.current = hostWindow.setTimeout(() => {
        void loadAnalytics();
      }, 0);
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [api, hostWindow, loadAnalytics, onDirty]);

  useEffect(() => {
    const restored = restoredDraft.current;
    if (!restored) {
      void load();
    } else {
      restoredDraft.current = null;
      onDirty(true);
      onDraftChange(restored);
      setState({
        kind: "success",
        message: t(
          "未保存的分类和规则草稿已恢复。",
          "The unsaved category and rule draft was restored."
        )
      });
      void api.ruleWorkspaceShell()
        .then((current) => {
          if (
            current.categories_revision !== restored.workspace.categories_revision
            || current.rules_revision !== restored.workspace.rules_revision
          ) {
            setState({
              kind: "error",
              message: t(
                "草稿已恢复，但其他窗口已修改分类或规则；重新加载前不能覆盖保存。",
                "The draft was restored, but another window changed categories or rules. Reload before saving."
              )
            });
          }
          if (analyticsTimer.current !== null) {
            hostWindow.clearTimeout(analyticsTimer.current);
          }
          analyticsTimer.current = hostWindow.setTimeout(() => {
            void loadAnalytics();
          }, 0);
        })
        .catch((error: unknown) => {
          setState({ kind: "error", message: messageFor(error) });
        });
    }
    return () => {
      if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
    };
  }, [
    api,
    hostWindow,
    load,
    loadAnalytics,
    onDirty,
    onDraftChange
  ]);

  useEffect(() => {
    if (!workspace) return;
    if (!categoryDirty && !ruleDirty) {
      onDraftChange(null);
      return;
    }
    onDraftChange({
      kind: "rules",
      workspace: clone(workspace),
      category_dirty: categoryDirty,
      rule_dirty: ruleDirty,
      analytics_ready: analyticsReady
    });
  }, [
    analyticsReady,
    categoryDirty,
    onDraftChange,
    ruleDirty,
    workspace
  ]);

  useEffect(() => {
    if (lastDataVersion.current === dataVersion) return;
    lastDataVersion.current = dataVersion;
    if (skipNextDataVersion.current) {
      skipNextDataVersion.current = false;
      return;
    }
    if (localDirtyRef.current) {
      setState({
        kind: "error",
        message: t(
          "其他窗口已修改规则或历史流水；当前草稿保留，保存前请先重新加载。",
          "Another window changed rules or historical transactions. The current draft is preserved; reload before saving."
        )
      });
      return;
    }
    void load();
  }, [dataVersion, load]);

  if (!workspace) return <Status state={state} />;

  const setDirtyFlags = (nextCategoryDirty: boolean, nextRuleDirty: boolean) => {
    const nextLocalDirty = nextCategoryDirty || nextRuleDirty;
    setCategoryDirty(nextCategoryDirty);
    setRuleDirty(nextRuleDirty);
    categoryDirtyRef.current = nextCategoryDirty;
    ruleDirtyRef.current = nextRuleDirty;
    localDirtyRef.current = nextLocalDirty;
    onDirty(nextLocalDirty);
  };
  const markCategoryDirty = () => setDirtyFlags(true, ruleDirtyRef.current);
  const markRuleDirty = () => setDirtyFlags(categoryDirtyRef.current, true);
  const ruleStatusLabel = (value: unknown) => ({
    正常: t("正常", "Normal"),
    重复: t("重复", "Duplicate"),
    冲突: t("冲突", "Conflict"),
    未创建: t("未创建", "Not created"),
    已覆盖: t("已覆盖", "Covered")
  }[scalarText(value)] ?? t("加载中…", "Loading…"));
  const categoryForKey = (key: string) => workspace.categories.find(
    (category) => category.category_key === key
  );

  const updateRule = (id: number, patch: Partial<SavedRule>) => {
    const index = workspace.rules.findIndex((rule) => Number(rule.id) === id);
    if (index < 0) return;
    const rules = clone(workspace.rules);
    rules[index] = { ...rules[index], ...patch };
    setWorkspace({ ...workspace, rules });
    markRuleDirty();
  };

  const deleteRule = async (id: number) => {
    const rule = workspace.rules.find((item) => Number(item.id) === id);
    if (!rule) return;
    const confirmed = await confirmAction(
      t("确认删除规则？", "Confirm rule deletion?"),
      t(
        `将删除“${rule.counterparty || "（未限定交易对方）"} / ${rule.product || "（未限定商品）"}”规则；历史流水不会被修改。`,
        `This will delete the rule for “${rule.counterparty || "(any counterparty)"} / ${rule.product || "(any item)"}”. Historical transactions will not change.`
      ),
      t("删除规则", "Delete rule")
    );
    if (!confirmed) return;
    setWorkspace({
      ...workspace,
      rules: workspace.rules.filter((item) => Number(item.id) !== id)
    });
    markRuleDirty();
  };

  const saveCategories = async () => {
    setCategoryState({ kind: "pending", message: t("保存分类…", "Saving categories…") });
    try {
      const result = await api.saveCategories(
        workspace.categories_revision,
        workspace.categories
      );
      const analytics = await api.ruleWorkspaceAnalytics();
      const categoryNames = new Map(
        result.rows.map((category) => [category.category_key, category.name])
      );
      setWorkspace((current) => current ? {
        ...current,
        categories_revision: result.revision,
        categories: result.rows,
        rules_revision: analytics.rules_revision,
        rules: ruleDirtyRef.current
          ? current.rules.map((rule) => ({
            ...rule,
            category: categoryNames.get(rule.category_key) ?? rule.category
          }))
          : analytics.rules,
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      } : current);
      setDirtyFlags(false, ruleDirtyRef.current);
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
      new Notice(t("分类已保存。", "Categories saved."));
      setCategoryState({ kind: "success", message: t("分类已保存。", "Categories saved.") });
    } catch (error) {
      new Notice(messageFor(error));
      setCategoryState({ kind: "error", message: messageFor(error) });
    }
  };

  const saveRules = async () => {
    if (categoryDirtyRef.current) {
      setRuleState({ kind: "error", message: t("请先保存分类，再保存匹配规则。", "Save categories before saving matching rules.") });
      return;
    }
    setRuleState({ kind: "pending", message: t("保存匹配规则…", "Saving matching rules…") });
    try {
      const categoryNames = new Map(
        workspace.categories.map((category) => [category.category_key, category.name])
      );
      await api.saveRules(
        workspace.rules_revision,
        workspace.rules.map((rule) => ({
          ...rule,
          category: categoryNames.get(rule.category_key) ?? rule.category
        }))
      );
      const analytics = await api.ruleWorkspaceAnalytics();
      setWorkspace((current) => current ? {
        ...current,
        categories_revision: analytics.categories_revision,
        rules_revision: analytics.rules_revision,
        categories: analytics.categories,
        rules: analytics.rules,
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      } : current);
      setDirtyFlags(categoryDirtyRef.current, false);
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
      new Notice(t("匹配规则已保存。", "Matching rules saved."));
      setRuleState({ kind: "success", message: t("匹配规则已保存。", "Matching rules saved.") });
    } catch (error) {
      new Notice(messageFor(error));
      setRuleState({ kind: "error", message: messageFor(error) });
    }
  };

  const createRuleImmediately = async (rule: SavedRule) => {
    if (categoryDirtyRef.current || ruleDirtyRef.current) {
      throw new AssetTrackError({
        code: "unsaved_rule_changes",
        status: 422,
        message: t(
          "当前有未保存的分类或规则修改，请先保存后再直接创建规则。",
          "Save the current category or rule changes before creating a rule directly."
        )
      });
    }
    const normalizedCounterparty = normalizeProduct(rule.counterparty);
    const normalizedProduct = normalizeProduct(rule.product);
    const duplicate = workspace.rules.some((current) =>
      current.transaction_type === rule.transaction_type
      && normalizeProduct(current.counterparty) === normalizedCounterparty
      && normalizeProduct(current.product) === normalizedProduct
    );
    if (duplicate) {
      throw new AssetTrackError({
        code: "duplicate_rule",
        status: 422,
        message: t(
          "相同的收支、交易对方和商品规则已经存在。",
          "A rule with the same type, counterparty, and item already exists."
        )
      });
    }
    setRuleState({ kind: "pending", message: t("正在保存规则…", "Saving rule…") });
    let savedToDatabase = false;
    try {
      await api.saveRules(
        workspace.rules_revision,
        [...workspace.rules.map((current) => ({ ...current })), { ...rule }]
      );
      savedToDatabase = true;
      const analytics = await api.ruleWorkspaceAnalytics();
      applyAnalytics(analytics);
      setHistoryPanelKey((value) => value + 1);
      setRuleState({ kind: "success", message: t("规则已保存，冲突面板已刷新。", "Rule saved and the conflict panel was refreshed.") });
      new Notice(t("规则已直接保存，冲突面板已刷新。", "Rule saved directly and the conflict panel was refreshed."));
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
    } catch (error) {
      if (savedToDatabase) {
        skipNextDataVersion.current = false;
        onSaved();
        onDataChanged();
      }
      setRuleState({ kind: "error", message: messageFor(error) });
      throw error;
    }
  };

  const openProductPanel = (initialQuery?: ProductHistoryQuery) => {
    setConflictView("product");
    setHistoryPanelQuery({
      ...(historyPanelQuery ?? {}),
      ...(initialQuery ?? { issue_filter: "conflict" })
    });
    setHistoryPanelKey((value) => value + 1);
    setHistoryPanelOpen(true);
  };

  const openRuleConflictPanel = (
    focusRules = false,
    filter: "rule-conflict" | "duplicate" = "rule-conflict"
  ) => {
    setConflictView("rule");
    setHealthFilter(filter);
    setHistoryPanelOpen(true);
    if (focusRules) {
      hostWindow.setTimeout(() => {
        rulesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  };

  const openProductDetail = (
    group: HistoricalProductStat,
    query: ProductHistoryQuery
  ) => {
    new RuleHistoryModal({
      app,
      api,
      categories: workspace.categories,
      mode: "product",
      initialQuery: query,
      detailOnly: true,
      detailGroup: group,
      confirmAction,
      onSaved: handleHistorySaved,
      onDataChanged
    }).open();
  };

  const openProductRename = (
    group: HistoricalProductStat
  ) => {
    new ProductRenameModal({
      app,
      api,
      categories: workspace.categories,
      group,
      confirmAction,
      onSaved: handleHistorySaved,
      onDataChanged
    }).open();
  };

  const openRuleCreation = (group: HistoricalProductStat) => {
    const suggestion = group.rule_suggestion;
    new RuleCreationModal({
      app,
      categories: workspace.categories,
      initial: {
        transaction_type: group.transaction_type,
        counterparty: suggestion?.counterparty ?? group.counterparty,
        product: suggestion?.product ?? group.product,
        category_key: suggestion?.category_key ?? group.recommended_category_key ?? "",
        category: suggestion?.category ?? group.recommended_category
      },
      onConfirm: createRuleImmediately
    }).open();
  };

  const openCategoryHistory = (initialQuery: ProductHistoryQuery) => {
    new RuleHistoryModal({
      app,
      api,
      categories: workspace.categories,
      mode: "category",
      initialQuery,
      confirmAction,
      onSaved: handleHistorySaved,
      onDataChanged
    }).open();
  };

  const removeCategory = async (category: CategoryDefinition, index: number) => {
    const reasons: string[] = [];
    if ((category.transaction_count ?? 0) > 0) {
      reasons.push(t(`${category.transaction_count} 条历史流水`, `${category.transaction_count} historical transactions`));
    }
    if ((category.rule_count ?? 0) > 0) {
      reasons.push(t(`${category.rule_count} 条规则`, `${category.rule_count} rules`));
    }
    if (reasons.length > 0) {
      const actions: Array<{ text: string; onClick?: () => void }> = [
        { text: t("关闭", "Close") }
      ];
      if ((category.transaction_count ?? 0) > 0) {
        actions.push({
          text: t("打开历史迁移", "Open history migration"),
          onClick: () => openCategoryHistory({ category_key: category.category_key })
        });
      }
      if ((category.rule_count ?? 0) > 0) {
        actions.push({
          text: t("查看规则", "View rules"),
          onClick: () => openRuleConflictPanel(true)
        });
      }
      alertAction(
        app,
        t("无法删除分类", "Category cannot be deleted"),
        t(`该分类仍绑定${reasons.join("和")}，请先处理这些引用。`, `This category is still bound to ${reasons.join(" and ")}. Resolve these references first.`),
        actions
      );
      return;
    }
    const confirmed = await confirmAction(
      t("确认删除分类？", "Confirm category deletion?"),
      t(`分类“${category.name}”没有历史流水或规则引用，删除后不可恢复。`, `Category “${category.name}” has no historical transactions or rule references and cannot be restored after deletion.`),
      t("确认删除", "Delete category")
    );
    if (!confirmed) return;
    const categories = workspace.categories.filter((_, rowIndex) => rowIndex !== index);
    setWorkspace({ ...workspace, categories });
    markCategoryDirty();
  };

  const categoryView = sortRows(
    workspace.categories,
    categorySort,
    (row, key) => row[key as keyof CategoryDefinition]
  );
  const ruleView = sortRows(
    workspace.rules,
    ruleSort,
    (row, key) => row[key as keyof SavedRule]
  );
  const visibleRuleConflicts = workspace.rule_conflicts.filter((group) =>
    healthFilter === "duplicate"
      ? group.kind === "duplicate"
      : healthFilter === "rule-conflict"
        ? group.kind !== "duplicate"
        : true
  );
  const summaryCards: Array<[keyof RuleHealthSummary, string, Exclude<HealthFilter, "all">]> = [
    ["product_conflicts", t("商品分类冲突", "Product conflicts"), "conflict"],
    ["rule_conflict_groups", t("自动规则冲突", "Rule conflicts"), "rule-conflict"],
    ["duplicate_rule_groups", t("重复规则", "Duplicate rules"), "duplicate"],
    ["inactive_category_transactions", t("停用分类流水", "Inactive-category transactions"), "inactive"],
    ["uncategorized_transactions", t("未分类流水", "Uncategorized transactions"), "uncategorized"],
    ["stable_products_without_rule", t("稳定商品无规则", "Stable items without rules"), "no-rule"]
  ];

  return <main className="asset-track-editor">
    <section className="asset-track-month-header">
      <div>
        <h2>{t("规则工作台", "Rules workspace")}</h2>
        <span>{t("分类、匹配和按需处理历史问题", "Categories, matching, and on-demand history issue handling")}</span>
      </div>
      <span className="asset-track-revision-note">
        {t(`分类 revision ${workspace.categories_revision} · 规则 revision ${workspace.rules_revision}`, `Categories revision ${workspace.categories_revision} · rules revision ${workspace.rules_revision}`)}
      </span>
    </section>
    <Status state={state} />
    <Section title={t("规则健康摘要", "Rule health summary")}>
      <div className="asset-track-health-grid">
        {summaryCards.map(([key, label, filter]) => <button
          key={key}
          type="button"
          className={`asset-track-health-card${healthFilter === filter ? " is-active" : ""}`}
          disabled={!analyticsReady}
          aria-pressed={healthFilter === filter}
          onClick={() => {
            setHealthFilter(filter);
            if (filter === "rule-conflict" || filter === "duplicate") {
              openRuleConflictPanel(false, filter);
            } else {
              openProductPanel({ issue_filter: filter });
            }
          }}
        >
          <strong>{analyticsReady ? workspace.summary[key] : "…"}</strong>
          <span>{label}</span>
        </button>)}
      </div>
      {historyPanelOpen && <div className="asset-track-health-panel">
        <div className="asset-track-health-panel-heading">
          <strong>{summaryCards.find(([, , filter]) => filter === healthFilter)?.[1] ?? t("问题详情", "Issue details")}</strong>
          <button type="button" onClick={() => setHistoryPanelOpen(false)}>{t("收起", "Collapse")}</button>
        </div>
        {conflictView === "product" ? <HistoryBackfillContent
          key={historyPanelKey}
          api={api}
          categories={workspace.categories}
          mode="product"
          embedded
          hostWindow={hostWindow}
          initialQuery={historyPanelQuery}
          hideIssueFilter
          confirmAction={confirmAction}
          onSaved={handleHistorySaved}
          onDataChanged={onDataChanged}
          onOpenDetail={openProductDetail}
          onOpenProductRename={openProductRename}
          onCreateRule={openRuleCreation}
          onQueryChange={setHistoryPanelQuery}
          onClose={() => setHistoryPanelOpen(false)}
        /> : <RuleConflictPanel
          groups={visibleRuleConflicts}
          rules={workspace.rules}
          categories={workspace.categories}
          localDirty={ruleDirty}
          onUpdateRule={updateRule}
          onDeleteRule={(id) => void deleteRule(id)}
        />}
      </div>}
    </Section>
    <Section title={t("分类定义", "Category definitions")}>
      <Status state={categoryState} />
      {categoryView.length === 0 ? <EmptyState text={t("尚无分类定义。", "No category definitions yet.")} /> : <div className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
        <table className="asset-track-category-table"><thead><tr>{[
          ["name", t("名称", "Name")], ["transaction_type", t("收支", "Type")],
          ["necessity", t("必要性", "Necessity")], ["pattern", t("消费频率", "Frequency")], ["is_big_ticket", t("大额", "Large")], ["color", t("颜色", "Color")],
          ["transaction_count", t("历史流水", "Transactions")], ["impact_months", t("月份数", "Months")], ["rule_count", t("规则数", "Rules")]
        ].map(([field, label]) => <th key={field} scope="col" className={field === "is_big_ticket"
          ? "asset-track-checkbox-heading"
          : field === "color"
            ? "asset-track-color-column"
            : ["transaction_type", "necessity", "pattern"].includes(field)
              ? "asset-track-type-column"
              : ["transaction_count", "impact_months", "rule_count"].includes(field)
                ? "asset-track-count-column"
                : undefined}><SortButton field={field} label={label} sort={categorySort} onSort={setCategorySort} /></th>)}<ActionTableHeader /></tr></thead>
          <tbody>{categoryView.map(({ row, originalIndex: index }) => <tr key={row.category_key}>
              <td><input value={row.name} onChange={(event) => { const next = clone(workspace.categories); next[index].name = event.target.value; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }} /></td>
              <td className="asset-track-type-cell"><select value={row.transaction_type} onChange={(event) => { const next = clone(workspace.categories); next[index].transaction_type = event.target.value as "支出" | "收入"; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }}><option value="支出">{businessLabel("支出")}</option><option value="收入">{businessLabel("收入")}</option></select></td>
              <td className="asset-track-type-cell"><select value={row.necessity} onChange={(event) => { const next = clone(workspace.categories); next[index].necessity = event.target.value as CategoryDefinition["necessity"]; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }}>{["必要", "可控", "不适用"].map((value) => <option key={value} value={value}>{businessLabel(value)}</option>)}</select></td>
              <td className="asset-track-type-cell"><select value={row.pattern} onChange={(event) => { const next = clone(workspace.categories); next[index].pattern = event.target.value as CategoryDefinition["pattern"]; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }}>{["周期", "日常", "偶尔", "不适用"].map((value) => <option key={value} value={value}>{businessLabel(value)}</option>)}</select></td>
              <td className="asset-track-checkbox-cell"><input type="checkbox" checked={row.is_big_ticket} onChange={(event) => { const next = clone(workspace.categories); next[index].is_big_ticket = event.target.checked; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }} /></td>
              <td className="asset-track-color-cell"><input type="color" value={row.color} onChange={(event) => { const next = clone(workspace.categories); next[index].color = event.target.value; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }} /></td>
              <td className="asset-track-count-cell">{row.transaction_count ?? 0}</td><td className="asset-track-count-cell">{row.impact_months?.length ?? 0}</td><td className="asset-track-count-cell">{row.rule_count ?? 0}</td>
              <td className="asset-track-category-actions asset-track-actions-cell">
                {row.transaction_count ? <button type="button" onClick={() => openCategoryHistory({ category_key: row.category_key })}>{t("迁移", "Migrate")}</button> : null}
                <button type="button" onClick={() => void removeCategory(row, index)}>{t("删除", "Delete")}</button>
              </td>
            </tr>)}</tbody>
        </table>
      </div>}
      <div className="asset-track-section-actions">
        <button type="button" onClick={() => { setWorkspace({ ...workspace, categories: [...workspace.categories, { category_key: `cat-user-${crypto.randomUUID()}`, name: "", transaction_type: "支出", necessity: "必要", pattern: "日常", is_big_ticket: false, color: CATEGORY_RAINBOW[workspace.categories.length % CATEGORY_RAINBOW.length], is_active: true, sort_order: workspace.categories.length }] }); markCategoryDirty(); }}>{t("新增分类", "Add category")}</button>
        <button type="button" className="mod-cta" disabled={!categoryDirty || categoryState.kind === "pending"} onClick={() => void saveCategories()}>{t("保存分类", "Save categories")}</button>
      </div>
    </Section>
      <Section
      title={t("交易匹配规则", "Transaction matching rules")}
      sectionRef={rulesSectionRef}
    >
      <Status state={ruleState} />
      {ruleView.length === 0 ? <EmptyState text={t("尚无已保存匹配规则。", "No saved matching rules yet.")} /> : <div className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
        <table className="asset-track-rules-table"><thead><tr>{[
          ["transaction_type", t("收支", "Type")], ["counterparty", t("交易对方", "Counterparty")], ["product", t("商品", "Item")], ["category", t("分类", "Category")], ["rule_status", t("规则状态", "Rule status")], ["occurrences", t("历史次数", "Occurrences")], ["last_month", t("最近月份", "Latest month")]
        ].map(([field, label]) => <th key={field} scope="col"><SortButton field={field} label={label} sort={ruleSort} onSort={setRuleSort} /></th>)}<ActionTableHeader /></tr></thead>
          <tbody>{ruleView.map(({ row, originalIndex: index }) => <tr key={scalarText(row.id ?? index)}>
            <td><select value={row.transaction_type} onChange={(event) => { const next = clone(workspace.rules); next[index].transaction_type = event.target.value as "支出" | "收入"; next[index].category_key = ""; next[index].category = ""; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }}><option value="支出">{businessLabel("支出")}</option><option value="收入">{businessLabel("收入")}</option></select></td>
            <td><input value={row.counterparty} onChange={(event) => { const next = clone(workspace.rules); next[index].counterparty = event.target.value; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }} /></td>
            <td><input value={row.product} onChange={(event) => { const next = clone(workspace.rules); next[index].product = event.target.value; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }} /></td>
            <td><select value={row.category_key} onChange={(event) => { const next = clone(workspace.rules); const category = categoryForKey(event.target.value); next[index].category_key = event.target.value; next[index].category = category?.name ?? ""; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }}><option value="">{t("请选择", "Select")}</option>{workspace.categories.filter((category) => category.transaction_type === row.transaction_type).map((category) => <option key={category.category_key} value={category.category_key} disabled={!category.is_active}>{category.name}{category.is_active ? "" : ` · ${t("停用", "Inactive")}`}</option>)}</select></td>
            <td className="asset-track-status-cell">{ruleStatusLabel(row.rule_status)}{row.conflict_rule_ids?.length ? ` · ${row.conflict_rule_ids.length}` : ""}</td><td className="asset-track-count-cell">{row.occurrences ?? "—"}</td><td className="asset-track-date-cell">{row.last_month ?? "—"}</td>
            <td className="asset-track-actions-cell"><button type="button" onClick={() => { setWorkspace({ ...workspace, rules: workspace.rules.filter((_, item) => item !== index) }); markRuleDirty(); }}>{t("删除", "Delete")}</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="asset-track-section-actions">
        <button type="button" onClick={() => { const category = workspace.categories.find((row) => row.is_active && row.transaction_type === "支出"); setWorkspace({ ...workspace, rules: [...workspace.rules, { transaction_type: "支出", counterparty: "", product: "", category_key: category?.category_key ?? "", category: category?.name ?? "" }] }); markRuleDirty(); }}>{t("新增规则", "Add rule")}</button>
        <button type="button" className="mod-cta" disabled={!ruleDirty || ruleState.kind === "pending"} onClick={() => void saveRules()}>{t("保存规则", "Save rules")}</button>
      </div>
    </Section>
  </main>;
}

function IssueList({
  issues,
  rows
}: {
  issues: Array<Record<string, unknown>>;
  rows: Transaction[];
}) {
  const blocking = issues.filter(issueIsBlocking).length;
  return (
    <div className="asset-track-issues" role="alert">
      <strong>{blocking > 0
        ? t(`以下问题中有 ${blocking} 项会阻止保存：`, `${blocking} of the following issues block saving:`)
        : t("以下为保存后的提醒：", "The following items are saved warnings:")}</strong>
      <ul>
        {issues.map((issue, index) => {
          const globalIndex = Number(issue.row_index ?? 0);
          const type = scalarText(
            issue.type ?? rows[globalIndex]?.type ?? t("流水", "Transaction")
          );
          const blockRow = transactionBlockNumber(rows, globalIndex);
          const severity = issueIsBlocking(issue)
            ? t("错误", "Error")
            : t("警告", "Warning");
          const issueReason = scalarText(issue.issue ?? issue.reason) || "无效";
          const hasRuleConflict = Array.isArray(issue.rule_ids) && issue.rule_ids.length > 0;
          const visibleReason = hasRuleConflict
            ? t("规则存在冲突，未自动覆盖", "Rules conflict; no automatic override was applied.")
            : issueReason;
          return (
            <li key={index}>
              {t(
                `［${severity}］${businessLabel(type)}第 ${Math.max(1, blockRow)} 行／${scalarText(issue.field) || "规则"}／${visibleReason}`,
                `[${severity}] ${businessLabel(type)} row ${Math.max(1, blockRow)} / ${businessLabel(scalarText(issue.field) || "规则")} / ${displayError(visibleReason)}`
              )}
              {scalarText(issue.suggestion) && <small> · {displayError(scalarText(issue.suggestion))}</small>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Section({
  title,
  children,
  sectionRef
}: {
  title: string;
  children: ReactNode;
  sectionRef?: { current: HTMLElement | null };
}) {
  return (
    <section ref={sectionRef} className="asset-track-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={
          typeof value === "number" || typeof value === "string"
            ? value
            : 0
        }
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Status({ state }: { state: OperationState }) {
  if (state.kind === "idle" && !state.message) return null;
  return (
    <div
      className={`asset-track-status is-${state.kind}`}
      role={state.kind === "error" ? "alert" : "status"}
      aria-live={state.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {state.message}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="asset-track-empty" role="status">{text}</div>;
}
