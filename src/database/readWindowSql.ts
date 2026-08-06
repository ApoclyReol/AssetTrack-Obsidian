import type { ReadWindow } from "../types/readWindows";

/**
 * Every historical transaction read must carry both month and date bounds.
 * Month bounds keep the query index-friendly; date bounds protect callers that
 * use an explicit day range or encounter legacy rows whose date and month do
 * not agree perfectly.
 */
export function transactionWindowPredicate(
  window: ReadWindow,
  alias = "t"
): { sql: string; parameters: string[] } {
  return {
    sql: `${alias}.month>=? AND ${alias}.month<=? AND ${alias}.transaction_date>=? AND ${alias}.transaction_date<=?`,
    parameters: [window.from_month, window.to_month, window.from_date, window.to_date]
  };
}
