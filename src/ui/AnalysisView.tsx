import type { AnalysisMode } from "../constants";
import type { App } from "obsidian";
import type { EditorShellPort } from "../services/ports";
import type { AnnualOverview } from "../types/analysis";
import type { TransactionAnalysisDrilldown } from "../types/analysis";
import type { MonthOverview } from "../types/month";
import { t } from "../i18n";
import { Empty, type LoadState } from "./AnalysisPrimitives";
import { AnnualAnalysis } from "./AnalysisAnnual";
import { MonthlyAnalysis } from "./AnalysisMonthly";
import { AnalysisTransactionsModal } from "./AnalysisTransactionsModal";

export function AnalysisView({
  app,
  api,
  month,
  mode,
  year,
  annualState,
  monthlyState,
  reconciliationTolerance,
  onOpenTransactions
}: {
  app: App;
  api: EditorShellPort;
  month: string;
  mode: AnalysisMode;
  year: string;
  annualState: LoadState<AnnualOverview>;
  monthlyState: LoadState<MonthOverview>;
  reconciliationTolerance: number;
  onOpenTransactions?: (drilldown?: TransactionAnalysisDrilldown) => void;
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
          onOpenTransactions={(drilldown) => {
            if (drilldown) new AnalysisTransactionsModal(app, api, month, drilldown).open();
            else onOpenTransactions?.();
          }}
        />
      )}
      {mode === "monthly" && !month && <Empty text={t("尚无可分析月份。", "No months are available for analysis.")} />}
    </main>
  );
}
