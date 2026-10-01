import { Modal, type App } from "obsidian";
import type { EditorShellPort } from "../services/ports";
import type { TransactionAnalysisDrilldown } from "../types/analysis";
import { t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { messageFor } from "./editorPrimitives";

export class AnalysisTransactionsModal extends Modal {
  private closed = false;

  constructor(app: App, private readonly api: EditorShellPort,
    private readonly month: string, private readonly drilldown: TransactionAnalysisDrilldown) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("asset-track-native-modal", "asset-track-analysis-transactions-modal");
    const month = this.month?.trim() || t("当前月份", "Current month");
    const label = this.drilldown.label?.trim() || this.drilldown.key?.trim() || t("相关流水", "Related transactions");
    this.setTitle(t(`${month} · ${label}`, `${month} · ${label}`));
    const status = this.contentEl.createEl("p", { text: t("正在加载流水…", "Loading transactions…") });
    void Promise.all([this.api.month(this.month), this.api.categories()]).then(([workspace, categoryResult]) => {
      if (this.closed) return;
      const categories = categoryResult.rows;
      const rows = workspace.transactions.filter((row) => {
        if (row.type !== "支出" && row.type !== "代付") return false;
        if (this.drilldown.dimension === "tag") return row.tag_keys?.includes(this.drilldown.key);
        const category = categories.find((item) => item.category_key === row.category_key || item.name === row.category);
        if (this.drilldown.dimension === "attribute") return category?.attribute_keys?.includes(this.drilldown.key);
        return row.category_key === this.drilldown.key || row.category === this.drilldown.key
          || category?.name === this.drilldown.key;
      });
      status.remove();
      this.contentEl.createEl("p", { text: t(`${rows.length} 条流水；代付金额按负数计入。`, `${rows.length} transactions; paid-on-behalf amounts count as negative.`) });
      const scroller = this.contentEl.createDiv({ cls: "asset-track-table-scroll" });
      const table = scroller.createEl("table");
      const header = table.createEl("thead").createEl("tr");
      [t("日期", "Date"), t("商品", "Item"), t("交易对手", "Counterparty"), t("分类", "Category"), t("金额", "Amount")]
        .forEach((label) => header.createEl("th", { text: label }));
      const body = table.createEl("tbody");
      rows.forEach((row) => {
        const tr = body.createEl("tr");
        [row.transaction_date || t("未填写日期", "Date not specified"), row.product || t("未填写商品", "Item not specified"), row.counterparty || t("未填写交易对手", "Counterparty not specified"), row.category || t("未分类", "Uncategorized"),
          money(row.type === "代付" ? -row.amount : row.amount)]
          .forEach((value) => tr.createEl("td", { text: value }));
      });
      this.contentEl.createEl("strong", { text: t(`合计 ${money(rows.reduce((sum, row) => sum + (row.type === "代付" ? -row.amount : row.amount), 0))}`,
        `Total ${money(rows.reduce((sum, row) => sum + (row.type === "代付" ? -row.amount : row.amount), 0))}`) });
    }).catch((error: unknown) => {
      if (!this.closed) status.setText(messageFor(error));
    });
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }
}
