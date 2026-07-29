import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type ChangeEvent,
  type ReactNode
} from "react";
import { Notice } from "obsidian";
import {
  EDITOR_MODES,
  type AnalysisMode,
  type EditorMode
} from "../constants";
import type {
  CategoryDefinition,
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  FixedAsset,
  ImportMode,
  MonthCreationPolicy,
  MonthWorkspace,
  RuleCandidate,
  Transaction
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { AnalysisView } from "./AnalysisView";
import {
  createTransactionDraft,
  transactionBlockNumber,
  transactionBlockNumbers,
  transactionIndexes,
  TRANSACTION_SECTIONS
} from "./analysisModel";
import { CsvImportDialog } from "./CsvImportDialog";
import {
  groupTransactions,
  normalizeProduct,
  type TransactionGroup
} from "./transactionGrouping";
import {
  MAX_IMPORT_FILE_BYTES,
  prepareCsvImportCommit
} from "./csvImportCommit";
import { scalarText } from "../domain/text";
import { CATEGORY_COLORS } from "../domain/categoryColors";
import {
  calculateVirtualRowRange,
  virtualSpacerBlocks
} from "./virtualRows";

interface Props {
  api: AssetTrackService;
  hostWindow: Window;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
  initialMode: EditorMode;
  initialAnalysisMode: AnalysisMode;
  initialMonth?: string;
  onDirtyChange: (dirty: boolean) => void;
  onStateChange: (
    mode: EditorMode,
    analysisMode: AnalysisMode,
    month: string
  ) => void;
  subscribeDataChanges: (listener: () => void) => () => void;
  getCsvMapping: (signature: string) => CsvColumnMapping | undefined;
  saveCsvMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}

type OperationState =
  | { kind: "idle"; message?: string }
  | { kind: "pending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type SortState = { key: string; direction: "asc" | "desc" } | null;

const CATEGORY_RAINBOW = CATEGORY_COLORS;

function candidateKey(candidate: RuleCandidate): string {
  return [
    candidate.transaction_type,
    normalizeProduct(candidate.counterparty ?? ""),
    normalizeProduct(candidate.product)
  ].join("\u0000");
}

function messageFor(error: unknown): string {
  if (error instanceof AssetTrackError && error.status === 409) {
    const detail = error.detail as { expected?: number; actual?: number };
    return `revision 冲突：草稿基于 ${detail.expected ?? "—"}，当前数据库为 ${
      detail.actual ?? "—"
    }。请重新加载。`;
  }
  return error instanceof Error ? error.message : String(error);
}

function number(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clone<T>(data: T): T {
  return structuredClone(data);
}

function readFileBase64(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return Promise.reject(
      new Error("账单文件不能超过 20 MiB；请拆分后重新导入")
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("账单文件读取失败"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("账单文件编码失败"));
        return;
      }
      const result = reader.result;
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("账单文件编码失败"));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left ?? 0) - Number(right ?? 0);
  }
  return scalarText(left).localeCompare(scalarText(right), "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
}

function sortRows<T>(
  rows: T[],
  sort: SortState,
  value: (row: T, key: string) => unknown
): Array<{ row: T; originalIndex: number }> {
  const indexed = rows.map((row, originalIndex) => ({ row, originalIndex }));
  if (!sort) return indexed;
  return indexed.sort((left, right) => {
    const compared = compareValues(
      value(left.row, sort.key),
      value(right.row, sort.key)
    );
    return sort.direction === "asc" ? compared : -compared;
  });
}

function toggleSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

function SortButton({
  label,
  field,
  sort,
  onSort
}: {
  label: string;
  field: string;
  sort: SortState;
  onSort: (next: SortState) => void;
}) {
  const mark =
    sort?.key === field ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
  const active = sort?.key === field;
  return (
    <button
      type="button"
      className="asset-track-sort"
      aria-label={`${label}排序${
        active ? `，当前${sort.direction === "asc" ? "升序" : "降序"}` : ""
      }`}
      aria-pressed={active}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      onClick={() => onSort(toggleSort(sort, field))}
    >
      {label}
      {mark}
    </button>
  );
}

export function AssetTrackEditorApp({
  api,
  hostWindow,
  confirmAction,
  initialMode,
  initialAnalysisMode,
  initialMonth,
  onDirtyChange,
  onStateChange,
  subscribeDataChanges,
  getCsvMapping,
  saveCsvMapping
}: Props) {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(initialAnalysisMode);
  const [months, setMonths] = useState<string[]>([]);
  const [monthPolicy, setMonthPolicy] = useState<MonthCreationPolicy | null>(null);
  const [month, setMonth] = useState(initialMonth ?? "");
  const [dirty, setDirty] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [showPreparing, setShowPreparing] = useState(false);
  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setAnalysisMode(initialAnalysisMode), [initialAnalysisMode]);
  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);

  const refreshMonths = useCallback(async () => {
    try {
      const response = await api.months();
      setMonths(response.months);
      setMonthPolicy(response);
      setMonth((current) => current || initialMonth || response.months.at(-1) || "");
    } finally {
      setInitializing(false);
    }
  }, [api, initialMonth]);

  useEffect(() => {
    void refreshMonths().catch((error) => new Notice(messageFor(error)));
  }, [refreshMonths]);
  useEffect(() => {
    if (!initializing) {
      setShowPreparing(false);
      return;
    }
    const timeout = hostWindow.setTimeout(() => setShowPreparing(true), 500);
    return () => hostWindow.clearTimeout(timeout);
  }, [hostWindow, initializing]);
  useEffect(
    () => subscribeDataChanges(() => {
      setDataVersion((value) => value + 1);
      void refreshMonths();
    }),
    [refreshMonths, subscribeDataChanges]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(
    () => onStateChange(mode, analysisMode, month),
    [analysisMode, mode, month, onStateChange]
  );

  const switchMode = async (next: EditorMode): Promise<void> => {
    if (
      dirty
      && !await confirmAction(
        "放弃未保存草稿？",
        "当前草稿尚未保存。放弃更改并切换？",
        "放弃并切换"
      )
    ) return;
    setDirty(false);
    setMode(next);
  };
  const selectMonth = async (next: string): Promise<void> => {
    if (
      dirty
      && !await confirmAction(
        "切换月份并放弃草稿？",
        "当前月份草稿尚未保存。放弃更改并切换？",
        "放弃并切换"
      )
    ) return;
    setDirty(false);
    setMonth(next);
  };
  const createNext = async () => {
    if (!monthPolicy?.can_create) {
      throw new Error(monthPolicy?.reason ?? "当前不能创建新月份");
    }
    const target = monthPolicy.next_target;
    await api.createMonth(target);
    await refreshMonths();
    setMonth(target);
    setDataVersion((value) => value + 1);
    new Notice(`${target} 已创建`);
  };

  if (initializing) {
    return (
      <div className="asset-track-app asset-track-boot">
        {showPreparing && <span>正在读取 Asset Track 数据…</span>}
      </div>
    );
  }

  return (
    <div className="asset-track-app">
      <header className="asset-track-toolbar">
        <div>
          <strong>Asset Track</strong>
          <span>SQLite 事实 · TypeScript 计算 · 实时分析</span>
        </div>
        <nav>
          {EDITOR_MODES.map((item) => (
            <button
              key={item}
              className={mode === item ? "is-active" : ""}
              onClick={() => void switchMode(item)}
            >
              {{ analysis: "分析", transactions: "流水", debts: "借款", rules: "规则" }[item]}
            </button>
          ))}
        </nav>
      </header>
      {mode === "transactions" && (
        <div className="asset-track-month-picker">
          <select
            value={month}
            onChange={(event) => void selectMonth(event.target.value)}
          >
            {[...months].sort().reverse().map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            disabled={!monthPolicy?.can_create}
            title={monthPolicy?.reason ?? `创建 ${monthPolicy?.next_target ?? ""}`}
            onClick={() => void createNext().catch((error) => new Notice(messageFor(error)))}
          >
            {monthPolicy?.can_create
              ? `创建 ${monthPolicy.next_target}`
              : "暂不能创建月份"}
          </button>
          {monthPolicy?.reason && <span>{monthPolicy.reason}</span>}
        </div>
      )}
      {mode === "analysis" && (
        <AnalysisView
          api={api}
          months={months}
          month={month}
          onMonthChange={setMonth}
          initialMode={analysisMode}
          onModeChange={setAnalysisMode}
          dataVersion={dataVersion}
        />
      )}
      {mode === "transactions" && month && (
        <MonthEditor
          key={month}
          api={api}
          hostWindow={hostWindow}
          month={month}
          months={months}
          onDeleted={async (next) => {
            await refreshMonths();
            setMonth(next);
            setDataVersion((value) => value + 1);
          }}
          onSaved={async () => {
            await refreshMonths();
            setDataVersion((value) => value + 1);
          }}
          onDirty={setDirty}
          getCsvMapping={getCsvMapping}
          saveCsvMapping={saveCsvMapping}
        />
      )}
      {mode === "transactions" && !month && <EmptyState text="尚无月份，请创建第一个月份。" />}
      {mode === "debts" && (
        <CollectionEditor
          title="借款管理"
          load={() => api.debts()}
          save={(revision, rows) => api.saveDebts(revision, rows)}
          createRow={() => ({
            start_date: new Date().toISOString().slice(0, 10),
            description: "",
            counterparty: "",
            amount: 0,
            is_paid: false,
            paid_date: null
          })}
          columns={[
            ["start_date", "发生日期", "date"],
            ["description", "说明", "text"],
            ["counterparty", "对方", "text"],
            ["amount", "金额", "number"],
            ["is_paid", "已还", "checkbox"],
            ["paid_date", "还清日期", "date"]
          ]}
          onDirty={setDirty}
          onSaved={() => setDataVersion((value) => value + 1)}
        />
      )}
      {mode === "rules" && (
        <RulesEditor
          api={api}
          onDirty={setDirty}
          onSaved={() => setDataVersion((value) => value + 1)}
        />
      )}
    </div>
  );
}

function MonthEditor({
  api,
  hostWindow,
  month,
  months,
  onDeleted,
  onSaved,
  onDirty,
  getCsvMapping,
  saveCsvMapping
}: {
  api: AssetTrackService;
  hostWindow: Window;
  month: string;
  months: string[];
  onDeleted: (next: string) => Promise<void>;
  onSaved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  getCsvMapping: (signature: string) => CsvColumnMapping | undefined;
  saveCsvMapping: (
    signature: string,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}) {
  const [base, setBase] = useState<MonthWorkspace | null>(null);
  const [draft, setDraft] = useState<MonthWorkspace | null>(null);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [issues, setIssues] = useState<Array<Record<string, unknown>>>([]);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const [transactionView, setTransactionView] = useState<"detail" | "summary">("detail");
  const [summarySort, setSummarySort] = useState<SortState>({
    key: "count",
    direction: "desc"
  });
  const [expandedGroup, setExpandedGroup] = useState("");
  const [ruleCandidates, setRuleCandidates] = useState<{
    rules_revision: number;
    rows: RuleCandidate[];
  }>({ rules_revision: 0, rows: [] });
  const [candidateSort, setCandidateSort] = useState<SortState>({
    key: "occurrences",
    direction: "desc"
  });
  const [candidateCategories, setCandidateCategories] = useState<
    Record<string, string>
  >({});
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvSource, setCsvSource] = useState<{
    filename: string;
    contentBase64: string;
    inspection: CsvInspection;
  } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "pending", message: "加载月份…" });
    try {
      const [data, categoryData] = await Promise.all([api.month(month), api.categories()]);
      setBase(clone(data));
      setDraft(clone(data));
      setCategories(categoryData.rows);
      const candidateData = await api.ruleCandidates(month, data.transactions);
      setRuleCandidates(candidateData);
      setCandidateCategories(Object.fromEntries(
        candidateData.rows.map((candidate) => {
          const definition = categoryData.rows.find(
            (category) =>
              category.name === candidate.category
              && category.transaction_type === candidate.transaction_type
          );
          return [
            candidateKey(candidate),
            definition?.category_key ?? ""
          ];
        })
      ));
      setIssues([]);
      onDirty(false);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [api, month, onDirty]);
  useEffect(() => void load(), [load]);

  const mark = (next: MonthWorkspace) => {
    setDraft(next);
    setIssues([]);
    onDirty(JSON.stringify(next) !== JSON.stringify(base));
  };
  const refreshRuleCandidates = async (rows: Transaction[]) => {
    const result = await api.ruleCandidates(month, rows);
    setRuleCandidates(result);
    setCandidateCategories((current) => ({
      ...current,
      ...Object.fromEntries(result.rows.map((candidate) => {
        const key = candidateKey(candidate);
        const definition = categories.find(
          (category) =>
            category.name === candidate.category
            && category.transaction_type === candidate.transaction_type
        );
        return [key, current[key] || definition?.category_key || ""];
      }))
    }));
  };
  const createRule = async (candidate: RuleCandidate) => {
    if (!draft) return;
    const key = candidateKey(candidate);
    const categoryKey = candidateCategories[key] ?? "";
    const category = categories.find(
      (item) => item.category_key === categoryKey
    );
    if (!category) {
      setState({ kind: "error", message: "请先为规则建议选择分类。" });
      return;
    }
    setState({ kind: "pending", message: "正在创建规则并应用到草稿…" });
    try {
      const current = await api.rules();
      if (current.revision !== ruleCandidates.rules_revision) {
        await refreshRuleCandidates(draft.transactions);
        throw new Error("规则已在其他位置变化，建议已刷新；流水草稿未丢失。");
      }
      await api.saveRules(current.revision, [
        ...current.rows,
        {
          transaction_type: candidate.transaction_type,
          counterparty: candidate.counterparty,
          product: candidate.product,
          category_key: category.category_key,
          category: category.name
        }
      ]);
      const applied = await api.applyRules(month, draft.transactions);
      mark({ ...draft, transactions: applied.proposed_rows });
      await refreshRuleCandidates(applied.proposed_rows);
      setState({
        kind: "success",
        message: `已创建“${candidate.product}”规则并应用到当前草稿。`
      });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };
  if (!draft) return <Status state={state} />;

  const updateTransaction = (
    index: number,
    field: keyof Transaction,
    value: string
  ) => {
    const rows = draft.transactions.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = {
        ...row,
        [field]: field === "amount" ? number(value) : value
      };
      if (field === "type" && ["代付", "加仓", "提现"].includes(value)) {
        next.category = "";
        next.category_key = null;
      }
      if (field === "category_key") {
        next.category =
          categories.find((category) => category.category_key === value)?.name ?? "";
      }
      return next;
    });
    mark({ ...draft, transactions: rows });
  };
  const updateAsset = (index: number, field: keyof FixedAsset, value: string) => {
    const rows = draft.fixed_assets.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [field]: field === "purchase_price" ? number(value) : value
          }
        : row
    );
    mark({ ...draft, fixed_assets: rows });
  };
  const candidateView = sortRows(
    ruleCandidates.rows,
    candidateSort,
    (candidate, key) => candidate[key as keyof RuleCandidate]
  );

  const save = async () => {
    setState({ kind: "pending", message: "执行严格质检…" });
    try {
      const validation = await api.validateTransactions(month, draft.transactions);
      const found = validation.issues;
      setIssues(found);
      if (found.length) {
        setState({
          kind: "error",
          message: `有 ${found.length} 项必须先完整填写；未调用保存。`
        });
        return;
      }
      setState({ kind: "pending", message: "保存整月…" });
      const saved = await api.saveMonth(month, {
        expected_revision: draft.revision,
        cash_accounts: draft.cash_accounts,
        investment_accounts: draft.investment_accounts,
        transactions: draft.transactions,
        fixed_assets: draft.fixed_assets
      });
      setBase(clone(saved));
      setDraft(clone(saved));
      onDirty(false);
      await onSaved();
      setState({ kind: "success", message: `已保存 revision ${saved.revision}。` });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setState({ kind: "pending", message: "解析账单…" });
    try {
      const contentBase64 = await readFileBase64(file);
      const inspection = await api.inspectCsv(
        month,
        file.name,
        contentBase64
      );
      setCsvSource({ filename: file.name, contentBase64, inspection });
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };
  const applyCsvPreview = async (
    response: CsvImportPreview,
    mode: ImportMode,
    mapping: CsvColumnMapping
  ) => {
    if (!csvSource) return;
    setState({ kind: "pending", message: "正在准备导入草稿…" });
    try {
      const prepared = await prepareCsvImportCommit({
        currentTransactions: draft.transactions,
        importedTransactions: response.rows,
        mode,
        headerSignature: csvSource.inspection.header_signature,
        mapping,
        saveMapping: saveCsvMapping,
        loadRuleCandidates: (rows) => api.ruleCandidates(month, rows)
      });
      setRuleCandidates(prepared.candidates);
      setCandidateCategories((current) => ({
        ...current,
        ...Object.fromEntries(prepared.candidates.rows.map((candidate) => {
          const key = candidateKey(candidate);
          const definition = categories.find(
            (category) =>
              category.name === candidate.category
              && category.transaction_type === candidate.transaction_type
          );
          return [key, current[key] || definition?.category_key || ""];
        }))
      }));
      mark({
        ...draft,
        transactions: prepared.transactions
      });
      setIssues(response.issues);
      setCsvSource(null);
      setState({
        kind: "success",
        message:
          mode === "append"
            ? `已追加全部 ${response.rows.length} 行到草稿；未执行去重，尚未写库。`
            : `已用 ${response.rows.length} 行覆盖流水草稿，尚未写库。`
      });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
      throw error;
    }
  };

  const applyRules = async () => {
    setState({ kind: "pending", message: "应用自动规则…" });
    try {
      const result = await api.applyRules(month, draft.transactions);
      if (result.base_revision !== draft.revision) {
        throw new Error("规则预览期间 revision 已变化，请重新加载");
      }
      mark({ ...draft, transactions: result.proposed_rows });
      setState({ kind: "success", message: "规则结果已进入草稿，保存后写库。" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };

  const deleteMonth = async () => {
    if (deleteConfirm !== month) {
      setState({ kind: "error", message: "确认月份不匹配，未删除。" });
      return;
    }
    setState({ kind: "pending", message: `正在删除 ${month}…` });
    try {
      await api.deleteMonth(month, draft.revision);
      const remaining = months.filter((item) => item !== month).sort();
      const next = remaining.filter((item) => item < month).at(-1) ?? remaining.at(0) ?? "";
      onDirty(false);
      await onDeleted(next);
      setShowDeleteConfirm(false);
      setDeleteConfirm("");
      new Notice(`${month} 已删除`);
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };

  return (
    <main className="asset-track-editor">
      {csvSource && (
        <CsvImportDialog
          hostWindow={hostWindow}
          inspection={csvSource.inspection}
          savedMapping={getCsvMapping(
            csvSource.inspection.header_signature
          )}
          onCancel={() => setCsvSource(null)}
          onPreview={(mapping) =>
            api.previewMappedCsv(
              month,
              csvSource.filename,
              csvSource.contentBase64,
              mapping
            )
          }
          onApply={applyCsvPreview}
        />
      )}
      <section className="asset-track-month-header">
        <div>
          <h2>{month}</h2>
          <span>{draft.status} · revision {draft.revision}</span>
        </div>
        <div className="asset-track-actions">
          <button
            type="button"
            className="mod-cta"
            disabled={state.kind === "pending"}
            onClick={() => csvInputRef.current?.click()}
            title="支持 CSV、XLSX、XLS；导入前需要确认字段和收支映射"
          >
            导入账单
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(event) => void importCsv(event)}
          />
          <button onClick={() => void applyRules()}>应用规则</button>
          <button onClick={() => void load()}>放弃并重载</button>
          <button
            className="mod-warning"
            onClick={() => setShowDeleteConfirm((visible) => !visible)}
          >
            删除月份
          </button>
          <button className="mod-cta" disabled={state.kind === "pending"} onClick={() => void save()}>
            保存月份
          </button>
        </div>
      </section>
      {showDeleteConfirm && (
        <section className="asset-track-delete-confirm">
          <strong>删除后会清理该月全部数据库事实，且无法在界面中撤销。</strong>
          <label>
            输入完整月份 {month}
            <input
              autoFocus
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value.trim())}
            />
          </label>
          <button
            className="mod-warning"
            disabled={deleteConfirm !== month || state.kind === "pending"}
            onClick={() => void deleteMonth()}
          >
            确认删除 {month}
          </button>
          <button onClick={() => {
            setShowDeleteConfirm(false);
            setDeleteConfirm("");
          }}>
            取消
          </button>
        </section>
      )}
      <Status state={state} />
      {issues.length > 0 && (
        <IssueList issues={issues} rows={draft.transactions} />
      )}
      <Section title="现金账户">
        <div className="asset-track-fields">
          {draft.cash_accounts.map((account, index) => (
            <NumberField
              key={account.account_key}
              label={account.account ?? account.name ?? account.account_key}
              value={account.balance}
              onChange={(value) =>
                mark({
                  ...draft,
                  cash_accounts: draft.cash_accounts.map((row, item) =>
                    item === index ? { ...row, balance: number(value) } : row
                  )
                })
              }
            />
          ))}
        </div>
      </Section>
      <Section title="理财账户">
        {draft.investment_accounts.map((account, index) => (
          <div className="asset-track-fields asset-track-investment-row" key={account.account_key}>
            <div className="asset-track-account-name">
              <span>账户</span>
              <strong>{account.name ?? account.account_key}</strong>
            </div>
            {(["principal", "market_value", "cash_balance"] as const).map((field) => (
              <NumberField
                key={field}
                label={{ principal: "本金", market_value: "市值", cash_balance: "流动现金" }[field]}
                value={account[field]}
                onChange={(value) =>
                  mark({
                    ...draft,
                    investment_accounts: draft.investment_accounts.map((row, item) =>
                      item === index ? { ...row, [field]: number(value) } : row
                    )
                  })
                }
              />
            ))}
          </div>
        ))}
      </Section>
      <section className="asset-track-view-switcher">
        <strong>流水展示</strong>
        <button
          className={transactionView === "detail" ? "is-active" : ""}
          onClick={() => setTransactionView("detail")}
        >
          逐项
        </button>
        <button
          className={transactionView === "summary" ? "is-active" : ""}
          onClick={() => setTransactionView("summary")}
        >
          按商品汇总
        </button>
        <span>汇总只影响查看，保存时仍保留每笔流水。</span>
      </section>
      {transactionView === "detail" && TRANSACTION_SECTIONS.map((title) => (
          <TransactionTable
            key={title}
            title={title}
            month={month}
            rows={draft.transactions}
            visibleIndexes={transactionIndexes(draft.transactions, title)}
            categories={categories}
            onUpdate={updateTransaction}
            onDelete={(index) =>
              mark({
                ...draft,
                transactions: draft.transactions.filter((_, item) => item !== index)
              })
            }
            onAdd={() => {
              mark({
                ...draft,
                transactions: [
                  ...draft.transactions,
                  createTransactionDraft(title, month, categories)
                ]
              });
            }}
          />
        ))}
      {transactionView === "summary" && (
        <TransactionSummaryTable
          rows={draft.transactions}
          categories={categories}
          sort={summarySort}
          onSort={setSummarySort}
          expanded={expandedGroup}
          onExpanded={setExpandedGroup}
          onUpdate={updateTransaction}
        />
      )}
      {ruleCandidates.rows.length > 0 && (
        <Section title="潜在交易规则">
          <p>
            按历史记录和当前草稿统计；增量导入不去重，重复账单也会计入出现次数。
          </p>
          <div className="asset-track-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>收支</th>
                  <th>交易对方</th>
                  <th><SortButton label="商品" field="product" sort={candidateSort} onSort={setCandidateSort} /></th>
                  <th><SortButton label="出现次数" field="occurrences" sort={candidateSort} onSort={setCandidateSort} /></th>
                  <th><SortButton label="月份" field="months_count" sort={candidateSort} onSort={setCandidateSort} /></th>
                  <th><SortButton label="最近月份" field="last_month" sort={candidateSort} onSort={setCandidateSort} /></th>
                  <th>建议分类</th>
                  <th>置信度</th><th />
                </tr>
              </thead>
              <tbody>
                {candidateView.map(({ row: candidate }) => {
                  const key = candidateKey(candidate);
                  return (
                    <tr key={key}>
                      <td>{candidate.transaction_type}</td>
                      <td>{candidate.counterparty || "—"}</td>
                      <td title={candidate.variants.join("、")}>{candidate.product}</td>
                      <td>{candidate.occurrences}</td>
                      <td>{candidate.months_count}</td>
                      <td>{candidate.last_month}</td>
                      <td>
                        <select
                          value={candidateCategories[key] ?? ""}
                          onChange={(event) => setCandidateCategories((current) => ({
                            ...current,
                            [key]: event.target.value
                          }))}
                        >
                          <option value="">请选择</option>
                          {categories.filter(
                            (category) =>
                              category.is_active
                              && category.transaction_type === candidate.transaction_type
                          ).map((category) => (
                            <option
                              key={category.category_key}
                              value={category.category_key}
                            >
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {(candidate.category_confidence * 100).toFixed(0)}%
                        {candidate.has_category_conflict ? " · 有冲突" : ""}
                      </td>
                      <td>
                        <button
                          disabled={state.kind === "pending"}
                          onClick={() => void createRule(candidate)}
                        >
                          创建规则并应用
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <FixedAssetTable
        rows={draft.fixed_assets}
        onUpdate={updateAsset}
        onDelete={(index) =>
          mark({
            ...draft,
            fixed_assets: draft.fixed_assets.filter((_, item) => item !== index)
          })
        }
        onAdd={() =>
          mark({
            ...draft,
            fixed_assets: [
              ...draft.fixed_assets,
              {
                client_id: crypto.randomUUID(),
                asset_key: crypto.randomUUID(),
                asset_name: "",
                category: "",
                purchase_date: null,
                purchase_price: 0,
                status: "在用",
                note: ""
              }
            ]
          })
        }
      />
    </main>
  );
}

function TransactionTable({
  title,
  rows,
  visibleIndexes,
  categories,
  onUpdate,
  onDelete,
  onAdd
}: {
  title: string;
  month: string;
  rows: Transaction[];
  visibleIndexes: number[];
  categories: CategoryDefinition[];
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 600
  });
  const sorted = useMemo(
    () =>
      sortRows(visibleIndexes, sort, (index, key) => rows[index][key as keyof Transaction]),
    [rows, sort, visibleIndexes]
  );
  const blockNumbers = useMemo(
    () => transactionBlockNumbers(rows),
    [rows]
  );
  const range = calculateVirtualRowRange(
    sorted.length,
    viewport.scrollTop,
    viewport.height
  );
  const visibleRows = sorted.slice(range.start, range.end);
  return (
    <Section title={`${title}（${visibleIndexes.length} 行）`}>
      <div
        className="asset-track-virtual-table"
        role="table"
        aria-rowcount={sorted.length + 1}
        onScroll={(event) => {
          setViewport({
            scrollTop: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight
          });
        }}
      >
        <div className="asset-track-grid asset-track-grid-head">
          <span>行号</span>
          {[
            ["transaction_date", "日期"],
            ["counterparty", "交易对方"],
            ["category", "分类"],
            ["product", "商品"],
            ["amount", "金额"]
          ].map(([field, label]) => (
            <SortButton key={field} field={field} label={label} sort={sort} onSort={setSort} />
          ))}
          <span />
        </div>
        <div className="asset-track-virtual-body">
          {virtualSpacerBlocks(range.start).map((block) => (
            <div
              className={`asset-track-virtual-spacer is-${block}`}
              aria-hidden="true"
              key={`top-${block}`}
            />
          ))}
          {visibleRows.map(({ row: originalIndex }, visibleIndex) => {
              const row = rows[originalIndex];
              const blockNumber = blockNumbers[originalIndex];
              const special = ["代付", "加仓", "提现"].includes(row.type);
              const options = categories.filter(
                (category) =>
                  category.transaction_type === row.type &&
                  (category.is_active || category.category_key === row.category_key)
              );
              return (
                <div
                  className="asset-track-grid"
                  key={row.id ?? row.client_id ?? originalIndex}
                  role="row"
                  aria-rowindex={range.start + visibleIndex + 2}
                >
                  <span className="asset-track-row-number">
                    {blockNumber}
                  </span>
                  <input
                    aria-label={`${title}第 ${blockNumber} 行日期`}
                    value={row.transaction_date}
                    onChange={(event) => onUpdate(originalIndex, "transaction_date", event.target.value)}
                  />
                  <input
                    aria-label={`${title}第 ${blockNumber} 行交易对方`}
                    value={row.counterparty ?? ""}
                    placeholder="交易对方"
                    onChange={(event) =>
                      onUpdate(originalIndex, "counterparty", event.target.value)
                    }
                  />
                  <select
                    aria-label={`${title}第 ${blockNumber} 行分类`}
                    disabled={special}
                    value={row.category_key ?? ""}
                    onChange={(event) => onUpdate(originalIndex, "category_key", event.target.value)}
                  >
                    <option value="">请选择</option>
                    {options.map((category) => (
                      <option key={category.category_key} value={category.category_key}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`${title}第 ${blockNumber} 行商品`}
                    value={row.product}
                    onChange={(event) => onUpdate(originalIndex, "product", event.target.value)}
                  />
                  <input
                    aria-label={`${title}第 ${blockNumber} 行金额`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={(event) => onUpdate(originalIndex, "amount", event.target.value)}
                  />
                  <button
                    aria-label={`删除${title}第 ${blockNumber} 行`}
                    onClick={() => onDelete(originalIndex)}
                  >
                    删除
                  </button>
                </div>
              );
            })}
          {virtualSpacerBlocks(sorted.length - range.end).map((block) => (
            <div
              className={`asset-track-virtual-spacer is-${block}`}
              aria-hidden="true"
              key={`bottom-${block}`}
            />
          ))}
        </div>
      </div>
      <button onClick={onAdd}>新增{title}流水</button>
    </Section>
  );
}

function TransactionSummaryTable({
  rows,
  categories,
  sort,
  onSort,
  expanded,
  onExpanded,
  onUpdate
}: {
  rows: Transaction[];
  categories: CategoryDefinition[];
  sort: SortState;
  onSort: (sort: SortState) => void;
  expanded: string;
  onExpanded: (key: string) => void;
  onUpdate: (
    index: number,
    field: keyof Transaction,
    value: string
  ) => void;
}) {
  const groups = sortRows(groupTransactions(rows), sort, (group, key) =>
    group[key as keyof TransactionGroup]
  );
  return (
    <Section title="商品汇总">
      <div className="asset-track-table-scroll">
        <table>
          <thead>
            <tr>
              <th>收支</th>
              <th><SortButton label="商品" field="product" sort={sort} onSort={onSort} /></th>
              <th><SortButton label="出现次数" field="count" sort={sort} onSort={onSort} /></th>
              <th><SortButton label="总金额" field="amount" sort={sort} onSort={onSort} /></th>
              <th><SortButton label="最近日期" field="lastDate" sort={sort} onSort={onSort} /></th>
              <th>分类</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map(({ row: group }) => (
              <Fragment key={group.key}>
                <tr>
                  <td>{group.type}</td>
                  <td title={group.variants.join("、")}>{group.product}</td>
                  <td>{group.count}</td>
                  <td>{group.amount.toFixed(1)}</td>
                  <td>
                    {group.firstDate === group.lastDate
                      ? group.lastDate
                      : `${group.firstDate} ～ ${group.lastDate}`}
                  </td>
                  <td>
                    {group.categories.length === 0
                      ? "未分类"
                      : group.categories.length === 1
                        ? group.categories[0]
                        : `${group.categories.length} 个分类（有冲突）`}
                  </td>
                  <td>
                    <button onClick={() =>
                      onExpanded(expanded === group.key ? "" : group.key)
                    }>
                      {expanded === group.key ? "收起" : "展开逐项"}
                    </button>
                  </td>
                </tr>
                {expanded === group.key && (
                  <tr key={`${group.key}:expanded`}>
                    <td colSpan={7}>
                      <div className="asset-track-summary-details">
                        {group.indexes.map((index) => {
                          const item = rows[index];
                          const available = categories.filter(
                            (category) =>
                              category.is_active
                              && category.transaction_type === item.type
                          );
                          return (
                            <div key={item.id ?? item.client_id ?? index}>
                              <input
                                type="date"
                                value={item.transaction_date}
                                onChange={(event) =>
                                  onUpdate(index, "transaction_date", event.target.value)
                                }
                              />
                              <input
                                value={item.counterparty ?? ""}
                                placeholder="交易对方"
                                onChange={(event) =>
                                  onUpdate(index, "counterparty", event.target.value)
                                }
                              />
                              <input
                                value={item.product}
                                onChange={(event) =>
                                  onUpdate(index, "product", event.target.value)
                                }
                              />
                              <input
                                type="number"
                                value={item.amount}
                                onChange={(event) =>
                                  onUpdate(index, "amount", event.target.value)
                                }
                              />
                              {["支出", "收入"].includes(item.type) ? (
                                <select
                                  value={item.category_key ?? ""}
                                  onChange={(event) =>
                                    onUpdate(index, "category_key", event.target.value)
                                  }
                                >
                                  <option value="">请选择分类</option>
                                  {available.map((category) => (
                                    <option
                                      key={category.category_key}
                                      value={category.category_key}
                                    >
                                      {category.name}
                                    </option>
                                  ))}
                                </select>
                              ) : <span>无需分类</span>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function FixedAssetTable({
  rows,
  onUpdate,
  onDelete,
  onAdd
}: {
  rows: FixedAsset[];
  onUpdate: (index: number, field: keyof FixedAsset, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const sorted = sortRows(rows, sort, (row, key) => row[key as keyof FixedAsset]);
  return (
    <Section title={`固定资产（${rows.length} 项）`}>
      <div className="asset-track-table-scroll">
        <table>
          <thead>
            <tr>
              {[
                ["asset_name", "名称"],
                ["category", "类别"],
                ["purchase_date", "购置日"],
                ["purchase_price", "购买价"],
                ["status", "状态"],
                ["note", "备注"]
              ].map(([field, label]) => (
                <th key={field}>
                  <SortButton field={field} label={label} sort={sort} onSort={setSort} />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, originalIndex }) => (
              <tr key={row.id ?? row.asset_key ?? row.client_id ?? originalIndex}>
                {(["asset_name", "category", "purchase_date", "purchase_price"] as const).map((field) => (
                  <td key={field}>
                    <input
                      type={
                        field === "purchase_price"
                          ? "number"
                          : field === "purchase_date"
                            ? "date"
                            : "text"
                      }
                      value={String(row[field] ?? "")}
                      onChange={(event) => onUpdate(originalIndex, field, event.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <select
                    value={row.status}
                    onChange={(event) => onUpdate(originalIndex, "status", event.target.value)}
                  >
                    {["在用", "闲置", "已出售", "已报废"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={row.note}
                    onChange={(event) => onUpdate(originalIndex, "note", event.target.value)}
                  />
                </td>
                <td>
                  <button onClick={() => onDelete(originalIndex)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={onAdd}>新增资产</button>
    </Section>
  );
}

type ColumnType = "text" | "number" | "date" | "checkbox" | "readonly";

function CollectionEditor({
  title,
  load,
  save,
  createRow,
  columns,
  onDirty,
  onSaved
}: {
  title: string;
  load: () => Promise<{ revision: number; rows: Array<Record<string, unknown>> }>;
  save: (revision: number, rows: Array<Record<string, unknown>>) => Promise<unknown>;
  createRow: () => Record<string, unknown>;
  columns: Array<[string, string, ColumnType]>;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const loadRef = useRef(load);
  const saveRef = useRef(save);
  loadRef.current = load;
  saveRef.current = save;
  const reload = useCallback(async () => {
    setState({ kind: "pending", message: "加载…" });
    try {
      const result = await loadRef.current();
      setRevision(result.revision);
      setRows(result.rows);
      onDirty(false);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [onDirty]);
  useEffect(() => void reload(), [reload]);
  const update = (index: number, key: string, value: unknown) => {
    setRows((current) =>
      current.map((row, item) => (item === index ? { ...row, [key]: value } : row))
    );
    onDirty(true);
  };
  const commit = async () => {
    setState({ kind: "pending", message: "保存…" });
    try {
      await saveRef.current(revision, rows);
      await reload();
      onSaved();
      setState({ kind: "success", message: "已保存。" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };
  const sorted = sortRows(rows, sort, (row, key) => row[key]);
  return (
    <main className="asset-track-editor">
      <section className="asset-track-month-header">
        <div>
          <h2>{title}</h2>
          <span>revision {revision}</span>
        </div>
        <div className="asset-track-actions">
          <button
            onClick={() => {
              setRows((current) => [...current, createRow()]);
              onDirty(true);
            }}
          >
            新增
          </button>
          <button onClick={() => void reload()}>放弃并重载</button>
          <button className="mod-cta" onClick={() => void commit()}>
            整体保存
          </button>
        </div>
      </section>
      <Status state={state} />
      <div className="asset-track-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map(([field, label]) => (
                <th key={field}>
                  <SortButton field={field} label={label} sort={sort} onSort={setSort} />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, originalIndex }) => (
              <tr key={scalarText(row.id ?? originalIndex)}>
                {columns.map(([key, , type]) => (
                  <td key={key}>
                    {type === "readonly" ? (
                      scalarText(row[key])
                    ) : type === "checkbox" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(row[key])}
                        onChange={(event) => update(originalIndex, key, event.target.checked)}
                      />
                    ) : (
                      <input
                        type={type}
                        value={scalarText(row[key])}
                        onChange={(event) =>
                          update(
                            originalIndex,
                            key,
                            type === "number" ? number(event.target.value) : event.target.value
                          )
                        }
                      />
                    )}
                  </td>
                ))}
                <td>
                  <button
                    onClick={() => {
                      setRows((current) =>
                        current.filter((_, item) => item !== originalIndex)
                      );
                      onDirty(true);
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function RulesEditor({
  api,
  onDirty,
  onSaved
}: {
  api: AssetTrackService;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const [categories, setCategories] = useState<{ revision: number; rows: CategoryDefinition[] } | null>(null);
  const [rules, setRules] = useState<{ revision: number; rows: Array<Record<string, unknown>> } | null>(null);
  const [categorySort, setCategorySort] = useState<SortState>(null);
  const [ruleSort, setRuleSort] = useState<SortState>(null);
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const load = useCallback(async () => {
    setState({ kind: "pending", message: "加载分类与规则…" });
    try {
      const [categoryData, ruleData] = await Promise.all([api.categories(), api.rules()]);
      setCategories(categoryData);
      setRules(ruleData);
      onDirty(false);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [api, onDirty]);
  useEffect(() => void load(), [load]);
  if (!categories || !rules) return <Status state={state} />;

  const saveAll = async () => {
    setState({ kind: "pending", message: "保存分类与规则…" });
    try {
      const categoryResult = await api.saveCategories(categories.revision, categories.rows);
      await api.saveRules(rules.revision, rules.rows);
      setCategories(categoryResult);
      await load();
      onSaved();
      setState({ kind: "success", message: "分类和交易匹配规则已保存。" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };
  const activeForType = (type: unknown) =>
    categories.rows.filter(
      (row) => row.is_active && row.transaction_type === String(type)
    );
  const categoryView = sortRows(
    categories.rows,
    categorySort,
    (row, key) => row[key as keyof CategoryDefinition]
  );
  const ruleView = sortRows(rules.rows, ruleSort, (row, key) => row[key]);
  return (
    <main className="asset-track-editor">
      <section className="asset-track-month-header">
        <div>
          <h2>规则</h2>
          <span>分类定义与交易对方／商品匹配</span>
        </div>
        <button className="mod-cta" onClick={() => void saveAll()}>
          整体保存
        </button>
      </section>
      <Status state={state} />
      <Section title="分类定义">
        <div className="asset-track-table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  ["name", "名称"], ["transaction_type", "收支"],
                  ["necessity", "必要性"], ["pattern", "消费频率"],
                  ["is_big_ticket", "大额"], ["color", "颜色"],
                  ["is_active", "启用"], ["transaction_count", "影响"]
                ].map(([field, label]) => <th key={field}>
                  <SortButton field={field} label={label} sort={categorySort} onSort={setCategorySort} />
                </th>)}<th />
              </tr>
            </thead>
            <tbody>
              {categoryView.map(({ row, originalIndex: index }) => (
                <tr key={row.category_key}>
                  <td><input value={row.name} onChange={(event) => {
                    const rows = clone(categories.rows);
                    rows[index].name = event.target.value;
                    setCategories({ ...categories, rows }); onDirty(true);
                  }} /></td>
                  <td><select value={row.transaction_type} onChange={(event) => {
                    const rows = clone(categories.rows);
                    rows[index].transaction_type = event.target.value as "支出" | "收入";
                    setCategories({ ...categories, rows }); onDirty(true);
                  }}><option>支出</option><option>收入</option></select></td>
                  <td><select value={row.necessity} onChange={(event) => {
                    const rows = clone(categories.rows);
                    rows[index].necessity = event.target.value as CategoryDefinition["necessity"];
                    setCategories({ ...categories, rows }); onDirty(true);
                  }}>{["必要", "可控", "不适用"].map((value) => <option key={value}>{value}</option>)}</select></td>
                  <td><select value={row.pattern} onChange={(event) => {
                    const rows = clone(categories.rows);
                    rows[index].pattern = event.target.value as CategoryDefinition["pattern"];
                    setCategories({ ...categories, rows }); onDirty(true);
                  }}>{["周期", "日常", "偶尔", "不适用"].map((value) => <option key={value}>{value}</option>)}</select></td>
                  <td><input type="checkbox" checked={row.is_big_ticket} onChange={(event) => {
                    const rows = clone(categories.rows); rows[index].is_big_ticket = event.target.checked;
                    setCategories({ ...categories, rows }); onDirty(true);
                  }} /></td>
                  <td><input type="color" value={row.color} onChange={(event) => {
                    const rows = clone(categories.rows); rows[index].color = event.target.value;
                    setCategories({ ...categories, rows }); onDirty(true);
                  }} /></td>
                  <td><input type="checkbox" checked={row.is_active} onChange={(event) => {
                    const rows = clone(categories.rows); rows[index].is_active = event.target.checked;
                    setCategories({ ...categories, rows }); onDirty(true);
                  }} /></td>
                  <td>{row.transaction_count ?? 0} 行 / {row.impact_months?.length ?? 0} 月</td>
                  <td><button onClick={() => {
                    const rows = categories.rows.filter((_, item) => item !== index);
                    setCategories({ ...categories, rows }); onDirty(true);
                  }}>{(row.transaction_count ?? 0) + (row.rule_count ?? 0) > 0 ? "停用" : "删除"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => {
          setCategories({
            ...categories,
            rows: [...categories.rows, {
              category_key: `cat-user-${crypto.randomUUID()}`,
              name: "",
              transaction_type: "支出",
              necessity: "必要",
              pattern: "日常",
              is_big_ticket: false,
              color: CATEGORY_RAINBOW[categories.rows.length % CATEGORY_RAINBOW.length],
              is_active: true,
              sort_order: categories.rows.length
            }]
          }); onDirty(true);
        }}>新增分类</button>
      </Section>
      <Section title="交易匹配规则">
        <div className="asset-track-table-scroll">
          <table>
            <thead><tr>{[
              ["transaction_type", "收支"],
              ["counterparty", "交易对方"], ["product", "商品"],
              ["category", "分类"], ["occurrences", "历史次数"],
              ["last_month", "最近月份"]
            ].map(([field, label]) => <th key={field}>
              <SortButton field={field} label={label} sort={ruleSort} onSort={setRuleSort} />
            </th>)}<th /></tr></thead>
            <tbody>{ruleView.map(({ row, originalIndex: index }) => (
              <tr key={scalarText(row.id ?? index)}>
                <td><select value={scalarText(row.transaction_type) || "支出"} onChange={(event) => {
                  const next = clone(rules.rows); next[index].transaction_type = event.target.value;
                  next[index].category_key = ""; next[index].category = "";
                  setRules({ ...rules, rows: next }); onDirty(true);
                }}><option>支出</option><option>收入</option></select></td>
                <td><input value={scalarText(row.counterparty)} onChange={(event) => {
                  const next = clone(rules.rows); next[index].counterparty = event.target.value;
                  setRules({ ...rules, rows: next }); onDirty(true);
                }} /></td>
                <td><input value={scalarText(row.product)} onChange={(event) => {
                  const next = clone(rules.rows); next[index].product = event.target.value;
                  setRules({ ...rules, rows: next }); onDirty(true);
                }} /></td>
                <td><select value={scalarText(row.category_key)} onChange={(event) => {
                  const next = clone(rules.rows);
                  const definition = categories.rows.find((item) => item.category_key === event.target.value);
                  next[index].category_key = event.target.value;
                  next[index].category = definition?.name ?? "";
                  setRules({ ...rules, rows: next }); onDirty(true);
                }}><option value="">请选择</option>{activeForType(row.transaction_type).map((category) => (
                  <option key={category.category_key} value={category.category_key}>{category.name}</option>
                ))}</select></td>
                <td>{scalarText(row.occurrences)}</td><td>{scalarText(row.last_month)}</td>
                <td><button onClick={() => {
                  setRules({ ...rules, rows: rules.rows.filter((_, item) => item !== index) }); onDirty(true);
                }}>删除</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <button onClick={() => {
          const definition = categories.rows.find((row) => row.is_active && row.transaction_type === "支出");
          setRules({ ...rules, rows: [...rules.rows, {
            transaction_type: "支出", counterparty: "", product: "",
            category_key: definition?.category_key ?? "", category: definition?.name ?? ""
          }] }); onDirty(true);
        }}>新增规则</button>
      </Section>
    </main>
  );
}

function IssueList({
  issues,
  rows
}: {
  issues: Array<Record<string, unknown>>;
  rows: Transaction[];
}) {
  return (
    <div className="asset-track-issues" role="alert">
      <strong>必须先修正以下问题：</strong>
      <ul>
        {issues.map((issue, index) => {
          const globalIndex = Number(issue.row_index ?? 0);
          const type = scalarText(
            issue.type ?? rows[globalIndex]?.type ?? "流水"
          );
          const blockRow = transactionBlockNumber(rows, globalIndex);
          return (
            <li key={index}>
              {type}第 {Math.max(1, blockRow)} 行／
              {scalarText(issue.field) || "字段"}／
              {scalarText(issue.issue) || "无效"}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="asset-track-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={
          typeof value === "number" || typeof value === "string"
            ? value
            : 0
        }
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Status({ state }: { state: OperationState }) {
  if (state.kind === "idle" && !state.message) return null;
  return (
    <div
      className={`asset-track-status is-${state.kind}`}
      role={state.kind === "error" ? "alert" : "status"}
      aria-live={state.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {state.message}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="asset-track-empty" role="status">{text}</div>;
}
