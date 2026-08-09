import { Modal, type App } from "obsidian";
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  AiBatchResult,
  OperationPreview
} from "../types/operations";
import type {
  Transaction
} from "../types/transactions";
import { businessLabel, t } from "../i18n";
import { scalarText } from "../domain/text";
import { money } from "../domain/moneyFormat";
import { messageFor } from "./editorPrimitives";

export interface TransactionOperationModalOptions {
  app: App;
  preview: OperationPreview;
  onConfirm: (
    includeProtected: boolean,
    replacement?: { preview: OperationPreview; rows: Transaction[] }
  ) => void | Promise<void>;
  onRetry?: (
    statuses: Array<AiBatchResult["rows"][number]["status"]>
  ) => Promise<{ preview: OperationPreview; rows: Transaction[] }>;
}

type PreviewFieldKey =
  | "transaction_date"
  | "type"
  | "counterparty"
  | "product"
  | "category"
  | "amount"
  | "source";

interface PreviewField {
  key: PreviewFieldKey;
  label: string;
}

function previewFields(aiClassification: boolean): PreviewField[] {
  if (aiClassification) {
    return [
      { key: "counterparty", label: t("交易对手", "Counterparty") },
      { key: "product", label: t("商品", "Item") },
      { key: "category", label: t("分类结果", "Category result") }
    ];
  }
  return [
    { key: "transaction_date", label: t("日期", "Date") },
    { key: "type", label: t("类型", "Type") },
    { key: "counterparty", label: t("交易对手", "Counterparty") },
    { key: "product", label: t("商品", "Item") },
    { key: "category", label: t("分类", "Category") },
    { key: "amount", label: t("金额", "Amount") },
    { key: "source", label: t("来源", "Source") }
  ];
}

function previewValue(field: PreviewFieldKey, value: unknown): string {
  if (field === "amount") return money(value);
  const text = scalarText(value).trim();
  if (!text) {
    return field === "category"
      ? t("未分类", "Uncategorized")
      : t("未填写", "Not specified");
  }
  return field === "type" ? businessLabel(text) : text;
}

function displayFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  aiClassification: boolean
): string {
  const fields = previewFields(aiClassification).filter(({ key }) => aiClassification
    ? before[key] !== undefined || after[key] !== undefined
    : scalarText(before[key]) !== scalarText(after[key]));
  if (fields.length === 0) return t("没有字段变化", "No field changes");
  return fields
    .map(({ key, label }) => `${label}：${previewValue(key, before[key])} → ${previewValue(key, after[key])}`)
    .join(" · ");
}

function aiStatusLabel(status: string): string {
  return status === "classified"
    ? t("已分类", "Classified")
    : status === "unclassified"
      ? t("无法分类", "Unclassified")
      : status === "need_review"
        ? t("需要确认", "Needs review")
        : t("调用/解析失败", "Call or parse error");
}

function OperationPreviewContent({
  preview,
  onConfirm,
  onRetry,
  onClose
}: Omit<TransactionOperationModalOptions, "app"> & { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(preview);
  const [currentRows, setCurrentRows] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retryStatuses = ["error", "need_review", "unclassified"] as const;
  const availableRetryStatuses = retryStatuses.filter((status) =>
    current.metadata
    && Array.isArray(current.metadata.result_rows)
    && (current.metadata.result_rows as Array<{ status?: unknown }>).some((row) => row.status === status)
  );
  const aiRows = current.metadata && Array.isArray(current.metadata.result_rows)
    ? current.metadata.result_rows as Array<{ status?: unknown }>
    : [];
  const aiStatusCounts = ["classified", "unclassified", "need_review", "error"].map((status) => ({
    status,
    count: aiRows.filter((row) => row.status === status).length
  }));
  const confirm = async (includeProtected: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(
        includeProtected,
        currentRows ? { preview: current, rows: currentRows } : undefined
      );
      onClose();
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  };
  const retry = async (status: AiBatchResult["rows"][number]["status"]) => {
    if (!onRetry) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onRetry([status]);
      setCurrent(result.preview);
      setCurrentRows(result.rows);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  };
  const samples = current.changes.slice(0, 8);
  const isTypeConversion = current.operation_type === "income-to-daifu"
    || current.operation_type === "daifu-to-income";
  const isAiClassification = current.operation_type === "ai-classification";
  return <div className="asset-track-operation-preview">
    {error && <p role="alert" className="asset-track-operation-error">{error}</p>}
    <p>{t("写入前预览。确认后只会进入当前月份草稿，仍需保存流水。", "Preview before writing. Confirmation only changes the current-month draft; save transactions to persist it.")}</p>
    <div className="asset-track-operation-preview-metrics" role="status">
      <span>{t("总数", "Total")} {current.total_count}</span>
      <span>{t("将变更", "Changes")} {current.change_count}</span>
      <span>{t("跳过", "Skipped")} {current.skipped_count}</span>
      <span>{t("失败", "Failed")} {current.failure_count}</span>
    </div>
    {isTypeConversion && <p className="asset-track-operation-preview-note">
      {t("互转会清空分类字段。", "Converting between income and daifu clears the category field.")}
    </p>}
    {current.protected_count ? <p>{t(`默认保护 ${current.protected_count} 条已人工修改流水。`, `${current.protected_count} manually edited rows are protected by default.`)}</p> : null}
    {aiRows.length > 0 && <div className="asset-track-ai-result-summary" role="status">
      <strong>{t("AI 建议结果", "AI suggestion results")}</strong>
      <div>{aiStatusCounts.map(({ status, count }) => <span key={status}>{aiStatusLabel(status)}：{count}</span>)}</div>
      {aiRows.some((row) => row.status !== "classified") && <small>{t("未完成的分类会保留原值，可按结果重试。", "Unresolved classifications keep their current values and can be retried by result.")}</small>}
    </div>}
    {!isTypeConversion && samples.length > 0 && <div className="asset-track-operation-preview-list">
        <strong>{t("前后对比（含跳过/失败示例）", "Before and after (including skipped/failed samples)")}</strong>
      {samples.map((change, index) => <div key={`${index}-${change.status}`}>
        <small>{displayFields(change.before, change.after, isAiClassification)}</small>
        {change.reason && <small>{change.reason}</small>}
      </div>)}
    </div>}
    {onRetry && availableRetryStatuses.length > 0 && <div className="asset-track-operation-retry-actions">
      <strong>{t("按结果重试", "Retry by result")}</strong>
      {availableRetryStatuses.map((status) => <button
        key={status}
        type="button"
        disabled={busy}
        onClick={() => void retry(status)}
      >{status === "error" ? t("重试调用失败的结果", "Retry failed requests") : status === "need_review" ? t("重试需要确认的结果", "Retry results needing review") : t("重试未分类的结果", "Retry unclassified results")}</button>)}
    </div>}
    <div className="asset-track-operation-preview-actions">
      <button
        type="button"
        disabled={busy}
        aria-label={t("确认修改，并跳过已保护的流水", "Confirm changes and skip protected transactions")}
        onClick={() => void confirm(false)}
      >{t("确认修改（跳过保护流水）", "Confirm changes (skip protected)")}</button>
      {Boolean(current.protected_count) && <button
        type="button"
        className="mod-warning"
        disabled={busy}
        aria-label={t("确认修改，并包含已保护的流水", "Confirm changes including protected transactions")}
        onClick={() => void confirm(true)}
      >{t("包含保护流水并修改", "Include protected and modify")}</button>}
      <button type="button" disabled={busy} onClick={onClose}>{t("取消", "Cancel")}</button>
    </div>
  </div>;
}

export class TransactionOperationModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: TransactionOperationModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(t("流水操作预览", "Transaction operation preview"));
    this.modalEl.addClass("asset-track-operation-preview-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(OperationPreviewContent, {
      preview: this.options.preview,
      onConfirm: this.options.onConfirm,
      onRetry: this.options.onRetry,
      onClose: () => this.close()
    }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
