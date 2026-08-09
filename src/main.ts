import {
  FileSystemAdapter,
  Plugin
} from "obsidian";
import { existsSync, mkdirSync } from "node:fs";
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
  AssetTrackSettings
} from "./types/settings";
import type {
  CsvMappingProfile
} from "./types/csv";
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
import { AssetTrackError } from "./application/errors";
import { t } from "./i18n";
import {
  DRAFT_RECOVERY_EPHEMERAL_KEY,
  DraftRecoveryStore,
  type EditorDraftSnapshot
} from "./ui/editorDraft";

const electronShell = loadElectronModule().shell;

export type DatabaseState = "unconfigured" | "initializing" | "ready" | "error";
export type DirectorySwitchMode = "migrate" | "load";

function canLoadDatabase(inspection: DatabaseInspection): boolean {
  return inspection.valid
    || inspection.migration_required === true
    || inspection.recovery_available === true;
}

interface ServiceContext {
  manager: DatabaseManager;
  api: AssetTrackService;
}

export default class AssetTrackPlugin extends Plugin {
  settings: AssetTrackSettings = { ...DEFAULT_SETTINGS, csvMappings: [] };
  api!: AssetTrackService;
  databaseState: DatabaseState = "unconfigured";
  databaseError: unknown = null;
  settingsIssues: string[] = [];
  private databaseManager: DatabaseManager | null = null;
  private readonly dataListeners = new Set<() => void>();
  private readonly draftRecoveries = new DraftRecoveryStore();

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
      void this.openEditor("analysis", undefined, "annual");
    });

    this.addCommand({
      id: "open-editor",
      name: t("打开编辑器", "Open editor"),
      callback: () => void this.openEditor("analysis", undefined, "annual")
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.settingsIssues = [];
  }

  async openEditor(
    mode: EditorMode = "analysis",
    month?: string,
    analysisMode: AnalysisMode = "annual"
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

  async reopenEditorWithDraft(
    state: AssetTrackViewState,
    snapshot: EditorDraftSnapshot
  ): Promise<void> {
    const token = this.draftRecoveries.store(snapshot);
    const leaf = this.app.workspace.getLeaf("tab");
    try {
      await leaf.setViewState({
        type: VIEW_TYPE_ASSET_TRACK,
        active: true,
        state
      });
      leaf.setEphemeralState({
        [DRAFT_RECOVERY_EPHEMERAL_KEY]: token
      });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      this.draftRecoveries.delete(token);
      throw error;
    }
  }

  takeDraftRecovery(token: string): EditorDraftSnapshot | undefined {
    return this.draftRecoveries.take(token);
  }

  isDatabaseReady(): boolean {
    return this.databaseState === "ready" && Boolean(this.databaseManager);
  }

  hasUnsavedEditorChanges(): boolean {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ASSET_TRACK)
      .some((leaf) =>
        leaf.view instanceof AssetTrackEditorView
        && leaf.view.hasUnsavedChanges()
      );
  }

  async inspectDataDirectory(value: string): Promise<DatabaseInspection> {
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) {
      throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
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
        this.databaseError = error;
        void this.refreshViews();
      });
    }
  }

  async createDatabase(value: string): Promise<void> {
    if (this.isDatabaseReady()) {
      throw new AssetTrackError({ code: "database.already_open", status: 409 });
    }
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
    const inspection = await this.inspectDataDirectory(dataDirectory);
    if (inspection.exists || inspection.recovery_available) {
      throw new AssetTrackError({ code: "database.file_exists_use_load", status: 409 });
    }
    await this.activateInitialDatabase(dataDirectory, true);
  }

  async loadDatabase(value: string): Promise<void> {
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
    if (this.isDatabaseReady()) {
      if (dataDirectory === this.settings.dataDirectory) return;
      throw new AssetTrackError({ code: "database.already_open", status: 409 });
    }
    const inspection = await this.inspectDataDirectory(dataDirectory);
    if (!canLoadDatabase(inspection)) {
      const error = inspection.exists || inspection.recovery_available
        ? new AssetTrackError({
            code: "database.invalid_database",
            status: 422,
            params: { details: inspection.error ?? "" }
          })
        : new AssetTrackError({ code: "database.file_missing", status: 404 });
      this.databaseState = "error";
      this.databaseError = error;
      await this.refreshViews();
      throw error;
    }
    await this.activateInitialDatabase(dataDirectory, false);
  }

  async switchDataDirectory(
    value: string,
    mode: DirectorySwitchMode
  ): Promise<void> {
    const currentManager = this.databaseManager;
    if (!currentManager || !this.isDatabaseReady()) {
      throw new AssetTrackError({ code: "database.not_ready", status: 409 });
    }
    const dataDirectory = normalizeDataDirectory(value);
    if (!dataDirectory) throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
    if (dataDirectory === this.settings.dataDirectory) {
      throw new AssetTrackError({ code: "database.directory_in_use", status: 409 });
    }
    if (this.hasUnsavedEditorChanges()) {
      throw new AssetTrackError({ code: "database.unsaved_changes", status: 409 });
    }

    const inspection = await this.inspectDataDirectory(dataDirectory);
    if (mode === "migrate" && inspection.exists) {
      throw new AssetTrackError({ code: "database.migration_target_exists", status: 409 });
    }
    if (mode === "load" && !canLoadDatabase(inspection)) {
      throw inspection.exists || inspection.recovery_available
        ? new AssetTrackError({
            code: "database.invalid_database",
            status: 422,
            params: { details: inspection.error ?? "" }
          })
        : new AssetTrackError({ code: "database.file_missing", status: 404 });
    }
    await this.createProtectionBackup("before-switch");
    const targetPath = this.fullDatabasePath(dataDirectory);
    if (mode === "migrate") {
      mkdirSync(dirname(targetPath), { recursive: true });
      await currentManager.snapshot(targetPath);
      const copied = DatabaseManager.inspect(targetPath);
      if (!copied.valid) {
        throw new AssetTrackError({
          code: "database.migration_validation_failed",
          status: 422,
          params: { details: copied.error ?? "" }
        });
      }
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
      throw new AssetTrackError({ code: "filesystem.desktop_vault_required", status: 422 });
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
      if (!createIfMissing && !canLoadDatabase(inspection)) {
        throw inspection.exists || inspection.recovery_available
          ? new AssetTrackError({
              code: "database.invalid_database",
              status: 422,
              params: { details: inspection.error ?? "" }
            })
          : new AssetTrackError({ code: "database.file_missing", status: 404 });
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
      this.databaseError = error;
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
    if (!this.databaseManager) throw new AssetTrackError({ code: "database.not_ready", status: 409 });
    const adapter = this.filesystemAdapter();
    const directory = adapter.getFullPath(
      backupsVaultPath(this.settings.dataDirectory)
    );
    const base = join(
      directory,
      `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite3`
    );
    let target = base;
    let sequence = 1;
    while (existsSync(target)) {
      target = `${base}-${sequence}`;
      sequence += 1;
    }
    await this.databaseManager.snapshot(target);
    const validation = DatabaseManager.inspect(target);
    if (!validation.valid) {
      throw new AssetTrackError({
        code: "database.protection_backup_invalid",
        status: 422,
        params: { details: validation.error ?? "" }
      });
    }
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
    if (!this.settings.dataDirectory) throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
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
    this.draftRecoveries.clear();
    if (this.isDatabaseReady()) void this.api.close();
  }
}
