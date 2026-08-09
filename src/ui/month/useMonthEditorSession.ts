import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type Reducer,
  type SetStateAction
} from "react";
import { Notice } from "obsidian";
import type {
  CategoryDefinition
} from "../../types/configuration";
import type {
  MonthSection,
  MonthSectionSaveRequest,
  MonthWorkspace
} from "../../types/month";
import type {
  PendingOperationLog
} from "../../types/operations";
import type {
  SavedRule
} from "../../types/rules";
import type { MonthEditorPort } from "../../services/ports";
import { t } from "../../i18n";
import { transactionTab } from "../../domain/transactionOperations";
import type {
  EditorDraftSnapshot,
  MonthEditorDraftSnapshot
} from "../editorDraft";
import {
  clone,
  issueIsBlocking,
  messageFor,
  type OperationState
} from "../editorPrimitives";
import {
  draftMonthMetrics,
  draftReducer,
  MONTH_SECTIONS,
  type DraftAction,
  type MonthMetrics
} from "../monthEditorModel";

export interface MonthEditorSessionOptions {
  api: MonthEditorPort;
  month: string;
  dataVersion: number;
  activeSection?: MonthSection;
  initialDraft?: MonthEditorDraftSnapshot;
  onMetricsChange?: (metrics: MonthMetrics | null) => void;
  onSessionChange: (snapshot: EditorDraftSnapshot | null) => void;
  onSaved: () => Promise<void>;
  onReloaded?: () => void;
}

export interface MonthEditorSession {
  draft: MonthWorkspace | null;
  categories: CategoryDefinition[];
  setCategories: Dispatch<SetStateAction<CategoryDefinition[]>>;
  rules: SavedRule[];
  setRules: Dispatch<SetStateAction<SavedRule[]>>;
  rulesRevision: number | null;
  setRulesRevision: Dispatch<SetStateAction<number | null>>;
  issues: Array<Record<string, unknown>>;
  setIssues: Dispatch<SetStateAction<Array<Record<string, unknown>>>>;
  state: OperationState;
  setState: Dispatch<SetStateAction<OperationState>>;
  dirtySections: MonthSection[];
  dirtySectionsRef: MutableRefObject<MonthSection[]>;
  pendingOperationLogsRef: MutableRefObject<PendingOperationLog[]>;
  transactionResetVersion: number;
  load: () => Promise<void>;
  mark: (
    next: MonthWorkspace,
    section: MonthSection,
    nextIssues?: Array<Record<string, unknown>>
  ) => void;
  reloadCurrentSection: () => Promise<void>;
  save: () => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  discardAll: () => Promise<void>;
  acknowledgeDataChange: () => void;
  hasUnsavedChanges: () => boolean;
  getDraftSnapshot: () => EditorDraftSnapshot | null;
}

export function useMonthEditorSession({
  api,
  month,
  dataVersion,
  activeSection,
  initialDraft,
  onMetricsChange,
  onSessionChange,
  onSaved,
  onReloaded
}: MonthEditorSessionOptions): MonthEditorSession {
  const [draft, dispatchDraft] = useReducer<
    Reducer<MonthWorkspace | null, DraftAction>
  >(draftReducer, initialDraft ? clone(initialDraft.workspace) : null);
  const [categories, setCategories] = useState<CategoryDefinition[]>(
    initialDraft ? clone(initialDraft.categories) : []
  );
  const [rules, setRules] = useState<SavedRule[]>([]);
  const [rulesRevision, setRulesRevision] = useState<number | null>(null);
  const [issues, setIssues] = useState<Array<Record<string, unknown>>>(
    initialDraft ? clone(initialDraft.issues) : []
  );
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const [dirtySections, setDirtySections] = useState<MonthSection[]>(
    initialDraft?.dirty_sections
      ? [...new Set(initialDraft.dirty_sections)]
      : initialDraft
        ? [...MONTH_SECTIONS]
        : []
  );
  const dirtySectionsRef = useRef<MonthSection[]>(
    initialDraft?.dirty_sections
      ? [...new Set(initialDraft.dirty_sections)]
      : initialDraft
        ? [...MONTH_SECTIONS]
        : []
  );
  const pendingOperationLogsRef = useRef<PendingOperationLog[]>(
    initialDraft?.pending_operation_logs ? clone(initialDraft.pending_operation_logs) : []
  );
  const lastDataVersion = useRef(dataVersion);
  const skipNextDataVersion = useRef(false);
  const validationSequence = useRef(0);
  const requestSequence = useRef(0);
  const draftGeneration = useRef(0);
  const mounted = useRef(true);
  const restoredDraft = useRef(
    initialDraft ? clone(initialDraft) : null
  );
  const [transactionResetVersion, setTransactionResetVersion] = useState(0);

  const transactionWarningNotice = useCallback((
    rows: MonthWorkspace["transactions"],
    validationIssues: Array<Record<string, unknown>>
  ): string | null => {
    const warnings = validationIssues.filter((issue) => !issueIsBlocking(issue));
    if (!warnings.length) return null;
    const counts = new Map<"outgoing" | "incoming" | "investment", number>();
    warnings.forEach((issue) => {
      const index = Number(issue.row_index);
      if (!Number.isInteger(index) || index < 0) return;
      const tab = transactionTab(rows[index]?.type ?? "");
      if (!tab) return;
      counts.set(tab, (counts.get(tab) ?? 0) + 1);
    });
    const labels = [
      counts.has("outgoing")
        ? t(`出账 ${counts.get("outgoing")} 项`, `${counts.get("outgoing")} outgoing issues`)
        : "",
      counts.has("incoming")
        ? t(`入账 ${counts.get("incoming")} 项`, `${counts.get("incoming")} incoming issues`)
        : "",
      counts.has("investment")
        ? t(`理财 ${counts.get("investment")} 项`, `${counts.get("investment")} investment issues`)
        : ""
    ].filter(Boolean);
    if (!labels.length) return null;
    return t(
      `${labels.join("、")}有不规范流水，建议检查行号标记。`,
      `${labels.join(", ")} remain irregular. Check the row markers.`
    );
  }, []);

  const reportDraft = useCallback((
    next: MonthWorkspace,
    nextIssues: Array<Record<string, unknown>>,
    nextDirtySections = dirtySections
  ) => {
    onSessionChange({
      kind: "transactions",
      month,
      workspace: clone(next),
      categories: clone(categories),
      issues: clone(nextIssues),
      pending_operation_logs: clone(pendingOperationLogsRef.current),
      active_section: activeSection,
      dirty_sections: [...nextDirtySections]
    });
  }, [activeSection, categories, dirtySections, month, onSessionChange]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    validationSequence.current += 1;
    setState({ kind: "pending", message: t("加载月份…", "Loading month…") });
    try {
      const [data, ruleData] = await Promise.all([
        api.month(month),
        api.ruleWorkspaceShell()
      ]);
      const validation = await api.validateTransactions(month, data.transactions);
      if (!mounted.current || sequence !== requestSequence.current) return;
      draftGeneration.current += 1;
      dispatchDraft({ type: "reset", workspace: clone(data) });
      setCategories(ruleData.categories);
      setRules(ruleData.rules);
      setRulesRevision(ruleData.rules_revision);
      setIssues(validation.issues);
      setDirtySections([]);
      pendingOperationLogsRef.current = [];
      dirtySectionsRef.current = [];
      setTransactionResetVersion((value) => value + 1);
      onSessionChange(null);
      setState({ kind: "idle" });
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [api, month, onSessionChange]);

  useEffect(() => {
    const restored = restoredDraft.current;
    if (!restored) {
      void load();
      return;
    }
    restoredDraft.current = null;
    const sequence = ++requestSequence.current;
    validationSequence.current += 1;
    onSessionChange(restored);
    setState({
      kind: "success",
      message: t("未保存月份草稿已恢复。", "The unsaved month draft was restored.")
    });
    new Notice(t("未保存月份草稿已恢复。", "The unsaved month draft was restored."));
    void Promise.all([
      api.month(month),
      api.ruleWorkspaceShell()
    ])
      .then(([current, ruleData]) => {
        if (!mounted.current || sequence !== requestSequence.current) return;
        setCategories(ruleData.categories);
        setRules(ruleData.rules);
        setRulesRevision(ruleData.rules_revision);
        if (current.revision !== restored.workspace.revision) {
          const message = t(
            "草稿已恢复，但其他窗口已修改当前月份；重新加载前不能覆盖保存。",
            "The draft was restored, but another window changed this month. Reload before saving."
          );
          setState({ kind: "error", message });
          new Notice(message);
        }
      })
      .catch((error: unknown) => {
        if (!mounted.current || sequence !== requestSequence.current) return;
        const message = messageFor(error);
        new Notice(message);
        setState({ kind: "error", message });
      });
  }, [api, load, month, onSessionChange]);

  useEffect(() => {
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      validationSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    if (lastDataVersion.current === dataVersion) return;
    lastDataVersion.current = dataVersion;
    if (skipNextDataVersion.current) {
      skipNextDataVersion.current = false;
      return;
    }
    if (dirtySections.length > 0) {
      const message = t(
        "其他窗口已修改当前月份；未保存草稿已保留，保存前请先重新加载。",
        "Another window changed this month. The unsaved draft was preserved; reload before saving."
      );
      setState({ kind: "error", message });
      new Notice(message);
      return;
    }
    void load();
  }, [dataVersion, dirtySections, load]);

  useEffect(() => {
    onMetricsChange?.(draft ? draftMonthMetrics(draft) : null);
  }, [draft, onMetricsChange]);

  useEffect(() => {
    if (!draft || !dirtySections.includes("transactions")) return;
    const sequence = ++validationSequence.current;
    const generation = draftGeneration.current;
    const validatingDraft = draft;
    void api.validateTransactions(month, draft.transactions)
      .then((result) => {
        if (!mounted.current || sequence !== validationSequence.current
          || generation !== draftGeneration.current) return;
        setIssues(result.issues);
        if (dirtySectionsRef.current.includes("transactions")) {
          reportDraft(validatingDraft, result.issues, dirtySectionsRef.current);
        }
      })
      .catch((error: unknown) => {
        if (!mounted.current || sequence !== validationSequence.current
          || generation !== draftGeneration.current) return;
        setState({ kind: "error", message: messageFor(error) });
      });
  }, [api, draft, dirtySections, month, reportDraft]);

  const mark = useCallback((
    next: MonthWorkspace,
    section: MonthSection,
    nextIssues: Array<Record<string, unknown>> = issues
  ) => {
    draftGeneration.current += 1;
    validationSequence.current += 1;
    const nextDirtySections = [...new Set([...dirtySectionsRef.current, section])];
    dispatchDraft({ type: "edit", workspace: next });
    if (section === "transactions") setIssues(nextIssues);
    else setIssues(issues);
    setDirtySections(nextDirtySections);
    dirtySectionsRef.current = nextDirtySections;
    reportDraft(next, nextIssues, nextDirtySections);
  }, [issues, reportDraft]);

  const refreshAfterSave = useCallback(async (): Promise<void> => {
    try {
      await onSaved();
    } catch (error) {
      // The database write has already committed.  A cache/list refresh
      // failure must not turn a successful save into a retryable write error.
      new Notice(t(
        `数据已保存，但页面刷新失败：${messageFor(error)}`,
        `Data was saved, but the page could not refresh: ${messageFor(error)}`
      ));
    }
  }, [onSaved]);

  const reloadCurrentSection = useCallback(async () => {
    if (!draft || !activeSection) {
      await load();
      return;
    }
    const sequence = ++requestSequence.current;
    const generation = draftGeneration.current;
    validationSequence.current += 1;
    setState({ kind: "pending", message: t("正在放弃当前页修改并重新加载…", "Discarding current page changes and reloading…") });
    try {
      const current = await api.month(month);
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (generation !== draftGeneration.current) {
        const message = t(
          "重载期间产生了新修改，当前草稿已保留。",
          "New edits were made while reloading; the current draft was preserved."
        );
        setState({ kind: "error", message });
        return;
      }
      const nextDirtySections = dirtySections.filter((item) => item !== activeSection);
      const preserveRevision = nextDirtySections.length > 0;
      const next: MonthWorkspace = {
        ...draft,
        revision: preserveRevision ? draft.revision : current.revision,
        status: current.status,
        debt_revision: preserveRevision ? draft.debt_revision : current.debt_revision,
        computed: current.computed,
        overview: current.overview
      };
      let nextIssues = issues;
      if (activeSection === "assets") {
        next.cash_accounts = current.cash_accounts;
        next.investment_accounts = current.investment_accounts;
      } else if (activeSection === "transactions") {
        next.transactions = current.transactions;
        pendingOperationLogsRef.current = [];
        const ruleData = await api.ruleWorkspaceShell();
        if (!mounted.current || sequence !== requestSequence.current) return;
        if (generation !== draftGeneration.current) {
          const message = t(
            "重载期间产生了新修改，当前草稿已保留。",
            "New edits were made while reloading; the current draft was preserved."
          );
          setState({ kind: "error", message });
          return;
        }
        setCategories(ruleData.categories);
        const validation = await api.validateTransactions(month, current.transactions);
        if (!mounted.current || sequence !== requestSequence.current) return;
        if (generation !== draftGeneration.current) {
          const message = t(
            "重载期间产生了新修改，当前草稿已保留。",
            "New edits were made while reloading; the current draft was preserved."
          );
          setState({ kind: "error", message });
          return;
        }
        nextIssues = validation.issues;
      } else if (activeSection === "debts") {
        next.debts = current.debts;
      } else {
        next.fixed_assets = current.fixed_assets;
      }
      if (!mounted.current || sequence !== requestSequence.current
        || generation !== draftGeneration.current) return;
      if (activeSection === "transactions") {
        pendingOperationLogsRef.current = [];
      }
      dispatchDraft({ type: "reset", workspace: clone(next) });
      draftGeneration.current += 1;
      setIssues(nextIssues);
      setDirtySections(nextDirtySections);
      dirtySectionsRef.current = nextDirtySections;
      if (nextDirtySections.length > 0) {
        reportDraft(next, nextIssues, nextDirtySections);
      } else {
        onSessionChange(null);
      }
      if (activeSection === "transactions") {
        setTransactionResetVersion((value) => value + 1);
      }
      onReloaded?.();
      setState({ kind: "success", message: t("当前页已重新加载。", "This page was reloaded.") });
      new Notice(t("当前页已重新加载。", "This page was reloaded."));
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [activeSection, api, draft, dirtySections, issues, load, month, onReloaded, onSessionChange, reportDraft]);

  const saveWholeMonth = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    const sequence = ++requestSequence.current;
    const generation = draftGeneration.current;
    const saveDraft = clone(draft);
    const operationLogs = clone(pendingOperationLogsRef.current);
    validationSequence.current += 1;
    setState({ kind: "pending", message: t("检查流水…", "Checking transactions…") });
    try {
      const validation = await api.validateTransactions(month, saveDraft.transactions);
      if (!mounted.current || sequence !== requestSequence.current
        || generation !== draftGeneration.current) {
        const message = t("保存期间草稿已变化，未覆盖新的编辑。", "The draft changed while saving; the newer edits were kept.");
        setState({ kind: "error", message });
        return false;
      }
      const found = validation.issues;
      setIssues(found);
      if (dirtySections.length > 0) reportDraft(saveDraft, found, dirtySections);
      const blocking = found.filter(issueIsBlocking);
      if (blocking.length) {
        const message = t(
          `有 ${blocking.length} 项错误必须先修正；未调用保存。`,
          `${blocking.length} errors must be fixed before saving. Nothing was written.`
        );
        new Notice(message);
        setState({ kind: "error", message });
        return false;
      }
      setState({ kind: "pending", message: t("保存整月…", "Saving the month…") });
      const saved = await api.saveMonth(month, {
        expected_revision: saveDraft.revision,
        cash_accounts: saveDraft.cash_accounts,
        investment_accounts: saveDraft.investment_accounts,
        transactions: saveDraft.transactions,
        fixed_assets: saveDraft.fixed_assets,
        debt_revision: saveDraft.debt_revision,
        debts: saveDraft.debts,
        operation_logs: operationLogs
      });
      let persistedIssues: Array<Record<string, unknown>> = found;
      let postSaveValidationMessage: string | null = null;
      try {
        const persistedValidation = await api.validateTransactions(month, saved.transactions);
        persistedIssues = persistedValidation.issues;
      } catch (error) {
        postSaveValidationMessage = messageFor(error);
      }
      if (!mounted.current || sequence !== requestSequence.current
        || generation !== draftGeneration.current) {
        await refreshAfterSave();
        const message = t("月份已保存，但保存期间产生了新的编辑；请重新加载后继续。", "The month was saved, but new edits were made during saving. Reload before continuing.");
        setState({ kind: "error", message });
        return false;
      }
      dispatchDraft({ type: "reset", workspace: clone(saved) });
      draftGeneration.current += 1;
      setIssues(persistedIssues);
      setDirtySections([]);
      pendingOperationLogsRef.current = [];
      dirtySectionsRef.current = [];
      setTransactionResetVersion((value) => value + 1);
      onSessionChange(null);
      skipNextDataVersion.current = true;
      await refreshAfterSave();
      const warningMessage = transactionWarningNotice(saved.transactions, persistedIssues);
      const message = postSaveValidationMessage
        ? t(
            `本月已保存，但无法刷新流水提醒：${postSaveValidationMessage}`,
            `This month was saved, but transaction warnings could not be refreshed: ${postSaveValidationMessage}`
          )
        : warningMessage
        ? t(
            `本月已保存；${warningMessage}`,
            `This month was saved. ${warningMessage}`
          )
        : t(
            "本月已保存。",
            "This month was saved."
          );
      new Notice(message);
      setState({ kind: "success", message });
      return true;
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return false;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
      return false;
    }
  }, [api, dirtySections, draft, month, onSessionChange, refreshAfterSave, reportDraft, transactionWarningNotice]);

  const saveSection = useCallback(async (section: MonthSection): Promise<boolean> => {
    if (!draft) return false;
    if (!dirtySections.includes(section)) {
      new Notice(t("当前页没有需要保存的修改。", "This page has no changes to save."));
      setState({ kind: "idle" });
      return true;
    }
    const sequence = ++requestSequence.current;
    const generation = draftGeneration.current;
    const saveDraft = clone(draft);
    const operationLogs = clone(pendingOperationLogsRef.current);
    validationSequence.current += 1;
    setState({
      kind: "pending",
      message: t("正在检查当前页…", "Checking this page…")
    });
    try {
      let request: MonthSectionSaveRequest;
      if (section === "assets") {
        request = {
          expected_revision: saveDraft.revision,
          section,
          cash_accounts: saveDraft.cash_accounts,
          investment_accounts: saveDraft.investment_accounts
        };
      } else if (section === "transactions") {
        const validation = await api.validateTransactions(month, saveDraft.transactions);
        if (!mounted.current || sequence !== requestSequence.current
          || generation !== draftGeneration.current) {
          const message = t("保存期间草稿已变化，未覆盖新的编辑。", "The draft changed while saving; the newer edits were kept.");
          setState({ kind: "error", message });
          return false;
        }
        setIssues(validation.issues);
        if (dirtySections.length > 0) reportDraft(saveDraft, validation.issues, dirtySections);
        const blocking = validation.issues.filter(issueIsBlocking);
        if (blocking.length) {
          const message = t(
            `有 ${blocking.length} 项错误必须先修正；未调用保存。`,
            `${blocking.length} errors must be fixed before saving. Nothing was written.`
          );
          new Notice(message);
          setState({ kind: "error", message });
          return false;
        }
        request = {
          expected_revision: saveDraft.revision,
          section,
          transactions: saveDraft.transactions,
          operation_logs: operationLogs
        };
      } else if (section === "debts") {
        request = {
          expected_revision: saveDraft.revision,
          section,
          debt_revision: saveDraft.debt_revision,
          debts: saveDraft.debts
        };
      } else {
        request = {
          expected_revision: saveDraft.revision,
          section,
          fixed_assets: saveDraft.fixed_assets
        };
      }
      setState({ kind: "pending", message: t("正在保存当前页…", "Saving this page…") });
      const saved = await api.saveMonthSection(month, request);
      const next: MonthWorkspace = {
        ...saveDraft,
        revision: saved.revision,
        status: saved.status,
        debt_revision: saved.debt_revision,
        computed: saved.computed,
        overview: saved.overview,
        ...(section === "assets" ? {
          cash_accounts: saved.cash_accounts,
          investment_accounts: saved.investment_accounts
        } : {}),
        ...(section === "transactions" ? { transactions: saved.transactions } : {}),
        ...(section === "debts" ? { debts: saved.debts } : {}),
        ...(section === "fixed_assets" ? { fixed_assets: saved.fixed_assets } : {})
      };
      const nextDirtySections = dirtySections.filter((item) => item !== section);
      let persistedIssues: Array<Record<string, unknown>> | null = null;
      let postSaveValidationMessage: string | null = null;
      if (section === "transactions") {
        try {
          persistedIssues = (await api.validateTransactions(month, saved.transactions)).issues;
        } catch (error) {
          postSaveValidationMessage = messageFor(error);
        }
      }
      if (!mounted.current || sequence !== requestSequence.current
        || generation !== draftGeneration.current) {
        await refreshAfterSave();
        const message = t("区块已保存，但保存期间产生了新的编辑；请重新加载后继续。", "The section was saved, but new edits were made during saving. Reload before continuing.");
        setState({ kind: "error", message });
        return false;
      }
      // The month revision covers every section, while an operation preview
      // describes transaction rows only. Saving assets/debts/fixed assets
      // therefore rebases pending transaction audit previews to the new month
      // revision instead of making an otherwise valid preview unusable. This
      // must happen only after the generation check, otherwise a new preview
      // created during the save could be rebound to the old save.
      if (section !== "transactions" && pendingOperationLogsRef.current.length > 0) {
        pendingOperationLogsRef.current = pendingOperationLogsRef.current.map((entry) => ({
          ...entry,
          preview: {
            ...entry.preview,
            metadata: {
              ...(entry.preview.metadata ?? {}),
              expected_revision: saved.revision
            }
          }
        }));
      }
      dispatchDraft({ type: "reset", workspace: clone(next) });
      draftGeneration.current += 1;
      if (persistedIssues) setIssues(persistedIssues);
      setDirtySections(nextDirtySections);
      if (section === "transactions") {
        pendingOperationLogsRef.current = [];
        setTransactionResetVersion((value) => value + 1);
      }
      dirtySectionsRef.current = nextDirtySections;
      if (nextDirtySections.length > 0) {
        reportDraft(next, persistedIssues ?? issues, nextDirtySections);
      } else {
        onSessionChange(null);
      }
      skipNextDataVersion.current = true;
      await refreshAfterSave();
      const warningMessage = section === "transactions" && persistedIssues
        ? transactionWarningNotice(saved.transactions, persistedIssues)
        : null;
      const sectionLabel = section === "assets"
        ? t("资产账户", "Asset accounts")
        : section === "transactions"
          ? t("流水", "Transactions")
          : section === "debts"
            ? t("借款", "Debts")
            : t("固定资产", "Fixed assets");
      const message = postSaveValidationMessage
        ? t(
            `${sectionLabel}已保存，但无法刷新流水提醒：${postSaveValidationMessage}`,
            `${sectionLabel} saved, but transaction warnings could not be refreshed: ${postSaveValidationMessage}`
          )
        : warningMessage
          ? t(
              `流水已保存；${warningMessage}`,
              `Transactions saved. ${warningMessage}`
            )
        : t(
            `${sectionLabel}已保存。`,
            `${sectionLabel} saved.`
          );
      new Notice(message);
      setState({ kind: "success", message });
      return true;
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return false;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
      return false;
    }
  }, [api, dirtySections, draft, issues, month, onSessionChange, refreshAfterSave, reportDraft, transactionWarningNotice]);

  const save = useCallback(async (): Promise<boolean> => {
    return activeSection ? saveSection(activeSection) : saveWholeMonth();
  }, [activeSection, saveSection, saveWholeMonth]);

  const saveAll = useCallback(async (): Promise<boolean> => saveWholeMonth(), [saveWholeMonth]);
  const discardAll = useCallback(async (): Promise<void> => { await load(); }, [load]);
  const acknowledgeDataChange = useCallback(() => {
    skipNextDataVersion.current = true;
  }, []);

  const hasUnsavedChanges = useCallback(() => dirtySectionsRef.current.length > 0, []);
  const getDraftSnapshot = useCallback((): EditorDraftSnapshot | null => {
    if (!dirtySectionsRef.current.length || !draft) return null;
    return {
      kind: "transactions",
      month,
      workspace: clone(draft),
      categories: clone(categories),
      issues: clone(issues),
      pending_operation_logs: clone(pendingOperationLogsRef.current),
      active_section: activeSection,
      dirty_sections: [...dirtySectionsRef.current]
    };
  }, [activeSection, categories, draft, issues, month]);

  return {
    draft,
    categories,
    setCategories,
    rules,
    setRules,
    rulesRevision,
    setRulesRevision,
    issues,
    setIssues,
    state,
    setState,
    dirtySections,
    dirtySectionsRef,
    pendingOperationLogsRef,
    transactionResetVersion,
    load,
    mark,
    reloadCurrentSection,
    save,
    saveAll,
    discardAll,
    acknowledgeDataChange,
    hasUnsavedChanges,
    getDraftSnapshot
  };
}
