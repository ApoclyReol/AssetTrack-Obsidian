import {
  FileSystemAdapter,
  Plugin
} from "obsidian";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  VIEW_TYPE_ASSET_TRACK,
  type AnalysisMode,
  type EditorMode
} from "./constants";
import {
  AssetTrackSettingTab,
  DEFAULT_SETTINGS
} from "./settings";
import {
  DatabaseManager,
  type DatabaseInspection
} from "./database/DatabaseManager";
import {
  type AssetTrackService
} from "./services/AssetTrackService";
import { LocalAssetTrackService } from "./services/LocalAssetTrackService";
import type {
  AssetTrackSettings,
  CsvMappingProfile
} from "./types";
import {
  assertPathInsideVault,
  databaseVaultPath,
  backupsVaultPath,
  normalizeDataDirectory
} from "./services/workspacePath";
import { parseAssetTrackSettings } from "./services/settingsValidation";
import { loadElectronModule } from "./services/desktopRuntime";
import {
  AssetTrackEditorView,
  type AssetTrackViewState
} from "./views/AssetTrackEditorView";
import { t } from "./i18n";

const electronShell = loadElectronModule().shell;

export type DatabaseState = "unconfigured" | "initializing" | "ready" | "error";
export type DirectorySwitchMode = "migrate" | "load";

interface ServiceContext {
  manager: DatabaseManager;
  api: AssetTrackService;
}

export default class AssetTrackPlugin extends Plugin {
  settings: AssetTrackSettings = { ...DEFAULT_SETTINGS, csvMappings: [] };
  api!: AssetTrackService;
  databaseState: DatabaseState = "unconfigured";
  databaseError: string | null = null;
  settingsIssues: string[] = [];
  private databaseManager: DatabaseManager | null = null;
  private readonly dataListeners = new Set<() => void>();

  async onload(): Promise<void> {
    const parsed = parseAssetTrackSettings(await this.loadData());
    this.settings = parsed.settings;
    this.settingsIssues = parsed.issues;
    this.registerView(
      VIEW_TYPE_ASSET_TRACK,
      (leaf) => new AssetTrackEditorView(leaf, this)
    );
    this.addSettingTab(new AssetTrackSettingTab(this.app, this));
    this.addRibbonIcon("landmark", t("打开资产追踪", "Open Asset Track"), () => {
      void this.openEditor("analysis", undefined, "home");
    });

    this.addCommand({
      id: "open-editor",
      name: t("打开编辑器", "Open editor"),
      callback: () => void this.openEditor("analysis", undefined, "home")
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.settingsIssues = [];
  }

  async openEditor(
    mode: EditorMode = "analysis",
    month?: string,
    analysisMode: AnalysisMode = "home"
  ): Promise<void> {
    let leaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ASSET_TRACK)
      .at(0);
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_ASSET_TRACK,
      active: true,
      state: { mode, month, analysisMode } satisfies AssetTrackViewState
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  isDatabaseReady(): boolean {
    return this.databaseState === "ready" && Boolean(this.databaseManager);
  }

  async inspectDataDirectory(value: string): Promise<DatabaseInspection> {
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) {
      throw new Error(t("请选择 Asset-track 数据目录", "Select an Asset Track data directory."));
    }
    return DatabaseManager.inspect(this.fullDatabasePath(dataDirectory));
  }

  async prepareDatabaseOnViewOpen(): Promise<void> {
    if (
      !this.isDatabaseReady()
      && this.databaseState !== "initializing"
      && this.settings.dataDirectory
    ) {
      await this.loadDatabase(this.settings.dataDirectory).catch((error) => {
        this.databaseState = "error";
        this.databaseError = error instanceof Error ? error.message : String(error);
        void this.refreshViews();
      });
    }
  }

  async createDatabase(value: string): Promise<void> {
    if (this.isDatabaseReady()) {
      throw new Error(t(
        "数据库已在运行；请使用迁移当前库或载入目标库",
        "A database is already open. Migrate the current database or load the target database."
      ));
    }
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) throw new Error(t(
      "请选择 Asset-track 数据目录",
      "Select an Asset Track data directory."
    ));
    const inspection = await this.inspectDataDirectory(dataDirectory);
    if (inspection.exists) {
      throw new Error(t(
        "所选目录已有 accounting_system.db，请使用载入数据库",
        "The selected directory already contains accounting_system.db. Use Load database."
      ));
    }
    await this.activateInitialDatabase(dataDirectory, true);
  }

  async loadDatabase(value: string): Promise<void> {
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) throw new Error(t(
      "请选择 Asset-track 数据目录",
      "Select an Asset Track data directory."
    ));
    if (this.isDatabaseReady()) {
      if (dataDirectory === this.settings.dataDirectory) return;
      throw new Error(t(
        "数据库已在运行；请使用迁移当前库或载入目标库",
        "A database is already open. Migrate the current database or load the target database."
      ));
    }
    const inspection = await this.inspectDataDirectory(dataDirectory);
    if (!inspection.exists || !inspection.valid) {
      const error = inspection.error ?? t(
        "所选目录没有 accounting_system.db",
        "The selected directory does not contain accounting_system.db."
      );
      this.databaseState = "error";
      this.databaseError = error;
      await this.refreshViews();
      throw new Error(error);
    }
    await this.activateInitialDatabase(dataDirectory, false);
  }

  async switchDataDirectory(
    value: string,
    mode: DirectorySwitchMode
  ): Promise<void> {
    const currentManager = this.databaseManager;
    if (!currentManager || !this.isDatabaseReady()) {
      throw new Error(t("当前数据库尚未就绪", "The current database is not ready."));
    }
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) throw new Error(t(
      "请选择 Asset-track 数据目录",
      "Select an Asset Track data directory."
    ));
    if (dataDirectory === this.settings.dataDirectory) {
      throw new Error(t(
        "所选目录就是当前数据目录",
        "The selected directory is already in use."
      ));
    }
    const dirty = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ASSET_TRACK)
      .some((leaf) =>
        leaf.view instanceof AssetTrackEditorView
        && leaf.view.hasUnsavedChanges()
      );
    if (dirty) throw new Error(t(
      "当前编辑器存在未保存草稿，不能切换数据目录",
      "The editor has unsaved changes, so the data directory cannot be switched."
    ));

    const inspection = await this.inspectDataDirectory(dataDirectory);
    if (mode === "migrate" && inspection.exists) {
      throw new Error(t(
        "目标目录已有 accounting_system.db，迁移不会覆盖",
        "The target directory already contains accounting_system.db. Migration will not overwrite it."
      ));
    }
    if (mode === "load" && (!inspection.exists || !inspection.valid)) {
      throw new Error(inspection.error ?? t(
        "目标目录没有可载入的数据库",
        "The target directory does not contain a database that can be loaded."
      ));
    }
    await this.createProtectionBackup("before-switch");
    const targetPath = this.fullDatabasePath(dataDirectory);
    if (mode === "migrate") {
      mkdirSync(dirname(targetPath), { recursive: true });
      await currentManager.snapshot(targetPath);
      const copied = DatabaseManager.inspect(targetPath);
      if (!copied.valid) throw new Error(copied.error ?? t(
        "迁移数据库校验失败",
        "Migrated database validation failed."
      ));
    }
    const next = this.buildService(dataDirectory);
    try {
      await next.api.meta();
      await this.saveData({
        dataDirectory,
        csvMappings: this.settings.csvMappings
      });
    } catch (error) {
      await next.api.close();
      throw error;
    }
    const previousApi = this.api;
    this.databaseManager = next.manager;
    this.api = next.api;
    this.settings.dataDirectory = dataDirectory;
    this.databaseState = "ready";
    this.databaseError = null;
    await previousApi.close();
    this.notifyDataChanged();
    await this.refreshViews();
  }

  private filesystemAdapter(): FileSystemAdapter {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error(t(
        "Asset Track 仅支持桌面文件系统 Vault",
        "Asset Track supports desktop filesystem vaults only."
      ));
    }
    return adapter;
  }

  private buildService(dataDirectory: string): ServiceContext {
    const adapter = this.filesystemAdapter();
    const workspaceRoot = adapter.getFullPath(dataDirectory);
    assertPathInsideVault(adapter.getBasePath(), workspaceRoot);
    const manager = new DatabaseManager(this.fullDatabasePath(dataDirectory));
    return {
      manager,
      api: new LocalAssetTrackService(
        manager,
        workspaceRoot,
        this.manifest.version,
        this.settings
      )
    };
  }

  private async activateInitialDatabase(
    dataDirectory: string,
    createIfMissing: boolean
  ): Promise<void> {
    this.databaseState = "initializing";
    this.databaseError = null;
    await this.refreshViews();
    let next: ServiceContext | null = null;
    try {
      const inspection = await this.inspectDataDirectory(dataDirectory);
      if (!createIfMissing && (!inspection.exists || !inspection.valid)) {
        throw new Error(inspection.error ?? t(
          "所选目录没有有效数据库",
          "The selected directory does not contain a valid database."
        ));
      }
      next = this.buildService(dataDirectory);
      await next.api.meta();
      await this.saveData({
        dataDirectory,
        csvMappings: this.settings.csvMappings
      });
      this.databaseManager = next.manager;
      this.api = next.api;
      this.settings.dataDirectory = dataDirectory;
      this.databaseState = "ready";
      await this.refreshViews();
    } catch (error) {
      if (next) await next.api.close();
      this.databaseState = "error";
      this.databaseError = error instanceof Error ? error.message : String(error);
      await this.refreshViews();
      throw error;
    }
  }

  private fullDatabasePath(dataDirectory: string): string {
    const adapter = this.filesystemAdapter();
    const databasePath = adapter.getFullPath(databaseVaultPath(dataDirectory));
    assertPathInsideVault(adapter.getBasePath(), databasePath);
    return databasePath;
  }

  private async createProtectionBackup(prefix: string): Promise<string> {
    if (!this.databaseManager) throw new Error(t(
      "数据库尚未就绪",
      "The database is not ready."
    ));
    const adapter = this.filesystemAdapter();
    const directory = adapter.getFullPath(
      backupsVaultPath(this.settings.dataDirectory)
    );
    const target = join(
      directory,
      `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite3`
    );
    await this.databaseManager.snapshot(target);
    const validation = DatabaseManager.inspect(target);
    if (!validation.valid) throw new Error(validation.error ?? t(
      "保护备份校验失败",
      "Protection backup validation failed."
    ));
    return target;
  }

  async refreshViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSET_TRACK)) {
      if (leaf.view instanceof AssetTrackEditorView) leaf.view.refresh();
    }
  }

  openPluginSettings(): void {
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
    if (!this.settings.dataDirectory) throw new Error(t(
      "尚未选择数据目录",
      "No data directory has been selected."
    ));
    electronShell.showItemInFolder(
      this.filesystemAdapter().getFullPath(this.settings.dataDirectory)
    );
  }

  showPathInFinder(path: string): void {
    electronShell.showItemInFolder(path);
  }

  async reopenDatabase(): Promise<void> {
    await this.api.reopen();
  }

  onunload(): void {
    if (this.isDatabaseReady()) void this.api.close();
  }
}
