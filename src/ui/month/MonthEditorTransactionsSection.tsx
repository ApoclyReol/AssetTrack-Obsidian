import type {
  CategoryDefinition,
  MonthWorkspace,
  Transaction
} from "../../types";
import { t } from "../../i18n";
import {
  transactionIndexes,
  TRANSACTION_SECTIONS
} from "../analysisModel";
import {
  TransactionSummaryTable,
  TransactionTable
} from "../TransactionTables";
import type { SortState } from "../editorPrimitives";

type TransactionView = "detail" | "summary";

export function MonthEditorTransactionsSection({
  month,
  draft,
  categories,
  transactionView,
  summarySort,
  expandedGroup,
  onTransactionViewChange,
  onSummarySort,
  onExpandedGroupChange,
  onUpdate,
  onDelete,
  onAdd
}: {
  month: string;
  draft: MonthWorkspace;
  categories: CategoryDefinition[];
  transactionView: TransactionView;
  summarySort: SortState;
  expandedGroup: string;
  onTransactionViewChange: (view: TransactionView) => void;
  onSummarySort: (sort: SortState) => void;
  onExpandedGroupChange: (key: string) => void;
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: (title: string) => void;
}) {
  return (
    <>
      <section className="asset-track-view-switcher">
        <strong>{t("流水展示", "Transaction display")}</strong>
        <button
          type="button"
          className={transactionView === "detail" ? "is-active" : ""}
          onClick={() => onTransactionViewChange("detail")}
        >
          {t("逐项", "Individual")}
        </button>
        <button
          type="button"
          className={transactionView === "summary" ? "is-active" : ""}
          onClick={() => onTransactionViewChange("summary")}
        >
          {t("按商品汇总", "Group by item")}
        </button>
        <span>{t(
          "汇总只影响查看，保存时仍保留每笔流水。",
          "Grouping only changes the view. Every transaction is preserved when saved."
        )}</span>
      </section>
      {transactionView === "detail" && TRANSACTION_SECTIONS.map((title) => (
        <TransactionTable
          key={title}
          title={title}
          month={month}
          rows={draft.transactions}
          visibleIndexes={transactionIndexes(draft.transactions, title)}
          categories={categories}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onAdd={() => onAdd(title)}
        />
      ))}
      {transactionView === "summary" && (
        <TransactionSummaryTable
          rows={draft.transactions}
          categories={categories}
          sort={summarySort}
          onSort={onSummarySort}
          expanded={expandedGroup}
          onExpanded={onExpandedGroupChange}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}
