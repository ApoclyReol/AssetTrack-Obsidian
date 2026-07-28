import {
  FileSystemAdapter,
  Notice,
  Plugin,
  TFolder,
  normalizePath
} from "obsidian";
import {
  VIEW_TYPE_ASSET_TRACK,
  type AnalysisMode,
  type EditorMode
} from "./constants";
import {
  AssetTrackSettingTab,
  DEFAULT_SETTINGS
} from "./settings";
import { DatabaseManager } from "./database/DatabaseManager";
import {
  type AssetTrackService
} from "./services/AssetTrackService";
import { LocalAssetTrackService } from "./services/LocalAssetTrackService";
import type {
  AssetTrackSettings,
  CsvMappingProfile
} from "./types";
import {
  databaseVaultPath,
  normalizeWorkspacePath
} from "./services/workspacePath";
import {
  AssetTrackEditorView,
  type AssetTrackViewState
} from "./views/AssetTrackEditorView";

const electronShell = require("electron").shell as {
  showItemInFolder(path: string): void;
};

export default class AssetTrackPlugin extends Plugin {
  settings: AssetTrackSettings = { ...DEFAULT_SETTINGS };
  api!: AssetTrackService;
  private databaseManager: DatabaseManager | null = null;
  private readonly dataListeners = new Set<() => void>();

  async onload(): Promise<void> {
    const stored = await this.loadData() as Partial<AssetTrackSettings> | null;
    this.settings = {
      workspacePath: normalizeWorkspacePath(
        typeof stored?.workspacePath === "string" ? stored.workspacePath : ""
      ),
      csvMappings: Array.isArray(stored?.csvMappings)
        ? stored.csvMappings
        : []
    };
    if (this.settings.workspacePath) this.createService();

    this.registerView(
      VIEW_TYPE_ASSET_TRACK,
      (leaf) => new AssetTrackEditorView(leaf, this)
    );
    this.addSettingTab(new AssetTrackSettingTab(this.app, this));
    this.addRibbonIcon("landmark", "打开 Asset Track", () => {
      void this.openEditor("analysis", undefined, "home");
    });

    this.addCommand({
      id: "open-editor",
      name: "打开编辑器",
      callback: () => void this.openEditor("analysis", undefined, "home")
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async openEditor(
    mode: EditorMode = "analysis",
    month?: string,
    analysisMode: AnalysisMode = "home"
  ): Promise<void> {
    if (!this.settings.workspacePath) {
      new Notice("请先在 Asset Track 设置中选择根目录并完成初始化");
      this.openPluginSettings();
      return;
    }
    let leaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ASSET_TRACK)
      .at(0);
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_ASSET_TRACK,
      active: true,
      state: { mode, month, analysisMode } satisfies AssetTrackViewState
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async configureWorkspacePath(value: string): Promise<void> {
    const workspacePath = normalizeWorkspacePath(value);
    if (!workspacePath) throw new Error("请选择 Asset_Track 根目录");
    const dirty = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ASSET_TRACK)
      .some((leaf) =>
        leaf.view instanceof AssetTrackEditorView
        && leaf.view.hasUnsavedChanges()
      );
    if (dirty) throw new Error("当前编辑器存在未保存草稿，不能切换数据目录");

    const previous = this.settings.workspacePath;
    await this.api?.close();
    this.databaseManager = null;
    await this.ensureVaultFolder(workspacePath);
    this.settings = {
      workspacePath,
      csvMappings: this.settings.csvMappings
    };
    await this.saveSettings();
    try {
      this.createService();
      await this.api.meta();
      this.notifyDataChanged();
    } catch (error) {
      await this.api?.close();
      this.databaseManager = null;
      this.settings = {
        workspacePath: previous,
        csvMappings: this.settings.csvMappings
      };
      await this.saveSettings();
      if (previous) this.createService();
      throw error;
    }
  }

  private filesystemAdapter(): FileSystemAdapter {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Asset Track v1.0.0 仅支持桌面文件系统 Vault");
    }
    return adapter;
  }

  private createService(): void {
    const adapter = this.filesystemAdapter();
    const workspaceRoot = adapter.getFullPath(this.settings.workspacePath);
    const databasePath = adapter.getFullPath(
      databaseVaultPath(this.settings.workspacePath)
    );
    this.databaseManager = new DatabaseManager(databasePath);
    this.api = new LocalAssetTrackService(
      this.databaseManager,
      workspaceRoot,
      this.manifest.version
    );
  }

  private async ensureVaultFolder(path: string): Promise<void> {
    let current = "";
    for (const part of normalizePath(path).split("/")) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`无法创建数据目录：${current} 已存在且不是文件夹`);
      }
    }
  }

  private openPluginSettings(): void {
    const setting = (this.app as typeof this.app & {
      setting: { open(): void; openTabById(id: string): void };
    }).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  onDataChange(listener: () => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  notifyDataChanged(): void {
    this.dataListeners.forEach((listener) => listener());
  }

  csvMapping(signature: string): CsvMappingProfile | undefined {
    return this.settings.csvMappings.find(
      (profile) => profile.header_signature === signature
    );
  }

  async saveCsvMapping(profile: CsvMappingProfile): Promise<void> {
    this.settings.csvMappings = [
      ...this.settings.csvMappings.filter(
        (item) => item.header_signature !== profile.header_signature
      ),
      profile
    ].slice(-20);
    await this.saveSettings();
  }

  async openDataDirectory(): Promise<void> {
    const status = await this.api.runtimeStatus();
    electronShell.showItemInFolder(String(status.db_path));
  }

  showPathInFinder(path: string): void {
    electronShell.showItemInFolder(path);
  }

  async copyDiagnostics(): Promise<void> {
    const [meta, runtime, exported] = await Promise.all([
      this.api.meta(),
      this.api.runtimeStatus(),
      this.api.exportDiagnostics()
    ]);
    const diagnostic = {
      plugin_version: this.manifest.version,
      service_version: meta.app_version,
      protocol_version: meta.protocol_version,
      schema_version: runtime.schema_version,
      schema_validation: exported.payload.schema,
      workspace_path: this.settings.workspacePath,
      db_path: runtime.db_path,
      source_revision: meta.source_revision,
      runtime: "typescript"
    };
    await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
  }

  async reopenDatabase(): Promise<void> {
    await this.api.reopen();
  }

  async onunload(): Promise<void> {
    await this.api?.close();
  }
}
