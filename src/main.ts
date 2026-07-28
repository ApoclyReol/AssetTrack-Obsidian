import { Notice, Plugin, TFolder, normalizePath } from "obsidian";
import {
  VIEW_TYPE_ASSET_TRACK,
  type AnalysisMode,
  type EditorMode
} from "./constants";
import {
  AssetTrackSettingTab,
  DEFAULT_SETTINGS
} from "./settings";
import { AssetTrackApi } from "./services/AssetTrackApi";
import { SidecarManager } from "./services/SidecarManager";
import type {
  AssetTrackSettings,
  CsvMappingProfile
} from "./types";
import { normalizeWorkspacePath } from "./services/workspacePath";
import {
  AssetTrackEditorView,
  type AssetTrackViewState
} from "./views/AssetTrackEditorView";

const electronShell = require("electron").shell as {
  showItemInFolder(path: string): void;
};

export default class AssetTrackPlugin extends Plugin {
  settings: AssetTrackSettings = { ...DEFAULT_SETTINGS };
  sidecar!: SidecarManager;
  api!: AssetTrackApi;
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
    this.sidecar = new SidecarManager(this, () => this.settings);
    this.api = new AssetTrackApi(this.sidecar);

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
    await this.sidecar.stop();
    await this.ensureVaultFolder(workspacePath);
    this.settings = {
      workspacePath,
      csvMappings: this.settings.csvMappings
    };
    await this.saveSettings();
    try {
      await this.sidecar.ensureReady();
      this.notifyDataChanged();
    } catch (error) {
      await this.sidecar.stop();
      this.settings = {
        workspacePath: previous,
        csvMappings: this.settings.csvMappings
      };
      await this.saveSettings();
      throw error;
    }
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
    await this.sidecar.ensureReady();
    const status = await this.api.runtimeStatus();
    electronShell.showItemInFolder(String(status.db_path));
  }

  showPathInFinder(path: string): void {
    electronShell.showItemInFolder(path);
  }

  async copyDiagnostics(): Promise<void> {
    await this.sidecar.ensureReady();
    const [meta, runtime, exported] = await Promise.all([
      this.api.meta(),
      this.api.runtimeStatus(),
      this.api.exportDiagnostics()
    ]);
    const diagnostic = {
      plugin_version: this.manifest.version,
      backend_version: meta.app_version,
      protocol_version: meta.protocol_version,
      schema_version: runtime.schema_version,
      schema_validation: exported.payload.schema,
      workspace_path: this.settings.workspacePath,
      db_path: runtime.db_path,
      source_revision: meta.source_revision,
      sidecar: this.sidecar.getStatus()
    };
    await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
  }

  async restartSidecar(): Promise<void> {
    await this.sidecar.restart();
  }

  async onunload(): Promise<void> {
    await this.sidecar.stop();
  }
}
