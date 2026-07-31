import type {
  CsvColumnMapping,
  ImportMode,
  Transaction
} from "../types";

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

export interface CsvImportCommitOptions {
  currentTransactions: Transaction[];
  importedTransactions: Transaction[];
  mode: ImportMode;
  headerSignature: string;
  mapping: CsvColumnMapping;
  saveMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}

export interface PreparedCsvImport {
  transactions: Transaction[];
}

export async function prepareCsvImportCommit({
  currentTransactions,
  importedTransactions,
  mode,
  headerSignature,
  mapping,
  saveMapping
}: CsvImportCommitOptions): Promise<PreparedCsvImport> {
  const transactions = mode === "append"
    ? [...currentTransactions, ...importedTransactions]
    : [...importedTransactions];
  await saveMapping(headerSignature, mapping);
  return { transactions };
}
