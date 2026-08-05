import type { App } from "obsidian";
import type {
  CategoryDefinition,
  HistoricalProductStat,
  ProductHistoryIssueFilter,
  ProductHistoryQuery
} from "../../types";
import type { AssetTrackService } from "../../services/AssetTrackService";

export type HistoryMode = "product" | "category";
export type SortDirection = "asc" | "desc";

export type HistorySort = {
  key: string;
  direction: SortDirection;
};

export interface HistoryFilters {
  transaction_type: "" | "支出" | "收入";
  category_key: string;
  issue_filter: "" | ProductHistoryIssueFilter;
  product_search: string;
  from_month: string;
  to_month: string;
  min_occurrences: string;
}

export interface RuleHistoryModalOptions {
  app: App;
  api: AssetTrackService;
  categories: CategoryDefinition[];
  mode: HistoryMode;
  initialQuery?: ProductHistoryQuery;
  detailOnly?: boolean;
  detailGroup?: HistoricalProductStat;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
  onSaved: () => void;
  onDataChanged: () => void;
  onOpenProductRename?: (group: HistoricalProductStat) => void;
}

export type HistoryBackfillContentProps = Omit<RuleHistoryModalOptions, "app"> & {
  embedded?: boolean;
  hostWindow: Window;
  overview?: boolean;
  hideIssueFilter?: boolean;
  onOpenDetail?: (group: HistoricalProductStat, query: ProductHistoryQuery) => void;
  onCreateRule?: (group: HistoricalProductStat) => void;
  onQueryChange?: (query: ProductHistoryQuery) => void;
  onClose?: () => void;
};
