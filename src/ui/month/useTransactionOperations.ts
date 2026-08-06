import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import { Notice, type App } from "obsidian";
import { AssetTrackError } from "../../application/errors";
import type {
  CategoryDefinition
} from "../../types/configuration";
import type {
  MonthWorkspace
} from "../../types/month";
import type {
  OperationPreview,
  PendingOperationLog,
  TransactionBusinessTab,
  TransactionOperationRequest
} from "../../types/operations";
import type {
  SavedRule
} from "../../types/rules";
import type {
  Transaction
} from "../../types/transactions";
import type { MonthEditorPort } from "../../services/ports";
import { isSelectableTransaction, transactionKey as operationTransactionKey } from "../../domain/transactionOperations";
import { previewAiClassification } from "../../services/aiClassification";
import { t } from "../../i18n";
import {
  messageFor,
  type OperationState
} from "../editorPrimitives";
import {
  transactionKey as uiTransactionKey,
  type TransactionKey
} from "../transactionGrouping";
import { confirmAction } from "../ConfirmModal";
import { TransactionBatchEditModal } from "../TransactionBatchEditModal";
import { TransactionOperationModal } from "../TransactionOperationModal";

export type MonthOperationRequest = TransactionOperationRequest & {
  rows: Transaction[];
  selected_rows: Transaction[];
};

export interface OperationPreviewResult {
  preview: OperationPreview;
  rows: Transaction[];
}

export type AiRetryStatus = "classified" | "unclassified" | "need_review" | "error";

export interface TransactionOperations {
  businessTab: TransactionBusinessTab;
  selectedTransactionKeys: Set<TransactionKey>;
  changeBusinessTab: (next: TransactionBusinessTab) => void;
  onSelectedTransactionKeysChange: (keys: Set<TransactionKey>) => void;
  protectTransaction: (index: number) => void;
  operationRequest: (
    operationType: TransactionOperationRequest["operation_type"],
    rows: Transaction[],
    business?: TransactionBusinessTab,
    includeProtected?: boolean,
    extra?: Partial<TransactionOperationRequest>,
    allRows?: Transaction[]
  ) => MonthOperationRequest;
  previewOperation: (
    operationType: TransactionOperationRequest["operation_type"],
    rows: Transaction[],
    business?: TransactionBusinessTab,
    extra?: Partial<TransactionOperationRequest>,
    allRows?: Transaction[]
  ) => Promise<void>;
  applyOperationPreview: (
    request: MonthOperationRequest,
    preview: OperationPreview,
    nextRows: Transaction[],
    rerun?: (includeProtected: boolean) => Promise<OperationPreviewResult>,
    retry?: (statuses: AiRetryStatus[]) => Promise<OperationPreviewResult>
  ) => Promise<void>;
  applyRules: () => Promise<void>;
  executeSelectedOperation: (
    operationType: TransactionOperationRequest["operation_type"],
    business: TransactionBusinessTab,
    keys: ReadonlySet<TransactionKey>,
    predicate: (row: Transaction) => boolean,
    extra?: Partial<TransactionOperationRequest>
  ) => Promise<void>;
  executeAiClassification: (
    business: TransactionBusinessTab,
    keys: ReadonlySet<TransactionKey>
  ) => Promise<void>;
  openBatchEdit: (
    operationType: Extract<TransactionOperationRequest["operation_type"], "bulk-edit-counterparty" | "bulk-edit-product" | "bulk-edit-category">,
    business: TransactionBusinessTab,
    keys: ReadonlySet<TransactionKey>,
    predicate: (row: Transaction) => boolean
  ) => void;
}

export interface TransactionOperationsOptions {
  app?: App;
  api: MonthEditorPort;
  settings?: Parameters<typeof previewAiClassification>[3];
  hostWindow: Window;
  month: string;
  draft: MonthWorkspace | null;
  categories: CategoryDefinition[];
  rules: SavedRule[];
  rulesRevision: number | null;
  setState: Dispatch<SetStateAction<OperationState>>;
  mark: (next: MonthWorkspace, section: "transactions") => void;
  pendingOperationLogsRef: MutableRefObject<PendingOperationLog[]>;
  transactionResetVersion: number;
}

export function useTransactionOperations({
  app,
  api,
  settings,
  hostWindow,
  month,
  draft,
  categories,
  rules,
  rulesRevision,
  setState,
  mark,
  pendingOperationLogsRef,
  transactionResetVersion
}: TransactionOperationsOptions): TransactionOperations {
  const [businessTab, setBusinessTab] = useState<TransactionBusinessTab>("outgoing");
  const [selectedTransactionKeys, setSelectedTransactionKeys] = useState<Set<TransactionKey>>(
    () => new Set()
  );
  const [protectedTransactionKeys, setProtectedTransactionKeys] = useState<Set<TransactionKey>>(
    () => new Set()
  );

  useEffect(() => {
    setSelectedTransactionKeys(new Set());
    setProtectedTransactionKeys(new Set());
  }, [transactionResetVersion]);

  const changeBusinessTab = useCallback((next: TransactionBusinessTab): void => {
    setBusinessTab(next);
    setSelectedTransactionKeys(new Set());
    setProtectedTransactionKeys(new Set());
  }, []);

  const onSelectedTransactionKeysChange = useCallback((keys: Set<TransactionKey>): void => {
    setSelectedTransactionKeys(keys);
  }, []);

  const uiKeyFor = useCallback((row: Transaction, index: number): TransactionKey =>
    uiTransactionKey(row) ?? `draft:${index}`, []);

  const operationRows = useCallback((
    keys: ReadonlySet<TransactionKey> | null,
    predicate: (row: Transaction) => boolean,
    business?: TransactionBusinessTab
  ): Transaction[] => {
    if (!draft) return [];
    return draft.transactions.filter((row, index) => {
      if (!predicate(row)) return false;
      if (business && !isSelectableTransaction(row, business)) return false;
      return keys === null || keys.has(uiKeyFor(row, index));
    });
  }, [draft, uiKeyFor]);

  const operationRequest = useCallback((
    operationType: TransactionOperationRequest["operation_type"],
    rows: Transaction[],
    business?: TransactionBusinessTab,
    includeProtected = false,
    extra: Partial<TransactionOperationRequest> = {},
    allRows = draft?.transactions ?? []
  ): MonthOperationRequest => {
    if (!draft) {
      throw new AssetTrackError({ code: "month.not_loaded", status: 409 });
    }
    return {
      month,
      operation_type: operationType,
      transaction_ids: rows.flatMap((row) => typeof row.id === "number" ? [row.id] : []),
      transaction_keys: rows.map((row) => operationTransactionKey(row, draft.transactions.indexOf(row))),
      expected_revision: draft.revision,
      source_page: "记录/流水",
      business_tab: business ?? (operationType === "apply-rules" ? "all" : undefined),
      protected_transaction_ids: draft.transactions.flatMap((row, index) =>
        typeof row.id === "number" && protectedTransactionKeys.has(uiKeyFor(row, index))
          ? [row.id] : []
      ),
      protected_transaction_keys: draft.transactions.flatMap((row, index) =>
        protectedTransactionKeys.has(uiKeyFor(row, index))
          ? [operationTransactionKey(row, index)]
          : []
      ),
      include_protected: includeProtected,
      ...extra,
      rows: allRows,
      selected_rows: rows
    };
  }, [draft, month, protectedTransactionKeys, uiKeyFor]);

  const applyOperationResultToDraft = useCallback((
    request: MonthOperationRequest,
    result: OperationPreviewResult
  ): void => {
    if (!draft) return;
    const selection = request.selected_rows.map((row) => operationTransactionKey(
      row,
      draft.transactions.indexOf(row)
    ));
    mark({ ...draft, transactions: result.rows }, "transactions");
    pendingOperationLogsRef.current = [
      ...pendingOperationLogsRef.current,
      { preview: result.preview, selection }
    ];
    new Notice(t(
      `操作已进入草稿：${result.preview.change_count} 条流水，请保存流水。`,
      `${result.preview.change_count} changes entered the draft. Save transactions to persist them.`
    ));
  }, [draft, mark, pendingOperationLogsRef]);

  const applyOperationPreview = useCallback(async (
    request: MonthOperationRequest,
    preview: OperationPreview,
    nextRows: Transaction[],
    rerun?: (includeProtected: boolean) => Promise<OperationPreviewResult>,
    retry?: (statuses: AiRetryStatus[]) => Promise<OperationPreviewResult>
  ): Promise<void> => {
    const apply = (result: OperationPreviewResult): void => {
      applyOperationResultToDraft(request, result);
    };
    const confirm = async (
      includeProtected: boolean,
      replacement?: OperationPreviewResult
    ): Promise<void> => {
      if (replacement && !includeProtected) {
        apply(replacement);
        return;
      }
      if (includeProtected && !request.include_protected && rerun) {
        const rerunResult = await rerun(true);
        if (app) {
          new TransactionOperationModal({
            app,
            preview: rerunResult.preview,
            onConfirm: async () => apply({
              preview: rerunResult.preview,
              rows: rerunResult.rows
            })
          }).open();
        } else if (hostWindow.confirm(t("确认包含保护范围并进入草稿？", "Include protected rows in the draft?"))) {
          apply(rerunResult);
        }
        return;
      }
      apply({ preview, rows: nextRows });
    };
    if (app) {
      new TransactionOperationModal({ app, preview, onConfirm: confirm, onRetry: retry }).open();
    } else if (hostWindow.confirm(t(
      `将变更 ${preview.change_count} 条流水，确认进入草稿？`,
      `Apply ${preview.change_count} transaction changes to the draft?`
    ))) {
      await confirm(false);
    }
  }, [app, applyOperationResultToDraft, hostWindow]);

  const previewOperation = useCallback(async (
    operationType: TransactionOperationRequest["operation_type"],
    rows: Transaction[],
    business?: TransactionBusinessTab,
    extra: Partial<TransactionOperationRequest> = {},
    allRows?: Transaction[]
  ): Promise<void> => {
    if (!rows.length) {
      new Notice(t("当前范围没有可操作流水。", "There are no operable transactions in the current range."));
      return;
    }
    const request = operationRequest(operationType, rows, business, false, extra, allRows);
    const { selected_rows: _selectedRows, ...previewRequest } = request;
    const operationUsesRules = operationType === "apply-rules"
      || operationType === "ai-classification";
    const result = await api.previewTransactionOperation({
      ...previewRequest,
      rules,
      rules_revision: operationUsesRules ? rulesRevision ?? undefined : undefined
    });
    await applyOperationPreview(request, result.preview, result.rows);
  }, [api, applyOperationPreview, operationRequest, rules, rulesRevision]);

  const protectTransaction = useCallback((index: number): void => {
    if (!draft) return;
    setProtectedTransactionKeys((current) => {
      const next = new Set(current);
      next.add(uiKeyFor(draft.transactions[index], index));
      return next;
    });
  }, [draft, uiKeyFor]);

  const applyRules = useCallback(async (): Promise<void> => {
    const rows = operationRows(
      null,
      (row) => row.type === "支出" || row.type === "收入"
    );
    const existingCategoryCount = rows.filter((row) =>
      Boolean(row.category_key || row.category?.trim())
    ).length;
    if (existingCategoryCount > 0) {
      const message = t(
        `当前有 ${existingCategoryCount} 条流水已有分类，应用规则可能覆盖已有分类。是否继续？`,
        `${existingCategoryCount} transactions already have categories. Applying rules may overwrite them. Continue?`
      );
      const confirmed = app
        ? await confirmAction(
          app,
          t("应用规则", "Apply rules"),
          message,
          t("继续应用", "Continue")
        )
        : hostWindow.confirm(message);
      if (!confirmed) return;
    }
    setState({ kind: "pending", message: t("生成规则预览…", "Preparing the rule preview…") });
    try {
      await previewOperation("apply-rules", rows);
      setState({ kind: "idle" });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [app, hostWindow, operationRows, previewOperation, setState]);

  const executeSelectedOperation = useCallback(async (
    operationType: TransactionOperationRequest["operation_type"],
    business: TransactionBusinessTab,
    keys: ReadonlySet<TransactionKey>,
    predicate: (row: Transaction) => boolean,
    extra: Partial<TransactionOperationRequest> = {}
  ): Promise<void> => {
    setState({ kind: "pending", message: t("生成批量操作预览…", "Preparing the batch operation preview…") });
    try {
      await previewOperation(operationType, operationRows(keys, predicate, business), business, extra);
      setState({ kind: "idle" });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [operationRows, previewOperation, setState]);

  const executeAiClassification = useCallback(async (
    business: TransactionBusinessTab,
    keys: ReadonlySet<TransactionKey>
  ): Promise<void> => {
    if (!app || !settings) {
      new Notice(t("当前未提供 AI 配置。", "AI configuration is not available in this window."));
      return;
    }
    const rows = operationRows(
      keys,
      (row) => row.type === "支出" || row.type === "收入" || row.type === "代付",
      business
    );
    if (!rows.length) {
      new Notice(t("请选择可分类的支出、收入或代付流水。", "Select classifiable expense, income, or daifu transactions."));
      return;
    }
    setState({ kind: "pending", message: t("生成 AI 分类预览…", "Preparing the AI classification preview…") });
    try {
      const request = operationRequest("ai-classification", rows, business, false, {
        rules_revision: rulesRevision ?? undefined
      });
      const key = app.secretStorage.getSecret("asset-track-ai-api-key") ?? "";
      const result = await previewAiClassification(request.rows, request, categories, settings, key, hostWindow);
      await applyOperationPreview(request, result.preview, result.rows, async (includeProtected) => {
        const rerunRequest = { ...request, include_protected: includeProtected };
        const rerun = await previewAiClassification(rerunRequest.rows, rerunRequest, categories, settings, key, hostWindow);
        return { preview: rerun.preview, rows: rerun.rows };
      }, async (statuses) => {
        if (!draft) return { preview: result.preview, rows: result.rows };
        const retryRows = result.batch.rows
          .filter((row) => statuses.includes(row.status))
          .flatMap((candidate) => rows.find((row) =>
            (candidate.transaction_id !== null && row.id === candidate.transaction_id)
            || (candidate.transaction_id === null
              && candidate.transaction_key === operationTransactionKey(row, draft.transactions.indexOf(row)))
          ) ?? []);
        const retryRequest = operationRequest("ai-classification", retryRows, business, false, {
          rules_revision: rulesRevision ?? undefined
        });
        const retried = await previewAiClassification(retryRequest.rows, retryRequest, categories, settings, key, hostWindow);
        return { preview: retried.preview, rows: retried.rows };
      });
      setState({ kind: "idle" });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [app, applyOperationPreview, categories, draft, hostWindow, operationRequest, operationRows, rulesRevision, setState, settings]);

  const openBatchEdit = useCallback((
    operationType: Extract<TransactionOperationRequest["operation_type"], "bulk-edit-counterparty" | "bulk-edit-product" | "bulk-edit-category">,
    business: TransactionBusinessTab,
    keys: ReadonlySet<TransactionKey>,
    predicate: (row: Transaction) => boolean
  ): void => {
    if (!app) {
      new Notice(t("当前窗口不支持批量编辑窗口。", "This window does not support the batch edit modal."));
      return;
    }
    const rows = operationRows(keys, predicate, business);
    const transactionType = operationType === "bulk-edit-category"
      ? (() => {
          const type = rows.find((row) => row.type === "支出" || row.type === "收入" || row.type === "代付")?.type;
          return type === "代付" ? "支出" : type as "支出" | "收入" | undefined;
        })()
      : undefined;
    const selectedCategoryTypes = new Set(rows.map((row) => row.type));
    const categorySelectionConflict = operationType === "bulk-edit-category"
      && selectedCategoryTypes.size > 1;
    new TransactionBatchEditModal({
      app,
      operationType,
      categories,
      transactionType,
      categorySelectionConflict,
      categorySelectionConflictTypes: categorySelectionConflict ? [...selectedCategoryTypes] : undefined,
      onConfirm: async (value) => {
        const selectedRows = operationRows(keys, predicate, business);
        if (!selectedRows.length) {
          throw new AssetTrackError({ code: "transaction.selection.no_editable_rows", status: 422 });
        }
        setState({ kind: "pending", message: t("正在执行批量修改…", "Applying batch changes…") });
        try {
          const request = operationRequest(operationType, selectedRows, business, false, value);
          const { selected_rows: _selectedRows, ...previewRequest } = request;
          const result = await api.previewTransactionOperation({
            ...previewRequest,
            rules: []
          });
          setState({ kind: "idle" });
          applyOperationResultToDraft(request, result);
        } catch (error) {
          const message = messageFor(error);
          setState({ kind: "error", message });
          throw error;
        }
      }
    }).open();
  }, [api, app, applyOperationResultToDraft, categories, operationRequest, operationRows, setState]);

  return {
    businessTab,
    selectedTransactionKeys,
    changeBusinessTab,
    onSelectedTransactionKeysChange,
    protectTransaction,
    operationRequest,
    previewOperation,
    applyOperationPreview,
    applyRules,
    executeSelectedOperation,
    executeAiClassification,
    openBatchEdit
  };
}
