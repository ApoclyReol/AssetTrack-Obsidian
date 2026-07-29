import type {
  CsvColumnMapping,
  ImportMode,
  Transaction
} from "../types";

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

export interface CsvImportCommitOptions<TCandidates> {
  currentTransactions: Transaction[];
  importedTransactions: Transaction[];
  mode: ImportMode;
  headerSignature: string;
  mapping: CsvColumnMapping;
  saveMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
  loadRuleCandidates: (rows: Transaction[]) => Promise<TCandidates>;
}

export interface PreparedCsvImport<TCandidates> {
  transactions: Transaction[];
  candidates: TCandidates;
}

export async function prepareCsvImportCommit<TCandidates>({
  currentTransactions,
  importedTransactions,
  mode,
  headerSignature,
  mapping,
  saveMapping,
  loadRuleCandidates
}: CsvImportCommitOptions<TCandidates>): Promise<PreparedCsvImport<TCandidates>> {
  const transactions = mode === "append"
    ? [...currentTransactions, ...importedTransactions]
    : [...importedTransactions];
  await saveMapping(headerSignature, mapping);
  const candidates = await loadRuleCandidates(transactions);
  return { transactions, candidates };
}
