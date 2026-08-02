import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  SettingPage,
  type SettingDefinitionItem
} from "obsidian";
import {
  DATABASE_NAME,
  RECOMMENDED_WORKSPACE
} from "./constants";
import type AssetTrackPlugin from "./main";
import type { AccountDefinition, AssetTrackSettings } from "./types";
import {
  databaseVaultPath,
  normalizeDataDirectory
} from "./services/workspacePath";
import {
  chooseBackupDirectory,
  chooseBackupFile
} from "./services/nativeDialogs";
import { isCurrencyCode } from "./domain/moneyFormat";
import { scalarText } from "./domain/text";
import { confirmAction } from "./ui/ConfirmModal";
import { displayError, t } from "./i18n";

export const DEFAULT_SETTINGS: AssetTrackSettings = {
  dataDirectory: "",
  csvMappings: [],
  baseCurrency: "CNY",
  currencyFormat: "standard",
  reconciliationTolerance: 100,
  largeExpenseThreshold: 1000
};

function message(error: unknown): string {
  return displayError(error);
}

type SettingsRefresh = () => void;

export class AssetTrackSettingTab extends PluginSettingTab {
  private dataDirectoryDraft = "";
  private dataDirectoryDraftDirty = false;
  private directoryInspectionPath: string | null = null;
  private directoryInspectionText = "";
  private inspectionSequence = 0;

  constructor(app: App, private readonly plugin: AssetTrackPlugin) {
    super(app, plugin);
    this.dataDirectoryDraft = plugin.settings.dataDirectory;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: t("数据库存储", "Database storage"),
        cls: "asset-track-settings",
        items: [
          {
            name: t("数据安全提示", "Data safety notice"),
            searchable: false,
            render: (setting) => {
              setting.setClass("asset-track-settings-warning");
              setting.setDesc(t(
                "本地数据库是唯一事实源。数据库若位于同步目录，请勿在多台设备并发写入。",
                "The local database is the single source of truth. If it is stored in a synced directory, do not write to it concurrently from multiple devices."
              ));
            }
          },
          {
            name: t("设置校验提示", "Settings validation warning"),
            searchable: false,
            visible: () => this.plugin.settingsIssues.length > 0,
            render: (setting) => {
              setting.setClass("asset-track-settings-warning");
              setting.setDesc(this.plugin.settingsIssues.map(displayError).join(t("；", "; ")));
              setting.descEl.setAttr("role", "alert");
            }
          },
          {
            name: t("Asset-track 数据目录", "Asset Track data directory"),
            desc: t(
              "选择当前 Vault 内的目录；创建、载入或迁移成功后才会保存。",
              "Choose a directory inside the current vault. It is saved only after create, load, or migration succeeds."
            ),
            control: {
              type: "folder",
              key: "dataDirectoryDraft",
              placeholder: RECOMMENDED_WORKSPACE,
              includeRoot: false,
              validate: (value: string) => this.validateDataDirectory(value)
            }
          },
          {
            name: t("数据库状态", "Database status"),
            searchable: false,
            render: (setting) => this.renderDirectoryStatus(setting)
          },
          {
            name: t("数据库操作", "Database actions"),
            searchable: false,
            render: (setting) => this.renderDatabaseActions(setting)
          },
          {
            name: t("当前正在使用", "Currently in use"),
            searchable: false,
            visible: () => this.plugin.isDatabaseReady(),
            render: (setting) => this.renderCurrentDirectory(setting)
          },
          {
            name: t("数据库未就绪", "Database not ready"),
            searchable: false,
            visible: () => !this.plugin.isDatabaseReady(),
            render: (setting) => this.renderDatabaseNotReady(setting)
          }
        ]
      },
      {
        type: "group",
        heading: t("显示与分析", "Display and analysis"),
        cls: "asset-track-settings",
        visible: () => this.plugin.isDatabaseReady(),
        items: [
          {
            name: t("基础货币", "Base currency"),
            desc: t(
              "使用 ISO 4217 三字母货币代码。",
              "Use a three-letter ISO 4217 currency code."
            ),
            control: {
              type: "text",
              key: "baseCurrency",
              placeholder: "CNY",
              validate: (value: string) => this.validateCurrency(value)
            }
          },
          {
            name: t("金额格式", "Amount format"),
            control: {
              type: "dropdown",
              key: "currencyFormat",
              options: {
                standard: t("标准货币格式", "Standard currency format"),
                accounting: t("会计格式", "Accounting format")
              }
            }
          },
          {
            name: t("平账容差", "Reconciliation tolerance"),
            desc: t(
              "差额绝对值不超过该金额时视为平账。",
              "Differences up to this amount are treated as reconciled."
            ),
            control: {
              type: "number",
              key: "reconciliationTolerance",
              min: 0,
              step: "any",
              validate: (value: number) => this.validateNonNegative(value)
            }
          },
          {
            name: t("大额支出阈值", "Large expense threshold"),
            desc: t(
              "单笔或同商品汇总达到该金额时视为大额。",
              "A transaction or item total at this amount is treated as large."
            ),
            control: {
              type: "number",
              key: "largeExpenseThreshold",
              min: 0,
              step: "any",
              validate: (value: number) => this.validatePositive(value)
            }
          }
        ]
      },
      {
        type: "page",
        name: t("备份与恢复", "Backup and restore"),
        desc: t(
          "导出、校验并恢复完整的数据库备份。",
          "Export, validate, and restore complete database backups."
        ),
        visible: () => this.plugin.isDatabaseReady(),
        page: () => new AssetTrackBackupPage(this)
      },
      {
        type: "page",
        name: t("现金与理财账户", "Cash and investment accounts"),
        desc: t(
          "管理新月份使用的现金与理财账户定义。",
          "Manage cash and investment account definitions used by new months."
        ),
        visible: () => this.plugin.isDatabaseReady(),
        page: () => new AssetTrackAccountsPage(this)
      }
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "dataDirectoryDraft") return this.currentDataDirectory();
    return super.getControlValue(key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "dataDirectoryDraft") {
      const raw = typeof value === "string" ? value : "";
      try {
        this.dataDirectoryDraft = normalizeDataDirectory(raw);
      } catch {
        this.dataDirectoryDraft = raw;
      }
      this.dataDirectoryDraftDirty = true;
      this.startDirectoryInspection(this.dataDirectoryDraft);
      return;
    }

    if (key === "baseCurrency") {
      this.plugin.settings.baseCurrency = String(value).trim().toUpperCase();
      await this.plugin.saveSettings();
      await this.plugin.refreshViews();
      return;
    }

    if (key === "currencyFormat") {
      this.plugin.settings.currencyFormat = value === "accounting"
        ? "accounting"
        : "standard";
      await this.plugin.saveSettings();
      await this.plugin.refreshViews();
      return;
    }

    if (key === "reconciliationTolerance") {
      this.plugin.settings.reconciliationTolerance = Number(value);
      await this.plugin.saveSettings();
      await this.plugin.refreshViews();
      return;
    }

    if (key === "largeExpenseThreshold") {
      this.plugin.settings.largeExpenseThreshold = Number(value);
      await this.plugin.saveSettings();
      await this.plugin.refreshViews();
      return;
    }

    await super.setControlValue(key, value);
  }

  hide(): void {
    this.inspectionSequence += 1;
    this.dataDirectoryDraft = this.plugin.settings.dataDirectory;
    this.dataDirectoryDraftDirty = false;
    this.directoryInspectionPath = null;
    this.directoryInspectionText = "";
    super.hide();
  }

  private currentDataDirectory(): string {
    return this.dataDirectoryDraftDirty
      ? this.dataDirectoryDraft
      : this.plugin.settings.dataDirectory;
  }

  private validateDataDirectory(value: string): string | void {
    if (!value.trim()) return;
    try {
      normalizeDataDirectory(value);
    } catch (error) {
      return message(error);
    }
  }

  private validateCurrency(value: string): string | void {
    if (isCurrencyCode(value.trim().toUpperCase())) return;
    return t("请输入有效的 ISO 4217 货币代码。", "Enter a valid ISO 4217 currency code.");
  }

  private validateNonNegative(value: number): string | void {
    if (Number.isFinite(value) && value >= 0) return;
    return t("请输入不小于 0 的有限数字。", "Enter a finite number that is at least 0.");
  }

  private validatePositive(value: number): string | void {
    if (Number.isFinite(value) && value > 0) return;
    return t("请输入大于 0 的有限数字。", "Enter a finite number greater than 0.");
  }

  private startDirectoryInspection(directory: string): void {
    const sequence = ++this.inspectionSequence;
    this.directoryInspectionPath = directory;
    this.directoryInspectionText = directory
      ? t("正在检查目录……", "Inspecting the directory…")
      : t("请输入当前 Vault 内的数据目录。", "Enter a data directory inside the current vault.");
    this.update();
    if (!directory) return;
    void this.inspectDirectoryText(directory).then((text) => {
      if (sequence !== this.inspectionSequence) return;
      this.directoryInspectionText = text;
      this.update();
    });
  }

  private renderDirectoryStatus(setting: Setting): void {
    const directory = this.currentDataDirectory();
    const text = this.dataDirectoryDraftDirty
      && this.directoryInspectionPath === directory
      ? this.directoryInspectionText
      : this.databaseStatusText();
    setting.setClass("asset-track-settings-status");
    setting.setDesc(text);
    setting.descEl.setAttr("role", "status");
    setting.descEl.setAttr("aria-live", "polite");
    setting.descEl.setAttr("aria-atomic", "true");
  }

  private renderDatabaseActions(setting: Setting): void {
    setting.setDesc(t(
      "对上方选定目录执行显式数据库操作。",
      "Run an explicit database operation for the directory selected above."
    ));
    const directory = () => this.currentDataDirectory();
    if (this.plugin.isDatabaseReady()) {
      setting.addButton((button) =>
        button.setButtonText(t("迁移当前库", "Migrate current database")).onClick(() =>
          void this.runDatabaseAction(() =>
            this.plugin.switchDataDirectory(directory(), "migrate")
          )
        )
      );
      setting.addButton((button) =>
        button.setButtonText(t("载入目标库", "Load target database")).onClick(() =>
          void this.runDatabaseAction(() =>
            this.plugin.switchDataDirectory(directory(), "load")
          )
        )
      );
      return;
    }
    setting.addButton((button) =>
      button.setButtonText(t("创建新数据库", "Create new database")).onClick(() =>
        void this.runDatabaseAction(() => this.plugin.createDatabase(directory()))
      )
    );
    setting.addButton((button) =>
      button.setCta().setButtonText(t("载入数据库", "Load database")).onClick(() =>
        void this.runDatabaseAction(() => this.plugin.loadDatabase(directory()))
      )
    );
  }

  private renderCurrentDirectory(setting: Setting): void {
    setting.setDesc(databaseVaultPath(this.plugin.settings.dataDirectory));
    setting.addButton((button) =>
      button.setButtonText(t("打开数据目录", "Open data directory")).onClick(async () => {
        try {
          await this.plugin.openDataDirectory();
        } catch (error) {
          new Notice(message(error));
        }
      })
    );
  }

  private renderDatabaseNotReady(setting: Setting): void {
    setting.setClass("asset-track-settings-warning");
    setting.setDesc(this.plugin.databaseError
      ? t(
          `数据库未载入，原文件未修改：${displayError(this.plugin.databaseError)}`,
          `Database not loaded; original files were not changed: ${displayError(this.plugin.databaseError)}`
        )
      : t(
          "完成创建或载入后才能管理账户和执行备份恢复。",
          "Create or load a database before managing accounts, backups, or restores."
        ));
  }

  private async runDatabaseAction(action: () => Promise<void>): Promise<void> {
    let succeeded = false;
    try {
      await action();
      succeeded = true;
      new Notice(t("数据库操作完成", "Database operation complete"));
    } catch (error) {
      this.directoryInspectionPath = this.currentDataDirectory();
      this.directoryInspectionText = message(error);
      new Notice(message(error), 10_000);
    } finally {
      if (succeeded) {
        this.dataDirectoryDraft = this.plugin.settings.dataDirectory;
        this.dataDirectoryDraftDirty = false;
        this.directoryInspectionPath = null;
        this.directoryInspectionText = "";
      }
      this.update();
    }
  }

  private databaseStatusText(): string {
    if (this.plugin.databaseState === "ready") {
      return t(
        "数据库已就绪。输入其他目录后可迁移当前库或载入目标库。",
        "The database is ready. Enter another directory to migrate the current database or load the target database."
      );
    }
    if (this.plugin.databaseState === "initializing") {
      return t("正在初始化数据库……", "Initializing the database…");
    }
    if (this.plugin.databaseState === "error") {
      return t(
        `数据库载入失败：${displayError(this.plugin.databaseError ?? "未知错误")}`,
        `Database load failed: ${displayError(this.plugin.databaseError ?? "Unknown error")}`
      );
    }
    return t(
      "尚未配置 Asset-track 数据目录。",
      "No Asset Track data directory is configured."
    );
  }

  private async inspectDirectoryText(directory: string): Promise<string> {
    if (!directory.trim()) return t(
      "请输入当前 Vault 内的数据目录。",
      "Enter a data directory inside the current vault."
    );
    try {
      const result = await this.plugin.inspectDataDirectory(directory);
      if (!result.exists) return t(
        "目录中没有数据库，可以创建新数据库。",
        "No database was found in this directory. You can create a new one."
      );
      if (result.valid) return t(
        `发现有效的 ${DATABASE_NAME}，可以载入。`,
        `A valid ${DATABASE_NAME} was found and can be loaded.`
      );
      return t(
        `发现数据库文件，但校验失败：${displayError(result.error ?? "未知错误")}`,
        `A database file was found, but validation failed: ${displayError(result.error ?? "Unknown error")}`
      );
    } catch (error) {
      return message(error);
    }
  }

  renderBackupPage(root: HTMLElement): void {
    const backupStatus = root.createEl("p", {
      text: t("尚未执行操作。", "No operation has been run."),
      cls: "asset-track-settings-status",
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true"
      }
    });
    let exportedPath = "";
    let revealButton: { setDisabled(value: boolean): unknown } | undefined;
    new Setting(root)
      .setName(t("立即备份", "Back up now"))
      .setDesc(t(
        "选择保存目录后生成一个完整 zip 备份。",
        "Choose a destination to create a complete ZIP backup."
      ))
      .addButton((button) =>
        button.setButtonText(t("选择目录并导出", "Choose folder and export")).onClick(async () => {
          try {
            const directory = await chooseBackupDirectory();
            if (!directory) return;
            button.setDisabled(true);
            backupStatus.setText(t(
              "正在创建并校验一致性 zip 备份…",
              "Creating and validating a consistent ZIP backup…"
            ));
            const result = await this.plugin.api.backup(directory);
            exportedPath = result.path;
            revealButton?.setDisabled(false);
            backupStatus.setText(t(
              `备份完成：${result.path}`,
              `Backup complete: ${result.path}`
            ));
          } catch (error) {
            backupStatus.setText(t(
              `备份失败：${message(error)}`,
              `Backup failed: ${message(error)}`
            ));
          } finally {
            button.setDisabled(false);
          }
        })
      )
      .addButton((button) => {
        revealButton = button;
        button
          .setButtonText(t("在文件管理器中显示", "Show in file manager"))
          .setDisabled(true)
          .onClick(() => {
            if (exportedPath) this.plugin.showPathInFinder(exportedPath);
          });
      });

    let restorePath = "";
    let restoreValidated = false;
    let restoreButton:
      | { setDisabled(value: boolean): unknown }
      | undefined;
    const validationSummary = (result: Record<string, unknown>): string => {
      const rows = result.row_counts as Record<string, number> | undefined;
      const manifest = result.manifest as Record<string, unknown> | undefined;
      return [
        t("备份校验通过", "Backup validation passed"),
        t(
          `流水 ${rows?.transactions ?? 0} 行`,
          `${rows?.transactions ?? 0} transactions`
        ),
        manifest?.created_at
          ? t(
              `创建时间 ${scalarText(manifest.created_at)}`,
              `Created ${scalarText(manifest.created_at)}`
            )
          : t("数据库文件", "Database file"),
        restorePath
      ].join(" · ");
    };
    const selectAndValidate = async (
      picker: () => Promise<string | null>
    ): Promise<void> => {
      const selected = await picker();
      if (!selected) return;
      restorePath = selected;
      restoreValidated = false;
      restoreButton?.setDisabled(true);
      backupStatus.setText(t(
        "正在校验备份候选…",
        "Validating the selected backup…"
      ));
      try {
        const result = await this.plugin.api.validateBackup(restorePath);
        restoreValidated = true;
        restoreButton?.setDisabled(false);
        backupStatus.setText(validationSummary(result));
      } catch (error) {
        backupStatus.setText(t(
          `校验失败：${message(error)}`,
          `Validation failed: ${message(error)}`
        ));
      }
    };
    new Setting(root)
      .setName(t("恢复备份", "Restore backup"))
      .setDesc(t(
        "选择完整备份 zip 或数据库文件。",
        "Choose a complete backup ZIP or database file."
      ))
      .addButton((button) =>
        button.setButtonText(t("选择备份文件", "Choose backup file")).onClick(() =>
          void selectAndValidate(() => chooseBackupFile())
        )
      )
      .addButton((button) => {
        restoreButton = button;
        button.buttonEl.addClass("mod-warning");
        button
          .setButtonText(t("确认恢复", "Confirm restore"))
          .setDisabled(true)
          .onClick(async () => {
            if (!restorePath || !restoreValidated) return;
            const confirmed = await confirmAction(
              this.app,
              t("恢复数据库备份？", "Restore database backup?"),
              t(
                `将恢复：${restorePath}。恢复前会创建当前数据库一致性安全备份。`,
                `Restore ${restorePath}? A consistent safety backup of the current database will be created first.`
              ),
              t("确认恢复", "Confirm restore")
            );
            if (!confirmed) return;
            button.setDisabled(true);
            backupStatus.setText(t(
              "正在 staging 恢复数据库…",
              "Staging the database restore…"
            ));
            try {
              await this.plugin.api.restoreBackup(restorePath);
              this.plugin.notifyDataChanged();
              restoreValidated = false;
              button.setDisabled(true);
              backupStatus.setText(t(
                "恢复完成；实时分析数据已刷新。",
                "Restore complete. Live analytics have been refreshed."
              ));
            } catch (error) {
              backupStatus.setText(t(
                `恢复失败：${message(error)}`,
                `Restore failed: ${message(error)}`
              ));
            } finally {
              button.setDisabled(!restoreValidated);
            }
          });
      });
  }

  renderAccountsPage(root: HTMLElement): void {
    root.empty();
    new Setting(root).setName(t(
      "现金与理财账户",
      "Cash and investment accounts"
    )).setHeading();
    const accountStatus = root.createEl("p", {
      text: t("正在读取账户定义…", "Loading account definitions…"),
      cls: "asset-track-settings-status",
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true"
      }
    });
    const accountRoot = root.createDiv("asset-track-settings-accounts");
    void this.renderAccounts(
      accountRoot,
      accountStatus,
      () => this.renderAccountsPage(root)
    );
  }

  private async renderAccounts(
    root: HTMLElement,
    status: HTMLElement,
    refresh: SettingsRefresh
  ): Promise<void> {
    try {
      const data = await this.plugin.api.accounts();
      let rows = structuredClone(data.rows);
      const redraw = () => {
        root.empty();
        for (const [index, row] of rows.entries()) {
          const setting = new Setting(root)
            .setName(`${row.account_type === "cash"
              ? t("现金", "Cash")
              : t("理财", "Investment")} · ${row.name}`)
            .setDesc(
              t(
                `${row.usage_count ?? 0} 个月有历史余额；有历史的账户只能停用。`,
                `${row.usage_count ?? 0} months have historical balances. Accounts with history can only be deactivated.`
              )
            );
          setting.addText((text) =>
            text.setValue(row.name).onChange((value) => {
              rows[index].name = value.trim();
            })
          );
          setting.addToggle((toggle) =>
            toggle.setValue(row.is_active).onChange((value) => {
              rows[index].is_active = value;
            })
          );
          setting.addButton((button) =>
            button
              .setButtonText((row.usage_count ?? 0) > 0
                ? t("停用", "Deactivate")
                : t("删除", "Delete"))
              .onClick(() => {
                if ((row.usage_count ?? 0) > 0) rows[index].is_active = false;
                else rows = rows.filter((_, item) => item !== index);
                redraw();
              })
          );
        }
        new Setting(root)
          .setName(t("新增账户", "Add account"))
          .addButton((button) =>
            button.setButtonText(t("新增现金账户", "Add cash account")).onClick(() => {
              rows.push(this.newAccount("cash", rows.length));
              redraw();
            })
          )
          .addButton((button) =>
            button.setButtonText(t("新增理财账户", "Add investment account")).onClick(() => {
              rows.push(this.newAccount("investment", rows.length));
              redraw();
            })
          )
          .addButton((button) =>
            button.setCta().setButtonText(t(
              "保存账户定义",
              "Save account definitions"
            )).onClick(async () => {
              status.setText(t(
                "正在保存账户定义…",
                "Saving account definitions…"
              ));
              try {
                await this.plugin.api.saveAccounts(data.revision, rows);
                this.plugin.notifyDataChanged();
                status.setText(t(
                  "账户定义已保存；新月份将带出名称并把数值归零。",
                  "Account definitions saved. New months will copy the names and reset the values to zero."
                ));
                refresh();
              } catch (error) {
                status.setText(t(
                  `账户保存失败：${message(error)}`,
                  `Failed to save accounts: ${message(error)}`
                ));
              }
            })
          );
      };
      redraw();
      status.setText(t("账户定义已加载。", "Account definitions loaded."));
    } catch (error) {
      status.setText(t(
        `账户加载失败：${message(error)}`,
        `Failed to load account definitions: ${message(error)}`
      ));
    }
  }

  private newAccount(
    accountType: "cash" | "investment",
    order: number
  ): AccountDefinition {
    return {
      account_key: `${accountType}-user-${crypto.randomUUID()}`,
      name: accountType === "cash"
        ? t("新现金账户", "New cash account")
        : t("新理财账户", "New investment account"),
      account_type: accountType,
      is_active: true,
      sort_order: order
    };
  }
}

class AssetTrackBackupPage extends SettingPage {
  title: string;

  constructor(private readonly owner: AssetTrackSettingTab) {
    super();
    this.title = t("备份与恢复", "Backup and restore");
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.addClass("asset-track-settings");
    this.owner.renderBackupPage(this.containerEl);
  }
}

class AssetTrackAccountsPage extends SettingPage {
  title: string;

  constructor(private readonly owner: AssetTrackSettingTab) {
    super();
    this.title = t("现金与理财账户", "Cash and investment accounts");
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.addClass("asset-track-settings");
    this.owner.renderAccountsPage(this.containerEl);
  }
}
