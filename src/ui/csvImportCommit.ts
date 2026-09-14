import type { ImportMode } from "../types/csv";
import type {
  Transaction
} from "../types/transactions";

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

export interface CsvImportCommitOptions {
  currentTransactions: Transaction[];
  importedTransactions: Transaction[];
  mode: ImportMode;
}

export interface PreparedCsvImport {
  transactions: Transaction[];
}

export function prepareCsvImportCommit({
  currentTransactions,
  importedTransactions,
  mode
}: CsvImportCommitOptions): PreparedCsvImport {
  const transactions = mode === "append"
    ? [...currentTransactions, ...importedTransactions]
    : [...importedTransactions];
  return { transactions };
}
