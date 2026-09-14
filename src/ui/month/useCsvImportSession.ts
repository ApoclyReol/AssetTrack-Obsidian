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
  CsvRawRow,
  ImportMode,
  CsvStructureSelection
} from "../../types/csv";
import type {
  MonthSection,
  MonthWorkspace
} from "../../types/month";
import type { MonthEditorPort } from "../../services/ports";
import { t } from "../../i18n";
import { scalarText } from "../../domain/text";
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

export interface CsvImportFeedback {
  kind: "success" | "warning" | "error";
  message: string;
  canRetry?: boolean;
}

export interface CsvImportedSource {
  filename: string;
  headers: string[];
  rows: CsvRawRow[];
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
  saveCsvMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}

export interface CsvImportSession {
  csvSource: CsvImportSource | null;
  lastImportedSource: CsvImportedSource | null;
  importFeedback: CsvImportFeedback | null;
  csvInputRef: MutableRefObject<HTMLInputElement | null>;
  openImport: () => void;
  cancelImport: () => void;
  clearImportFeedback: () => void;
  importCsv: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  selectCsvStructure: (
    selection: CsvStructureSelection
  ) => Promise<CsvInspection>;
  previewMappedCsv: (
    mapping: CsvColumnMapping,
    selection?: CsvStructureSelection
  ) => Promise<CsvImportPreview>;
  applyCsvPreview: (
    response: CsvImportPreview,
    mode: ImportMode,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}

function isEmptyCategoryIssue(
  issue: Record<string, unknown>,
  rows: CsvImportPreview["rows"]
): boolean {
  if (scalarText(issue.field).trim() !== "分类") return false;
  if (issue.blocking === true || scalarText(issue.severity).trim() === "错误") return false;
  const rowIndex = Number(issue.row_index);
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return false;
  const row = rows[rowIndex];
  if (!row) return false;
  if (!scalarText(row.category).trim() && !scalarText(row.category_key).trim()) return true;
  // The repository canonicalizes an imported category that is not defined in
  // the system to an empty category.  Treat that as the same optional import
  // case; explicit special-type category errors remain visible.
  return scalarText(issue.issue).includes("未选择有效分类")
    || scalarText(issue.code) === "transaction.category.missing";
}

export function useCsvImportSession({
  api,
  month,
  activeSection,
  draft,
  setState,
  mark,
  invalidatePendingOperationLogs,
  saveCsvMapping
}: CsvImportSessionOptions): CsvImportSession {
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvSource, setCsvSource] = useState<CsvImportSource | null>(null);
  const [lastImportedSource, setLastImportedSource] = useState<CsvImportedSource | null>(null);
  const [importFeedback, setImportFeedback] = useState<CsvImportFeedback | null>(null);
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const lastImportedSourceMonthRef = useRef(month);
  const contextRef = useRef({ month, activeSection, draft });
  const csvSourceRef = useRef(csvSource);
  const postCommitImportRef = useRef<object | null>(null);
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
      postCommitImportRef.current = null;
    }
  }, [activeSection, draft, month]);

  useEffect(() => {
    if (lastImportedSourceMonthRef.current === month) return;
    lastImportedSourceMonthRef.current = month;
    setLastImportedSource(null);
  }, [month]);

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
    postCommitImportRef.current = null;
    setImportFeedback(null);
    csvInputRef.current?.click();
  }, []);

  const cancelImport = useCallback(() => {
    requestSequence.current += 1;
    postCommitImportRef.current = null;
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
    postCommitImportRef.current = null;
    setLastImportedSource(null);
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
      setImportFeedback({ kind: "error", message });
      setState({ kind: "error", message });
    }
  }, [activeSection, api, draft, isCurrentRequest, month, nextRequestSequence, setState]);

  const selectCsvStructure = useCallback(async (
    selection: CsvStructureSelection
  ): Promise<CsvInspection> => {
    if (!csvSource) {
      throw new AssetTrackError({ code: "csv.file_not_selected", status: 422 });
    }
    const source = csvSource;
    const sourceDraft = draft;
    const sourceMonth = month;
    const sourceSection = activeSection;
    const sequence = nextRequestSequence();
    throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
    const inspection = await api.inspectCsv(
      sourceMonth,
      source.filename,
      source.content,
      selection
    );
    if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) {
      throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
      throw new AssetTrackError({ code: "operation.preview_draft_mismatch", status: 409 });
    }
    setCsvSource({ ...source, inspection });
    return inspection;
  }, [activeSection, api, csvSource, draft, isCurrentRequest, month, nextRequestSequence, throwIfContextChanged]);

  const previewMappedCsv = useCallback(async (
    mapping: CsvColumnMapping,
    selection?: CsvStructureSelection
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
      mapping,
      selection
    );
    if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) {
      throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
      throw new AssetTrackError({ code: "operation.preview_draft_mismatch", status: 409 });
    }
    const validation = await api.validateTransactions(sourceMonth, result.rows);
    if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) {
      throwIfContextChanged(sourceDraft, sourceMonth, sourceSection, source);
      throw new AssetTrackError({ code: "operation.preview_draft_mismatch", status: 409 });
    }
    return {
      ...result,
      // A blank category is allowed during import.  Keep the import preview
      // focused on problems that prevent a safe import; full validation runs
      // again after accepted rows enter the draft, where uncategorized rows
      // retain their row-level ? marker for later cleanup.
      issues: validation.issues.filter((issue) => !isEmptyCategoryIssue(issue, result.rows))
    };
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
    setState({ kind: "pending", message: t("正在把预览结果放入本月流水草稿…", "Putting the preview result into this month's transaction draft…") });
    try {
      const prepared = prepareCsvImportCommit({
        currentTransactions: sourceDraft.transactions,
        importedTransactions: response.rows,
        mode
      });
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) return;
      if (!response.rows.length) {
        sourceContextRef.current = null;
        setCsvSource(null);
        setLastImportedSource(null);
        const message = t(
          "没有通过预览的流水；草稿未改变。请展开被过滤条目检查原因。",
          "No transactions passed the preview. The draft was unchanged. Expand filtered rows to check why."
        );
        setImportFeedback({ kind: "warning", message });
        setState({ kind: "idle" });
        return;
      }
      // CSV import only commits accepted rows to the React draft. Rule changes
      // remain an explicit transaction operation with its own confirmation.
      if (mode === "replace") invalidatePendingOperationLogs();
      const nextWorkspace = { ...sourceDraft, transactions: prepared.transactions };
      const validation = await api.validateTransactions(sourceMonth, prepared.transactions);
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) return;
      mark(nextWorkspace, "transactions", validation.issues);
      setLastImportedSource(response.source_rows?.length
        ? {
            filename: source.filename,
            headers: source.inspection.headers,
            rows: response.source_rows
          }
        : null);
      // Keep the source and preview available until validation and the draft
      // update both succeed.  A failed validation/mark must be retryable from
      // the same import instead of forcing the user to select the file again.
      sourceContextRef.current = null;
      setCsvSource(null);
      const message = mode === "replace"
        ? t(
            `已用 ${response.rows.length} 条接受流水替换当前流水草稿；请检查行号提示，然后保存流水。`,
            `Replaced the current transaction draft with ${response.rows.length} accepted rows. Check row markers, then save transactions.`
          )
        : t(
            `已把 ${response.rows.length} 条接受流水加入本月草稿；请检查行号提示，然后保存流水。`,
            `Added ${response.rows.length} accepted rows to this month's draft. Check row markers, then save transactions.`
          );
      const commitToken = {};
      postCommitImportRef.current = commitToken;
      let feedback: CsvImportFeedback = { kind: "success", message };
      try {
        await saveCsvMapping(source.inspection.header_signature, mapping);
      } catch {
        const mappingWarning = t(
          "流水已加入，但映射未保存。",
          "Transactions were added, but the mapping was not saved."
        );
        feedback = { kind: "warning", message: mappingWarning, canRetry: false };
      }
      if (!mounted.current
        || postCommitImportRef.current !== commitToken
        || contextRef.current.month !== sourceMonth
        || contextRef.current.activeSection !== sourceSection) return;
      setImportFeedback(feedback);
      setState({ kind: "idle" });
    } catch (error) {
      if (!isCurrentRequest(sequence, sourceDraft, sourceMonth, sourceSection, source)) return;
      const message = messageFor(error);
      new Notice(message);
      setImportFeedback({ kind: "error", message });
      setState({ kind: "idle" });
      throw error;
    }
  }, [activeSection, api, csvSource, draft, invalidatePendingOperationLogs, isCurrentRequest, mark, month, nextRequestSequence, saveCsvMapping, setState, throwIfContextChanged]);

  return {
    csvSource: csvSource && sourceContextRef.current?.month === month
      && sourceContextRef.current.activeSection === activeSection
      && sourceContextRef.current.draft === draft
      ? csvSource
      : null,
    lastImportedSource,
    importFeedback,
    csvInputRef,
    openImport,
    cancelImport,
    clearImportFeedback: () => setImportFeedback(null),
    importCsv,
    selectCsvStructure,
    previewMappedCsv,
    applyCsvPreview
  };
}
