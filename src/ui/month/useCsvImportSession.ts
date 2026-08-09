import {
  useCallback,
  useEffect,
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
  MonthSection,
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

export interface CsvImportSource {
  filename: string;
  content: ArrayBuffer;
  inspection: CsvInspection;
}

export interface CsvImportSessionOptions {
  api: MonthEditorPort;
  month: string;
  activeSection?: MonthSection;
  draft: MonthWorkspace | null;
  setState: Dispatch<SetStateAction<OperationState>>;
  mark: (
    next: MonthWorkspace,
    section: "transactions",
    nextIssues?: Array<Record<string, unknown>>
  ) => void;
  invalidatePendingOperationLogs: () => void;
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
  activeSection,
  draft,
  setState,
  mark,
  invalidatePendingOperationLogs,
  getCsvMapping,
  saveCsvMapping
}: CsvImportSessionOptions): CsvImportSession {
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvSource, setCsvSource] = useState<CsvImportSource | null>(null);
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const contextRef = useRef({ month, activeSection, draft });
  const csvSourceRef = useRef(csvSource);
  const sourceContextRef = useRef<{
    month: string;
    activeSection?: MonthSection;
    draft: MonthWorkspace | null;
  } | null>(null);
  contextRef.current = { month, activeSection, draft };
  csvSourceRef.current = csvSource;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    requestSequence.current += 1;
    const sourceContext = sourceContextRef.current;
    if (sourceContext && (
      sourceContext.month !== month
      || sourceContext.activeSection !== activeSection
      || sourceContext.draft !== draft
    )) {
      sourceContextRef.current = null;
      setCsvSource(null);
    }
  }, [activeSection, draft, month]);

  const nextRequestSequence = useCallback((): number => {
    requestSequence.current += 1;
    return requestSequence.current;
  }, []);

  const isCurrentRequest = useCallback((
    sequence: number,
    sourceDraft: MonthWorkspace | null,
    sourceMonth: string,
    sourceSection?: MonthSection,
    source?: CsvImportSource
  ): boolean => mounted.current
    && requestSequence.current === sequence
    && contextRef.current.month === sourceMonth
    && contextRef.current.activeSection === sourceSection
    && contextRef.current.draft === sourceDraft
    && (source === undefined || csvSourceRef.current === source), []);

  const throwIfContextChanged = useCallback((
    sourceDraft: MonthWorkspace | null,
    sourceMonth: string,
    sourceSection?: MonthSection,
    source?: CsvImportSource
  ): void => {
    if (contextRef.current.month !== sourceMonth
      || contextRef.current.activeSection !== sourceSection
      || contextRef.current.draft !== sourceDraft
      || (source !== undefined && csvSourceRef.current !== source)) {
      throw new AssetTrackError({ code: "operation.preview_draft_mismatch", status: 409 });
    }
  }, []);

  const openImport = useCallback(() => {
    csvInputRef.current?.click();
  }, []);

  const cancelImport = useCallback(() => {
    requestSequence.current += 1;
    sourceContextRef.current = null;
    setCsvSource(null);
  }, []);

  const importCsv = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sourceDraft = draft;
    const sourceMonth = month;
    const sourceSection = activeSection;
    const sequence = nextRequestSequence();
    if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection)) return;
    setState({ kind: "pending", message: t("解析账单…", "Parsing statement…") });
    try {
      const content = await readImportFile(file);
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection)) return;
      const inspection = await api.inspectCsv(month, file.name, content);
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection)) return;
      sourceContextRef.current = {
        month: sourceMonth,
        activeSection: sourceSection,
        draft: sourceDraft
      };
      setCsvSource({ filename: file.name, content, inspection });
      if (isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection)) setState({ kind: "idle" });
    } catch (error) {
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection)) return;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [activeSection, api, draft, isCurrentRequest, month, nextRequestSequence, setState]);

  const previewMappedCsv = useCallback(async (
    mapping: CsvColumnMapping
  ): Promise<CsvImportPreview> => {
    if (!csvSource) {
      throw new AssetTrackError({ code: "csv.file_not_selected", status: 422 });
    }
    const source = csvSource;
    const sourceDraft = draft;
    const sourceMonth = month;
    const sourceSection = activeSection;
    const sequence = nextRequestSequence();
    throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
    if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) {
      throw new AssetTrackError({ code: "operation.preview_draft_mismatch", status: 409 });
    }
    const result = await api.previewMappedCsv(
      sourceMonth,
      source.filename,
      source.content,
      mapping
    );
    if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) {
      throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
      throw new AssetTrackError({ code: "operation.preview_draft_mismatch", status: 409 });
    }
    return result;
  }, [activeSection, api, draft, isCurrentRequest, month, nextRequestSequence, throwIfContextChanged, csvSource]);

  const applyCsvPreview = useCallback(async (
    response: CsvImportPreview,
    mode: ImportMode,
    mapping: CsvColumnMapping
  ): Promise<void> => {
    if (!csvSource) {
      throw new AssetTrackError({ code: "csv.file_not_selected", status: 422 });
    }
    if (!draft) {
      throw new AssetTrackError({ code: "month.not_loaded", status: 409 });
    }
    const source = csvSource;
    const sourceDraft = draft;
    const sourceMonth = month;
    const sourceSection = activeSection;
    const sequence = nextRequestSequence();
    if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) return;
    setState({ kind: "pending", message: t("正在准备导入草稿…", "Preparing the import draft…") });
    try {
      const prepared = await prepareCsvImportCommit({
        currentTransactions: sourceDraft.transactions,
        importedTransactions: response.rows,
        mode,
        headerSignature: source.inspection.header_signature,
        mapping,
        saveMapping: async (signature, nextMapping) => {
          throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
          await saveCsvMapping(signature, nextMapping);
          throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
        }
      });
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) return;
      if (!response.rows.length) {
        sourceContextRef.current = null;
        setCsvSource(null);
        setState({
          kind: "success",
          message: t(
            "没有可导入流水，当前草稿未改变。",
            "There are no importable transactions. The current draft was unchanged."
          )
        });
        return;
      }
      // CSV import only commits accepted rows to the React draft. Rule changes
      // remain an explicit transaction operation with its own confirmation.
      if (mode === "replace") invalidatePendingOperationLogs();
      const nextWorkspace = { ...sourceDraft, transactions: prepared.transactions };
      const validation = await api.validateTransactions(sourceMonth, prepared.transactions);
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) return;
      mark(nextWorkspace, "transactions", validation.issues);
      // Keep the source and preview available until validation and the draft
      // update both succeed.  A failed validation/mark must be retryable from
      // the same import instead of forcing the user to select the file again.
      sourceContextRef.current = null;
      setCsvSource(null);
      setState({
        kind: "success",
        message: t(
          `已导入 ${response.rows.length} 行到草稿，请检查流水并保存。`,
          `Imported ${response.rows.length} rows into the draft. Review and save transactions.`
        )
      });
    } catch (error) {
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) return;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
      throw error;
    }
  }, [activeSection, api, csvSource, draft, invalidatePendingOperationLogs, isCurrentRequest, mark, month, nextRequestSequence, saveCsvMapping, setState, throwIfContextChanged]);

  return {
    csvSource: csvSource && sourceContextRef.current?.month === month
      && sourceContextRef.current.activeSection === activeSection
      && sourceContextRef.current.draft === draft
      ? csvSource
      : null,
    csvInputRef,
    openImport,
    cancelImport,
    importCsv,
    previewMappedCsv,
    applyCsvPreview
  };
}
