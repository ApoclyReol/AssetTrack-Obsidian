export interface CategoryRemovalPreview {
  source_key: string;
  target_key?: string;
  categories_revision: number;
  rules_revision: number;
  transaction_count: number;
  rule_count: number;
  month_revisions: Record<string, number>;
}
