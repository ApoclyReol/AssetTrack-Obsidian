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
  const pendingOperationLogsRef = useRef<PendingOperationLog[]>([]);
  const lastDataVersion = useRef(dataVersion);
  const skipNextDataVersion = useRef(false);
  const restoredDraft = useRef(
    initialDraft ? clone(initialDraft) : null
  );
  const [transactionResetVersion, setTransactionResetVersion] = useState(0);

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
      active_section: activeSection,
      dirty_sections: [...nextDirtySections]
    });
  }, [activeSection, categories, dirtySections, month, onSessionChange]);

  const load = useCallback(async () => {
    setState({ kind: "pending", message: t("加载月份…", "Loading month…") });
    try {
      const [data, categoryData, ruleData] = await Promise.all([
        api.month(month),
        api.categories(),
        api.ruleWorkspaceShell()
      ]);
      const validation = await api.validateTransactions(month, data.transactions);
      dispatchDraft({ type: "reset", workspace: clone(data) });
      setCategories(categoryData.rows);
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
    onSessionChange(restored);
    setState({
      kind: "success",
      message: t("未保存月份草稿已恢复。", "The unsaved month draft was restored.")
    });
    new Notice(t("未保存月份草稿已恢复。", "The unsaved month draft was restored."));
    void Promise.all([
      api.month(month),
      api.categories(),
      api.ruleWorkspaceShell()
    ])
      .then(([current, categoryData, ruleData]) => {
        setCategories(categoryData.rows);
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
        const message = messageFor(error);
        new Notice(message);
        setState({ kind: "error", message });
      });
  }, [api, load, month, onSessionChange]);

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

  const mark = useCallback((
    next: MonthWorkspace,
    section: MonthSection,
    nextIssues: Array<Record<string, unknown>> = section === "transactions" ? [] : issues
  ) => {
    const nextDirtySections = [...new Set([...dirtySections, section])];
    dispatchDraft({ type: "edit", workspace: next });
    if (section === "transactions") setIssues(nextIssues);
    else setIssues(issues);
    setDirtySections(nextDirtySections);
    dirtySectionsRef.current = nextDirtySections;
    reportDraft(next, nextIssues, nextDirtySections);
  }, [dirtySections, issues, reportDraft]);

  const reloadCurrentSection = useCallback(async () => {
    if (!draft || !activeSection) {
      await load();
      return;
    }
    setState({ kind: "pending", message: t("重载当前区块…", "Reloading this section…") });
    try {
      const current = await api.month(month);
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
        const categoryData = await api.categories();
        setCategories(categoryData.rows);
        const validation = await api.validateTransactions(month, current.transactions);
        nextIssues = validation.issues;
      } else if (activeSection === "debts") {
        next.debts = current.debts;
      } else {
        next.fixed_assets = current.fixed_assets;
      }
      dispatchDraft({ type: "reset", workspace: clone(next) });
      setIssues(nextIssues);
      setDirtySections(nextDirtySections);
      dirtySectionsRef.current = nextDirtySections;
      if (nextDirtySections.length > 0) {
        reportDraft(next, nextIssues, nextDirtySections);
      } else {
        onSessionChange(null);
      }
      onReloaded?.();
      setState({ kind: "success", message: t("当前区块已重载。", "This section was reloaded.") });
      new Notice(t("当前区块已重载。", "This section was reloaded."));
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [activeSection, api, draft, dirtySections, issues, load, month, onReloaded, onSessionChange, reportDraft]);

  const saveWholeMonth = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    setState({ kind: "pending", message: t("检查流水…", "Checking transactions…") });
    try {
      const validation = await api.validateTransactions(month, draft.transactions);
      const found = validation.issues;
      setIssues(found);
      if (dirtySections.length > 0) reportDraft(draft, found, dirtySections);
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
        expected_revision: draft.revision,
        cash_accounts: draft.cash_accounts,
        investment_accounts: draft.investment_accounts,
        transactions: draft.transactions,
        fixed_assets: draft.fixed_assets,
        debt_revision: draft.debt_revision,
        debts: draft.debts,
        operation_logs: pendingOperationLogsRef.current
      });
      dispatchDraft({ type: "reset", workspace: clone(saved) });
      const persistedValidation = await api.validateTransactions(month, saved.transactions);
      setIssues(persistedValidation.issues);
      setDirtySections([]);
      pendingOperationLogsRef.current = [];
      dirtySectionsRef.current = [];
      setTransactionResetVersion((value) => value + 1);
      onSessionChange(null);
      skipNextDataVersion.current = true;
      await onSaved();
      const message = persistedValidation.issues.length
        ? t(
            `已保存 revision ${saved.revision}，保留 ${persistedValidation.issues.length} 项警告。`,
            `Saved revision ${saved.revision} with ${persistedValidation.issues.length} warnings.`
          )
        : t(
            `已保存 revision ${saved.revision}。`,
            `Saved revision ${saved.revision}.`
          );
      new Notice(message);
      setState({ kind: "success", message });
      return true;
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
      return false;
    }
  }, [api, dirtySections, draft, month, onSaved, onSessionChange, reportDraft]);

  const saveSection = useCallback(async (section: MonthSection): Promise<boolean> => {
    if (!draft) return false;
    if (!dirtySections.includes(section)) {
      new Notice(t("当前区块没有未保存修改。", "This section has no unsaved changes."));
      setState({ kind: "idle" });
      return true;
    }
    setState({
      kind: "pending",
      message: t("检查当前区块…", "Checking this section…")
    });
    try {
      let request: MonthSectionSaveRequest;
      if (section === "assets") {
        request = {
          expected_revision: draft.revision,
          section,
          cash_accounts: draft.cash_accounts,
          investment_accounts: draft.investment_accounts
        };
      } else if (section === "transactions") {
        const validation = await api.validateTransactions(month, draft.transactions);
        setIssues(validation.issues);
        if (dirtySections.length > 0) reportDraft(draft, validation.issues, dirtySections);
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
          expected_revision: draft.revision,
          section,
          transactions: draft.transactions,
          operation_logs: pendingOperationLogsRef.current
        };
      } else if (section === "debts") {
        request = {
          expected_revision: draft.revision,
          section,
          debt_revision: draft.debt_revision,
          debts: draft.debts
        };
      } else {
        request = {
          expected_revision: draft.revision,
          section,
          fixed_assets: draft.fixed_assets
        };
      }
      setState({ kind: "pending", message: t("保存当前区块…", "Saving this section…") });
      const saved = await api.saveMonthSection(month, request);
      const next: MonthWorkspace = {
        ...draft,
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
      const persistedValidation = section === "transactions"
        ? await api.validateTransactions(month, saved.transactions)
        : null;
      dispatchDraft({ type: "reset", workspace: clone(next) });
      if (persistedValidation) setIssues(persistedValidation.issues);
      setDirtySections(nextDirtySections);
      if (section === "transactions") {
        pendingOperationLogsRef.current = [];
        setTransactionResetVersion((value) => value + 1);
      }
      dirtySectionsRef.current = nextDirtySections;
      if (nextDirtySections.length > 0) {
        reportDraft(next, persistedValidation?.issues ?? issues, nextDirtySections);
      } else {
        onSessionChange(null);
      }
      skipNextDataVersion.current = true;
      await onSaved();
      const message = t(
        `${section === "assets" ? "资产" : section === "transactions" ? "流水" : section === "debts" ? "借款" : "固定资产"}已保存，revision ${saved.revision}。`,
        `The ${section.replace("_", " ")} section was saved at revision ${saved.revision}.`
      );
      new Notice(message);
      setState({ kind: "success", message });
      return true;
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
      return false;
    }
  }, [api, dirtySections, draft, issues, month, onSaved, onSessionChange, reportDraft]);

  const save = useCallback(async (): Promise<boolean> => {
    return activeSection ? saveSection(activeSection) : saveWholeMonth();
  }, [activeSection, saveSection, saveWholeMonth]);

  const hasUnsavedChanges = useCallback(() => dirtySectionsRef.current.length > 0, []);
  const getDraftSnapshot = useCallback((): EditorDraftSnapshot | null => {
    if (!dirtySectionsRef.current.length || !draft) return null;
    return {
      kind: "transactions",
      month,
      workspace: clone(draft),
      categories: clone(categories),
      issues: clone(issues),
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
    hasUnsavedChanges,
    getDraftSnapshot
  };
}
