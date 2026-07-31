import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import {
  ANALYSIS_MODES,
  EDITOR_MODES,
  VIEW_TYPE_ASSET_TRACK,
  type AnalysisMode,
  type EditorMode
} from "../constants";
import { AssetTrackEditorApp } from "../ui/AssetTrackEditorApp";
import type AssetTrackPlugin from "../main";
import type { CsvColumnMapping } from "../types";
import { confirmAction } from "../ui/ConfirmModal";
import { displayError, t } from "../i18n";
import { AssetTrackErrorBoundary } from "../ui/AssetTrackErrorBoundary";

export interface AssetTrackViewState extends Record<string, unknown> {
  mode?: EditorMode;
  analysisMode?: AnalysisMode;
  month?: string;
}

export class AssetTrackEditorView extends ItemView {
  private root: Root | null = null;
  private state: AssetTrackViewState = {
    mode: "analysis",
    analysisMode: "home"
  };
  private dirty = false;
  private readonly onDirtyChange = (dirty: boolean): void => {
    this.dirty = dirty;
  };
  private readonly onStateChange = (
    mode: EditorMode,
    analysisMode: AnalysisMode,
    month: string
  ): void => {
    this.state = { mode, analysisMode, month };
    void this.app.workspace.requestSaveLayout();
  };
  private readonly subscribeDataChanges = (
    listener: () => void
  ): (() => void) => this.plugin.onDataChange(listener);
  private readonly getCsvMapping = (
    signature: string
  ): CsvColumnMapping | undefined =>
    this.plugin.csvMapping(signature)?.mapping;
  private readonly saveCsvMapping = (
    headerSignature: string,
    mapping: CsvColumnMapping
  ): Promise<void> => this.plugin.saveCsvMapping({
    header_signature: headerSignature,
    mapping,
    updated_at: new Date().toISOString()
  });
  private readonly confirmAction = (
    title: string,
    message: string,
    confirmText?: string
  ): Promise<boolean> =>
    confirmAction(this.app, title, message, confirmText);

  constructor(leaf: WorkspaceLeaf, private readonly plugin: AssetTrackPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_ASSET_TRACK;
  }

  getDisplayText(): string {
    return this.state.month
      ? `Asset Track · ${this.state.month}`
      : "Asset Track";
  }

  getIcon(): string {
    return "landmark";
  }

  async setState(
    state: Record<string, unknown>,
    result: ViewStateResult
  ): Promise<void> {
    if (
      this.dirty
      && !await this.confirmAction(
        t("放弃未保存草稿？", "Discard unsaved changes?"),
        t(
          "当前 Asset Track 草稿尚未保存。放弃后继续？",
          "The current Asset Track draft has not been saved. Discard it and continue?"
        ),
        t("放弃并继续", "Discard and continue")
      )
    ) {
      return;
    }
    const requestedMode = typeof state.mode === "string" ? state.mode : "";
    const requestedAnalysisMode =
      typeof state.analysisMode === "string" ? state.analysisMode : "";
    this.state = {
      mode: EDITOR_MODES.includes(requestedMode as EditorMode)
        ? requestedMode as EditorMode
        : "analysis",
      analysisMode: ANALYSIS_MODES.includes(
        requestedAnalysisMode as AnalysisMode
      )
        ? requestedAnalysisMode as AnalysisMode
        : "home",
      month: state.month as string | undefined
    };
    await super.setState(state, result);
    this.render();
  }

  getState(): Record<string, unknown> {
    return this.state;
  }

  hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("asset-track-view");
    await this.plugin.prepareDatabaseOnViewOpen();
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    if (!this.plugin.isDatabaseReady()) {
      this.root?.unmount();
      this.root = null;
      this.contentEl.empty();
      const guide = this.contentEl.createDiv("asset-track-setup-guide");
      guide.createEl("h2", {
        text: t("Asset Track 尚未配置", "Asset Track is not configured")
      });
      guide.createEl("p", {
        text: this.plugin.databaseState === "initializing"
          ? t("正在初始化数据库……", "Initializing the database…")
          : t(
              "请先在插件设置中选择当前 Vault 内的 Asset-track 数据目录，然后创建或载入数据库。",
              "Choose an Asset Track data directory inside the current vault in plugin settings, then create or load a database."
            )
      });
      if (this.plugin.databaseError) {
        guide.createEl("p", {
          text: t(
            `数据库未载入，原文件未修改：${displayError(this.plugin.databaseError)}`,
            `Database not loaded; original files were not changed: ${displayError(this.plugin.databaseError)}`
          )
        });
      }
      const button = guide.createEl("button", {
        text: t("打开插件设置", "Open plugin settings")
      });
      this.registerDomEvent(
        button,
        "click",
        () => this.plugin.openPluginSettings()
      );
      return;
    }
    if (!this.root) {
      this.contentEl.empty();
      this.root = createRoot(this.contentEl);
    }
    this.root?.render(
      createElement(
        AssetTrackErrorBoundary,
        { onReload: () => this.refresh() },
        createElement(AssetTrackEditorApp, {
          api: this.plugin.api,
          settings: this.plugin.settings,
          initialMode: this.state.mode ?? "analysis",
          initialAnalysisMode: this.state.analysisMode ?? "home",
          initialMonth: this.state.month,
          hostWindow: this.contentEl.ownerDocument.defaultView
            ?? this.containerEl.ownerDocument.defaultView
            ?? activeWindow,
          confirmAction: this.confirmAction,
          onDirtyChange: this.onDirtyChange,
          onStateChange: this.onStateChange,
          subscribeDataChanges: this.subscribeDataChanges,
          getCsvMapping: this.getCsvMapping,
          saveCsvMapping: this.saveCsvMapping
        })
      )
    );
  }

  async onClose(): Promise<void> {
    if (this.dirty) {
      const discard = await this.confirmAction(
        t("关闭并放弃草稿？", "Close and discard the draft?"),
        t(
          "Asset Track 编辑器仍有未保存草稿。关闭将放弃这些更改，是否继续？",
          "The Asset Track editor still has unsaved changes. Closing it will discard them. Continue?"
        ),
        t("关闭并放弃", "Close and discard")
      );
      if (!discard) {
        const hostWindow = this.containerEl.ownerDocument.defaultView;
        hostWindow?.setTimeout(
          () => void this.plugin.openEditor(
            this.state.mode,
            this.state.month,
            this.state.analysisMode
          ),
          0
        );
      }
    }
    this.root?.unmount();
    this.root = null;
  }
}
