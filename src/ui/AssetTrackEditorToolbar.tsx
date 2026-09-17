import type {
  AnalysisMode,
  EditorMode,
  RulesMode
} from "../constants";
import {
  EDITOR_MODES,
  RULES_MODES
} from "../constants";
import type { MonthCreationPolicy } from "../types/configuration";
import type { MonthSection } from "../types/month";
import { businessLabel, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import {
  reconciliationStatus,
  reconciliationTone
} from "./analysisModel";
import { ReconciliationHint } from "./ReconciliationHint";
import {
  MONTH_SECTIONS,
  type MonthMetrics
} from "./monthEditorModel";

export interface AssetTrackEditorToolbarProps {
  mode: EditorMode;
  analysisMode: AnalysisMode;
  analysisYear: string;
  analysisYears: string[];
  savedMonths: string[];
  month: string;
  months: string[];
  monthPolicy: MonthCreationPolicy | null;
  monthSection: MonthSection;
  rulesMode: RulesMode;
  monthMetrics: { month: string; metrics: MonthMetrics } | null;
  reconciliationTolerance: number;
  onSwitchMode: (mode: EditorMode) => void | Promise<void>;
  onSwitchAnalysisMode: (mode: AnalysisMode) => void;
  onAnalysisYearChange: (year: string) => void;
  onSelectMonth: (month: string) => void | Promise<void>;
  onCreateNext: () => void | Promise<void>;
  onDeleteMonth: () => void;
  onSwitchMonthSection: (section: MonthSection) => void | Promise<void>;
  onSwitchRulesMode: (mode: RulesMode) => void | Promise<void>;
}

export function MonthMetricsSummary({
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
    <section
      className="asset-track-month-metrics asset-track-context-metrics"
      aria-label={t("本月摘要", "Monthly summary")}
    >
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
        <span className="asset-track-month-metric-label">
          {t("对账差额", "Reconciliation difference")}
          <ReconciliationHint
            discrepancy={metrics.discrepancy}
            tolerance={reconciliationTolerance}
          />
        </span>
        <strong>
          {metrics.discrepancy === null ? t("不可比较", "Unavailable") : money(metrics.discrepancy)}
          {discrepancyStatus && <small className="asset-track-month-metric-suffix">（{businessLabel(discrepancyStatus)}）</small>}
        </strong>
      </div>
    </section>
  );
}

export function AssetTrackEditorToolbar({
  mode,
  analysisMode,
  analysisYear,
  analysisYears,
  savedMonths,
  month,
  months,
  monthPolicy,
  monthSection,
  rulesMode,
  monthMetrics,
  reconciliationTolerance,
  onSwitchMode,
  onSwitchAnalysisMode,
  onAnalysisYearChange,
  onSelectMonth,
  onCreateNext,
  onDeleteMonth,
  onSwitchMonthSection,
  onSwitchRulesMode
}: AssetTrackEditorToolbarProps) {
  return (
    <header className="asset-track-toolbar">
      <div className="asset-track-toolbar-main">
        <strong>Asset Track</strong>
        <nav aria-label={t("主导航", "Main navigation")}>
          {EDITOR_MODES.map((item) => (
            <button
              key={item}
              type="button"
              className={mode === item ? "is-active" : ""}
              onClick={() => void onSwitchMode(item)}
            >
              {{ analysis: t("分析", "Analysis"), transactions: t("记录", "Records"), rules: t("配置", "Configuration") }[item]}
            </button>
          ))}
        </nav>
      </div>
      {mode === "analysis" && (
        <div className="asset-track-context-toolbar asset-track-context-toolbar-inline">
          <nav className="asset-track-context-nav" aria-label={t("分析子导航", "Analysis sub-navigation")}>
            {(["annual", ...(savedMonths.length ? ["monthly"] : [])] as AnalysisMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={analysisMode === item ? "is-active" : ""}
                onClick={() => onSwitchAnalysisMode(item)}
              >
                {{ annual: t("年度", "Annual"), monthly: t("月度", "Monthly") }[item]}
              </button>
            ))}
          </nav>
          <div className="asset-track-context-period">
            {analysisMode === "annual" && analysisYears.length > 0 && (
              <select
                value={analysisYear}
                onChange={(event) => onAnalysisYearChange(event.target.value)}
                aria-label={t("分析年份", "Analysis year")}
              >
                {analysisYears.map((item) => <option key={item}>{item}</option>)}
              </select>
            )}
            {analysisMode === "monthly" && savedMonths.length > 0 && (
              <select
                value={month}
                onChange={(event) => void onSelectMonth(event.target.value)}
                aria-label={t("分析月份", "Analysis month")}
              >
                {[...savedMonths].sort().reverse().map((item) => <option key={item}>{item}</option>)}
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
                  onClick={() => void onSwitchMonthSection(item)}
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
                onClick={() => void onCreateNext()}
              >
                {t("创建月份", "Create month")}
              </button>
              {month && (
                <button
                  type="button"
                  className="mod-warning"
                  onClick={onDeleteMonth}
                >
                  {t("删除月份", "Delete month")}
                </button>
              )}
              {months.length > 0 && (
                <select
                  value={month}
                  onChange={(event) => void onSelectMonth(event.target.value)}
                  aria-label={t("编辑月份", "Editing month")}
                >
                  {[...months].sort().reverse().map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              )}
            </div>
          </div>
          {month && monthMetrics?.month === month && (
            <MonthMetricsSummary
              metrics={monthMetrics.metrics}
              reconciliationTolerance={reconciliationTolerance}
            />
          )}
        </div>
      )}
      {mode === "rules" && (
        <div className="asset-track-context-toolbar">
          <nav className="asset-track-context-nav" aria-label={t("配置子导航", "Configuration sub-navigation")}>
            {RULES_MODES.map((item) => (
              <button
                key={item}
                type="button"
                className={rulesMode === item ? "is-active" : ""}
                onClick={() => void onSwitchRulesMode(item)}
              >
                {{ health: t("数据健康", "Data health"), categories: t("分类定义", "Categories"), matching: t("匹配规则", "Matching rules"), products: t("商品总览", "Item overview") }[item]}
              </button>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
