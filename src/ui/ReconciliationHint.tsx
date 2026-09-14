import { reconciliationStatus } from "./analysisModel";
import { businessLabel, t } from "../i18n";
import { money } from "../domain/moneyFormat";

export function ReconciliationHint({
  discrepancy,
  tolerance
}: {
  discrepancy: number | null;
  tolerance: number;
}) {
  const numericDiscrepancy = typeof discrepancy === "number" && Number.isFinite(discrepancy)
    ? discrepancy
    : null;
  const status = reconciliationStatus(numericDiscrepancy, tolerance);
  const unavailable = numericDiscrepancy === null;
  const summaryLabel = t("查看对账差额说明", "View reconciliation difference explanation");
  let title = t("暂无对账基准", "No reconciliation baseline");
  let description = t(
    "没有连续的上月现金快照，暂不能计算理论消费和对账差额。",
    "There is no continuous previous-month cash snapshot, so theoretical consumption and the reconciliation difference cannot be calculated yet."
  );
  let suggestions = [
    t("补充上月现金快照或创建前置月份。", "Complete the previous month's cash snapshot or create the preceding month.")
  ];

  if (numericDiscrepancy !== null && status === "平账") {
    title = t("当前显示平账", "Currently balanced");
    description = Math.abs(numericDiscrepancy) < 0.01
      ? t(
        "对账差额 = 实际净支出 − 理论消费；当前两者完全一致。",
        "Reconciliation difference = actual net expense − theoretical consumption; the two values currently match exactly."
      )
      : t(
        `对账差额 = 实际净支出 − 理论消费；当前差额在平账容差 ${money(tolerance)} 以内，因此显示为平账。`,
        `Reconciliation difference = actual net expense − theoretical consumption; the current difference is within the ${money(tolerance)} balance tolerance, so it is shown as balanced.`
      );
    suggestions = [];
  } else if (numericDiscrepancy !== null && status === "少收入") {
    title = t("差额为正：少收入", "Positive difference: income may be missing");
    description = t(
      "正数表示实际净支出高于资产变动推导出的理论消费。",
      "A positive value means recorded net expenses are higher than the theoretical consumption derived from asset changes."
    );
    suggestions = [
      t("检查本月大额支出是否重复导入。", "Check whether a large expense was imported twice."),
      t("检查收入、退款、红包或转账回款是否漏记。", "Check for missing income, refunds, red packets, or transfer repayments."),
      t("复核月底现金快照是否多填了账户余额。", "Check whether the month-end cash snapshot is too high.")
    ];
  } else if (numericDiscrepancy !== null && status === "少支出") {
    title = t("差额为负：少支出", "Negative difference: expenses may be missing");
    description = t(
      "负数表示资产变动推导出的理论消费高于已记录净支出。",
      "A negative value means theoretical consumption derived from asset changes is higher than recorded net expenses."
    );
    suggestions = [
      t("检查现金消费、自动扣款或小额多笔消费是否漏记。", "Check for missing cash spending, automatic debits, or several small expenses."),
      t("检查加仓、提现是否被误标为普通支出或收入。", "Check whether investment deposits or withdrawals were marked as ordinary expenses or income."),
      t("复核月底现金快照是否少填了账户余额。", "Check whether the month-end cash snapshot is too low.")
    ];
  }

  return (
    <details className="asset-track-reconciliation-hint">
      <summary aria-label={summaryLabel} title={summaryLabel}>?</summary>
      <div className="asset-track-reconciliation-hint-content" role="note">
        <strong>{title}</strong>
        <p>{description}</p>
        {!unavailable && (
          <p className="asset-track-reconciliation-hint-value">
            {t("当前结果：", "Current result: ")}{money(numericDiscrepancy)}
            {status && `（${businessLabel(status)}）`}
          </p>
        )}
        {suggestions.length > 0 && (
          <>
            <strong>{t("建议检查", "Suggested checks")}</strong>
            <ul>{suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
          </>
        )}
      </div>
    </details>
  );
}
