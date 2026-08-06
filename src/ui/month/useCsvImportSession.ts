import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import { Notice } from "obsidian";
import { AssetTrackError } from "../../application/errors";
import type {
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  ImportMode
} from "../../types/csv";
import type {
  MonthWorkspace
} from "../../types/month";
import type { MonthEditorPort } from "../../services/ports";
import { t } from "../../i18n";
import { prepareCsvImportCommit } from "../csvImportCommit";
import {
  messageFor,
  type OperationState
} from "../editorPrimitives";
import {
  readImportFile
} from "../monthEditorModel";
import type { TransactionOperations } from "./useTransactionOperations";

export interface CsvImportSource {
  filename: string;
  content: ArrayBuffer;
  inspection: CsvInspection;
}

export interface CsvImportSessionOptions {
  api: MonthEditorPort;
  month: string;
  draft: MonthWorkspace | null;
  rulesRevision: number | null;
  setIssues: Dispatch<SetStateAction<Array<Record<string, unknown>>>>;
  setState: Dispatch<SetStateAction<OperationState>>;
  operations: TransactionOperations;
  getCsvMapping: (signature: string) => CsvColumnMapping | undefined;
  saveCsvMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}

export interface CsvImportSession {
  csvSource: CsvImportSource | null;
  csvInputRef: MutableRefObject<HTMLInputElement | null>;
  openImport: () => void;
  cancelImport: () => void;
  importCsv: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  previewMappedCsv: (mapping: CsvColumnMapping) => Promise<CsvImportPreview>;
  applyCsvPreview: (
    response: CsvImportPreview,
    mode: ImportMode,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}

export function useCsvImportSession({
  api,
  month,
  draft,
  rulesRevision,
  setIssues,
  setState,
  operations,
  getCsvMapping,
  saveCsvMapping
}: CsvImportSessionOptions): CsvImportSession {
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvSource, setCsvSource] = useState<CsvImportSource | null>(null);

  const openImport = useCallback(() => {
    csvInputRef.current?.click();
  }, []);

  const cancelImport = useCallback(() => {
    setCsvSource(null);
  }, []);

  const importCsv = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setState({ kind: "pending", message: t("解析账单…", "Parsing statement…") });
    try {
      const content = await readImportFile(file);
      const inspection = await api.inspectCsv(month, file.name, content);
      setCsvSource({ filename: file.name, content, inspection });
      setState({ kind: "idle" });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [api, month, setState]);

  const previewMappedCsv = useCallback(async (
    mapping: CsvColumnMapping
  ): Promise<CsvImportPreview> => {
    if (!csvSource) {
      throw new AssetTrackError({ code: "csv.file_not_selected", status: 422 });
    }
    return api.previewMappedCsv(
      month,
      csvSource.filename,
      csvSource.content,
      mapping
    );
  }, [api, csvSource, month]);

  const applyCsvPreview = useCallback(async (
    response: CsvImportPreview,
    mode: ImportMode,
    mapping: CsvColumnMapping
  ): Promise<void> => {
    if (!csvSource || !draft) return;
    setState({ kind: "pending", message: t("正在准备导入草稿…", "Preparing the import draft…") });
    try {
      const prepared = await prepareCsvImportCommit({
        currentTransactions: draft.transactions,
        importedTransactions: response.rows,
        mode,
        headerSignature: csvSource.inspection.header_signature,
        mapping,
        saveMapping: saveCsvMapping
      });
      setCsvSource(null);
      setIssues(response.issues);
      await operations.previewOperation(
        "apply-rules",
        response.rows,
        undefined,
        { rules_revision: rulesRevision ?? undefined },
        prepared.transactions
      );
      setState({
        kind: "success",
        message: t(
          `已准备导入 ${response.rows.length} 行并生成规则预览，确认后请保存流水。`,
          `Prepared ${response.rows.length} imported rows and generated a rule preview. Confirm, then save transactions.`
        )
      });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
      throw error;
    }
  }, [csvSource, draft, operations, rulesRevision, saveCsvMapping, setIssues, setState]);

  return {
    csvSource,
    csvInputRef,
    openImport,
    cancelImport,
    importCsv,
    previewMappedCsv,
    applyCsvPreview
  };
}
