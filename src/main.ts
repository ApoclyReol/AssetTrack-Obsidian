import {
  FileSystemAdapter,
  Platform,
  Plugin
} from "obsidian";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync
} from "node:fs";
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
  AnalysisRuntimeSettings,
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

function desktopShell(): ReturnType<typeof loadElectronModule>["shell"] {
  if (!Platform.isDesktop) {
    throw new AssetTrackError({
      code: "filesystem.desktop_vault_required",
      status: 422
    });
  }
  return loadElectronModule().shell;
}

function cloneSettings(settings: AssetTrackSettings): AssetTrackSettings {
  return {
    ...settings,
    csvMappings: settings.csvMappings.map((profile) => ({
      ...profile,
      mapping: {
        ...profile.mapping,
        type_values: { ...profile.mapping.type_values },
        included_statuses: [...profile.mapping.included_statuses]
      }
    }))
  };
}

function restoreSettings(
  target: AssetTrackSettings,
  snapshot: AssetTrackSettings
): void {
  Object.assign(target, snapshot);
}

export type DatabaseState = "unconfigured" | "initializing" | "ready" | "error";
export type DirectorySwitchMode = "migrate" | "load";
export type LegacyAttributeMigrationChoice = "preserve" | "clear";

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
  private settingsWriteTail: Promise<void> = Promise.resolve();
  private databaseOperationTail: Promise<unknown> = Promise.resolve();
  private viewOpenDatabaseInitialization: Promise<void> | null = null;

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

  private enqueueSettingsWrite(operation: () => Promise<void>): Promise<void> {
    const previous = this.settingsWriteTail ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.settingsWriteTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private enqueueDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.databaseOperationTail ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.databaseOperationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private async persistSettingsSnapshot(): Promise<void> {
    await this.saveData(cloneSettings(this.settings));
    this.settingsIssues = [];
  }

  async saveSettings(): Promise<void> {
    await this.enqueueSettingsWrite(() => this.persistSettingsSnapshot());
  }

  async updateSettings(
    update: (settings: AssetTrackSettings) => void
  ): Promise<void> {
    await this.enqueueSettingsWrite(async () => {
      const previous = cloneSettings(this.settings);
      try {
        update(this.settings);
        await this.persistSettingsSnapshot();
      } catch (error) {
        restoreSettings(this.settings, previous);
        throw error;
      }
    });
  }

  private async persistDataDirectorySettings(dataDirectory: string): Promise<void> {
    await this.updateSettings((settings) => {
      settings.dataDirectory = dataDirectory;
    });
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
    if (this.isDatabaseReady() || !this.settings.dataDirectory) return;
    if (!this.viewOpenDatabaseInitialization) {
      if (this.databaseState === "initializing") return;
      const dataDirectory = this.settings.dataDirectory;
      const inspectBeforeOpen = async (): Promise<void> => {
        // View opening is automatic, so a legacy file must stop here and let
        // the settings page show its read-only impact summary and choice.
        // The app guard keeps lightweight test doubles on the old loader path.
        if (this.app && typeof this.inspectDataDirectory === "function") {
          const inspection = await this.inspectDataDirectory(dataDirectory);
          if (inspection.migration_required) {
            this.databaseState = "error";
            this.databaseError = new AssetTrackError({
              code: "database.migration_confirmation_required",
              status: 409,
              params: { ...(inspection.migration_impact ?? {}) }
            });
            await this.refreshViews();
            return;
          }
        }
        await this.loadDatabase(dataDirectory);
      };
      this.viewOpenDatabaseInitialization = inspectBeforeOpen()
        .catch((error) => {
          this.databaseState = "error";
          this.databaseError = error;
          void this.refreshViews();
        })
        .finally(() => {
          this.viewOpenDatabaseInitialization = null;
        });
    }
    await this.viewOpenDatabaseInitialization;
  }

  async createDatabase(value: string): Promise<void> {
    return this.enqueueDatabaseOperation(() => this.createDatabaseUnlocked(value));
  }

  private async createDatabaseUnlocked(value: string): Promise<void> {
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

  async loadDatabase(
    value: string,
    migrationChoice: LegacyAttributeMigrationChoice = "preserve"
  ): Promise<void> {
    return this.enqueueDatabaseOperation(() => this.loadDatabaseUnlocked(value, migrationChoice));
  }

  private async loadDatabaseUnlocked(
    value: string,
    migrationChoice: LegacyAttributeMigrationChoice = "preserve"
  ): Promise<void> {
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
    await this.activateInitialDatabase(dataDirectory, false, {
      preserveLegacyAttributes: migrationChoice === "preserve"
    });
  }

  async switchDataDirectory(
    value: string,
    mode: DirectorySwitchMode,
    migrationChoice: LegacyAttributeMigrationChoice = "preserve"
  ): Promise<void> {
    return this.enqueueDatabaseOperation(() => this.switchDataDirectoryUnlocked(value, mode, migrationChoice));
  }

  async backup(directory?: string): ReturnType<AssetTrackService["backup"]> {
    return this.enqueueDatabaseOperation(() => {
      if (!this.isDatabaseReady()) {
        return Promise.reject(new AssetTrackError({ code: "database.not_ready", status: 409 }));
      }
      return this.api.backup(directory);
    });
  }

  async validateBackup(path: string): ReturnType<AssetTrackService["validateBackup"]> {
    return this.enqueueDatabaseOperation(() => {
      if (!this.isDatabaseReady()) {
        return Promise.reject(new AssetTrackError({ code: "database.not_ready", status: 409 }));
      }
      return this.api.validateBackup(path);
    });
  }

  async restoreBackup(
    path: string,
    beforeCommit?: () => void
  ): ReturnType<AssetTrackService["restoreBackup"]> {
    return this.enqueueDatabaseOperation(() => {
      if (!this.isDatabaseReady()) {
        return Promise.reject(new AssetTrackError({ code: "database.not_ready", status: 409 }));
      }
      return this.api.restoreBackup(path, beforeCommit);
    });
  }

  private async switchDataDirectoryUnlocked(
    value: string,
    mode: DirectorySwitchMode,
    migrationChoice: LegacyAttributeMigrationChoice = "preserve"
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
    if (mode === "migrate" && (inspection.exists || inspection.recovery_available)) {
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
    const controlManager = currentManager as unknown as {
      withExclusiveControl?: <T>(operation: () => Promise<T>) => Promise<T>;
      snapshotWithinControlLock?: (targetPath: string) => Promise<void>;
    };
    const hasControlLock = Boolean(
      controlManager.withExclusiveControl && controlManager.snapshotWithinControlLock
    );
    const runExclusive = controlManager.withExclusiveControl
      ? (operation: () => Promise<void>) => controlManager.withExclusiveControl!(operation)
      : (operation: () => Promise<void>) => operation();
    await runExclusive(async () => {
      await this.createProtectionBackup("before-switch", currentManager, hasControlLock);
      const targetPath = this.fullDatabasePath(dataDirectory);
      if (mode === "migrate") {
        mkdirSync(dirname(targetPath), { recursive: true });
        const incomingPath = `${targetPath}.incoming`;
        let incomingCreated = true;
        try {
          if (hasControlLock) await controlManager.snapshotWithinControlLock!(incomingPath);
          else await currentManager.snapshot(incomingPath);
          const copied = DatabaseManager.inspect(incomingPath);
          if (!copied.valid) {
            throw new AssetTrackError({
              code: "database.migration_validation_failed",
              status: 422,
              params: { details: copied.error ?? "" }
            });
          }
          if (existsSync(targetPath)) {
            throw new AssetTrackError({
              code: "database.migration_target_exists",
              status: 409
            });
          }
          renameSync(incomingPath, targetPath);
          incomingCreated = false;
        } finally {
          if (incomingCreated) rmSync(incomingPath, { force: true });
        }
      }
      const next = this.buildService(dataDirectory, {
        preserveLegacyAttributes: migrationChoice === "preserve"
      });
      try {
        await next.api.meta();
        await this.persistDataDirectorySettings(dataDirectory);
        // Keep the old manager quiescent until the replacement has opened and
        // its settings are durable. Publishing the new API after this close
        // prevents a stale service from committing after the switch.
        if (typeof currentManager.close === "function") currentManager.close();
        this.databaseManager = next.manager;
        this.api = next.api;
        this.databaseState = "ready";
        this.databaseError = null;
      } catch (error) {
        await next.api.close();
        throw error;
      }
    });
    this.notifyDataChanged();
    await this.refreshViews();
  }

  private filesystemAdapter(): FileSystemAdapter {
    if (!Platform.isDesktop) {
      throw new AssetTrackError({
        code: "filesystem.desktop_vault_required",
        status: 422
      });
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new AssetTrackError({ code: "filesystem.desktop_vault_required", status: 422 });
    }
    return adapter;
  }

  private buildService(
    dataDirectory: string,
    migrationOptions: { preserveLegacyAttributes?: boolean } = {}
  ): ServiceContext {
    const adapter = this.filesystemAdapter();
    const workspaceRoot = adapter.getFullPath(dataDirectory);
    assertPathInsideVault(adapter.getBasePath(), workspaceRoot);
    const manager = new DatabaseManager(this.fullDatabasePath(dataDirectory));
    manager.setMigrationOptions(migrationOptions);
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
    createIfMissing: boolean,
    migrationOptions: { preserveLegacyAttributes?: boolean } = {}
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
      next = this.buildService(dataDirectory, migrationOptions);
      await next.api.meta();
      await this.persistDataDirectorySettings(dataDirectory);
      this.databaseManager = next.manager;
      this.api = next.api;
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

  private async createProtectionBackup(
    prefix: string,
    manager?: DatabaseManager,
    controlLockHeld = false
  ): Promise<string> {
    const activeManager = manager ?? this.databaseManager;
    if (!activeManager) throw new AssetTrackError({ code: "database.not_ready", status: 409 });
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
    if (controlLockHeld) await activeManager.snapshotWithinControlLock(target);
    else await activeManager.snapshot(target);
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

  updateRuntimeSettings(): void {
    if (!this.isDatabaseReady()) return;
    const settings: AnalysisRuntimeSettings = {
      reconciliationTolerance: this.settings.reconciliationTolerance
    };
    this.api.updateRuntimeSettings(settings);
    this.notifyDataChanged();
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
    await this.updateSettings((settings) => {
      settings.csvMappings = [
        ...settings.csvMappings.filter(
          (item) => item.header_signature !== profile.header_signature
        ),
        profile
      ].slice(-20);
    });
  }

  async clearCsvMapping(signature: string): Promise<void> {
    await this.updateSettings((settings) => {
      settings.csvMappings = settings.csvMappings.filter(
        (profile) => profile.header_signature !== signature
      );
    });
  }

  async openDataDirectory(): Promise<void> {
    if (!this.settings.dataDirectory) throw new AssetTrackError({ code: "workspace.data_directory_required", status: 422 });
    desktopShell().showItemInFolder(
      this.filesystemAdapter().getFullPath(this.settings.dataDirectory)
    );
  }

  showPathInFinder(path: string): void {
    desktopShell().showItemInFolder(path);
  }

  async reopenDatabase(): Promise<void> {
    await this.enqueueDatabaseOperation(async () => {
      if (!this.isDatabaseReady()) {
        throw new AssetTrackError({ code: "database.not_ready", status: 409 });
      }
      await this.api.reopen();
    });
  }

  onunload(): void {
    this.draftRecoveries.clear();
    if (this.isDatabaseReady()) void this.api.close();
  }
}
