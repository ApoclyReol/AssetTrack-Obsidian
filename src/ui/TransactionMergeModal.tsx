import { Modal, type App } from "obsidian";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MergePreviewResult } from "../domain/transactionMerge";
import { businessLabel, displayError, t } from "../i18n";

interface Options {
  tagNames?: Record<string, string>;
  app: App;
  result: MergePreviewResult;
  onPreview?: (includeTagged: boolean) => Promise<MergePreviewResult>;
  onConfirm: (isOpen: () => boolean, result: MergePreviewResult) => Promise<void>;
}
export function TransactionMergeContent({ result: initialResult, tagNames = {}, onPreview, onConfirm, onClose }:
  Omit<Options, "app" | "onConfirm"> & { onConfirm: (result: MergePreviewResult) => Promise<void>; onClose: () => void }) {
  const [result, setResult] = useState(initialResult);
  const [includeTagged, setIncludeTagged] = useState(initialResult.preview.metadata?.include_tagged === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  useEffect(() => () => { requestSequence.current++; }, []);
  const count = result.groups.reduce((sum, group) => sum + group.before.length, 0);
  const tagLabel = (keys?: string[]) => keys?.map((key) => tagNames[key] ?? key).join(" · ") || t("无标签", "No tags");
  const nameLabel = (group: MergePreviewResult["groups"][number], field: "counterparty" | "product") =>
    group.cleared_fields.includes(field) ? t("—（原名称不同，合并后留空）", "— (different original names; left blank)") : group.after[field] || "—";
  const changeTags = async (next: boolean) => {
    if (!onPreview) return;
    const sequence = ++requestSequence.current;
    setIncludeTagged(next); setBusy(true); setError("");
    try {
      const updated = await onPreview(next);
      if (sequence === requestSequence.current) setResult(updated);
    } catch (reason) {
      if (sequence === requestSequence.current) {
        setIncludeTagged(result.preview.metadata?.include_tagged === true);
        setError(displayError(reason));
      }
    } finally { if (sequence === requestSequence.current) setBusy(false); }
  };
  return <div className="asset-track-merge-content">
    <div className="asset-track-merge-summary" role="status">
      <div><strong>{count}</strong><span>{t("参与合并", "Source transactions")}</span></div>
      <div><strong>{result.groups.length}</strong><span>{t("合并后记录", "Merged transactions")}</span></div>
      <div><strong>{count - result.groups.length}</strong><span>{t("减少记录", "Records removed")}</span></div>
      <div><strong>{result.unchanged_count}</strong><span>{t("保留明细", "Kept unchanged")}</span></div>
    </div>
    <fieldset className="asset-track-editor-modal-section asset-track-merge-options">
      <legend>{t("合并范围", "Merge scope")}</legend>
      <label className="asset-track-merge-tag-option"><input type="checkbox" checked={includeTagged} disabled={busy || !onPreview}
        onChange={(event) => void changeTags(event.target.checked)} />{t("将有标签的流水也参与合并", "Include tagged transactions")}</label>
      <p>{t("默认仅合并无标签流水。勾选后，按完整标签组合分别处理；A、A+B 和无标签不会混在一起。", "Only untagged transactions are included by default. When enabled, identical complete tag sets are merged separately; A, A+B and untagged transactions stay separate.")}</p>
      {result.excluded_tagged_count > 0 && <small>{t(`${result.excluded_tagged_count} 笔带标签流水将保留明细。`, `${result.excluded_tagged_count} tagged transactions will remain unchanged.`)}</small>}
      <p>{t("按当前分类和完整标签组合分别合并，每组不足两笔时保留明细。保留汇总字段，另一名称一致时保留，不一致时留空；使用当前草稿，不重新应用规则。", "Transactions are merged separately by their current category and complete tag set. Groups with fewer than two transactions stay unchanged. The summary name is kept; the other name is kept only when identical, otherwise left blank. Current draft values are used without reapplying rules.")}</p>
    </fieldset>
    <section className="asset-track-merge-results" aria-label={t("合并结果预览", "Merge results preview")}>
      {!result.groups.length && <p className="asset-track-merge-empty">{t("当前选项下没有可合并的记录。可勾选带标签流水；相同分类和标签组合内至少需要两笔。", "No records can be merged with these options. Include tagged transactions; each category and tag-set combination needs at least two transactions.")}</p>}
      {result.groups.map((group, index) => <section className="asset-track-editor-modal-section asset-track-merge-result" key={group.after.client_id}>
        <header><strong>{t(`结果 ${index + 1}`, `Result ${index + 1}`)}</strong>
          <span>{t(`${group.before.length} 笔 → 1 笔`, `${group.before.length} transactions → 1`)}</span></header>
        <p className="asset-track-modal-subtitle">{result.preview.metadata?.group_by === "counterparty"
          ? t(`交易对手汇总 · ${group.after.counterparty || "—"}`, `Counterparty summary · ${group.after.counterparty || "—"}`)
          : t(`商品汇总 · ${group.after.product || "—"}`, `Item summary · ${group.after.product || "—"}`)}</p>
        <dl className="asset-track-merge-fields">
          <div><dt>{t("日期", "Date")}</dt><dd>{group.after.transaction_date}</dd></div>
          <div><dt>{t("收支", "Type")}</dt><dd>{businessLabel(group.after.type)}</dd></div>
          <div><dt>{t("交易对手", "Counterparty")}</dt><dd>{nameLabel(group, "counterparty")}</dd></div>
          <div><dt>{t("商品", "Item")}</dt><dd>{nameLabel(group, "product")}</dd></div>
          <div><dt>{t("分类", "Category")}</dt><dd>{group.after.category || "—"}</dd></div>
          <div><dt>{t("金额", "Amount")}</dt><dd className="asset-track-merge-amount">{group.after.amount.toFixed(2)}</dd></div>
          <div className="asset-track-merge-tags"><dt>{t("标签组合", "Tag set")}</dt><dd>{tagLabel(group.after.tag_keys)}</dd></div>
        </dl>
        <details><summary>{t("查看合并前明细", "View original transactions")}</summary>
          <div className="asset-track-table-scroll"><table>
            <thead><tr>{[t("日期", "Date"), t("交易对手", "Counterparty"), t("商品", "Item"), t("分类", "Category"), t("金额", "Amount"), t("标签", "Tags")].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{group.before.map((row, rowIndex) => <tr key={group.source_keys[rowIndex]}><td>{row.transaction_date}</td><td>{row.counterparty || "—"}</td><td>{row.product || "—"}</td><td>{row.category || "—"}</td><td>{row.amount.toFixed(2)}</td><td>{tagLabel(row.tag_keys)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </section>)}
    </section>
    <div className="asset-track-merge-footer">
      <p className="asset-track-merge-notice" role="note">{t("确认后先进入当前草稿。保存流水后将替换原逐笔记录，插件不提供拆分还原。", "Confirmation updates the draft. Saving replaces the original transactions; the plugin cannot split them back.")}</p>
      {error && <p role="alert">{error}</p>}
      <div className="asset-track-rule-create-actions">
        <button type="button" disabled={busy} onClick={onClose}>{t("取消", "Cancel")}</button>
        <button type="button" className="mod-cta" disabled={busy || !result.groups.length} onClick={() => {
          setBusy(true); setError("");
          void onConfirm(result).then(onClose).catch((reason: unknown) => { setError(displayError(reason)); setBusy(false); });
        }}>{busy ? t("正在处理…", "Working…") : t("确认合并到草稿", "Merge into draft")}</button>
      </div>
    </div>
  </div>;
}
export class TransactionMergeModal extends Modal {
  private root: Root | null = null;
  private closed = false;
  constructor(private readonly options: Options) { super(options.app); }
  onOpen(): void {
    this.closed = false;
    this.setTitle(t("合并流水", "Merge transactions"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-merge-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(TransactionMergeContent, { ...this.options,
      onConfirm: (result) => this.options.onConfirm(() => !this.closed, result), onClose: () => this.close() }));
  }
  onClose(): void { this.closed = true; this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
