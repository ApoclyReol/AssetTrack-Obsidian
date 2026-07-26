import {
  AbstractInputSuggest,
  App,
  Notice,
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

export const DEFAULT_SETTINGS: AssetTrackSettings = {
  workspacePath: ""
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
            new Notice("Asset Track 数据目录已就绪");
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
    new Setting(containerEl)
      .setName("立即备份")
      .setDesc("导出 schema 8 SQLite、一致的九张 CSV 和格式 2 manifest。")
      .addButton((button) =>
        button.setButtonText("创建备份").onClick(async () => {
          button.setDisabled(true);
          backupStatus.setText("正在创建一致性备份…");
          try {
            const result = await this.plugin.api.backup();
            backupStatus.setText(`备份完成：${result.path}`);
            new Notice("Asset Track 备份已完成");
          } catch (error) {
            backupStatus.setText(`备份失败：${message(error)}`);
          } finally {
            button.setDisabled(false);
          }
        })
      );
    let restorePath = "";
    new Setting(containerEl)
      .setName("备份路径")
      .setDesc("支持格式 2 目录、ZIP 或 schema 8 SQLite。必须先验证再恢复。")
      .addText((text) =>
        text.setPlaceholder("/absolute/path/to/backup").onChange((value) => {
          restorePath = value.trim();
        })
      )
      .addButton((button) =>
        button.setButtonText("校验路径").onClick(async () => {
          button.setDisabled(true);
          backupStatus.setText("正在校验备份候选…");
          try {
            const result = await this.plugin.api.validateBackup(restorePath);
            backupStatus.setText(`校验通过：${JSON.stringify(result)}`);
          } catch (error) {
            backupStatus.setText(`校验失败：${message(error)}`);
          } finally {
            button.setDisabled(false);
          }
        })
      )
      .addButton((button) =>
        button.setWarning().setButtonText("确认恢复").onClick(async () => {
          if (!restorePath) {
            backupStatus.setText("请先填写并校验备份路径。");
            return;
          }
          try {
            await this.plugin.api.validateBackup(restorePath);
          } catch (error) {
            backupStatus.setText(`恢复前校验失败：${message(error)}`);
            return;
          }
          if (
            !window.confirm(
              `将恢复：\n${restorePath}\n\n恢复前会创建当前数据库一致性安全备份。继续？`
            )
          ) return;
          button.setDisabled(true);
          backupStatus.setText("正在 staging 恢复数据库…");
          const notice = new Notice("正在验证并恢复 Asset Track…", 0);
          try {
            await this.plugin.api.restoreBackup(restorePath);
            this.plugin.notifyDataChanged();
            backupStatus.setText("恢复完成；实时分析数据已刷新。");
            new Notice("备份恢复完成");
          } catch (error) {
            backupStatus.setText(`恢复失败：${message(error)}`);
          } finally {
            notice.hide();
            button.setDisabled(false);
          }
        })
      );

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
      .setName("sidecar 与数据")
      .addButton((button) =>
        button.setButtonText("重启 sidecar").onClick(() =>
          operation("sidecar 重启", () => this.plugin.restartSidecar())
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
