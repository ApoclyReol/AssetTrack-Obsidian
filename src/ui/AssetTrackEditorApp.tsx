import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode
} from "react";
import { Notice } from "obsidian";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  EDITOR_MODES,
  type AnalysisMode,
  type EditorMode
} from "../constants";
import type {
  CategoryDefinition,
  FixedAsset,
  MonthCreationPolicy,
  MonthWorkspace,
  Transaction
} from "../types";
import { ApiError, type AssetTrackApi } from "../services/AssetTrackApi";
import { AnalysisView } from "./AnalysisView";
import {
  createTransactionDraft,
  transactionIndexes,
  TRANSACTION_SECTIONS
} from "./analysisModel";

interface Props {
  api: AssetTrackApi;
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
}

type OperationState =
  | { kind: "idle"; message?: string }
  | { kind: "pending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type SortState = { key: string; direction: "asc" | "desc" } | null;

const CATEGORY_RAINBOW = [
  "#e53935", "#f4511e", "#fb8c00", "#fdd835", "#c0ca33",
  "#7cb342", "#43a047", "#00897b", "#00acc1", "#039be5",
  "#1e88e5", "#3949ab", "#5e35b1", "#8e24aa", "#d81b60"
];

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("CSV 读取失败"));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  });
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left ?? 0) - Number(right ?? 0);
  }
  return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN", {
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
  return (
    <button className="asset-track-sort" onClick={() => onSort(toggleSort(sort, field))}>
      {label}
      {mark}
    </button>
  );
}

export function AssetTrackEditorApp({
  api,
  initialMode,
  initialAnalysisMode,
  initialMonth,
  onDirtyChange,
  onStateChange,
  subscribeDataChanges
}: Props) {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(initialAnalysisMode);
  const [months, setMonths] = useState<string[]>([]);
  const [monthPolicy, setMonthPolicy] = useState<MonthCreationPolicy | null>(null);
  const [month, setMonth] = useState(initialMonth ?? "");
  const [dirty, setDirty] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setAnalysisMode(initialAnalysisMode), [initialAnalysisMode]);
  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);

  const refreshMonths = useCallback(async () => {
    const response = await api.months();
    setMonths(response.months);
    setMonthPolicy(response);
    setMonth((current) => current || initialMonth || response.months.at(-1) || "");
  }, [api, initialMonth]);

  useEffect(() => {
    void refreshMonths().catch((error) => new Notice(messageFor(error)));
  }, [refreshMonths]);
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

  const switchMode = (next: EditorMode) => {
    if (dirty && !window.confirm("当前草稿尚未保存。放弃更改并切换？")) return;
    setDirty(false);
    setMode(next);
  };
  const selectMonth = (next: string) => {
    if (dirty && !window.confirm("当前月份草稿尚未保存。放弃更改并切换？")) return;
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

  return (
    <div className="asset-track-app">
      <header className="asset-track-toolbar">
        <div>
          <strong>Asset Track</strong>
          <span>SQLite 事实 · Python 计算 · 实时分析</span>
        </div>
        <nav>
          {EDITOR_MODES.map((item) => (
            <button
              key={item}
              className={mode === item ? "is-active" : ""}
              onClick={() => switchMode(item)}
            >
              {{ analysis: "分析", transactions: "流水", debts: "借款", rules: "规则" }[item]}
            </button>
          ))}
        </nav>
      </header>
      {mode === "transactions" && (
        <div className="asset-track-month-picker">
          <select value={month} onChange={(event) => selectMonth(event.target.value)}>
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
  month,
  months,
  onDeleted,
  onSaved,
  onDirty
}: {
  api: AssetTrackApi;
  month: string;
  months: string[];
  onDeleted: (next: string) => Promise<void>;
  onSaved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [base, setBase] = useState<MonthWorkspace | null>(null);
  const [draft, setDraft] = useState<MonthWorkspace | null>(null);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [issues, setIssues] = useState<Array<Record<string, unknown>>>([]);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const csvInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setState({ kind: "pending", message: "加载月份…" });
    try {
      const [data, categoryData] = await Promise.all([api.month(month), api.categories()]);
      setBase(clone(data));
      setDraft(clone(data));
      setCategories(categoryData.rows);
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

  const save = async () => {
    setState({ kind: "pending", message: "执行严格质检…" });
    try {
      const validation = await api.validateTransactions(month, draft.transactions);
      const found = validation.issues as Array<Record<string, unknown>>;
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
    setState({ kind: "pending", message: "解析 CSV…" });
    try {
      const response = await api.importCsv(month, file.name, await readFileBase64(file));
      const choice = window.prompt(
        `识别 ${response.rows.length} 行。类型汇总：${JSON.stringify(
          response.type_summary
        )}\n问题 ${response.issues.length} 项。\n请输入“追加”或“替换”：`,
        "追加"
      );
      if (choice !== "追加" && choice !== "替换") {
        setState({ kind: "idle" });
        return;
      }
      mark({
        ...draft,
        transactions:
          choice === "追加"
            ? [...draft.transactions, ...response.rows]
            : response.rows
      });
      setIssues(response.issues as Array<Record<string, unknown>>);
      setState({
        kind: "success",
        message: `已${choice} ${response.rows.length} 行到草稿，尚未写库。`
      });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
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
            title="支持必需的商品、收支、金额，以及可选的日期、分类列"
          >
            导入 CSV
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={importCsv}
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
      {issues.length > 0 && <IssueList issues={issues} />}
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
          <div className="asset-track-fields" key={account.account_key}>
            <strong>{account.name ?? account.account_key}</strong>
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
      {TRANSACTION_SECTIONS.map((title) => (
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
  const sorted = useMemo(
    () =>
      sortRows(visibleIndexes, sort, (index, key) => rows[index][key as keyof Transaction]),
    [rows, sort, visibleIndexes]
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    overscan: 12
  });
  return (
    <Section title={`${title}（${visibleIndexes.length} 行）`}>
      <div className="asset-track-virtual-table">
        <div className="asset-track-grid asset-track-grid-head">
          {[
            ["transaction_date", "日期"],
            ["category", "分类"],
            ["product", "商品"],
            ["amount", "金额"]
          ].map(([field, label]) => (
            <SortButton key={field} field={field} label={label} sort={sort} onSort={setSort} />
          ))}
          <span />
        </div>
        <div
          className="asset-track-virtual-body"
          ref={scrollRef}
          style={{ height: Math.min(560, Math.max(42, sorted.length * 42)) }}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const originalIndex = sorted[item.index].row;
              const row = rows[originalIndex];
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
                  style={{
                    position: "absolute",
                    transform: `translateY(${item.start}px)`,
                    width: "100%"
                  }}
                >
                  <input
                    value={row.transaction_date}
                    onChange={(event) => onUpdate(originalIndex, "transaction_date", event.target.value)}
                  />
                  <select
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
                    value={row.product}
                    onChange={(event) => onUpdate(originalIndex, "product", event.target.value)}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={(event) => onUpdate(originalIndex, "amount", event.target.value)}
                  />
                  <button onClick={() => onDelete(originalIndex)}>删除</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <button onClick={onAdd}>新增{title}流水</button>
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
              <tr key={String(row.id ?? originalIndex)}>
                {columns.map(([key, , type]) => (
                  <td key={key}>
                    {type === "readonly" ? (
                      String(row[key] ?? "")
                    ) : type === "checkbox" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(row[key])}
                        onChange={(event) => update(originalIndex, key, event.target.checked)}
                      />
                    ) : (
                      <input
                        type={type}
                        value={String(row[key] ?? "")}
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
  api: AssetTrackApi;
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
      setState({ kind: "success", message: "分类和商品匹配规则已保存。" });
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
          <span>分类定义与商品匹配</span>
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
      <Section title="商品匹配规则">
        <div className="asset-track-table-scroll">
          <table>
            <thead><tr>{[
              ["transaction_type", "收支"], ["product", "商品"],
              ["category", "分类"], ["occurrences", "历史次数"],
              ["last_month", "最近月份"]
            ].map(([field, label]) => <th key={field}>
              <SortButton field={field} label={label} sort={ruleSort} onSort={setRuleSort} />
            </th>)}<th /></tr></thead>
            <tbody>{ruleView.map(({ row, originalIndex: index }) => (
              <tr key={String(row.id ?? index)}>
                <td><select value={String(row.transaction_type ?? "支出")} onChange={(event) => {
                  const next = clone(rules.rows); next[index].transaction_type = event.target.value;
                  next[index].category_key = ""; next[index].category = "";
                  setRules({ ...rules, rows: next }); onDirty(true);
                }}><option>支出</option><option>收入</option></select></td>
                <td><input value={String(row.product ?? "")} onChange={(event) => {
                  const next = clone(rules.rows); next[index].product = event.target.value;
                  setRules({ ...rules, rows: next }); onDirty(true);
                }} /></td>
                <td><select value={String(row.category_key ?? "")} onChange={(event) => {
                  const next = clone(rules.rows);
                  const definition = categories.rows.find((item) => item.category_key === event.target.value);
                  next[index].category_key = event.target.value;
                  next[index].category = definition?.name ?? "";
                  setRules({ ...rules, rows: next }); onDirty(true);
                }}><option value="">请选择</option>{activeForType(row.transaction_type).map((category) => (
                  <option key={category.category_key} value={category.category_key}>{category.name}</option>
                ))}</select></td>
                <td>{String(row.occurrences ?? "")}</td><td>{String(row.last_month ?? "")}</td>
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
            transaction_type: "支出", product: "",
            category_key: definition?.category_key ?? "", category: definition?.name ?? ""
          }] }); onDirty(true);
        }}>新增规则</button>
      </Section>
    </main>
  );
}

function IssueList({ issues }: { issues: Array<Record<string, unknown>> }) {
  return (
    <div className="asset-track-issues">
      <strong>必须先修正以下问题：</strong>
      <ul>
        {issues.map((issue, index) => (
          <li key={index}>
            {String(issue.type ?? "流水")}第 {Number(issue.row_index ?? 0) + 1} 行／
            {String(issue.field ?? "字段")}／{String(issue.issue ?? "无效")}
          </li>
        ))}
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
        value={String(value ?? 0)}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Status({ state }: { state: OperationState }) {
  if (state.kind === "idle" && !state.message) return null;
  return <div className={`asset-track-status is-${state.kind}`}>{state.message}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="asset-track-empty">{text}</div>;
}
