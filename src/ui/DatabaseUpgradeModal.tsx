import { Modal, type App } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DatabaseMigrationImpact } from "../database/DatabaseManager";
import { t } from "../i18n";

interface UpgradeOptions {
  app: App;
  directory: string;
  impact: DatabaseMigrationImpact;
  onChoice: (upgrade: boolean) => void;
}

export function DatabaseUpgradeContent({ directory, impact, onChoice }: Omit<UpgradeOptions, "app">) {
  return <div className="asset-track-upgrade-content">
    <p>{t("升级现有账本后，即可使用金额规则和流水合并。", "Upgrade your existing ledger to use amount rules and transaction merging.")}</p>
    <p className="asset-track-modal-subtitle">{t(`数据目录：${directory}`, `Data directory: ${directory}`)}</p>
    <fieldset className="asset-track-editor-modal-section">
      <legend>{t("现有数据", "Existing data")}</legend>
      <p>{t(`${impact.category_count} 个分类 · ${impact.transaction_count} 笔流水`, `${impact.category_count} categories · ${impact.transaction_count} transactions`)}</p>
      <p>{t("保留现有流水、规则、分类属性和标签，原规则默认不限金额。", "Transactions, rules, category attributes and tags are preserved. Existing rules remain unrestricted by amount.")}</p>
      {impact.from_schema < 12 && <p>{t("旧分类属性会转换并保留。如需清除，请先选择“稍后”，再从设置中载入并选择清除。", "Legacy category attributes will be converted and preserved. To clear them instead, choose Later, then load the ledger from settings and select the clear option.")}</p>}
    </fieldset>
    <p role="note">{t("确认后先创建本地保护备份，再自动升级。选择“稍后”不会修改数据库。", "Confirmation creates a local protection backup before upgrading automatically. Choosing Later leaves the database unchanged.")}</p>
    <div className="asset-track-rule-create-actions">
      <button type="button" onClick={() => onChoice(false)}>{t("稍后", "Later")}</button>
      <button type="button" className="mod-cta" onClick={() => onChoice(true)}>{t("备份并升级", "Back up and upgrade")}</button>
    </div>
  </div>;
}

export class DatabaseUpgradeModal extends Modal {
  private root: Root | null = null;
  private settled = false;
  constructor(private readonly options: UpgradeOptions) { super(options.app); }

  onOpen(): void {
    this.setTitle(t("升级现有账本", "Upgrade existing ledger"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-confirmation-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(DatabaseUpgradeContent, { ...this.options, onChoice: (choice) => this.finish(choice) }));
  }

  private finish(choice: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.options.onChoice(choice);
    this.close();
  }

  onClose(): void {
    this.root?.unmount(); this.root = null; this.contentEl.empty();
    if (!this.settled) { this.settled = true; this.options.onChoice(false); }
  }
}
