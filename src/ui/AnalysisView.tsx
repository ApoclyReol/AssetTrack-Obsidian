import { useEffect, useMemo, useState } from "react";
import { ANALYSIS_MODES, type AnalysisMode } from "../constants";
import type { AssetTrackService } from "../services/AssetTrackService";
import { t } from "../i18n";
import { Empty } from "./AnalysisPrimitives";
import { HomeAnalysis } from "./AnalysisHome";
import { ProductOverviewAnalysis } from "./AnalysisProducts";
import { AnnualAnalysis } from "./AnalysisAnnual";
import { MonthlyAnalysis } from "./AnalysisMonthly";

export function AnalysisView({
  api,
  months,
  month,
  onMonthChange,
  initialMode,
  onModeChange,
  dataVersion,
  reconciliationTolerance
}: {
  api: AssetTrackService;
  months: string[];
  month: string;
  onMonthChange: (month: string) => void;
  initialMode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  dataVersion: number;
  reconciliationTolerance: number;
}) {
  const [mode, setMode] = useState<AnalysisMode>(initialMode);
  useEffect(() => setMode(initialMode), [initialMode]);
  const years = useMemo(
    () => [...new Set(months.map((item) => item.slice(0, 4)))].sort().reverse(),
    [months]
  );
  const [year, setYear] = useState(years[0] ?? String(new Date().getFullYear()));
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [year, years]);
  const selectMode = (next: AnalysisMode) => {
    setMode(next);
    onModeChange(next);
  };
  return (
    <main className="asset-track-analysis">
      <div className="asset-track-analysis-nav">
        {ANALYSIS_MODES.map((item) => (
          <button
            key={item}
            className={mode === item ? "is-active" : ""}
            onClick={() => selectMode(item)}
          >
            {{ home: "Home", annual: t("年度", "Annual"), monthly: t("月度", "Monthly"), products: t("商品总览", "Items") }[item]}
          </button>
        ))}
        {mode === "annual" && (
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            {years.map((item) => <option key={item}>{item}</option>)}
          </select>
        )}
        {mode === "monthly" && (
          <select value={month} onChange={(event) => onMonthChange(event.target.value)}>
            {[...months].sort().reverse().map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        )}
      </div>
      {mode === "home" && (
        <HomeAnalysis api={api} dataVersion={dataVersion} />
      )}
      {mode === "annual" && (
        <AnnualAnalysis api={api} year={year} dataVersion={dataVersion} />
      )}
      {mode === "monthly" && month && (
        <MonthlyAnalysis
          api={api}
          month={month}
          dataVersion={dataVersion}
          reconciliationTolerance={reconciliationTolerance}
        />
      )}
      {mode === "monthly" && !month && <Empty text={t("尚无可分析月份。", "No months are available for analysis.")} />}
      {mode === "products" && <ProductOverviewAnalysis api={api} dataVersion={dataVersion} />}
    </main>
  );
}
