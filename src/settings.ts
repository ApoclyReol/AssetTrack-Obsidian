import {
  AbstractInputSuggest,
  App,
  Notice,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
  TFolder
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
import { scalarText } from "./domain/text";
import { confirmAction } from "./ui/ConfirmModal";
import { displayError, t } from "./i18n";

export const DEFAULT_SETTINGS: AssetTrackSettings = {
  dataDirectory: "",
  csvMappings: []
};

function message(error: unknown): string {
  return displayError(error);
}

interface FolderSuggestion {
  path: string;
  exists: boolean;
}

class VaultFolderSuggest extends AbstractInputSuggest<FolderSuggestion> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private readonly onSelectPath: (path: string) => void
  ) {
    super(app, input);
    this.limit = 50;
  }

  protected getSuggestions(query: string): FolderSuggestion[] {
    let normalized = "";
    try {
      normalized = normalizeDataDirectory(query);
    } catch {
      return [];
    }
    const lowered = normalized.toLocaleLowerCase("zh-CN");
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && Boolean(file.path))
      .map((folder) => ({ path: folder.path, exists: true }))
      .filter((folder) =>
        !lowered || folder.path.toLocaleLowerCase("zh-CN").includes(lowered)
      )
      .sort((left, right) => {
        const leftRecommended = left.path.endsWith(RECOMMENDED_WORKSPACE) ? 0 : 1;
        const rightRecommended = right.path.endsWith(RECOMMENDED_WORKSPACE) ? 0 : 1;
        return leftRecommended - rightRecommended
          || left.path.localeCompare(right.path, "zh-CN");
      });
    const candidates: FolderSuggestion[] = [];
    const proposed = normalized || RECOMMENDED_WORKSPACE;
    if (!folders.some((folder) => folder.path === proposed)) {
      candidates.push({ path: proposed, exists: false });
    }
    return [...candidates, ...folders];
  }

  renderSuggestion(value: FolderSuggestion, el: HTMLElement): void {
    el.createDiv({ text: value.path });
    el.createEl("small", {
      text: value.exists
        ? t("Vault 内现有文件夹", "Existing folder in this vault")
        : t("可在创建数据库时新建", "Will be created with the database")
    });
  }

  selectSuggestion(value: FolderSuggestion): void {
    this.setValue(value.path);
    this.onSelectPath(value.path);
    this.close();
  }
}

export class AssetTrackSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: AssetTrackPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("asset-track-settings");
    containerEl.createEl("p", {
      text:
        t(
          "本地数据库是唯一事实源。数据库若位于同步目录，请勿在多台设备并发写入。",
          "The local database is the single source of truth. If it is stored in a synced directory, do not write to it concurrently from multiple devices."
        ),
      cls: "asset-track-settings-warning"
    });
    if (this.plugin.settingsIssues.length) {
      containerEl.createEl("p", {
        text: this.plugin.settingsIssues.map(displayError).join(t("；", "; ")),
        cls: "asset-track-settings-warning",
        attr: { role: "alert" }
      });
    }

    new Setting(containerEl).setName(t("数据库存储", "Database storage")).setHeading();

    let selectedPath = this.plugin.settings.dataDirectory;
    const pathStatus = containerEl.createEl("p", {
      text: this.databaseStatusText(),
      cls: "asset-track-settings-status",
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true"
      }
    });
    const rootSetting = new Setting(containerEl)
      .setName(t("Asset-track 数据目录", "Asset Track data directory"));
    rootSetting.addSearch((search) => {
      search
        .setPlaceholder(RECOMMENDED_WORKSPACE)
        .setValue(selectedPath)
        .onChange((value) => {
          selectedPath = value;
          void this.inspectDirectoryText(value).then((text) => pathStatus.setText(text));
        });
      new VaultFolderSuggest(this.app, search.inputEl, (path) => {
        selectedPath = path;
        void this.inspectDirectoryText(path).then((text) => pathStatus.setText(text));
      });
    });
    if (this.plugin.isDatabaseReady()) {
      rootSetting
        .addButton((button) =>
          button.setButtonText(t("迁移当前库", "Migrate current database")).onClick(() =>
            void this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(selectedPath, "migrate")
            )
          )
        )
        .addButton((button) =>
          button.setButtonText(t("载入目标库", "Load target database")).onClick(() =>
            void this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(selectedPath, "load")
            )
          )
        );
    } else {
      rootSetting
        .addButton((button) =>
          button.setButtonText(t("创建新数据库", "Create new database")).onClick(() =>
            void this.runDatabaseAction(() => this.plugin.createDatabase(selectedPath))
          )
        )
        .addButton((button) =>
          button.setCta().setButtonText(t("载入数据库", "Load database")).onClick(() =>
            void this.runDatabaseAction(() => this.plugin.loadDatabase(selectedPath))
          )
        );
    }
    if (this.plugin.isDatabaseReady()) {
      new Setting(containerEl)
        .setName(t("当前正在使用", "Currently in use"))
        .setDesc(databaseVaultPath(this.plugin.settings.dataDirectory))
        .addButton((button) =>
          button.setButtonText(t("打开数据目录", "Open data directory")).onClick(async () => {
            try {
              await this.plugin.openDataDirectory();
            } catch (error) {
              new Notice(message(error));
            }
          })
        );
    }
    if (!this.plugin.isDatabaseReady()) {
      containerEl.createEl("p", {
        text: this.plugin.databaseError
          ? t(
              `数据库未载入，原文件未修改：${displayError(this.plugin.databaseError)}`,
              `Database not loaded; original files were not changed: ${displayError(this.plugin.databaseError)}`
            )
          : t(
              "完成创建或载入后才能管理账户和执行备份恢复。",
              "Create or load a database before managing accounts, backups, or restores."
            ),
        cls: "asset-track-settings-warning"
      });
      return;
    }

    const backupStatus = containerEl.createEl("p", {
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
    new Setting(containerEl)
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
    new Setting(containerEl)
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

    new Setting(containerEl).setName(t(
      "现金与理财账户",
      "Cash and investment accounts"
    )).setHeading();
    const accountStatus = containerEl.createEl("p", {
      text: t("正在读取账户定义…", "Loading account definitions…"),
      cls: "asset-track-settings-status",
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true"
      }
    });
    const accountRoot = containerEl.createDiv("asset-track-settings-accounts");
    void this.renderAccounts(accountRoot, accountStatus);

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

  private async runDatabaseAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      new Notice(t("数据库操作完成", "Database operation complete"));
    } catch (error) {
      new Notice(message(error), 10_000);
    }
    this.display();
  }

  private async renderAccounts(
    root: HTMLElement,
    status: HTMLElement
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
                this.display();
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
        `Failed to load accounts: ${message(error)}`
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
