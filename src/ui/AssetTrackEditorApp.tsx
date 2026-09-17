import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Notice, type App } from "obsidian";
import type {
  AnalysisMode,
  EditorMode,
  RulesMode
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
import { displayError, getLocale, t } from "../i18n";
import { configureMoneyFormat } from "../domain/moneyFormat";
import type { ChoiceAction } from "./ConfirmModal";
import { messageFor } from "./editorPrimitives";
import type { LoadState } from "./AnalysisPrimitives";
import type { EditorDraftSnapshot } from "./editorDraft";
import type { EditorSession } from "./editorSession";
import {
  MonthEditor,
  type MonthEditorHandle
} from "./MonthEditor";
import type { MonthMetrics } from "./monthEditorModel";
import {
  AssetTrackEditorToolbar
} from "./AssetTrackEditorToolbar";
import { EmptyMonthGuide } from "./AssetTrackEditorEmptyState";
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
  clearCsvMapping?: (signature: string) => Promise<void>;
}


type UnsavedPageAction = "save" | "discard" | "cancel";

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
  saveCsvMapping,
  clearCsvMapping
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
  const [rulesMode, setRulesMode] = useState<RulesMode>(
    recoveryDraft.current?.kind === "rules"
      ? recoveryDraft.current.active_section ?? "health"
      : "health"
  );
  const [months, setMonths] = useState<string[]>([]);
  const [savedMonths, setSavedMonths] = useState<string[]>([]);
  const [monthPolicy, setMonthPolicy] = useState<MonthCreationPolicy | null>(null);
  const [month, setMonth] = useState(
    recoveryDraft.current?.kind === "transactions"
      ? recoveryDraft.current.month
      : initialMonth ?? ""
  );
  const transactionRecoveryDraft = recoveryDraft.current?.kind === "transactions"
    && recoveryDraft.current.month === month
    ? recoveryDraft.current
    : undefined;
  const [dataVersion, setDataVersion] = useState(0);
  const monthRefreshSequence = useRef(0);
  const navigationSequence = useRef(0);
  const [monthMetrics, setMonthMetrics] = useState<{ month: string; metrics: MonthMetrics } | null>(null);
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
  const analysisYears = [...new Set(savedMonths.map((item) => item.slice(0, 4)))].sort().reverse();
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
    setMonthMetrics((current) => mode === "transactions" && month && current?.month === month ? current : null);
  }, [mode, month]);
  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setAnalysisMode(initialAnalysisMode), [initialAnalysisMode]);
  useEffect(() => {
    if (analysisYears.length && !analysisYears.includes(analysisYear)) {
      setAnalysisYear(analysisYears[0]);
    }
  }, [analysisYear, analysisYears.join(",")]);
  useEffect(() => {
    if (initializing || mode !== "analysis") return;
    if (analysisMode === "monthly" && savedMonths.length === 0) {
      setAnalysisMode("annual");
    }
    if (analysisMode === "monthly" && month && !savedMonths.includes(month)) {
      setMonth(savedMonths.at(-1) ?? "");
    }
  }, [analysisMode, analysisYears.length, initializing, month, savedMonths.join(","), savedMonths.length]);
  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);
  const refreshMonths = useCallback(async () => {
    const sequence = ++monthRefreshSequence.current;
    try {
      const response = await api.months();
      if (sequence !== monthRefreshSequence.current) return;
      setMonths(response.months);
      setSavedMonths(response.saved_months ?? response.months);
      setMonthPolicy(response);
      setMonth((current) => current || initialMonth || response.months.at(-1) || "");
    } finally {
      if (sequence === monthRefreshSequence.current) setInitializing(false);
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
      void refreshMonths().catch((error) => new Notice(messageFor(error)));
    }),
    [refreshMonths, subscribeDataChanges]
  );
  useEffect(
    () => onStateChange(mode, analysisMode, month),
    [analysisMode, mode, month, onStateChange]
  );

  const handleMonthMetricsChange = useCallback((metrics: MonthMetrics | null) => {
    setMonthMetrics(metrics ? { month, metrics } : null);
  }, [month]);

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
      if (await session.saveAll() && !session.hasUnsavedChanges()) return true;
      new Notice(t(`当前${pageLabel}仍有未保存修改，未切换。`, `The current ${pageLabel} still has unsaved changes. The view was not switched.`));
      return false;
    }
    if (action !== "discard") return false;
    await session.discardAll();
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
    const sequence = ++navigationSequence.current;
    if (next === mode) return;
    const pageSettled = mode === "transactions"
      ? await settleTransactionPage()
      : mode === "rules"
        ? await settleRulesPage()
        : true;
    if (!pageSettled) return;
    if (sequence !== navigationSequence.current) return;
    if (next === "analysis") {
      if (analysisMode === "annual") {
        void analysisApi.annual(analysisYear).catch(() => undefined);
      } else {
        const analysisMonth = savedMonths.includes(month) ? month : savedMonths.at(-1) ?? "";
        if (analysisMonth && analysisMonth !== month) setMonth(analysisMonth);
        if (analysisMonth) void analysisApi.monthOverview(analysisMonth).catch(() => undefined);
      }
    }
    setMode(next);
  };
  const selectMonth = async (next: string): Promise<void> => {
    const sequence = ++navigationSequence.current;
    if (next === month) return;
    if (mode === "transactions" && !await settleTransactionPage()) return;
    if (mode === "rules" && !await settleRulesPage()) return;
    if (sequence !== navigationSequence.current) return;
    if (mode === "analysis" && analysisMode === "monthly") {
      void analysisApi.monthOverview(next).catch(() => undefined);
    }
    setMonth(next);
  };
  const switchAnalysisMode = (next: AnalysisMode): void => {
    if (next === "annual") {
      void analysisApi.annual(analysisYear).catch(() => undefined);
    } else {
      const analysisMonth = savedMonths.includes(month) ? month : savedMonths.at(-1) ?? "";
      if (analysisMonth) void analysisApi.monthOverview(analysisMonth).catch(() => undefined);
      if (analysisMonth && analysisMonth !== month) setMonth(analysisMonth);
    }
    setAnalysisMode(next);
  };
  const changeAnalysisYear = (next: string): void => {
    void analysisApi.annual(next).catch(() => undefined);
    setAnalysisYear(next);
  };
  const createNext = async () => {
    const sequence = ++navigationSequence.current;
    if (mode === "transactions" && !await settleTransactionPage()) return;
    if (mode === "rules" && !await settleRulesPage()) return;
    if (sequence !== navigationSequence.current) return;
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
    if (sequence !== navigationSequence.current) return;
    await refreshMonths();
    if (sequence !== navigationSequence.current) return;
    recoveryDraft.current = undefined;
    setMonth(target);
    notifyDataChanged();
    new Notice(t(`${target} 已创建`, `${target} created`));
  };
  const switchMonthSection = async (next: MonthSection): Promise<void> => {
    const sequence = ++navigationSequence.current;
    if (next === monthSection) return;
    if (!await settleTransactionPage()) return;
    if (sequence !== navigationSequence.current) return;
    setMonthSection(next);
  };
  const switchRulesMode = async (next: RulesMode): Promise<void> => {
    const sequence = ++navigationSequence.current;
    if (next === rulesMode) return;
    if (!await settleRulesPage()) return;
    if (sequence !== navigationSequence.current) return;
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
      <AssetTrackEditorToolbar
        mode={mode}
        analysisMode={analysisMode}
        analysisYear={analysisYear}
        analysisYears={analysisYears}
        savedMonths={savedMonths}
        month={month}
        months={months}
        monthPolicy={monthPolicy}
        monthSection={monthSection}
        rulesMode={rulesMode}
        monthMetrics={monthMetrics}
        reconciliationTolerance={settings.reconciliationTolerance}
        onSwitchMode={switchMode}
        onSwitchAnalysisMode={switchAnalysisMode}
        onAnalysisYearChange={changeAnalysisYear}
        onSelectMonth={selectMonth}
        onCreateNext={() => {
          void createNext().catch((error) => new Notice(messageFor(error)));
        }}
        onDeleteMonth={() => monthEditorRef.current?.requestDelete()}
        onSwitchMonthSection={switchMonthSection}
        onSwitchRulesMode={switchRulesMode}
      />
      {mode === "analysis" && (
        <AnalysisView
          month={month}
          mode={analysisMode}
          year={analysisYear}
          annualState={currentAnnualState}
          monthlyState={currentMonthlyState}
          reconciliationTolerance={settings.reconciliationTolerance}
          onOpenTransactions={() => void switchMode("transactions")}
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
          onMetricsChange={handleMonthMetricsChange}
          onDeleted={async (next) => {
            try {
              await refreshMonths();
            } catch (error) {
              new Notice(t(
                `月份已删除，但刷新月份列表失败：${messageFor(error)}`,
                `The month was deleted, but the month list could not refresh: ${messageFor(error)}`
              ));
            }
            recoveryDraft.current = undefined;
            onSessionChange(null);
            setMonth(next);
            notifyDataChanged();
          }}
          onSaved={async () => {
            try {
              await refreshMonths();
            } catch (error) {
              new Notice(t(
                `数据已保存，但月份列表刷新失败：${messageFor(error)}`,
                `The data was saved, but the month list could not refresh: ${messageFor(error)}`
              ));
            }
            notifyDataChanged();
          }}
          onNavigateSection={switchMonthSection}
          onNavigateAnalysis={() => switchMode("analysis")}
          onDataChanged={notifyDataChanged}
          initialDraft={transactionRecoveryDraft}
          onSessionChange={handleSessionChange}
          getCsvMapping={getCsvMapping}
          saveCsvMapping={saveCsvMapping}
          clearCsvMapping={clearCsvMapping}
        />
      )}
      {mode === "transactions" && !month && (
        <EmptyMonthGuide
          canCreate={Boolean(monthPolicy?.can_create)}
          onCreate={() => void createNext().catch((error) => new Notice(messageFor(error)))}
        />
      )}
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
