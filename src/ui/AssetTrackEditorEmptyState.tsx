import { t } from "../i18n";

export function EmptyMonthGuide({
  canCreate,
  onCreate
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="asset-track-empty-month-guide">
      <h2>{t("从一个月度结算开始", "Start with a monthly close")}</h2>
      <p>{t("创建月份后，按下面顺序完成一次闭环：", "After creating a month, complete the loop in this order:")}</p>
      <ol>
        <li>{t("导入账单并确认表头、字段和收支映射", "Import a statement and confirm its header, fields, and type mapping")}</li>
        <li>{t("整理流水，处理异常并保存", "Organize transactions, resolve issues, and save")}</li>
        <li>{t("补充资产账户和借款信息", "Complete asset accounts and debt information")}</li>
        <li>{t("回到分析页检查对账和月度变化", "Return to analysis to check reconciliation and monthly changes")}</li>
      </ol>
      <button
        type="button"
        className="mod-cta"
        disabled={!canCreate}
        onClick={onCreate}
      >
        {t("创建第一个月份", "Create the first month")}
      </button>
    </section>
  );
}
