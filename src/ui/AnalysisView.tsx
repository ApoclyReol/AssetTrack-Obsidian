import type { AnalysisMode } from "../constants";
import type { AssetTrackService } from "../services/AssetTrackService";
import { t } from "../i18n";
import { Empty } from "./AnalysisPrimitives";
import { AnnualAnalysis } from "./AnalysisAnnual";
import { MonthlyAnalysis } from "./AnalysisMonthly";

export function AnalysisView({
  api,
  month,
  mode,
  year,
  dataVersion,
  reconciliationTolerance
}: {
  api: AssetTrackService;
  month: string;
  mode: AnalysisMode;
  year: string;
  dataVersion: number;
  reconciliationTolerance: number;
}) {
  return (
    <main className="asset-track-analysis">
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
    </main>
  );
}
