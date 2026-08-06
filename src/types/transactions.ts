export interface Transaction {
  id?: number;
  client_id?: string;
  source?: string;
  account_key?: string | null;
  transaction_date: string;
  type: string;
  category_key?: string | null;
  category: string;
  counterparty?: string;
  product: string;
  amount: number;
}
