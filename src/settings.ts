import {
  AbstractInputSuggest,
  App,
  PluginSettingTab,
  Setting,
  TFolder
} from "obsidian";
import {
  DEFAULT_DB_RELATIVE_PATH,
  RECOMMENDED_WORKSPACE
} from "./constants";
import type AssetTrackPlugin from "./main";
import type { AccountDefinition, AssetTrackSettings } from "./types";
import {
  databaseVaultPath,
  normalizeWorkspacePath
} from "./services/workspacePath";
import {
  chooseBackupDirectory,
  chooseBackupFile
} from "./services/nativeDialogs";

export const DEFAULT_SETTINGS: AssetTrackSettings = {
  workspacePath: "",
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
      normalized = normalizeWorkspacePath(query);
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
      text: value.exists ? "Vault 内现有文件夹" : "初始化时新建此文件夹"
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
    containerEl.createEl("h2", { text: "Asset Track" });
    containerEl.createEl("p", {
      text:
        "SQLite 是唯一事实源。数据库若位于同步目录，请勿在多台设备并发写入。",
      cls: "asset-track-settings-warning"
    });

    let selectedPath = this.plugin.settings.workspacePath;
    const pathStatus = containerEl.createEl("p", {
      text: selectedPath
        ? `当前数据库：${databaseVaultPath(selectedPath)}`
        : "尚未初始化。选择或输入 Vault 内文件夹后，点击“使用并初始化”。",
      cls: "asset-track-settings-status"
    });
    const rootSetting = new Setting(containerEl)
      .setName("Asset_Track 根目录")
      .setDesc(
        `支持 Vault 文件夹联想；数据库固定为根目录下的 ${DEFAULT_DB_RELATIVE_PATH}。`
      );
    let initializeButton: { setDisabled(value: boolean): unknown } | undefined;
    rootSetting.addSearch((search) => {
      search
        .setPlaceholder(RECOMMENDED_WORKSPACE)
        .setValue(selectedPath)
        .onChange((value) => {
          selectedPath = value;
          initializeButton?.setDisabled(!value.trim());
        });
      new VaultFolderSuggest(this.app, search.inputEl, (path) => {
        selectedPath = path;
        initializeButton?.setDisabled(false);
      });
    });
    rootSetting.addButton((button) => {
      initializeButton = button;
      button
        .setCta()
        .setButtonText(selectedPath ? "切换并验证" : "使用并初始化")
        .setDisabled(!selectedPath)
        .onClick(async () => {
          button.setDisabled(true);
          pathStatus.setText("正在验证目录并初始化数据库…");
          try {
            await this.plugin.configureWorkspacePath(selectedPath);
            this.display();
          } catch (error) {
            pathStatus.setText(`初始化失败：${message(error)}`);
            button.setDisabled(false);
          }
        });
    });
    if (!this.plugin.settings.workspacePath) {
      containerEl.createEl("p", {
        text: "完成初始化后才能进入编辑器、管理账户或执行备份恢复。",
        cls: "asset-track-settings-warning"
      });
      return;
    }

    containerEl.createEl("h3", { text: "现金与理财账户" });
    const accountStatus = containerEl.createEl("p", {
      text: "正在读取账户定义…",
      cls: "asset-track-settings-status"
    });
    const accountRoot = containerEl.createDiv("asset-track-settings-accounts");
    void this.renderAccounts(accountRoot, accountStatus);

    containerEl.createEl("h3", { text: "备份与恢复" });
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

    containerEl.createEl("h3", { text: "运行与诊断" });
    const toolsStatus = containerEl.createEl("p", {
      text: "尚未执行操作。",
      cls: "asset-track-settings-status"
    });
    const operation = async (
      label: string,
      action: () => Promise<void>
    ): Promise<void> => {
      toolsStatus.setText(`${label}中…`);
      try {
        await action();
        toolsStatus.setText(`${label}完成。`);
      } catch (error) {
        toolsStatus.setText(`${label}失败：${message(error)}`);
      }
    };
    new Setting(containerEl)
      .setName("数据库与诊断")
      .addButton((button) =>
        button.setButtonText("重新打开数据库连接").onClick(() =>
          operation("数据库重新打开", () => this.plugin.reopenDatabase())
        )
      )
      .addButton((button) =>
        button.setButtonText("打开数据目录").onClick(() =>
          operation("打开数据目录", () => this.plugin.openDataDirectory())
        )
      )
      .addButton((button) =>
        button.setButtonText("复制诊断").onClick(() =>
          operation("复制诊断", () => this.plugin.copyDiagnostics())
        )
      );
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
