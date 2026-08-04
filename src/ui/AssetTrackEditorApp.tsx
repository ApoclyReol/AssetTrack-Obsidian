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
import { Notice, type App } from "obsidian";
import {
  EDITOR_MODES,
  RULES_MODES,
  type AnalysisMode,
  type EditorMode,
  type RulesMode
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
  MonthSection,
  MonthSectionSaveRequest,
  MonthWorkspace,
  Transaction
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { AnalysisView } from "./AnalysisView";
import { RulesEditorV2, type RulesEditorHandle } from "./RulesEditor";
export { RulesEditorV2 } from "./RulesEditor";
import {
  createTransactionDraft,
  reconciliationTone,
  reconciliationStatus,
  transactionIndexes,
  TRANSACTION_SECTIONS
} from "./analysisModel";
import { CsvImportDialog } from "./CsvImportDialog";
import {
  MAX_IMPORT_FILE_BYTES,
  prepareCsvImportCommit
} from "./csvImportCommit";
import { monthEnd, previousMonth } from "../domain/dates";
import { roundHalfEven, sum } from "../domain/money";
import { businessLabel, getLocale, t } from "../i18n";
import { configureMoneyFormat, money } from "../domain/moneyFormat";
import type { ChoiceAction } from "./ConfirmModal";
import { debtSummary, MonthDebtSection } from "./MonthDebtSection";
import {
  FixedAssetTable,
  TransactionSummaryTable,
  TransactionTable
} from "./TransactionTables";
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
  chooseAction: <T extends string>(
    title: string,
    message: string,
    actions: Array<ChoiceAction<T>>
  ) => Promise<T | null>;
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

export interface MonthEditorHandle {
  requestDelete: () => void;
  openImport: () => void;
  applyRules: () => Promise<void>;
  reload: () => Promise<void>;
  save: () => Promise<void>;
  isSectionDirty: () => boolean;
  hasUnsavedChanges: () => boolean;
}

type MonthMetrics = {
  asset: number;
  income: number;
  expense: number;
  discrepancy: number | null;
};

type UnsavedPageAction = "save" | "discard" | "cancel";

function MonthMetricsSummary({
  metrics,
  reconciliationTolerance
}: {
  metrics: MonthMetrics;
  reconciliationTolerance: number;
}) {
  const discrepancyStatus = metrics.discrepancy === null
    ? ""
    : reconciliationStatus(metrics.discrepancy, reconciliationTolerance);
  return (
    <section className="asset-track-month-metrics asset-track-context-metrics" aria-label={t("本月摘要", "Monthly summary")}>
      <div className="asset-track-month-metric">
        <span>{t("资产", "Assets")}</span>
        <strong>{money(metrics.asset)}</strong>
      </div>
      <div className="asset-track-month-metric inflow">
        <span>{t("收入", "Income")}</span>
        <strong>{money(metrics.income)}</strong>
      </div>
      <div className="asset-track-month-metric outflow">
        <span>{t("净支出", "Net expense")}</span>
        <strong>{money(metrics.expense)}</strong>
      </div>
      <div className={`asset-track-month-metric ${reconciliationTone(metrics.discrepancy, reconciliationTolerance) ?? ""}`}>
        <span>{t("对账差额", "Reconciliation difference")}</span>
        <strong>
          {metrics.discrepancy === null ? t("不可比较", "Unavailable") : money(metrics.discrepancy)}
          {discrepancyStatus && <small className="asset-track-month-metric-suffix">（{businessLabel(discrepancyStatus)}）</small>}
        </strong>
      </div>
    </section>
  );
}

const MONTH_SECTIONS: MonthSection[] = [
  "assets",
  "transactions",
  "debts",
  "fixed_assets"
];

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
  chooseAction,
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
  const [analysisYear, setAnalysisYear] = useState(String(new Date().getFullYear()));
  const [monthSection, setMonthSection] = useState<MonthSection>(
    recoveryDraft.current?.kind === "transactions"
      ? recoveryDraft.current.active_section ?? "transactions"
      : "transactions"
  );
  const [rulesMode, setRulesMode] = useState<RulesMode>("health");
  const [months, setMonths] = useState<string[]>([]);
  const [monthPolicy, setMonthPolicy] = useState<MonthCreationPolicy | null>(null);
  const [month, setMonth] = useState(
    recoveryDraft.current?.kind === "transactions"
      ? recoveryDraft.current.month
      : initialMonth ?? ""
  );
  const [dirty, setDirty] = useState(Boolean(recoveryDraft.current));
  const [dataVersion, setDataVersion] = useState(0);
  const [monthMetrics, setMonthMetrics] = useState<MonthMetrics | null>(null);
  const monthEditorRef = useRef<MonthEditorHandle>(null);
  const rulesEditorRef = useRef<RulesEditorHandle>(null);
  const [initializing, setInitializing] = useState(true);
  const [showPreparing, setShowPreparing] = useState(false);
  useEffect(() => {
    if (mode !== "transactions" || !month) setMonthMetrics(null);
  }, [mode, month]);
  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setAnalysisMode(initialAnalysisMode), [initialAnalysisMode]);
  const analysisYears = [...new Set(months.map((item) => item.slice(0, 4)))].sort().reverse();
  useEffect(() => {
    if (analysisYears.length && !analysisYears.includes(analysisYear)) {
      setAnalysisYear(analysisYears[0]);
    }
  }, [analysisYear, analysisYears.join(",")]);
  useEffect(() => {
    if (initializing) return;
    if (analysisMode === "monthly" && months.length === 0) {
      setAnalysisMode("annual");
    }
  }, [analysisMode, analysisYears.length, initializing, months.length]);
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

  const settleCurrentPage = async (
    isDirty: () => boolean,
    hasUnsavedChanges: () => boolean,
    save: () => Promise<void>,
    reload: () => Promise<void>,
    pageLabel: string
  ): Promise<boolean> => {
    if (!isDirty()) return true;
    const action = await chooseAction<UnsavedPageAction>(
      t("当前页面有未保存修改", "This page has unsaved changes"),
      t(`当前${pageLabel}有未保存修改，请选择下一步。`, `The current ${pageLabel} has unsaved changes. Choose what to do next.`),
      [
        { value: "save", text: t("保存并继续", "Save and continue"), cta: true },
        { value: "discard", text: t("放弃并继续", "Discard and continue"), className: "mod-warning" },
        { value: "cancel", text: t("取消", "Cancel") }
      ]
    );
    if (action === "save") {
      await save();
      if (!isDirty()) return true;
      new Notice(t(`当前${pageLabel}仍有未保存修改，未切换。`, `The current ${pageLabel} still has unsaved changes. The view was not switched.`));
      return false;
    }
    if (action !== "discard") return false;
    await reload();
    if (isDirty() || hasUnsavedChanges()) {
      new Notice(t(`当前${pageLabel}未能重载，未切换。`, `The current ${pageLabel} could not be reloaded. The view was not switched.`));
      return false;
    }
    return true;
  };

  const settleTransactionPage = async (): Promise<boolean> => {
    if (!monthEditorRef.current) return true;
    return settleCurrentPage(
      monthEditorRef.current.isSectionDirty,
      monthEditorRef.current.hasUnsavedChanges,
      monthEditorRef.current.save,
      monthEditorRef.current.reload,
      t("流水区块", "transaction section")
    );
  };

  const settleRulesPage = async (): Promise<boolean> => {
    if (!rulesEditorRef.current) return true;
    return settleCurrentPage(
      rulesEditorRef.current.isSectionDirty,
      rulesEditorRef.current.hasUnsavedChanges,
      rulesEditorRef.current.save,
      rulesEditorRef.current.reload,
      t("配置子页面", "configuration subpage")
    );
  };

  const switchMode = async (next: EditorMode): Promise<void> => {
    if (next === mode) return;
    const pageSettled = mode === "transactions"
      ? await settleTransactionPage()
      : mode === "rules"
        ? await settleRulesPage()
        : true;
    if (!pageSettled) return;
    const remainingDraft = mode === "transactions"
      ? monthEditorRef.current?.hasUnsavedChanges() ?? false
      : mode === "rules"
        ? rulesEditorRef.current?.hasUnsavedChanges() ?? false
        : dirty;
    if (remainingDraft && !await confirmAction(
      t("放弃其他未保存修改？", "Discard other unsaved changes?"),
      t("当前还有未保存修改。放弃这些修改并切换？", "There are still unsaved changes. Discard them and switch?"),
      t("放弃并切换", "Discard and switch")
    )) return;
    setDirty(false);
    handleDraftSnapshotChange(null);
    setMode(next);
  };
  const selectMonth = async (next: string): Promise<void> => {
    if (next === month) return;
    if (mode === "transactions" && !await settleTransactionPage()) return;
    const remainingDraft = mode === "transactions"
      ? monthEditorRef.current?.hasUnsavedChanges() ?? false
      : dirty;
    if (remainingDraft && !await confirmAction(
      t("放弃其他未保存修改？", "Discard other unsaved changes?"),
      t("当前还有未保存修改。放弃这些修改并切换月份？", "There are still unsaved changes. Discard them and switch months?"),
      t("放弃并切换", "Discard and switch")
    )) return;
    setDirty(false);
    handleDraftSnapshotChange(null);
    setMonth(next);
  };
  const createNext = async () => {
    if (mode === "transactions" && !await settleTransactionPage()) return;
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
  const switchMonthSection = async (next: MonthSection): Promise<void> => {
    if (next === monthSection) return;
    if (!await settleTransactionPage()) return;
    setMonthSection(next);
  };
  const switchRulesMode = async (next: RulesMode): Promise<void> => {
    if (next === rulesMode) return;
    if (!await settleRulesPage()) return;
    setRulesMode(next);
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
        <div className="asset-track-toolbar-main">
          <strong>Asset Track</strong>
          <nav aria-label={t("主导航", "Main navigation")}>
          {EDITOR_MODES.map((item) => (
            <button
              key={item}
              className={mode === item ? "is-active" : ""}
              onClick={() => void switchMode(item)}
            >
              {{ analysis: t("分析", "Analysis"), transactions: t("记录", "Records"), rules: t("配置", "Configuration") }[item]}
            </button>
          ))}
          </nav>
        </div>
        {mode === "analysis" && (
          <div className="asset-track-context-toolbar asset-track-context-toolbar-inline">
            <nav className="asset-track-context-nav" aria-label={t("分析子导航", "Analysis sub-navigation")}>
              {(["annual", ...(months.length ? ["monthly"] : [])] as AnalysisMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={analysisMode === item ? "is-active" : ""}
                  onClick={() => setAnalysisMode(item)}
                >
                  {{ annual: t("年度", "Annual"), monthly: t("月度", "Monthly") }[item]}
                </button>
              ))}
            </nav>
            <div className="asset-track-context-period">
              {analysisMode === "annual" && analysisYears.length > 0 && (
                <select value={analysisYear} onChange={(event) => setAnalysisYear(event.target.value)} aria-label={t("分析年份", "Analysis year")}>
                  {analysisYears.map((item) => <option key={item}>{item}</option>)}
                </select>
              )}
              {analysisMode === "monthly" && months.length > 0 && (
                <select value={month} onChange={(event) => void selectMonth(event.target.value)} aria-label={t("分析月份", "Analysis month")}>
                  {[...months].sort().reverse().map((item) => <option key={item}>{item}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
        {mode === "transactions" && (
          <div className="asset-track-context-toolbar">
            <div className="asset-track-context-row">
              <nav className="asset-track-context-nav" aria-label={t("流水子导航", "Transaction sub-navigation")}>
                {MONTH_SECTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={monthSection === item ? "is-active" : ""}
                    disabled={!month}
                    onClick={() => void switchMonthSection(item)}
                  >
                    {{
                      assets: t("资产账户", "Asset accounts"),
                      transactions: t("流水", "Transactions"),
                      debts: t("借款", "Debts"),
                      fixed_assets: t("固定资产", "Fixed assets")
                    }[item]}
                  </button>
                ))}
              </nav>
              <div className="asset-track-context-period">
                <button
                  type="button"
                  className="mod-cta"
                  disabled={!monthPolicy?.can_create}
                  title={t("创建下一个月份", "Create the next month")}
                  onClick={() => void createNext().catch((error) => new Notice(messageFor(error)))}
                >
                  {t("创建月份", "Create month")}
                </button>
                {month && (
                  <button
                    type="button"
                    className="mod-warning"
                    onClick={() => monthEditorRef.current?.requestDelete()}
                  >
                    {t("删除月份", "Delete month")}
                  </button>
                )}
                {months.length > 0 && (
                  <select value={month} onChange={(event) => void selectMonth(event.target.value)} aria-label={t("编辑月份", "Editing month")}>
                    {[...months].sort().reverse().map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                )}
              </div>
            </div>
            {month && monthMetrics && (
              <MonthMetricsSummary
                metrics={monthMetrics}
                reconciliationTolerance={settings.reconciliationTolerance}
              />
            )}
          </div>
        )}
        {mode === "rules" && (
          <div className="asset-track-context-toolbar">
            <nav className="asset-track-context-nav" aria-label={t("配置子导航", "Configuration sub-navigation")}>
              {RULES_MODES.map((item) => (
                <button key={item} type="button" className={rulesMode === item ? "is-active" : ""} onClick={() => void switchRulesMode(item)}>
                  {{ health: t("数据健康", "Data health"), categories: t("分类定义", "Categories"), matching: t("匹配规则", "Matching rules"), products: t("商品总览", "Item overview") }[item]}
                </button>
              ))}
            </nav>
          </div>
        )}
      </header>
      {mode === "analysis" && (
        <AnalysisView
          api={api}
          month={month}
          mode={analysisMode}
          year={analysisYear}
          dataVersion={dataVersion}
          reconciliationTolerance={settings.reconciliationTolerance}
        />
      )}
      {mode === "transactions" && month && (
        <MonthEditor
          key={month}
          ref={monthEditorRef}
          api={api}
          hostWindow={hostWindow}
          month={month}
          months={months}
          dataVersion={dataVersion}
          reconciliationTolerance={settings.reconciliationTolerance}
          activeSection={monthSection}
          onMetricsChange={setMonthMetrics}
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
      {mode === "rules" && (
        <RulesEditorV2
          ref={rulesEditorRef}
          app={app}
          api={api}
          hostWindow={hostWindow}
          dataVersion={dataVersion}
          onSectionChange={setRulesMode}
          onDirty={setDirty}
          initialDraft={recoveryDraft.current?.kind === "rules"
            ? recoveryDraft.current
            : undefined}
          onDraftChange={handleDraftSnapshotChange}
          onSaved={() => setDataVersion((value) => value + 1)}
          onDataChanged={notifyDataChanged}
          confirmAction={confirmAction}
          section={rulesMode}
        />
      )}
    </div>
  );
}

function draftMonthMetrics(workspace: MonthWorkspace): MonthMetrics {
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
  const currentMonthEnd = monthEnd(workspace.month);
  const asset = roundHalfEven(
    sum(workspace.cash_accounts.map((row) => Number(row.balance) || 0))
    - draftDebtActiveAt(workspace.debts, currentMonthEnd, currentMonthEnd)
    + sum(workspace.investment_accounts.map((row) => Number(row.principal) || 0))
  );
  const theoretical = workspace.overview.reconciliation?.available
    && workspace.overview.reconciliation.theoretical.previous_cash !== null
    ? workspace.overview.reconciliation.theoretical.previous_cash
      + income
      + draftDebtChange(workspace)
      - sum(workspace.cash_accounts.map((row) => Number(row.balance) || 0))
      - sum(workspace.transactions
        .filter((row) => row.type === "加仓")
        .map((row) => Number(row.amount) || 0))
      + sum(workspace.transactions
        .filter((row) => row.type === "提现")
        .map((row) => Number(row.amount) || 0))
    : null;
  return {
    asset,
    income,
    expense,
    discrepancy: theoretical === null ? null : roundHalfEven(expense - theoretical)
  };
}

function normalizedDebtDate(value: string | null | undefined): string {
  return String(value ?? "").replace(/\//g, "-");
}

function draftDebtPaidDate(
  row: MonthWorkspace["debts"][number],
  currentMonthEnd: string
): string | null {
  const paidDate = normalizedDebtDate(row.paid_date);
  if (row.is_paid) return paidDate || currentMonthEnd;
  return paidDate && paidDate > currentMonthEnd ? paidDate : null;
}

function draftDebtActiveAt(
  rows: MonthWorkspace["debts"],
  boundary: string,
  currentMonthEnd: string
): number {
  return sum(rows.map((row) => {
    const startDate = normalizedDebtDate(row.start_date);
    if (!startDate || startDate > boundary) return 0;
    const paidDate = draftDebtPaidDate(row, currentMonthEnd);
    if (paidDate && paidDate <= boundary) return 0;
    return Number(row.amount) || 0;
  }));
}

function draftDebtChange(workspace: MonthWorkspace): number {
  const previous = previousMonth(workspace.month);
  if (!previous) return 0;
  const currentMonthEnd = monthEnd(workspace.month);
  const previousMonthEnd = monthEnd(previous);
  return roundHalfEven(
    draftDebtActiveAt(workspace.debts, currentMonthEnd, currentMonthEnd)
    - draftDebtActiveAt(workspace.debts, previousMonthEnd, currentMonthEnd)
  );
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
  const discrepancyStatus = monthMetrics.discrepancy === null
    ? ""
    : reconciliationStatus(monthMetrics.discrepancy, reconciliationTolerance);
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
      {activeSection && <>
        <section className="asset-track-month-header asset-track-page-heading">
          <div>
            <h2>{activeSection === "fixed_assets"
              ? t(`固定资产（${draft.fixed_assets.length} 项）`, `Fixed assets (${draft.fixed_assets.length})`)
              : activeSection === "debts"
                ? t("借款", "Debts")
                : {
                    assets: t("资产账户", "Asset accounts"),
                    transactions: t("流水", "Transactions")
                  }[activeSection]}</h2>
            {activeSection === "debts" && <span>{(() => {
              const summary = debtSummary(draft.debts);
              return t(
                `本月相关 ${draft.debts.length} 笔 · 本月未还 ${money(summary.openAmount)} · 本月还清 ${summary.paidCount} 笔`,
                `${draft.debts.length} related debts · Unpaid this month ${money(summary.openAmount)} · ${summary.paidCount} paid this month`
              );
            })()}</span>}
            {activeSection === "fixed_assets" && <span>{t("固定资产不计入总资产、对账和消费计算。", "Fixed assets are excluded from total assets, reconciliation, and spending calculations.")}</span>}
          </div>
          <div className="asset-track-page-actions">
            {activeSection === "transactions" && <>
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
              <button type="button" disabled={state.kind === "pending"} onClick={() => void applyRules()}>
                {t("应用规则", "Apply rules")}
              </button>
            </>}
            <button type="button" disabled={state.kind === "pending"} onClick={() => void reloadCurrentSection()}>
              {t("放弃并重载", "Discard and reload")}
            </button>
            <button
              type="button"
              className="mod-cta"
              disabled={state.kind === "pending" || !dirtySections.includes(activeSection)}
              onClick={() => void save()}
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
      </>}
      {showAllSections && <section className="asset-track-month-header">
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
      </section>}
      {showAllSections && <section className="asset-track-month-metrics" aria-label={t("本月摘要", "Monthly summary")}>
        <div className={`asset-track-month-metric ${reconciliationTone(monthMetrics.discrepancy, reconciliationTolerance) ?? ""}`}>
          <span>{t("对账差额", "Reconciliation difference")}</span>
          <strong>
            {monthMetrics.discrepancy === null ? t("不可比较", "Unavailable") : money(monthMetrics.discrepancy)}
            {discrepancyStatus && <small className="asset-track-month-metric-suffix">（{businessLabel(discrepancyStatus)}）</small>}
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
      <span className="asset-track-sr-only" role="status" aria-live="polite">
        {state.kind === "error" ? state.message : ""}
      </span>
      {issues.length > 0 && (
        <IssueList issues={issues} rows={draft.transactions} />
      )}
      {(showAllSections || activeSection === "assets") && <Section title={t("现金账户", "Cash accounts")}>
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
                }, "assets")
              }
            />
          ))}
        </div>
      </Section>}
      {(showAllSections || activeSection === "assets") && <Section title={t("理财账户", "Investment accounts")}>
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
                  }, "assets")
                }
              />
            ))}
          </div>
        ))}
      </Section>}
      {(showAllSections || activeSection === "transactions") && <section className="asset-track-view-switcher">
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
      </section>}
      {(showAllSections || activeSection === "transactions") && transactionView === "detail" && TRANSACTION_SECTIONS.map((title) => (
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
              }, "transactions")
            }
            onAdd={() => {
              mark({
                ...draft,
                transactions: [
                  ...draft.transactions,
                  createTransactionDraft(title, month, categories)
                ]
              }, "transactions");
            }}
          />
        ))}
      {(showAllSections || activeSection === "transactions") && transactionView === "summary" && (
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
      {(showAllSections || activeSection === "debts") && <MonthDebtSection
        month={month}
        rows={draft.debts}
        onChange={(rows) => mark({ ...draft, debts: rows }, "debts")}
        onBlocked={(message) => new Notice(message)}
        hideHeader={Boolean(activeSection)}
      />}
      {(showAllSections || activeSection === "fixed_assets") && <FixedAssetTable
        rows={draft.fixed_assets}
        onUpdate={updateAsset}
        onDelete={(index) =>
          mark({
            ...draft,
            fixed_assets: draft.fixed_assets.filter((_, item) => item !== index)
          }, "fixed_assets")
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
          }, "fixed_assets")
        }
        hideTitle={Boolean(activeSection)}
      />}
    </main>
  );
});
