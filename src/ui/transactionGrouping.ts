import type { Transaction } from "../types";

export interface TransactionGroup {
  key: string;
  type: string;
  product: string;
  variants: string[];
  count: number;
  amount: number;
  firstDate: string;
  lastDate: string;
  categories: string[];
  indexes: number[];
}

export function normalizeProduct(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}]+/gu, "");
}

export function groupTransactions(rows: Transaction[]): TransactionGroup[] {
  const groups = new Map<string, TransactionGroup>();
  rows.forEach((row, index) => {
    const normalized = normalizeProduct(row.product);
    const key = `${row.type}\u0000${normalized}`;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      current.amount += row.amount;
      current.indexes.push(index);
      current.firstDate = [current.firstDate, row.transaction_date].sort()[0];
      current.lastDate = [current.lastDate, row.transaction_date].sort().at(-1) ?? "";
      if (row.product && !current.variants.includes(row.product)) {
        current.variants.push(row.product);
      }
      if (row.category && !current.categories.includes(row.category)) {
        current.categories.push(row.category);
      }
      return;
    }
    groups.set(key, {
      key,
      type: row.type,
      product: row.product,
      variants: row.product ? [row.product] : [],
      count: 1,
      amount: row.amount,
      firstDate: row.transaction_date,
      lastDate: row.transaction_date,
      categories: row.category ? [row.category] : [],
      indexes: [index]
    });
  });
  return [...groups.values()];
}
