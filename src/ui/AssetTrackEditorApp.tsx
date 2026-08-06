import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
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
  CsvColumnMapping
} from "../types/csv";
import type {
  AssetTrackSettings
} from "../types/settings";
import type {
  MonthCreationPolicy
} from "../types/configuration";
import { AssetTrackError } from "../application/errors";
import type {
  MonthSection
} from "../types/month";
import type { MonthOverview } from "../types/month";
import type { AnnualOverview } from "../types/analysis";
import type { AnalysisPort, EditorShellPort } from "../services/ports";
import { AnalysisView } from "./AnalysisView";
import { RulesEditor, type RulesEditorHandle } from "./RulesEditor";
export { RulesEditor } from "./RulesEditor";
import {
  reconciliationTone,
  reconciliationStatus
} from "./analysisModel";
import { businessLabel, displayError, getLocale, t } from "../i18n";
import { configureMoneyFormat, money } from "../domain/moneyFormat";
import type { ChoiceAction } from "./ConfirmModal";
import {
  EmptyState,
  messageFor
} from "./editorPrimitives";
import type { LoadState } from "./AnalysisPrimitives";
import type { EditorDraftSnapshot } from "./editorDraft";
import type { EditorSession } from "./editorSession";
import {
  MONTH_SECTIONS,
  MonthEditor,
  type MonthEditorHandle,
  type MonthMetrics
} from "./MonthEditor";
export { MonthEditor } from "./MonthEditor";

interface Props {
  app: App;
  api: EditorShellPort;
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
  onSessionChange: (snapshot: EditorDraftSnapshot | null) => void;
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
  onSessionChange,
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
  const handleSessionChange = useCallback((
    snapshot: EditorDraftSnapshot | null
  ) => {
    recoveryDraft.current = snapshot ?? undefined;
    onSessionChange(snapshot);
  }, [onSessionChange]);
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
  const [dataVersion, setDataVersion] = useState(0);
  const [monthMetrics, setMonthMetrics] = useState<MonthMetrics | null>(null);
  const monthEditorRef = useRef<MonthEditorHandle>(null);
  const rulesEditorRef = useRef<RulesEditorHandle>(null);
  const [initializing, setInitializing] = useState(true);
  const [showPreparing, setShowPreparing] = useState(false);
  const analysisCache = useRef<{
    api: AnalysisPort;
    dataVersion: number;
    annual: Map<string, ReturnType<AnalysisPort["annual"]>>;
    monthly: Map<string, ReturnType<AnalysisPort["monthOverview"]>>;
  } | null>(null);
  const analysisApi = useMemo<AnalysisPort>(() => {
    const previous = analysisCache.current;
    const cache = previous && previous.api === api && previous.dataVersion === dataVersion
      ? previous
      : {
          api,
          dataVersion,
          annual: new Map<string, ReturnType<AnalysisPort["annual"]>>(),
          monthly: new Map<string, ReturnType<AnalysisPort["monthOverview"]>>()
        };
    analysisCache.current = cache;
    return {
      annual: (year) => {
        const cached = cache.annual.get(year);
        if (cached) return cached;
        const request = api.annual(year);
        cache.annual.set(year, request);
        void request.catch(() => {
          if (cache.annual.get(year) === request) cache.annual.delete(year);
        });
        return request;
      },
      monthOverview: (targetMonth) => {
        const cached = cache.monthly.get(targetMonth);
        if (cached) return cached;
        const request = api.monthOverview(targetMonth);
        cache.monthly.set(targetMonth, request);
        void request.catch(() => {
          if (cache.monthly.get(targetMonth) === request) cache.monthly.delete(targetMonth);
        });
        return request;
      }
    };
  }, [api, dataVersion]);
  const annualAnalysisKey = `${dataVersion}:${analysisYear}`;
  const monthlyAnalysisKey = `${dataVersion}:${month}`;
  const [annualLoad, setAnnualLoad] = useState<{
    key: string;
    state: LoadState<AnnualOverview>;
  }>({ key: "", state: { kind: "loading" } });
  const [monthlyLoad, setMonthlyLoad] = useState<{
    key: string;
    state: LoadState<MonthOverview>;
  }>({ key: "", state: { kind: "loading" } });
  const analysisYears = [...new Set(months.map((item) => item.slice(0, 4)))].sort().reverse();
  useEffect(() => {
    if (mode !== "analysis") return;
    if (analysisMode === "annual") {
      if (analysisYears.length > 0 && !analysisYears.includes(analysisYear)) return;
      const key = annualAnalysisKey;
      let active = true;
      setAnnualLoad({ key, state: { kind: "loading" } });
      void analysisApi.annual(analysisYear)
        .then((data) => active && setAnnualLoad({ key, state: { kind: "ready", data } }))
        .catch((error) => active && setAnnualLoad({
          key,
          state: { kind: "error", message: displayError(error) }
        }));
      return () => { active = false; };
    }
    if (!month) return;
    const key = monthlyAnalysisKey;
    let active = true;
    setMonthlyLoad({ key, state: { kind: "loading" } });
    void analysisApi.monthOverview(month)
      .then((data) => active && setMonthlyLoad({ key, state: { kind: "ready", data } }))
      .catch((error) => active && setMonthlyLoad({
        key,
        state: { kind: "error", message: displayError(error) }
      }));
    return () => { active = false; };
  }, [
    analysisApi,
    analysisMode,
    analysisYear,
    analysisYears.join(","),
    annualAnalysisKey,
    mode,
    month,
    monthlyAnalysisKey
  ]);
  const currentAnnualState = annualLoad.key === annualAnalysisKey
    ? annualLoad.state
    : { kind: "loading" as const };
  const currentMonthlyState = monthlyLoad.key === monthlyAnalysisKey
    ? monthlyLoad.state
    : { kind: "loading" as const };
  useEffect(() => {
    if (mode !== "transactions" || !month) setMonthMetrics(null);
  }, [mode, month]);
  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setAnalysisMode(initialAnalysisMode), [initialAnalysisMode]);
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
  useEffect(
    () => onStateChange(mode, analysisMode, month),
    [analysisMode, mode, month, onStateChange]
  );

  const settleCurrentPage = async (
    session: EditorSession | null,
    pageLabel: string
  ): Promise<boolean> => {
    if (!session || !session.hasUnsavedChanges()) return true;
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
      if (await session.save() && !session.hasUnsavedChanges()) return true;
      new Notice(t(`当前${pageLabel}仍有未保存修改，未切换。`, `The current ${pageLabel} still has unsaved changes. The view was not switched.`));
      return false;
    }
    if (action !== "discard") return false;
    await session.discard();
    if (session.hasUnsavedChanges()) {
      new Notice(t(`当前${pageLabel}未能重载，未切换。`, `The current ${pageLabel} could not be reloaded. The view was not switched.`));
      return false;
    }
    return true;
  };

  const settleTransactionPage = async (): Promise<boolean> => {
    return settleCurrentPage(monthEditorRef.current, t("流水区块", "transaction section"));
  };

  const settleRulesPage = async (): Promise<boolean> => {
    return settleCurrentPage(rulesEditorRef.current, t("配置子页面", "configuration subpage"));
  };

  const switchMode = async (next: EditorMode): Promise<void> => {
    if (next === mode) return;
    const pageSettled = mode === "transactions"
      ? await settleTransactionPage()
      : mode === "rules"
        ? await settleRulesPage()
        : true;
    if (!pageSettled) return;
    if (next === "analysis") {
      if (analysisMode === "annual") {
        void analysisApi.annual(analysisYear).catch(() => undefined);
      } else if (month) {
        void analysisApi.monthOverview(month).catch(() => undefined);
      }
    }
    setMode(next);
  };
  const selectMonth = async (next: string): Promise<void> => {
    if (next === month) return;
    if (mode === "transactions" && !await settleTransactionPage()) return;
    if (mode === "rules" && !await settleRulesPage()) return;
    if (mode === "analysis" && analysisMode === "monthly") {
      void analysisApi.monthOverview(next).catch(() => undefined);
    }
    setMonth(next);
  };
  const createNext = async () => {
    if (mode === "transactions" && !await settleTransactionPage()) return;
    if (mode === "rules" && !await settleRulesPage()) return;
    if (!monthPolicy?.can_create) {
      const reason = monthPolicy?.reason;
      throw new AssetTrackError({
        code: reason?.code ?? "month.creation_blocked",
        status: 422,
        params: reason?.params
      });
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
                  onClick={() => {
                    if (item === "annual") {
                      void analysisApi.annual(analysisYear).catch(() => undefined);
                    } else if (month) {
                      void analysisApi.monthOverview(month).catch(() => undefined);
                    }
                    setAnalysisMode(item);
                  }}
                >
                  {{ annual: t("年度", "Annual"), monthly: t("月度", "Monthly") }[item]}
                </button>
              ))}
            </nav>
            <div className="asset-track-context-period">
              {analysisMode === "annual" && analysisYears.length > 0 && (
                <select value={analysisYear} onChange={(event) => {
                  const next = event.target.value;
                  void analysisApi.annual(next).catch(() => undefined);
                  setAnalysisYear(next);
                }} aria-label={t("分析年份", "Analysis year")}>
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
          month={month}
          mode={analysisMode}
          year={analysisYear}
          annualState={currentAnnualState}
          monthlyState={currentMonthlyState}
          reconciliationTolerance={settings.reconciliationTolerance}
        />
      )}
      {mode === "transactions" && month && (
        <MonthEditor
          key={month}
          ref={monthEditorRef}
          app={app}
          api={api}
          settings={settings}
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
          initialDraft={recoveryDraft.current?.kind === "transactions"
            ? recoveryDraft.current
            : undefined}
          onSessionChange={handleSessionChange}
          getCsvMapping={getCsvMapping}
          saveCsvMapping={saveCsvMapping}
        />
      )}
      {mode === "transactions" && !month && <EmptyState text={t("尚无月份，请创建第一个月份。", "No months exist yet. Create the first month.")} />}
      {mode === "rules" && (
        <RulesEditor
          ref={rulesEditorRef}
          app={app}
          api={api}
          hostWindow={hostWindow}
          dataVersion={dataVersion}
          onSectionChange={setRulesMode}
          initialDraft={recoveryDraft.current?.kind === "rules"
            ? recoveryDraft.current
            : undefined}
          onSessionChange={handleSessionChange}
          onSaved={() => setDataVersion((value) => value + 1)}
          onDataChanged={notifyDataChanged}
          confirmAction={confirmAction}
          section={rulesMode}
        />
      )}
    </div>
  );
}
