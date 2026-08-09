import type { App } from "obsidian";
import type {
  CategoryDefinition
} from "../../types/configuration";
import type {
  RuleTransactionType
} from "../../types/rules";
import type {
  HistoricalProductStat
} from "../../types/rules";
import type {
  ProductHistoryIssueFilter,
  ProductHistoryQuery
} from "../../types/history";
import type { ConfigurationEditorPort } from "../../services/ports";

export type HistoryMode = "product" | "category";
export type SortDirection = "asc" | "desc";

export type HistorySort = {
  key: string;
  direction: SortDirection;
};

export interface HistoryFilters {
  transaction_type: "" | RuleTransactionType;
  category_key: string;
  issue_filter: "" | ProductHistoryIssueFilter;
  product_search: string;
  counterparty_search: string;
  from_date: string;
  to_date: string;
  min_occurrences: string;
}

export interface RuleHistoryModalOptions {
  app: App;
  api: ConfigurationEditorPort;
  categories: CategoryDefinition[];
  mode: HistoryMode;
  initialQuery?: ProductHistoryQuery;
  detailOnly?: boolean;
  detailGroup?: HistoricalProductStat;
  groupBy?: "product" | "counterparty";
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
  onSaved: () => void;
  onDataChanged: () => void;
  onOpenProductRename?: (group: HistoricalProductStat) => void;
  onOpenCounterpartyRename?: (group: HistoricalProductStat) => void;
  onGroupBy?: (groupBy: "product" | "counterparty") => void;
}

export type HistoryBackfillContentProps = Omit<RuleHistoryModalOptions, "app"> & {
  embedded?: boolean;
  hostWindow: Window;
  overview?: boolean;
  hideIssueFilter?: boolean;
  onOpenDetail?: (group: HistoricalProductStat, query: ProductHistoryQuery) => void;
  onCreateRule?: (group: HistoricalProductStat) => void;
  onOpenCounterpartyRename?: (group: HistoricalProductStat) => void;
  onGroupBy?: (groupBy: "product" | "counterparty") => void;
  onQueryChange?: (query: ProductHistoryQuery) => void;
  onClose?: () => void;
};
