import {
  AbstractInputSuggest,
  App,
  Notice,
  PluginSettingTab,
  Setting,
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

export const DEFAULT_SETTINGS: AssetTrackSettings = {
  dataDirectory: "",
  csvMappings: []
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      text: value.exists ? "Vault 内现有文件夹" : "可在创建数据库时新建"
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("asset-track-settings");
    containerEl.createEl("h2", { text: "Asset Track" });
    containerEl.createEl("p", {
      text:
        "SQLite 是唯一事实源。数据库若位于同步目录，请勿在多台设备并发写入。",
      cls: "asset-track-settings-warning"
    });

    new Setting(containerEl).setName("数据库存储").setHeading();

    let selectedPath = this.plugin.settings.dataDirectory;
    const pathStatus = containerEl.createEl("p", {
      text: this.databaseStatusText(),
      cls: "asset-track-settings-status"
    });
    const rootSetting = new Setting(containerEl)
      .setName("Asset-track 数据目录");
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
          button.setButtonText("迁移当前库").onClick(() =>
            void this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(selectedPath, "migrate")
            )
          )
        )
        .addButton((button) =>
          button.setButtonText("载入目标库").onClick(() =>
            void this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(selectedPath, "load")
            )
          )
        );
    } else {
      rootSetting
        .addButton((button) =>
          button.setButtonText("创建新数据库").onClick(() =>
            void this.runDatabaseAction(() => this.plugin.createDatabase(selectedPath))
          )
        )
        .addButton((button) =>
          button.setCta().setButtonText("载入数据库").onClick(() =>
            void this.runDatabaseAction(() => this.plugin.loadDatabase(selectedPath))
          )
        );
    }
    if (this.plugin.isDatabaseReady()) {
      new Setting(containerEl)
        .setName("当前正在使用")
        .setDesc(databaseVaultPath(this.plugin.settings.dataDirectory))
        .addButton((button) =>
          button.setButtonText("打开数据目录").onClick(async () => {
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
          ? `数据库未载入，原文件未修改：${this.plugin.databaseError}`
          : "完成创建或载入后才能管理账户和执行备份恢复。",
        cls: "asset-track-settings-warning"
      });
      return;
    }

    const backupStatus = containerEl.createEl("p", {
      text: "尚未执行操作。",
      cls: "asset-track-settings-status"
    });
    let exportedPath = "";
    let revealButton: { setDisabled(value: boolean): unknown } | undefined;
    new Setting(containerEl)
      .setName("立即备份")
      .setDesc("选择保存目录后生成一个完整 ZIP 备份。")
      .addButton((button) =>
        button.setButtonText("选择目录并导出").onClick(async () => {
          try {
            const directory = await chooseBackupDirectory();
            if (!directory) return;
            button.setDisabled(true);
            backupStatus.setText("正在创建并校验一致性 ZIP 备份…");
            const result = await this.plugin.api.backup(directory);
            exportedPath = result.path;
            revealButton?.setDisabled(false);
            backupStatus.setText(`备份完成：${result.path}`);
          } catch (error) {
            backupStatus.setText(`备份失败：${message(error)}`);
          } finally {
            button.setDisabled(false);
          }
        })
      )
      .addButton((button) => {
        revealButton = button;
        button
          .setButtonText("在 Finder 中显示")
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
        "备份校验通过",
        `流水 ${rows?.transactions ?? 0} 行`,
        manifest?.created_at
          ? `创建时间 ${String(manifest.created_at)}`
          : "SQLite 数据库文件",
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
      backupStatus.setText("正在校验备份候选…");
      try {
        const result = await this.plugin.api.validateBackup(restorePath);
        restoreValidated = true;
        restoreButton?.setDisabled(false);
        backupStatus.setText(validationSummary(result));
      } catch (error) {
        backupStatus.setText(`校验失败：${message(error)}`);
      }
    };
    new Setting(containerEl)
      .setName("恢复备份")
      .setDesc("选择 AssetTrack ZIP 备份或 SQLite 数据库文件。")
      .addButton((button) =>
        button.setButtonText("选择备份文件").onClick(() =>
          void selectAndValidate(() => chooseBackupFile())
        )
      )
      .addButton((button) => {
        restoreButton = button;
        button
          .setWarning()
          .setButtonText("确认恢复")
          .setDisabled(true)
          .onClick(async () => {
          if (!restorePath || !restoreValidated) return;
          if (
            !window.confirm(
              `将恢复：\n${restorePath}\n\n恢复前会创建当前数据库一致性安全备份。继续？`
            )
          ) return;
          button.setDisabled(true);
          backupStatus.setText("正在 staging 恢复数据库…");
          try {
            await this.plugin.api.restoreBackup(restorePath);
            this.plugin.notifyDataChanged();
            restoreValidated = false;
            button.setDisabled(true);
            backupStatus.setText("恢复完成；实时分析数据已刷新。");
          } catch (error) {
            backupStatus.setText(`恢复失败：${message(error)}`);
          } finally {
            button.setDisabled(!restoreValidated);
          }
          });
      });

    containerEl.createEl("h3", { text: "现金与理财账户" });
    const accountStatus = containerEl.createEl("p", {
      text: "正在读取账户定义…",
      cls: "asset-track-settings-status"
    });
    const accountRoot = containerEl.createDiv("asset-track-settings-accounts");
    void this.renderAccounts(accountRoot, accountStatus);

  }

  private databaseStatusText(): string {
    if (this.plugin.databaseState === "ready") {
      return "数据库已就绪。输入其他目录后可迁移当前库或载入目标库。";
    }
    if (this.plugin.databaseState === "initializing") return "正在初始化数据库……";
    if (this.plugin.databaseState === "error") {
      return `数据库载入失败：${this.plugin.databaseError ?? "未知错误"}`;
    }
    return "尚未配置 Asset-track 数据目录。";
  }

  private async inspectDirectoryText(directory: string): Promise<string> {
    if (!directory.trim()) return "请输入当前 Vault 内的数据目录。";
    try {
      const result = await this.plugin.inspectDataDirectory(directory);
      if (!result.exists) return "目录中没有数据库，可以创建新数据库。";
      if (result.valid) return `发现有效的 ${DATABASE_NAME}，可以载入。`;
      return `发现数据库文件，但校验失败：${result.error ?? "未知错误"}`;
    } catch (error) {
      return message(error);
    }
  }

  private async runDatabaseAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      new Notice("数据库操作完成");
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
            .setName(`${row.account_type === "cash" ? "现金" : "理财"} · ${row.name}`)
            .setDesc(
              `${row.usage_count ?? 0} 个月有历史余额；有历史的账户只能停用。`
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
              .setButtonText((row.usage_count ?? 0) > 0 ? "停用" : "删除")
              .onClick(() => {
                if ((row.usage_count ?? 0) > 0) rows[index].is_active = false;
                else rows = rows.filter((_, item) => item !== index);
                redraw();
              })
          );
        }
        new Setting(root)
          .setName("新增账户")
          .addButton((button) =>
            button.setButtonText("新增现金账户").onClick(() => {
              rows.push(this.newAccount("cash", rows.length));
              redraw();
            })
          )
          .addButton((button) =>
            button.setButtonText("新增理财账户").onClick(() => {
              rows.push(this.newAccount("investment", rows.length));
              redraw();
            })
          )
          .addButton((button) =>
            button.setCta().setButtonText("保存账户定义").onClick(async () => {
              status.setText("正在保存账户定义…");
              try {
                await this.plugin.api.saveAccounts(data.revision, rows);
                this.plugin.notifyDataChanged();
                status.setText("账户定义已保存；新月份将带出名称并把数值归零。");
                this.display();
              } catch (error) {
                status.setText(`账户保存失败：${message(error)}`);
              }
            })
          );
      };
      redraw();
      status.setText("账户定义已加载。");
    } catch (error) {
      status.setText(`账户加载失败：${message(error)}`);
    }
  }

  private newAccount(
    accountType: "cash" | "investment",
    order: number
  ): AccountDefinition {
    return {
      account_key: `${accountType}-user-${crypto.randomUUID()}`,
      name: accountType === "cash" ? "新现金账户" : "新理财账户",
      account_type: accountType,
      is_active: true,
      sort_order: order
    };
  }
}
