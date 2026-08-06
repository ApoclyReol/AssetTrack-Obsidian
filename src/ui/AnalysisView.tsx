import type { AnalysisMode } from "../constants";
import type { AnnualOverview } from "../types/analysis";
import type { MonthOverview } from "../types/month";
import { t } from "../i18n";
import { Empty, type LoadState } from "./AnalysisPrimitives";
import { AnnualAnalysis } from "./AnalysisAnnual";
import { MonthlyAnalysis } from "./AnalysisMonthly";

export function AnalysisView({
  month,
  mode,
  year,
  annualState,
  monthlyState,
  reconciliationTolerance
}: {
  month: string;
  mode: AnalysisMode;
  year: string;
  annualState: LoadState<AnnualOverview>;
  monthlyState: LoadState<MonthOverview>;
  reconciliationTolerance: number;
}) {
  return (
    <main className="asset-track-analysis">
      {mode === "annual" && (
        <AnnualAnalysis state={annualState} year={year} />
      )}
      {mode === "monthly" && month && (
        <MonthlyAnalysis
          month={month}
          state={monthlyState}
          reconciliationTolerance={reconciliationTolerance}
        />
      )}
      {mode === "monthly" && !month && <Empty text={t("尚无可分析月份。", "No months are available for analysis.")} />}
    </main>
  );
}
