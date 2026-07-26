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
    if (this.dirty && !window.confirm("当前 Asset Track 草稿尚未保存。放弃后继续？")) {
      return;
    }
    const requestedMode = String(state.mode ?? "");
    this.state = {
      mode: EDITOR_MODES.includes(requestedMode as EditorMode)
        ? requestedMode as EditorMode
        : "analysis",
      analysisMode: ANALYSIS_MODES.includes(
        String(state.analysisMode ?? "") as AnalysisMode
      )
        ? state.analysisMode as AnalysisMode
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
    this.root = createRoot(this.contentEl);
    this.render();
  }

  private render(): void {
    this.root?.render(
      createElement(AssetTrackEditorApp, {
        api: this.plugin.api,
        initialMode: this.state.mode ?? "analysis",
        initialAnalysisMode: this.state.analysisMode ?? "home",
        initialMonth: this.state.month,
        onDirtyChange: (dirty: boolean) => {
          this.dirty = dirty;
        },
        onStateChange: (
          mode: EditorMode,
          analysisMode: AnalysisMode,
          month: string
        ) => {
          this.state = { mode, analysisMode, month };
          this.app.workspace.requestSaveLayout();
        },
        subscribeDataChanges: (listener: () => void) =>
          this.plugin.onDataChange(listener)
      })
    );
  }

  async onClose(): Promise<void> {
    if (this.dirty) {
      const discard = window.confirm(
        "Asset Track 编辑器仍有未保存草稿。关闭将放弃这些更改，是否继续？"
      );
      if (!discard) {
        window.setTimeout(
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
